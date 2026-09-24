import type {
  ArtifactDetail,
  ArtifactInput,
  ArtifactInputRelation,
  ArtifactInputRelationInput,
  ArtifactInputRelationKind,
  ArtifactSourceDeclarationKind,
  ArtifactSummary,
  ArtifactThumbnail,
  ArtifactVersionDetail,
  ValidationStatus,
} from '@betterwork/agent-protocol';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EmptyPage } from '../components/EmptyState';
import { FieldSelect } from '../components/FieldSelect';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { type ToastTone, TransientToast } from '../components/TransientToast';
import { useArtifactSourceSelection } from '../hooks/use-artifact-source-selection';
import { useArtifactThumbnails } from '../hooks/use-artifact-thumbnails';
import { useArtifactViewer } from '../hooks/use-artifact-viewer';
import type { WorkspaceReferencesState } from '../hooks/use-workspace-references';
import {
  ArtifactIcon,
  CapabilityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  KnowledgeIcon,
} from '../icons';
import { reportAction, trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { MarkdownPreview } from '../markdown-preview';

const MIME_LABEL_MAP: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
};

const fileTypeLabel = (mimeType: string): string =>
  MIME_LABEL_MAP[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? 'FILE';

const inputLabel = (input: ArtifactInput): string => {
  if (input.kind === 'evidence') return `证据 · ${input.evidenceId}`;
  if (input.kind === 'knowledge-revision') return `知识修订 · ${input.knowledgeRevisionId}`;
  if (input.kind === 'artifact-version') return `成果版本 · ${input.artifactVersionId}`;
  if (input.sourcePath) return input.sourcePath.split('/').pop() ?? input.snapshotId;
  return input.snapshotId;
};

/** 声明种类与输入关系都用中文呈现：审阅者要能区分「声明采用」与「只是访问过」。 */
const DECLARATION_KIND_LABEL: Record<ArtifactSourceDeclarationKind, string> = {
  model: '模型声明采用',
  user: '用户选择采用',
  inherited: '继承前版声明',
  legacy: '历史关联，未核实采用',
  none: '未声明采用依据',
};

const RELATION_ORDER: readonly ArtifactInputRelationKind[] = [
  'data',
  'rule',
  'comparison',
  'structure',
  'template',
  'background',
  'other',
];

const RELATION_LABEL: Record<ArtifactInputRelation['relation'], string> = {
  data: '数据依据',
  rule: '规则口径',
  comparison: '历史对比',
  structure: '结构参考',
  template: '模板',
  background: '背景参考',
  other: '其他',
};

const RELATION_OPTIONS = RELATION_ORDER.map((kind) => ({ id: kind, label: RELATION_LABEL[kind] }));

const inputSourceLabel = (input: ArtifactInput): string => {
  if (input.kind === 'evidence') return '证据';
  if (input.kind === 'knowledge-revision') return '文档级依据，非全文已读';
  if (input.kind === 'artifact-version') return '成果版本';
  return '工作区输入';
};

const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  passed: '通过',
  failed: '未通过',
  pending: '待检查',
  'not-checked': '未检查',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactPage({
  artifacts,
  selected,
  onSelect,
  onSave,
  onExport,
  onOpenFile,
  onOpenSource,
  onStartFromVersion,
  references,
  onReferenceToTask,
  onBack,
}: {
  artifacts: ArtifactSummary[];
  selected: ArtifactDetail | undefined;
  onSelect: (artifact: ArtifactSummary) => void;
  /** `inputRelations` 省略表示沿用前版声明，空数组表示用户主动清除采用声明。 */
  onSave: (
    artifact: ArtifactDetail,
    title: string,
    content: string,
    inputRelations?: ArtifactInputRelationInput[],
  ) => Promise<void>;
  onExport: (
    artifact: ArtifactDetail,
    versionId?: string,
  ) => Promise<{ cancelled: boolean; filePath?: string }>;
  onOpenFile: (
    artifactId: string,
    versionId?: string,
  ) => Promise<{ opened: boolean; error?: string }>;
  onOpenSource: (sourcePath: string) => Promise<void>;
  onStartFromVersion: (artifact: ArtifactDetail, version: ArtifactVersionDetail) => Promise<void>;
  /** §3.6 参考成果版本：未接线（如测试或无空间）时不显示该区。 */
  references?: WorkspaceReferencesState | undefined;
  onReferenceToTask?: ((artifactVersionId: string) => void) | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const {
    editing,
    title,
    content,
    error,
    versions,
    visibleVersion,
    setTitle,
    setContent,
    setError,
    beginEditing,
    cancelEditing,
    finishEditing,
    selectVersion,
  } = useArtifactViewer(selected);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string }>();
  const dismissToast = useCallback(() => setToast(undefined), []);
  const thumbnails = useArtifactThumbnails({
    artifactId: selected?.type === 'presentation' ? selected.id : undefined,
    versionId: selected?.type === 'presentation' ? visibleVersion?.id : undefined,
  });
  const sourceSelection = useArtifactSourceSelection(visibleVersion);
  if (selected && visibleVersion)
    return (
      <>
        <PageHeader
          eyebrow={`${selected.type === 'markdown' ? 'Markdown' : fileTypeLabel(selected.mimeType)} · v${visibleVersion.versionNumber}${visibleVersion.origin === 'user-edit' ? ' · 人工修订' : ''}${visibleVersion.id !== selected.currentVersionId ? ' · 历史版本' : ''}`}
          title={selected.title}
          leading={
            <button className="back-button" onClick={onBack}>
              <ChevronLeftIcon size={13} /> 成果
            </button>
          }
          actions={
            !editing && (
              <>
                {selected.type === 'presentation' && (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      reportAction(
                        onOpenFile(selected.id, visibleVersion.id).then((result) => {
                          if (!result.opened) {
                            setToast({
                              tone: 'error',
                              message: result.error || '无法打开文件。',
                            });
                          }
                        }),
                        (errorMessage) =>
                          setToast({ tone: 'error', message: errorMessage || '打开失败。' }),
                      )
                    }
                  >
                    打开
                  </button>
                )}
                <button
                  className="secondary-button"
                  onClick={() =>
                    reportAction(
                      onExport(selected, visibleVersion.id).then((result) => {
                        if (!result.cancelled) {
                          setToast({
                            tone: 'success',
                            message: `已导出到 ${result.filePath ?? '所选位置'}。`,
                          });
                        }
                      }),
                      (errorMessage) =>
                        setToast({ tone: 'error', message: errorMessage || '导出失败。' }),
                    )
                  }
                >
                  {selected.type === 'markdown' ? '导出 Markdown' : '导出文件'}
                </button>
                {selected.type === 'markdown' && (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      reportAction(onStartFromVersion(selected, visibleVersion), (errorMessage) =>
                        setToast({ tone: 'error', message: errorMessage || '无法开始新任务。' }),
                      )
                    }
                  >
                    基于此版本开始新任务
                  </button>
                )}
                {selected.type === 'markdown' && (
                  <button className="primary-button" onClick={beginEditing}>
                    编辑此版本
                  </button>
                )}
              </>
            )
          }
        />
        <ScrollRegion ariaLabel="成果版本详情">
          <section className="page-body artifact-detail-page">
            <p className="page-intro">
              {selected.type === 'presentation'
                ? visibleVersion.id !== selected.currentVersionId
                  ? '正在查看历史版本；可通过「打开」用系统应用查看。'
                  : '来自一次任务运行，可用系统应用打开或导出到本地。'
                : visibleVersion.id !== selected.currentVersionId
                  ? '正在查看历史版本；编辑后会从这里创建新的人工修订版本。'
                  : visibleVersion.origin === 'user-edit'
                    ? '这是人工修订版本；此前版本仍可回溯。'
                    : '来自一次任务运行，可在后续继续修订并形成新版本。'}
            </p>
            {references && !editing && (
              <ReferenceVersionSection
                references={references}
                artifactTitle={selected.title}
                version={visibleVersion}
                onReferenceToTask={onReferenceToTask}
              />
            )}
            {error && (
              <p className="artifact-action-error" role="alert">
                {error}
              </p>
            )}
            {(visibleVersion.inputRelations?.length ?? 0) > 0 ||
            visibleVersion.sourceDeclarationKind !== undefined ? (
              <section className="artifact-input-grid">
                <h4>
                  声明采用依据 ·{' '}
                  {DECLARATION_KIND_LABEL[visibleVersion.sourceDeclarationKind ?? 'none']}
                </h4>
                {(visibleVersion.inputRelations ?? []).length === 0 && (
                  <p className="muted-text">
                    {visibleVersion.sourceDeclarationKind === 'legacy'
                      ? '这些输入关系来自旧版本，未经过采用核实。'
                      : '本版本没有声明采用依据；下方访问记录只表示运行读到过。'}
                  </p>
                )}
                <div className="artifact-input-cards">
                  {(visibleVersion.inputRelations ?? []).map((relation) => {
                    const fileName = inputLabel(relation.input);
                    const sourceLabel = inputSourceLabel(relation.input);
                    const isSnapshot = relation.input.kind === 'workspace-input-snapshot';
                    const Icon = isSnapshot ? KnowledgeIcon : ArtifactIcon;
                    return (
                      <div
                        key={`${relation.outputVersionId}:${JSON.stringify(relation.input)}`}
                        className="artifact-input-card"
                        title={`${fileName} · ${relation.relation} · ${sourceLabel}`}
                      >
                        <span className="artifact-input-card-icon">
                          <Icon size={16} />
                        </span>
                        <div className="artifact-input-card-body">
                          <span className="artifact-input-card-name">{fileName}</span>
                          <span className="artifact-input-card-meta">
                            {RELATION_LABEL[relation.relation]} · {sourceLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <div className="artifact-detail-layout">
              <aside className="artifact-version-list">
                <div>
                  <strong>版本历史</strong>
                  <span>{versions.length} 个版本</span>
                </div>
                {versions.map((version) => (
                  <button
                    key={version.id}
                    className={version.id === visibleVersion.id ? 'active' : ''}
                    onClick={() =>
                      reportAction(selectVersion(version), setError, '打开该版本失败，请重试。')
                    }
                  >
                    <span>v{version.versionNumber}</span>
                    <small>
                      {version.origin === 'user-edit' ? '人工修订' : 'AI 生成'} ·{' '}
                      {formatTime(version.createdAt)}
                    </small>
                  </button>
                ))}
                {visibleVersion.evidence.length > 0 && (
                  <div className="artifact-evidence-list">
                    <strong>运行访问记录</strong>
                    {visibleVersion.evidence.map((item) => {
                      const isWeb = item.sourceType === 'web-page';
                      const isMcp = item.sourceType === 'mcp-tool';
                      const Icon = isWeb ? GlobeIcon : isMcp ? CapabilityIcon : KnowledgeIcon;
                      return (
                        <article key={item.id}>
                          <b>
                            <Icon size={10} />
                          </b>
                          <div className="artifact-evidence-main">
                            <span>{item.title}</span>
                            <small>
                              {item.locator} ·{' '}
                              {isMcp ? 'MCP 工具' : isWeb ? '网页来源' : '本地资料'}
                            </small>
                          </div>
                          {!isWeb && !isMcp && (
                            <button
                              className="evidence-open-button"
                              type="button"
                              onClick={() =>
                                reportAction(
                                  onOpenSource(item.sourceUri).then(() =>
                                    setToast({
                                      tone: 'success',
                                      message: `已打开「${item.title}」的原始资料。`,
                                    }),
                                  ),
                                  (errorMessage) =>
                                    setToast({
                                      tone: 'error',
                                      message: errorMessage || '无法打开原始资料。',
                                    }),
                                )
                              }
                            >
                              原文
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </aside>
              {selected.type === 'markdown' ? (
                editing ? (
                  <form
                    className="artifact-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setError('');
                      onSave(selected, title, content, sourceSelection.buildInputRelations())
                        .then(finishEditing)
                        .catch((reason: unknown) =>
                          setError(reason instanceof Error ? reason.message : '保存修订失败。'),
                        );
                    }}
                  >
                    <label>
                      标题
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={160}
                        required
                      />
                    </label>
                    <label>
                      Markdown 内容
                      <textarea
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        required
                      />
                    </label>
                    {sourceSelection.hasCandidates && (
                      <fieldset className="artifact-source-select">
                        <legend>采用来源</legend>
                        <p className="muted-text">
                          {sourceSelection.touched
                            ? '已重新选择：保存后新版按这些精确来源记为用户选择采用。'
                            : '不勾选则沿用上一版声明；这里只列出运行真正返回过定位的来源。'}
                        </p>
                        {sourceSelection.candidates.map((candidate) => (
                          <div className="artifact-source-row" key={candidate.evidenceId}>
                            <input
                              type="checkbox"
                              id={`artifact-source-${candidate.evidenceId}`}
                              checked={sourceSelection.isSelected(candidate.evidenceId)}
                              onChange={() => sourceSelection.toggle(candidate.evidenceId)}
                            />
                            <label
                              htmlFor={`artifact-source-${candidate.evidenceId}`}
                              className="artifact-source-name"
                            >
                              {candidate.title}
                              <small>{candidate.operationLabel}</small>
                            </label>
                            {sourceSelection.isSelected(candidate.evidenceId) && (
                              <FieldSelect
                                options={RELATION_OPTIONS}
                                value={sourceSelection.relationFor(candidate.evidenceId)}
                                onChange={(id) => {
                                  const kind = RELATION_ORDER.find((key) => key === id);
                                  if (kind) sourceSelection.setRelation(candidate.evidenceId, kind);
                                }}
                                ariaLabel={`${candidate.title} 的依据类型`}
                              />
                            )}
                          </div>
                        ))}
                        {sourceSelection.touched && (
                          <button
                            className="text-button"
                            type="button"
                            onClick={sourceSelection.inheritPrevious}
                          >
                            改为沿用上一版声明
                          </button>
                        )}
                      </fieldset>
                    )}
                    <footer>
                      <span>保存后会创建 v{selected.versionNumber + 1} 人工修订版本。</span>
                      <div>
                        <button type="button" className="secondary-button" onClick={cancelEditing}>
                          取消
                        </button>
                        <button type="submit" className="primary-button">
                          保存新版本
                        </button>
                      </div>
                    </footer>
                  </form>
                ) : (
                  <MarkdownPreview content={(visibleVersion as { content: string }).content} />
                )
              ) : (
                <PresentationPreview
                  version={visibleVersion}
                  thumbnails={thumbnails.items}
                  loading={thumbnails.loading}
                  error={thumbnails.error}
                />
              )}
            </div>
          </section>
        </ScrollRegion>
        {toast && <TransientToast {...toast} onDismiss={dismissToast} />}
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="成果"
        title="可继续工作的交付物"
        actions={<span className="work-count">{artifacts.length} 项</span>}
      />
      <ScrollRegion ariaLabel="成果列表">
        <section className="page-body completed-work-page">
          <p className="page-intro">
            研究成果、Markdown 文档和 PPT 等文件成果均可版本化管理，方便后续继续修改和导出。
          </p>
          {artifacts.length === 0 ? (
            <EmptyPage
              eyebrow="尚无成果"
              title="将一次完成的回复保存为成果"
              detail="成果不同于运行记录：它会关联任务、来源运行与版本，方便后续继续修改和导出。"
            />
          ) : (
            <ViewContainer mode="list" className="completed-work-list">
              {artifacts.map((artifact) => (
                <button
                  className="completed-work-card"
                  key={artifact.id}
                  onClick={() => onSelect(artifact)}
                >
                  <span
                    className={`completed-work-icon ${artifact.type === 'markdown' ? 'markdown' : 'file'}`}
                    aria-hidden="true"
                  >
                    {artifact.type === 'markdown' ? 'MD' : 'PPT'}
                  </span>
                  <div>
                    <strong>{artifact.title}</strong>
                    <p>
                      {artifact.type === 'markdown' ? 'Markdown' : '文件成果'} · v
                      {artifact.versionNumber}
                      {artifact.origin === 'user-edit' ? ' · 人工修订' : ''} · 更新于{' '}
                      {formatTime(artifact.updatedAt)}
                    </p>
                  </div>
                  <span aria-hidden="true">
                    <ChevronRightIcon size={16} />
                  </span>
                </button>
              ))}
            </ViewContainer>
          )}
        </section>
      </ScrollRegion>
    </>
  );
}

function PresentationPreview({
  version,
  thumbnails,
  loading,
  error,
}: {
  version: ArtifactVersionDetail;
  thumbnails: ArtifactThumbnail[];
  loading: boolean;
  error?: string | undefined;
}): React.JSX.Element {
  // 放大查看的页号。必须满足两点：
  // 1）在所有早退分支之前声明，否则违反 Hook 调用顺序；
  // 2）绑定 versionId，否则切换版本后旧页号会把新 deck 的同号页面当成用户要看的那一页。
  const [expanded, setExpanded] = useState<{ versionId: string; slideIndex: number }>();
  if (version.type !== 'presentation') return <></>;
  if (loading) {
    return (
      <div className="artifact-file-info">
        <div className="artifact-file-info-row">
          <span>正在生成幻灯片预览…</span>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="artifact-file-info">
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">预览</span>
          <span>{error}</span>
        </div>
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">文件类型</span>
          <span>{fileTypeLabel(version.mimeType)}</span>
        </div>
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">文件大小</span>
          <span>{formatFileSize(version.fileSize)}</span>
        </div>
      </div>
    );
  }
  if (thumbnails.length === 0) {
    return (
      <div className="artifact-file-info">
        <div className="artifact-file-info-row">
          <span>暂无预览，可通过「打开」用系统应用查看。</span>
        </div>
      </div>
    );
  }
  return (
    <div className="artifact-presentation-preview">
      <div className="artifact-file-info">
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">文件类型</span>
          <span>{fileTypeLabel(version.mimeType)}</span>
        </div>
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">文件大小</span>
          <span>{formatFileSize(version.fileSize)}</span>
        </div>
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">结构校验</span>
          <span>{VALIDATION_LABEL[version.validation.structure]}</span>
        </div>
        <div className="artifact-file-info-row">
          <span className="artifact-file-info-label">视觉检查</span>
          <span>{VALIDATION_LABEL[version.validation.visual]}</span>
        </div>
        {version.description && (
          <div className="artifact-file-info-row">
            <span className="artifact-file-info-label">说明</span>
            <span>{version.description}</span>
          </div>
        )}
      </div>
      <div className="artifact-thumbnail-gallery">
        {thumbnails.map((thumb) => (
          <div key={thumb.slideIndex} className="artifact-thumbnail-item">
            <button
              type="button"
              className="artifact-thumbnail-trigger"
              aria-label={`放大查看第 ${thumb.slideIndex + 1} 页`}
              onClick={() => setExpanded({ versionId: version.id, slideIndex: thumb.slideIndex })}
            >
              <img
                src={thumb.dataUrl}
                alt={`幻灯片 ${thumb.slideIndex + 1}`}
                className="artifact-thumbnail-image"
                loading="lazy"
              />
            </button>
            <span className="artifact-thumbnail-index">第 {thumb.slideIndex + 1} 页</span>
          </div>
        ))}
      </div>
      <SlideViewer
        versionId={version.id}
        thumbnails={thumbnails}
        expanded={expanded}
        onExpand={(slideIndex) => setExpanded({ versionId: version.id, slideIndex })}
        onClose={() => setExpanded(undefined)}
      />
    </div>
  );
}

/**
 * 幻灯片放大查看层。复用 `.dialog-backdrop` 的遮罩与层级，不另建一套弹框体系；
 * 渲染的是主进程解码成 `data:` URL 的本地图片，不发起任何网络或文件请求。
 */
function SlideViewer({
  versionId,
  thumbnails,
  expanded,
  onExpand,
  onClose,
}: {
  versionId: string;
  thumbnails: ArtifactThumbnail[];
  expanded: { versionId: string; slideIndex: number } | undefined;
  onExpand: (slideIndex: number) => void;
  onClose: () => void;
}): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const position =
    expanded && expanded.versionId === versionId
      ? thumbnails.findIndex((thumb) => thumb.slideIndex === expanded.slideIndex)
      : -1;
  const active = position >= 0 ? thumbnails[position] : undefined;
  // 依赖用布尔量而不是 `active` 对象：把派生对象放进依赖数组一旦引用每次渲染都变，
  // 就会复现本次修掉的死循环（见 use-artifact-viewer.ts 的同名注释）。
  const isOpen = active !== undefined;

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  if (!active) return <></>;

  const step = (delta: number): void => {
    const target = thumbnails[position + delta];
    if (target) onExpand(target.slideIndex);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  };

  const pageNumber = position + 1;
  const pageCount = thumbnails.length;
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="slide-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`幻灯片第 ${pageNumber} 页，共 ${pageCount} 页`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="slide-viewer-bar">
          <span className="slide-viewer-counter">
            第 {pageNumber} / {pageCount} 页
          </span>
          <div>
            <button
              className="secondary-button"
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => step(-1)}
            >
              上一页
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={pageNumber >= pageCount}
              onClick={() => step(1)}
            >
              下一页
            </button>
            <button ref={closeRef} className="secondary-button" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>
        <img
          className="slide-viewer-image"
          src={active.dataUrl}
          alt={`幻灯片第 ${pageNumber} 页放大预览`}
        />
      </section>
    </div>,
    document.body,
  );
}

/**
 * 本空间的参考成果版本（产品设计 §3.6、实施契约 §10）。
 *
 * 三条约束：
 * - 标记固定到 `artifactVersionId` + 内容哈希，**不跟随最新**；
 * - 标记只表示参考选择，界面不得把它写成批准、正确或「本期已读取」；
 * - 写入失败（含 CAS 冲突）走内联错误，成功才是局部短时确认。
 */
function ReferenceVersionSection({
  references,
  artifactTitle,
  version,
  onReferenceToTask,
}: {
  references: WorkspaceReferencesState;
  artifactTitle: string;
  version: ArtifactVersionDetail;
  onReferenceToTask: ((artifactVersionId: string) => void) | undefined;
}): React.JSX.Element {
  const [note, setNote] = useState('');
  const reference = references.referenceOf(version.id);
  const busy = references.pendingVersionId === version.id;

  const mark = (): void => {
    trackAction(
      references
        .markReference(version.id, `v${version.versionNumber} · ${artifactTitle}`)
        .then((result) => {
          if (result.ok) {
            setNote(
              `已把 v${version.versionNumber} 指定为本空间参考版本：标记只表示参考选择，不表示内容正确或审批通过。`,
            );
          }
        }),
      '指定参考版本',
    );
  };

  const remove = (): void => {
    if (!reference) return;
    trackAction(
      references.removeReference(reference).then((result) => {
        if (result.ok) setNote('已取消参考；成果与版本本身不受影响。');
      }),
      '取消参考版本',
    );
  };

  return (
    <section className="artifact-reference-section">
      <div className="artifact-reference-heading">
        <div>
          <strong>本空间参考版本</strong>
          <small>
            {reference
              ? `当前查看的 v${version.versionNumber} 已标记为参考`
              : `当前查看的 v${version.versionNumber} 尚未标记`}
          </small>
        </div>
        <div className="artifact-reference-actions">
          {reference ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={remove}>
              取消参考
            </button>
          ) : (
            <button type="button" className="secondary-button" disabled={busy} onClick={mark}>
              {busy ? '正在提交…' : '指定为本空间参考版本'}
            </button>
          )}
          {onReferenceToTask && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onReferenceToTask(version.id)}
            >
              引用到当前任务
            </button>
          )}
        </div>
      </div>
      <p className="artifact-reference-note">
        标记与引用都固定到这一版的内容哈希，成果新增版本后参考仍指旧版本；引用只会把该版本加进当前任务材料，
        不会自动发送，也不会改变当前专家。
      </p>
      {references.error && (
        <p className="inline-message error" role="alert">
          {references.error}
        </p>
      )}
      {note && <TransientToast tone="success" message={note} onDismiss={() => setNote('')} />}
    </section>
  );
}
