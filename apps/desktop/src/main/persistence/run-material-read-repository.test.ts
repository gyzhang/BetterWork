import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('RunMaterialReadRepository', () => {
  it('requires scoped reads to match the exact selected material and hash', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/material-read-scope', '材料范围');
    const task = store.tasks.create(workspace.id, '材料任务', '验证读取范围');
    const context = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: 'rules',
            knowledgeRevisionId: 'rules-v1',
            contentHash: 'rules-hash',
            sourcePath: '/tmp/rules.md',
          },
          purpose: 'rule',
          addedFrom: 'workspace-candidate',
        },
      ],
    });
    const runId = 'run-material-read-scope';
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '读取规则',
      status: 'running',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId,
      taskId: task.task.id,
      workspaceId: workspace.id,
      taskContextRevisionId: context.id,
      contextSegmentId: 'segment-1',
      materials: context.materials ?? [],
      createdAt: 2,
    });

    expect(() =>
      store.materialReads.save({
        id: 'read-outside-scope',
        runId,
        material: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'other',
          knowledgeRevisionId: 'other-v1',
          contentHash: 'other-hash',
          sourcePath: '/tmp/other.md',
        },
        operation: 'read',
        locator: '全文',
        contentHash: 'other-hash',
        capturedAt: 3,
      }),
    ).toThrow('Run material read is outside the snapshot scope');
  });

  it('keeps unscoped legacy runs compatible', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/material-read-legacy', '旧任务');
    const task = store.tasks.create(workspace.id, '旧任务', '兼容通用助手');
    store.runs.create({
      id: 'run-material-read-legacy',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '搜索',
      status: 'running',
      createdAt: 1,
    });
    store.materialReads.save({
      id: 'read-legacy',
      runId: 'run-material-read-legacy',
      material: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'rules',
        knowledgeRevisionId: 'rules-v1',
        contentHash: 'rules-hash',
        sourcePath: '/tmp/rules.md',
      },
      operation: 'search',
      locator: '全文',
      contentHash: 'rules-hash',
      capturedAt: 2,
    });
    expect(store.materialReads.listByRun('run-material-read-legacy')).toHaveLength(1);
  });
});
