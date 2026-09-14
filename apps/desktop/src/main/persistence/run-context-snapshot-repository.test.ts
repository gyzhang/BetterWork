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

  it('persists the immutable Expert identity and revision used by a Run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(
      '/tmp/betterwork-expert-snapshot-test',
      '专家工作区',
    );
    const task = store.tasks.create(workspace.id, '专家任务', '验证专家快照');
    const expert = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '月报专家',
        summary: '测试',
        identity: '负责月报',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    store.runs.create({
      id: 'run-expert-snapshot-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '测试',
      status: 'running',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId: 'run-expert-snapshot-1',
      taskId: task.task.id,
      workspaceId: workspace.id,
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['calculator'] },
      mcpToolBindings: [{ connectionId: 'mcp-finance', toolId: 'mcp-finance/monthly_summary' }],
      contextSegmentId: 'segment-expert-1',
      materials: [],
      createdAt: 2,
    });

    expect(store.runContextSnapshots.get('run-expert-snapshot-1')).toMatchObject({
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['calculator'] },
      mcpToolBindings: [{ connectionId: 'mcp-finance', toolId: 'mcp-finance/monthly_summary' }],
    });
  });

  it('rejects a partially specified Expert binding', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(
      '/tmp/betterwork-partial-expert-snapshot-test',
      '工作区',
    );
    const task = store.tasks.create(workspace.id, '任务', '验证');
    store.runs.create({
      id: 'run-partial-expert-snapshot-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '测试',
      status: 'running',
      createdAt: 1,
    });

    expect(() =>
      store.runContextSnapshots.create({
        runId: 'run-partial-expert-snapshot-1',
        taskId: task.task.id,
        workspaceId: workspace.id,
        expertId: 'expert-only',
        contextSegmentId: 'segment-partial-1',
        materials: [],
        createdAt: 2,
      }),
    ).toThrow('Run expert snapshot must include both expertId and expertRevisionId');
  });

  it('rejects a revision that belongs to another Expert', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(
      '/tmp/betterwork-mismatched-expert-snapshot-test',
      '工作区',
    );
    const task = store.tasks.create(workspace.id, '任务', '验证');
    const first = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '专家一',
        summary: '',
        identity: '负责一',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const second = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '专家二',
        summary: '',
        identity: '负责二',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    store.runs.create({
      id: 'run-mismatched-expert-snapshot-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '测试',
      status: 'running',
      createdAt: 1,
    });

    expect(() =>
      store.runContextSnapshots.create({
        runId: 'run-mismatched-expert-snapshot-1',
        taskId: task.task.id,
        workspaceId: workspace.id,
        expertId: first.id,
        expertRevisionId: second.revision.id,
        contextSegmentId: 'segment-mismatched-1',
        materials: [],
        createdAt: 2,
      }),
    ).toThrow('Run expert revision does not belong to expert');
  });

  it('rejects snapshot metadata that belongs to another Task or Workspace', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const firstWorkspace = store.workspaces.getOrCreate(
      '/tmp/betterwork-snapshot-owner-a',
      '工作区一',
    );
    const secondWorkspace = store.workspaces.getOrCreate(
      '/tmp/betterwork-snapshot-owner-b',
      '工作区二',
    );
    const firstTask = store.tasks.create(firstWorkspace.id, '任务一', '验证');
    const secondTask = store.tasks.create(secondWorkspace.id, '任务二', '验证');
    store.runs.create({
      id: 'run-snapshot-owner-1',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '测试',
      status: 'running',
      createdAt: 1,
    });

    expect(() =>
      store.runContextSnapshots.create({
        runId: 'run-snapshot-owner-1',
        taskId: secondTask.task.id,
        workspaceId: secondWorkspace.id,
        contextSegmentId: 'segment-owner-mismatch',
        materials: [],
        createdAt: 2,
      }),
    ).toThrow('Run context snapshot task does not match Run');
  });

  it('rejects a TaskContextRevision that belongs to another Task', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(
      '/tmp/betterwork-snapshot-context-owner',
      '工作区',
    );
    const firstTask = store.tasks.create(workspace.id, '任务一', '验证');
    const secondTask = store.tasks.create(workspace.id, '任务二', '验证');
    const context = store.taskContexts.save(secondTask.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
    });
    store.runs.create({
      id: 'run-snapshot-context-owner-1',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '测试',
      status: 'running',
      createdAt: 1,
    });

    expect(() =>
      store.runContextSnapshots.create({
        runId: 'run-snapshot-context-owner-1',
        taskId: firstTask.task.id,
        workspaceId: workspace.id,
        taskContextRevisionId: context.id,
        contextSegmentId: 'segment-context-owner-mismatch',
        materials: [],
        createdAt: 2,
      }),
    ).toThrow('Run context revision does not belong to task');
  });
});
