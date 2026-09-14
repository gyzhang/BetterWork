import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore, MemoryConflictError } from './index';

describe('MemoryRepository', () => {
  const stores: AppStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('keeps revisions and resolves applicable scope precedence', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const repository = store.memories;
    const workspace = store.workspaces.getOrCreate('/tmp/memory-repo', 'Memory Repo');
    const expert = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '测试专家',
        summary: '测试',
        identity: '测试',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const user = repository.create({
      scope: { kind: 'user' },
      kind: 'semantic',
      content: '用户级规则',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const workspaceMemory = repository.create({
      scope: { kind: 'workspace', workspaceId: workspace.id },
      kind: 'procedural',
      content: '工作空间规则',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const expertMemory = repository.create({
      scope: { kind: 'expert', expertId: expert.id },
      kind: 'semantic',
      content: '专家规则',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const combinedMemory = repository.create({
      scope: { kind: 'expert-workspace', expertId: expert.id, workspaceId: workspace.id },
      kind: 'procedural',
      content: '专家工作空间规则',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const candidate = repository.create({
      scope: { kind: 'workspace', workspaceId: workspace.id },
      kind: 'preference',
      content: '待确认偏好',
      sourceType: 'conversation',
    });

    expect(repository.listApplicable(workspace.id, undefined).map((item) => item.id)).toEqual([
      user.id,
      workspaceMemory.id,
    ]);
    expect(repository.listApplicable(workspace.id, expert.id).map((item) => item.id)).toEqual([
      user.id,
      combinedMemory.id,
      expertMemory.id,
      workspaceMemory.id,
    ]);
    expect(repository.list({ workspaceId: workspace.id }).map((item) => item.id)).toContain(
      candidate.id,
    );
    const confirmed = repository.setStatus({
      id: candidate.id,
      expectedRevision: candidate.revision,
      status: 'confirmed',
    });
    const updated = repository.update({
      id: confirmed.id,
      expectedRevision: confirmed.revision,
      content: '已确认偏好',
    });
    expect(updated.revision).toBe(3);
    expect(updated.supersedesId).toBe(confirmed.revisionId);
    expect(repository.get(updated.id)?.content).toBe('已确认偏好');
    expect(() =>
      repository.update({ id: updated.id, expectedRevision: 1, content: '过期写入' }),
    ).toThrow(MemoryConflictError);
  });

  it('records the exact revision read by a run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const repository = store.memories;
    const workspace = store.workspaces.getOrCreate('/tmp/memory-read', 'Memory Read');
    const task = store.tasks.create(workspace.id, '读记忆', '记录本次读取');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: Date.now(),
    });
    const memory = repository.create({
      scope: { kind: 'workspace', workspaceId: workspace.id },
      kind: 'semantic',
      content: '可追溯记忆',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    repository.recordReads([{ runId, memory, capturedAt: 123 }]);
    expect(repository.listReads(runId)).toEqual([memory]);
    repository.recordReads([{ runId, memory, capturedAt: 124 }]);
    expect(repository.listReads(runId)).toHaveLength(1);
  });

  it('rejects a memory read with a stale content hash', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const repository = store.memories;
    const workspace = store.workspaces.getOrCreate('/tmp/memory-read-hash', 'Memory Read Hash');
    const task = store.tasks.create(workspace.id, '读记忆', '校验哈希');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: Date.now(),
    });
    const memory = repository.create({
      scope: { kind: 'workspace', workspaceId: workspace.id },
      kind: 'semantic',
      content: '可追溯记忆',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });

    expect(() =>
      repository.recordReads([
        { runId, memory: { ...memory, contentHash: 'stale-hash' }, capturedAt: 123 },
      ]),
    ).toThrow('记忆内容哈希不一致');
    expect(repository.listReads(runId)).toHaveLength(0);
  });

  it('rejects a memory read outside the Run workspace', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const repository = store.memories;
    const firstWorkspace = store.workspaces.getOrCreate('/tmp/memory-scope-a', '空间一');
    const secondWorkspace = store.workspaces.getOrCreate('/tmp/memory-scope-b', '空间二');
    const task = store.tasks.create(firstWorkspace.id, '读记忆', '校验范围');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: Date.now(),
    });
    const memory = repository.create({
      scope: { kind: 'workspace', workspaceId: secondWorkspace.id },
      kind: 'semantic',
      content: '另一空间记忆',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });

    expect(() => repository.recordReads([{ runId, memory, capturedAt: Date.now() }])).toThrow(
      '记忆范围不适用于该 Run',
    );
    expect(repository.listReads(runId)).toHaveLength(0);
  });
});
