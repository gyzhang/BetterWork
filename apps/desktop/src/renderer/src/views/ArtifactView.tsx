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
import { useCallback, useRef, useState } from 'react';

import { ActionBar } from '../components/ActionBar';
import { AsyncButton, InlineLoading } from '../components/AsyncButton';
import { Button } from '../components/Button';
import { Disclosure } from '../components/Disclosure';
import { EmptyPage } from '../components/EmptyState';
import { Field } from '../components/Field';
import { FieldSelect } from '../components/FieldSelect';
import { InlineError } from '../components/InlineError';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { ListRow } from '../components/ListRow';
import { Modal } from '../components/Modal';
import { SectionHeader } from '../components/SectionHeader';
import { SourceRow } from '../components/SourceRow';
import { TextArea, TextField } from '../components/TextField';
import { type ToastTone, TransientToast } from '../components/TransientToast';
import { useArtifactSourceSelection } from '../hooks/use-artifact-source-selection';
import { useArtifactThumbnails } from '../hooks/use-artifact-thumbnails';
import { useArtifactViewer } from '../hooks/use-artifact-viewer';
import type { WorkspaceReferencesState } from '../hooks/use-workspace-references';
import { ArtifactIcon, ChevronLeftIcon, ChevronRightIcon, KnowledgeIcon } from '../icons';
import { reportAction, trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { fileTypeLabel } from '../lib/labels';
import { MarkdownPreview } from '../markdown-preview';

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
  return '工作空间输入';
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
  referenceScope,
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
  /**
   * 成果归属与当前空间的隔离关系。参考版本只允许同空间（仓储 `requireOwnedVersion`
   * 会拒），所以不属于当前空间的成果不能提供「指定为参考」「引用到当前任务」
   * 这两颗点了才知道不行的按钮（docs/10 §10.1「一张卡片要能自我介绍」同一口径）。
   */
  referenceScope?: { inScope: boolean; ownerWorkspaceName: string } | undefined;
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
  // 页头那行小字要说清「这是哪一版、在不在本空间」：成果列表是跨空间全量的，
  // 不写归属就会让人对着别的空间的成果点「引用到当前任务」，点了才被仓储拒掉。
  const headerEyebrow =
    selected && visibleVersion
      ? [
          selected.type === 'markdown' ? 'Markdown' : fileTypeLabel(selected.mimeType),
          `v${visibleVersion.versionNumber}`,
          ...(visibleVersion.origin === 'user-edit' ? ['人工修订'] : []),
          ...(visibleVersion.id !== selected.currentVersionId ? ['历史版本'] : []),
          ...(referenceScope && !referenceScope.inScope
            ? [`属于「${referenceScope.ownerWorkspaceName}」`]
            : []),
        ].join(' · ')
      : '';
  if (selected && visibleVersion)
    return (
      <>
        <PageHeader
          eyebrow={headerEyebrow}
          title={selected.title}
          leading={
            <Button variant="link" size="sm" onClick={onBack}>
              <ChevronLeftIcon size={13} /> 成果
            </Button>
          }
          actions={
            !editing && (
              <>
                {selected.type === 'presentation' && (
                  <Button
                    variant="secondary"
                    size="lg"
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
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
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
                </Button>
                {selected.type === 'markdown' && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() =>
                      reportAction(onStartFromVersion(selected, visibleVersion), (errorMessage) =>
                        setToast({ tone: 'error', message: errorMessage || '无法开始新任务。' }),
                      )
                    }
                  >
                    基于此版本开始新任务
                  </Button>
                )}
                {selected.type === 'markdown' && (
                  <Button variant="primary" size="lg" onClick={beginEditing}>
                    编辑此版本
                  </Button>
                )}
              </>
            )
          }
        />
        <ScrollRegion ariaLabel="成果版本详情">
          <section className="page-body artifact-detail-page">
            {error && <InlineError message={error} onDismiss={() => setError('')} />}
            {references?.error && (
              <InlineError message={references.error} onDismiss={references.clearError} />
            )}
            <Disclosure label="参考设置与声明采用依据">
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
                  scope={referenceScope}
                  onReferenceToTask={onReferenceToTask}
                />
              )}
              {(visibleVersion.inputRelations?.length ?? 0) > 0 ||
              visibleVersion.sourceDeclarationKind !== undefined ? (
                <section className="artifact-input-grid">
                  <SectionHeader
                    className="artifact-input-heading"
                    title={`声明采用依据 · ${DECLARATION_KIND_LABEL[visibleVersion.sourceDeclarationKind ?? 'none']}`}
                  />
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
                        <ListRow
                          key={`${relation.outputVersionId}:${JSON.stringify(relation.input)}`}
                          variant="card"
                          leading={
                            <span className="artifact-input-card-icon">
                              <Icon size={16} />
                            </span>
                          }
                          title={fileName}
                          detail={`${RELATION_LABEL[relation.relation]} · ${sourceLabel}`}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </Disclosure>
            <div className="artifact-detail-layout">
              <aside className="artifact-version-list">
                <SectionHeader
                  variant="panel"
                  title="版本历史"
                  hint={`${versions.length} 个版本`}
                />
                {versions.map((version) => (
                  <ListRow
                    key={version.id}
                    variant="plain"
                    selected={version.id === visibleVersion.id}
                    label={`打开版本 v${version.versionNumber}`}
                    onClick={() =>
                      reportAction(selectVersion(version), setError, '打开该版本失败，请重试。')
                    }
                    title={`v${version.versionNumber}`}
                    detail={`${version.origin === 'user-edit' ? '人工修订' : 'AI 生成'} · ${formatTime(version.createdAt)}`}
                  />
                ))}
                {visibleVersion.evidence.length > 0 && (
                  <div className="artifact-evidence-list">
                    <SectionHeader variant="panel" title="运行访问记录" />
                    {visibleVersion.evidence.map((item) => (
                      <SourceRow
                        key={item.id}
                        item={item}
                        variant="plain"
                        onOpenSource={() =>
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
                      />
                    ))}
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
                    <Field label="标题">
                      <TextField
                        size="md"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={160}
                        required
                      />
                    </Field>
                    <Field label="Markdown 内容">
                      <TextArea
                        mono
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        required
                      />
                    </Field>
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
                                size="sm"
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
                          <Button
                            variant="text"
                            size="sm"
                            type="button"
                            onClick={sourceSelection.inheritPrevious}
                          >
                            改为沿用上一版声明
                          </Button>
                        )}
                      </fieldset>
                    )}
                    <ActionBar
                      hint={`保存后会创建 v${selected.versionNumber + 1} 人工修订版本。`}
                      label="保存成果修订"
                    >
                      <Button variant="secondary" size="md" type="button" onClick={cancelEditing}>
                        取消
                      </Button>
                      <Button variant="primary" size="md" type="submit">
                        保存新版本
                      </Button>
                    </ActionBar>
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
                <ListRow
                  key={artifact.id}
                  onClick={() => onSelect(artifact)}
                  leading={
                    <span
                      className={`completed-work-icon ${artifact.type === 'markdown' ? 'markdown' : 'file'}`}
                      aria-hidden="true"
                    >
                      {artifact.type === 'markdown' ? 'MD' : 'PPT'}
                    </span>
                  }
                  title={artifact.title}
                  detail={
                    <>
                      {artifact.type === 'markdown' ? 'Markdown' : '文件成果'} · v
                      {artifact.versionNumber}
                      {artifact.origin === 'user-edit' ? ' · 人工修订' : ''} · 更新于{' '}
                      {formatTime(artifact.updatedAt)}
                    </>
                  }
                  trailing={
                    <span aria-hidden="true">
                      <ChevronRightIcon size={16} />
                    </span>
                  }
                />
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
          <InlineLoading label="正在生成幻灯片预览…" />
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
 * 幻灯片放大查看层。外壳与键盘语义都来自 `Modal` 基座（`variant="viewer"`），
 * 这里只留放映层自己的左右翻页；渲染的是主进程解码成 `data:` URL 的本地图片，不发起任何网络或文件请求。
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

  if (!active) return <></>;

  const step = (delta: number): void => {
    const target = thumbnails[position + delta];
    if (target) onExpand(target.slideIndex);
  };

  // 基座负责 Esc／背板／焦点（见 components/Modal.tsx）；左右翻页是放映层自己的语义，留在这里。
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
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
  return (
    <Modal
      variant="viewer"
      className="slide-viewer"
      label={`幻灯片第 ${pageNumber} 页，共 ${pageCount} 页`}
      initialFocusRef={closeRef}
      onKeyDown={handleKeyDown}
      onClose={onClose}
    >
      <header className="slide-viewer-bar">
        <span className="slide-viewer-counter">
          第 {pageNumber} / {pageCount} 页
        </span>
        <div>
          <Button
            variant="secondary"
            size="md"
            type="button"
            disabled={pageNumber <= 1}
            onClick={() => step(-1)}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            size="md"
            type="button"
            disabled={pageNumber >= pageCount}
            onClick={() => step(1)}
          >
            下一页
          </Button>
          <Button variant="secondary" size="md" ref={closeRef} type="button" onClick={onClose}>
            关闭
          </Button>
        </div>
      </header>
      <img
        className="slide-viewer-image"
        src={active.dataUrl}
        alt={`幻灯片第 ${pageNumber} 页放大预览`}
      />
    </Modal>
  );
}

/**
 * 本空间的参考成果版本（产品设计 §3.6、实施契约 §10）。
 *
 * 四条约束：
 * - 标记固定到 `artifactVersionId` + 内容哈希，**不跟随最新**；
 * - 标记只表示参考选择，界面不得把它写成批准、正确或「本期已读取」；
 * - 写入失败（含 CAS 冲突）走内联错误，成功才是局部短时确认；
 * - **只能参考本空间的成果版本**（仓储 `requireOwnedVersion` 会拒）。跨空间的成果整区
 *   不可用并就地说明归属——后端会拒绝的操作不得做成按钮，让人点了才知道。
 */
function ReferenceVersionSection({
  references,
  artifactTitle,
  version,
  scope,
  onReferenceToTask,
}: {
  references: WorkspaceReferencesState;
  artifactTitle: string;
  version: ArtifactVersionDetail;
  scope: { inScope: boolean; ownerWorkspaceName: string } | undefined;
  onReferenceToTask: ((artifactVersionId: string) => void) | undefined;
}): React.JSX.Element {
  const [note, setNote] = useState('');
  const reference = references.referenceOf(version.id);
  const busy = references.pendingVersionId === version.id;

  if (scope && !scope.inScope) {
    return (
      <section className="artifact-reference-section">
        <SectionHeader
          title="本空间参考版本"
          hint={`这项成果属于「${scope.ownerWorkspaceName}」，不是当前工作空间的成果`}
        />
        <p className="artifact-reference-note">
          参考版本按工作空间隔离，只能标记与引用本空间的成果版本。需要参考它，请先在侧栏切到 「
          {scope.ownerWorkspaceName}」再打开这项成果。
        </p>
      </section>
    );
  }

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
      <SectionHeader
        title="本空间参考版本"
        hint={
          reference
            ? `当前查看的 v${version.versionNumber} 已标记为参考`
            : `当前查看的 v${version.versionNumber} 尚未标记`
        }
        actions={
          <>
            {reference ? (
              <Button variant="secondary" size="md" type="button" disabled={busy} onClick={remove}>
                取消参考
              </Button>
            ) : (
              <AsyncButton
                variant="secondary"
                size="md"
                busy={busy}
                label="指定为本空间参考版本"
                busyLabel="正在提交…"
                onClick={mark}
              />
            )}
            {onReferenceToTask && (
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => onReferenceToTask(version.id)}
              >
                引用到当前任务
              </Button>
            )}
          </>
        }
      />
      <p className="artifact-reference-note">
        标记与引用都固定到这一版的内容哈希，成果新增版本后参考仍指旧版本；引用只会把该版本加进当前任务材料，
        不会自动发送，也不会改变当前专家。
      </p>
      {note && <TransientToast tone="success" message={note} onDismiss={() => setNote('')} />}
    </section>
  );
}
