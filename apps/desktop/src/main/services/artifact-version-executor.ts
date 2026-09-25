import type { ArtifactVersionExecutorSummary } from '@betterwork/agent-protocol';
import { getArtifactVersionExecutorRequestSchema } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

/**
 * 解析「从此版本开始新任务」应当沿用的专家身份（契约 §11.5、MI08）。
 *
 * 只读，且只回答一件事：这个精确版本的来源 Run 当时用的是谁。
 * user-edit 版本沿同成果前版回溯；断链、缺来源 Run、循环一律 unavailable，
 * 绝不改取 latest，也不把旧 Task 的当前草稿当证据。
 */
export const resolveArtifactVersionExecutor = (
  store: AppStore,
  input: unknown,
): ArtifactVersionExecutorSummary | null => {
  const request = getArtifactVersionExecutorRequestSchema.parse(input);
  const target = store.artifacts.getVersionDetail(request.artifactVersionId);
  if (!target) return null;
  if (!store.artifacts.versionBelongsToArtifact(request.artifactVersionId, request.artifactId)) {
    // 版本不属于所给成果：与「不存在」同一形状，不泄露该版本是否存在。
    return null;
  }

  let versionId: string | undefined = request.artifactVersionId;
  const visited = new Set<string>();
  while (versionId !== undefined) {
    if (visited.has(versionId)) return { kind: 'unavailable', reason: 'source-unavailable' };
    visited.add(versionId);
    const detail = store.artifacts.getVersionDetail(versionId);
    if (!detail) return { kind: 'unavailable', reason: 'source-unavailable' };
    if (detail.artifactId !== request.artifactId) {
      return { kind: 'unavailable', reason: 'source-unavailable' };
    }
    const sourceRunId = store.artifacts.getVersionSourceRunId(versionId);
    if (detail.origin === 'user-edit' && sourceRunId === undefined) {
      versionId = store.artifacts.getPreviousVersionId(versionId);
      continue;
    }
    if (sourceRunId === undefined) return { kind: 'unavailable', reason: 'source-unavailable' };
    const snapshot = store.runContextSnapshots.get(sourceRunId);
    if (!snapshot) return { kind: 'unavailable', reason: 'source-unavailable' };
    // 快照必须仍归属同一 Task/Workspace 轨道：跨空间冒充一律拒绝。
    const artifactWorkspaceId = store.tasks.getWorkspaceId(
      store.artifacts.getDetail(detail.artifactId)?.taskId ?? '',
    );
    if (artifactWorkspaceId !== undefined && artifactWorkspaceId !== snapshot.workspaceId) {
      return { kind: 'unavailable', reason: 'source-unavailable' };
    }
    if (snapshot.expertId === undefined || snapshot.expertRevisionId === undefined) {
      return { kind: 'general', sourceRunId };
    }
    const expert = store.experts.get(snapshot.expertId);
    if (!expert || expert.lifecycle !== 'active') {
      return { kind: 'unavailable', reason: 'expert-unavailable' };
    }
    const revision = store.experts.getRevision(snapshot.expertId, snapshot.expertRevisionId);
    if (!revision) return { kind: 'unavailable', reason: 'expert-unavailable' };
    return {
      kind: 'expert',
      sourceRunId,
      expertId: snapshot.expertId,
      sourceExpertRevisionId: snapshot.expertRevisionId,
      currentExpertRevisionId: expert.revision.id,
      name: expert.revision.name,
    };
  }
  return { kind: 'unavailable', reason: 'source-unavailable' };
};
