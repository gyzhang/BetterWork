import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('RunContextSnapshotRepository', () => {
  it('persists the exact run material binding and context segment', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/betterwork-snapshot-test', '测试工作区');
    const task = store.tasks.create(workspace.id, '测试任务', '验证运行快照');
    store.runs.create({
      id: 'run-snapshot-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '测试',
      status: 'running',
      createdAt: 1,
    });
    const materials = [
      {
        reference: {
          kind: 'knowledge-revision' as const,
          knowledgeDocumentId: 'doc-1',
          knowledgeRevisionId: 'revision-1',
          contentHash: 'hash-1',
          sourcePath: '/tmp/rules.md',
        },
        purpose: 'rule' as const,
        addedFrom: 'workspace-candidate' as const,
      },
    ];
    store.runContextSnapshots.create({
      runId: 'run-snapshot-1',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'segment-1',
      materials,
      createdAt: 2,
    });

    expect(store.runContextSnapshots.get('run-snapshot-1')).toEqual({
      runId: 'run-snapshot-1',
      taskId: task.task.id,
      workspaceId: workspace.id,
      contextSegmentId: 'segment-1',
      materials,
      createdAt: 2,
    });
    expect(store.runContextSnapshots.latestByTask(task.task.id)?.runId).toBe('run-snapshot-1');
  });
});
