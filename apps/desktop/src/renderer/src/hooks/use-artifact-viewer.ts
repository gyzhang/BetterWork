import type {
  ArtifactDetail,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';

import { reportAction } from '../lib/async-action';

export interface ArtifactViewer {
  editing: boolean;
  title: string;
  content: string;
  error: string;
  versions: ArtifactVersionSummary[];
  /** 正在查看的版本；未选历史版本时回落到成果的当前版本。 */
  visibleVersion: ArtifactVersionDetail | undefined;
  setTitle: (title: string) => void;
  setContent: (content: string) => void;
  setError: (message: string) => void;
  beginEditing: () => void;
  cancelEditing: () => void;
  finishEditing: () => void;
  selectVersion: (version: ArtifactVersionSummary) => Promise<void>;
}

const toVersionDetail = (artifact: ArtifactDetail): ArtifactVersionDetail => ({
  id: artifact.currentVersionId,
  artifactId: artifact.id,
  versionNumber: artifact.versionNumber,
  origin: artifact.origin,
  ...(artifact.sourceRunId ? { sourceRunId: artifact.sourceRunId } : {}),
  createdAt: artifact.updatedAt,
  content: artifact.content,
  contentHash: artifact.contentHash,
  evidence: artifact.evidence,
});

/**
 * 成果预览页的状态与数据加载。
 *
 * 把 IPC 收在这里，视图就只剩呈现：切换成果时重置编辑态并重新拉版本列表，
 * 版本列表加载失败写进 `error` 而不是静默显示「0 个版本」。
 */
export function useArtifactViewer(selected: ArtifactDetail | undefined): ArtifactViewer {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [viewingVersion, setViewingVersion] = useState<ArtifactVersionDetail>();

  useEffect(() => {
    setEditing(false);
    setError('');
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
    setViewingVersion(undefined);
    if (!selected) {
      setVersions([]);
      return;
    }
    reportAction(
      window.betterwork.artifacts.listVersions({ artifactId: selected.id }).then(setVersions),
      setError,
      '版本历史加载失败，请重试。',
    );
  }, [selected]);

  const visibleVersion = viewingVersion ?? (selected ? toVersionDetail(selected) : undefined);

  const selectVersion = async (version: ArtifactVersionSummary): Promise<void> => {
    const detail = await window.betterwork.artifacts.getVersion({ id: version.id });
    if (!detail) throw new Error('该版本已不存在，请返回成果列表重新选择。');
    setViewingVersion(detail);
    setEditing(false);
    setError('');
  };

  const beginEditing = (): void => {
    if (!selected || !visibleVersion) return;
    setTitle(selected.title);
    setContent(visibleVersion.content);
    setEditing(true);
  };

  const finishEditing = (): void => setEditing(false);

  const cancelEditing = (): void => {
    setEditing(false);
    setError('');
    if (!selected || !visibleVersion) return;
    setTitle(selected.title);
    setContent(visibleVersion.content);
  };

  return {
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
  };
}
