import type { ArtifactDetail, ArtifactSummary } from '@betterwork/agent-protocol';
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

export function ArtifactPage({
  artifacts,
  selected,
  onSelect,
  onSave,
  onExport,
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
          eyebrow={`Markdown · v${visibleVersion.versionNumber}${visibleVersion.origin === 'user-edit' ? ' · 人工修订' : ''}${visibleVersion.id !== selected.currentVersionId ? ' · 历史版本' : ''}`}
          title={selected.title}
          leading={
            <button className="back-button" onClick={onBack}>
              <ChevronLeftIcon size={13} /> 成果
            </button>
          }
          actions={
            !editing && (
              <>
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
                  导出 Markdown
                </button>
                <button className="primary-button" onClick={beginEditing}>
                  编辑此版本
                </button>
              </>
            )
          }
        />
        <ScrollRegion ariaLabel="成果版本详情">
          <section className="page-body artifact-detail-page">
            <p className="page-intro">
              {visibleVersion.id !== selected.currentVersionId
                ? '正在查看历史版本；编辑后会从这里创建新的人工修订版本。'
                : visibleVersion.origin === 'user-edit'
                  ? '这是人工修订版本；此前版本仍可回溯。'
                  : '来自一次任务运行，可在后续继续修订并形成新版本。'}
            </p>
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
                        <div>
                          <span>{item.title}</span>
                          <small>{item.locator}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </aside>
              {editing ? (
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
                      rows={20}
                      required
                    />
                  </label>
                  {error && <p className="artifact-editor-error">{error}</p>}
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
                <MarkdownPreview content={visibleVersion.content} />
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
            Markdown 是第一种可版本化的成果。后续研究报告、Word、Excel 和 PPT 会接入同一条 Artifact
            链路。
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
                  <span className="completed-work-icon markdown" aria-hidden="true">
                    MD
                  </span>
                  <div>
                    <strong>{artifact.title}</strong>
                    <p>
                      Markdown · v{artifact.versionNumber}
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
