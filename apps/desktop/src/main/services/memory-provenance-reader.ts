import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { ProvenanceReader } from './memory-provenance';

/**
 * 主进程侧的来源读取器：来源正文只能由已登记的实体提供，
 * Renderer 提交的选择器只用于定位，不能自报摘录内容。
 */
export const createStoreProvenanceReader = (store: AppStore): ProvenanceReader => {
  const assistantContent = (runId: string, eventId: string): string | undefined => {
    const events: AgentRuntimeEvent[] = store.runs.listEvents(runId);
    const completed = events.find(
      (event): event is Extract<AgentRuntimeEvent, { type: 'message.completed' }> =>
        event.id === eventId && event.type === 'message.completed',
    );
    return completed?.content;
  };

  const readableVersionText = (artifactVersionId: string): string | undefined => {
    const detail = store.artifacts.getVersionDetail(artifactVersionId);
    if (!detail || detail.type !== 'markdown') return undefined;
    return detail.content;
  };

  return {
    runPrompt: (runId) => store.runs.get(runId)?.prompt,
    runAssistantEventContent: assistantContent,
    runMaterialReferences: (runId) => {
      const snapshot = store.runContextSnapshots.get(runId);
      return snapshot?.materials.map((material) => material.reference);
    },
    checkpointField: (checkpointId, field) => {
      const checkpoint = store.discussionCheckpoints.get(checkpointId);
      if (!checkpoint) return undefined;
      return field === 'feedback' ? checkpoint.feedback : checkpoint.summary;
    },
    artifactVersion: (artifactVersionId) => {
      const detail = store.artifacts.getVersionDetail(artifactVersionId);
      if (!detail) return undefined;
      return {
        artifactId: detail.artifactId,
        contentHash: detail.type === 'markdown' ? detail.contentHash : detail.fileHash,
        readableText: readableVersionText(artifactVersionId),
      };
    },
  };
};
