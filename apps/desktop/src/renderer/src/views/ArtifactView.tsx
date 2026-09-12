import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactThumbnail,
  ArtifactVersionDetail,
  ValidationStatus,
} from '@betterwork/agent-protocol';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EmptyPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { type ToastTone, TransientToast } from '../components/TransientToast';
import { useArtifactThumbnails } from '../hooks/use-artifact-thumbnails';
import { useArtifactViewer } from '../hooks/use-artifact-viewer';
import { ChevronLeftIcon, ChevronRightIcon, GlobeIcon, KnowledgeIcon } from '../icons';
import { reportAction } from '../lib/async-action';
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
  onBack,
}: {
  artifacts: ArtifactSummary[];
  selected: ArtifactDetail | undefined;
  onSelect: (artifact: ArtifactSummary) => void;
  onSave: (artifact: ArtifactDetail, title: string, content: string) => Promise<void>;
  onExport: (
    artifact: ArtifactDetail,
    versionId?: string,
  ) => Promise<{ cancelled: boolean; filePath?: string }>;
  onOpenFile: (
    artifactId: string,
    versionId?: string,
  ) => Promise<{ opened: boolean; error?: string }>;
  onOpenSource: (sourcePath: string) => Promise<void>;
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
            {error && (
              <p className="artifact-action-error" role="alert">
                {error}
              </p>
            )}
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
                    <strong>本版来源</strong>
                    {visibleVersion.evidence.map((item) => (
                      <article key={item.id}>
                        <b>
                          {item.sourceType === 'web-page' ? (
                            <GlobeIcon size={10} />
                          ) : (
                            <KnowledgeIcon size={10} />
                          )}
                        </b>
                        <div className="artifact-evidence-main">
                          <span>{item.title}</span>
                          <small>{item.locator}</small>
                        </div>
                        {item.sourceType === 'local-file' && (
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
                      onSave(selected, title, content)
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
