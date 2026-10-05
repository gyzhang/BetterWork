import { createHash } from 'node:crypto';

import {
  type MaterialReference,
  memoryRecallPolicyV2,
  type TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import type { RunMemorySelectionInput } from '../persistence/run-memory-context-repository';
import { continuityProgressDependenciesAreCurrent } from './task-continuity-progress';

const hashOf = (value: string): string => createHash('sha256').update(value).digest('hex');

const materialSelection = (reference: MaterialReference): TaskMaterialSelection => ({
  reference,
  purpose: 'background',
  addedFrom: 'user-input',
});

const runMemoryInput = (
  runId: string,
  materials: readonly MaterialReference[],
): RunMemorySelectionInput => ({
  runId,
  evaluatedAt: 100,
  queryHash: hashOf(`query:${runId}`),
  policySnapshot: memoryRecallPolicyV2,
  selectedItems: [],
  materialDependencyUnion: [...materials],
  memoryDependencyUnion: [],
  decisionSummary: {
    budget: {
      totalItems: 0,
      preferenceItems: 0,
      contentCodePoints: 0,
      wrapperCodePoints: 0,
      blockCodePoints: 0,
    },
    exclusions: [],
    queryTruncated: false,
    conflictReviewRequired: false,
  },
  authorizationHash: hashOf(`authorization:${runId}`),
});

describe('Task Continuity progress source verification', () => {
  const stores: AppStore[] = [];
  const openStore = (): AppStore => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('requires the exact source material revision in the effective Run selection', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/tc-material-source', 'TC material source');
    const created = store.tasks.create(workspace.id, '材料依赖', '核对材料来源');
    store.taskContinuity.initializeFromTaskGoal(created.task.id);
    store.runs.create({
      id: 'tc-material-source-run',
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: '核对材料版本',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    const sourceReference: MaterialReference = {
      kind: 'knowledge-revision',
      knowledgeDocumentId: 'synthetic-document',
      knowledgeRevisionId: 'synthetic-revision-1',
      contentHash: hashOf('revision-1'),
      sourcePath: 'synthetic/source.md',
    };
    const sourceSelection = materialSelection(sourceReference);
    const workspaceId = store.tasks.getWorkspaceId(created.task.id);
    if (!workspaceId) throw new Error('workspace missing');
    store.runContextSnapshots.create({
      runId: 'tc-material-source-run',
      taskId: created.task.id,
      workspaceId,
      contextSegmentId: 'synthetic-material-context',
      materials: [sourceSelection],
      createdAt: 1,
    });
    store.runMemoryContexts.recordSelection(
      runMemoryInput('tc-material-source-run', [sourceReference]),
    );

    const addEffectiveRun = (runId: string, references: readonly MaterialReference[]): void => {
      store.runs.create({
        id: runId,
        taskId: created.task.id,
        sessionId: created.sessionId,
        prompt: '继续核对',
        status: 'running',
        createdAt: 3,
      });
      store.runContextSnapshots.create({
        runId,
        taskId: created.task.id,
        workspaceId,
        contextSegmentId: `context:${runId}`,
        materials: references.map(materialSelection),
        createdAt: 3,
      });
      store.runMemoryContexts.recordSelection(runMemoryInput(runId, references));
    };

    addEffectiveRun('tc-material-source-exact', [sourceReference]);
    addEffectiveRun('tc-material-source-removed', []);
    addEffectiveRun('tc-material-source-revised', [
      {
        ...sourceReference,
        knowledgeRevisionId: 'synthetic-revision-2',
        contentHash: hashOf('revision-2'),
      },
    ]);

    expect(
      continuityProgressDependenciesAreCurrent(
        store,
        'tc-material-source-run',
        created.task.id,
        'tc-material-source-exact',
      ),
    ).toBe(true);
    expect(
      continuityProgressDependenciesAreCurrent(
        store,
        'tc-material-source-run',
        created.task.id,
        'tc-material-source-removed',
      ),
    ).toBe(false);
    expect(
      continuityProgressDependenciesAreCurrent(
        store,
        'tc-material-source-run',
        created.task.id,
        'tc-material-source-revised',
      ),
    ).toBe(false);
  });
});
