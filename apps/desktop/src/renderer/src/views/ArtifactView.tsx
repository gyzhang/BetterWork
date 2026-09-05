import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';

import { EmptyPage } from '../components/EmptyState';
import { ChevronLeftIcon, ChevronRightIcon, GlobeIcon, KnowledgeIcon } from '../icons';
import { reportAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { handleTitlebarDoubleClick } from '../lib/titlebar';
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
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [viewingVersion, setViewingVersion] = useState<ArtifactVersionDetail>();
  const [exportMessage, setExportMessage] = useState('');
  useEffect(() => {
    setEditing(false);
    setError('');
    setExportMessage('');
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
    setViewingVersion(undefined);
    if (!selected) {
      setVersions([]);
      return;
    }
    // 版本列表加载失败此前是静默的：用户只会看到一个空的「0 个版本」。
    reportAction(
      window.betterwork.artifacts.listVersions({ artifactId: selected.id }).then(setVersions),
      setError,
      '版本历史加载失败，请重试。',
    );
  }, [selected]);
  const visibleVersion =
    viewingVersion ??
    (selected
      ? {
          id: selected.currentVersionId,
          artifactId: selected.id,
          versionNumber: selected.versionNumber,
          origin: selected.origin,
          sourceRunId: selected.sourceRunId,
          createdAt: selected.updatedAt,
          content: selected.content,
          contentHash: selected.contentHash,
          evidence: selected.evidence,
        }
      : undefined);
  const selectVersion = async (version: ArtifactVersionSummary): Promise<void> => {
    const detail = await window.betterwork.artifacts.getVersion({ id: version.id });
    if (!detail) throw new Error('该版本已不存在，请返回成果列表重新选择。');
    setViewingVersion(detail);
    setEditing(false);
    setError('');
  };
  if (selected && visibleVersion)
    return (
      <>
        <header className="page-header" onDoubleClick={handleTitlebarDoubleClick}>
          <div className="page-header-leading">
            <button className="back-button" onClick={onBack}>
              <ChevronLeftIcon size={13} /> 成果
            </button>
            <div>
              <p className="eyebrow">
                Markdown · v{visibleVersion.versionNumber}
                {visibleVersion.origin === 'user-edit' ? ' · 人工修订' : ''}
                {visibleVersion.id !== selected.currentVersionId ? ' · 历史版本' : ''}
              </p>
              <h1>{selected.title}</h1>
            </div>
          </div>
          {!editing && (
            <div className="page-header-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  void onExport(selected, visibleVersion.id)
                    .then((result) =>
                      setExportMessage(
                        result.cancelled ? '' : `已导出到 ${result.filePath ?? '所选位置'}。`,
                      ),
                    )
                    .catch((reason: unknown) =>
                      setExportMessage(reason instanceof Error ? reason.message : '导出失败。'),
                    )
                }
              >
                导出 Markdown
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setTitle(selected.title);
                  setContent(visibleVersion.content);
                  setEditing(true);
                }}
              >
                编辑此版本
              </button>
            </div>
          )}
        </header>
        <div className="page-scroll">
          <section className="page-body artifact-detail-page">
            <p className="page-intro">
              {visibleVersion.id !== selected.currentVersionId
                ? '正在查看历史版本；编辑后会从这里创建新的人工修订版本。'
                : visibleVersion.origin === 'user-edit'
                  ? '这是人工修订版本；此前版本仍可回溯。'
                  : '来自一次任务运行，可在后续继续修订并形成新版本。'}
            </p>
            {exportMessage && <p className="artifact-export-message">{exportMessage}</p>}
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
                    void onSave(selected, title, content)
                      .then(() => setEditing(false))
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
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setEditing(false);
                          setError('');
                          setTitle(selected.title);
                          setContent(visibleVersion.content);
                        }}
                      >
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
        </div>
      </>
    );
  return (
    <>
      <header className="page-header" onDoubleClick={handleTitlebarDoubleClick}>
        <div>
          <p className="eyebrow">成果</p>
          <h1>可继续工作的交付物</h1>
        </div>
        <span className="work-count">{artifacts.length} 项</span>
      </header>
      <div className="page-scroll">
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
            <div className="completed-work-list">
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
            </div>
          )}
        </section>
      </div>
    </>
  );
}
