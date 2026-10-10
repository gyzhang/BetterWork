import { randomUUID } from 'node:crypto';

import {
  type MaterialReference,
  type MemoryDependency,
  memoryRecallPolicyV1,
  type MemoryRecord,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../../persistence';
import type { MemoryReplayDependency, MemoryRepository } from '../../persistence/memory-repository';

/** 旧逐项完整读取的对照；缺项保持缺失，不改成最新修订。 */
export const legacyReplayDependencies = (
  repository: MemoryRepository,
  revisionIds: readonly string[],
): MemoryReplayDependency[] =>
  [...new Set(revisionIds)].flatMap((revisionId) => {
    const record = repository.getRevision(revisionId);
    if (record === undefined) return [];
    const current = repository.get(record.id);
    return [
      {
        id: record.id,
        revisionId: record.revisionId,
        revision: record.revision,
        contentHash: record.contentHash,
        status: record.status,
        scope: record.scope,
        latestRevisionOfIdentity: current?.revision ?? record.revision,
        ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
        ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
      },
    ];
  });

export const seedReplayRun = (
  store: AppStore,
  input: {
    taskId: string;
    sessionId: string;
    workspaceId: string;
    index: number;
    selected?: readonly MemoryRecord[];
    dependencies?: readonly MemoryDependency[];
    materials?: readonly MaterialReference[];
    omitContext?: boolean;
    omitSnapshot?: boolean;
  },
): string => {
  const runId = randomUUID();
  const selected = input.selected ?? [];
  store.runs.create({
    id: runId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    prompt: `prompt ${input.index}`,
    status: 'completed',
    createdAt: input.index,
    completedAt: input.index + 1,
  });
  store.runs.appendEvent({
    id: `${runId}-answer`,
    runId,
    sequence: 1,
    createdAt: input.index,
    type: 'message.completed',
    messageId: runId,
    content: `answer ${input.index}`,
  });
  if (input.omitSnapshot !== true)
    store.runContextSnapshots.create({
      runId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      contextSegmentId: runId,
      materials: (input.materials ?? []).map((reference) => ({
        reference,
        purpose: 'background',
        addedFrom: 'user-input',
      })),
      createdAt: input.index,
    });
  if (input.omitContext !== true)
    store.runMemoryContexts.recordSelection({
      runId,
      evaluatedAt: input.index,
      selectedAt: input.index,
      queryHash: 'a'.repeat(64),
      authorizationHash: 'a'.repeat(64),
      policySnapshot: memoryRecallPolicyV1,
      selectedItems: selected.map((record, index) => ({
        memoryId: record.id,
        revisionId: record.revisionId,
        contentHash: record.contentHash,
        order: index + 1,
        score: 0,
        reason: 'task-relevant',
      })),
      decisionSummary: {
        budget: {
          totalItems: selected.length,
          preferenceItems: 0,
          contentCodePoints: 0,
          wrapperCodePoints: 0,
          blockCodePoints: 0,
        },
        exclusions: [],
        queryTruncated: false,
        conflictReviewRequired: false,
      },
      memoryDependencyUnion: [...(input.dependencies ?? [])],
    });
  return runId;
};
