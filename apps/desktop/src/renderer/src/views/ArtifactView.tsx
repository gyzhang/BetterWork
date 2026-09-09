import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionDetail,
  ValidationStatus,
} from '@betterwork/agent-protocol';
import { useCallback, useState } from 'react';

import { EmptyPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { type ToastTone, TransientToast } from '../components/TransientToast';
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
                <FileInfoPanel version={visibleVersion} />
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

function FileInfoPanel({ version }: { version: ArtifactVersionDetail }): React.JSX.Element {
  if (version.type !== 'presentation') return <></>;
  return (
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
  );
}
