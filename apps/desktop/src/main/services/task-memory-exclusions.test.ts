import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { MemoryScope } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { MemoryRecallService } from './memory-recall-service';
import { MemoryService } from './memory-service';

/**
 * MI03：本任务排除清单是 TaskContext 的只读投影（契约 §11.2）。
 * 真实 SQLite，不 mock 仓储；越范围条目不得泄露正文或存在性。
 */

const stores: AppStore[] = [];
const directories: string[] = [];

const openWorld = async (): Promise<{
  store: AppStore;
  recall: MemoryRecallService;
  taskId: string;
  directory: string;
  workspaceA: string;
  workspaceB: string;
}> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-exclusions-'));
  directories.push(directory);
  const store = AppStore.open(path.join(directory, 'app.db'));
  stores.push(store);
  const workspaceA = store.workspaces.getOrCreate('/tmp/excl/a', '甲空间').id;
  const workspaceB = store.workspaces.getOrCreate('/tmp/excl/b', '乙空间').id;
  const task = store.tasks.create(workspaceA, '排除清单', '请输出经营结论');
  return {
    store,
    recall: new MemoryRecallService({ store }),
    taskId: task.task.id,
    directory,
    workspaceA,
    workspaceB,
  };
};

const saveUserMemory = async (
  store: AppStore,
  services: MemoryService,
  scope: MemoryScope,
  content: string,
): Promise<string> => {
  const result = await services.create({
    operationId: randomUUID(),
    content,
    facet: 'preference',
    scope,
    asUserInstruction: true,
    ...(scope.kind === 'user' || scope.kind === 'expert' ? { genericDeclaration: true } : {}),
  });
  if (!result.ok) throw new Error(`写入失败：${result.error.code}`);
  const revisionId = result.data.committedRevisionIds[0];
  if (revisionId === undefined) throw new Error('缺少修订。');
  return store.memories.getRevision(revisionId)?.id ?? revisionId;
};

const saveContext = (
  store: AppStore,
  taskId: string,
  excludedMemoryIds: string[],
): { id: string; revision: number } =>
  store.taskContexts.save(taskId, {
    executor: { kind: 'general' },
    skillBindings: [],
    materials: [],
    excludedMemoryIds,
  });

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('本任务排除投影', () => {
  it('按 TaskContext 顺序返回可见项，不要求 prompt 也不依赖词面命中', async () => {
    const { store, recall, taskId, directory, workspaceA } = await openWorld();
    const services = new MemoryService(store, directory);
    const first = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceA },
      '金额按万元保留两位。',
    );
    const second = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceA },
      '图表必须标注统计口径。',
    );
    const context = saveContext(store, taskId, [second, first, second]);

    const result = recall.taskExclusions({
      taskId,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.map((item) => item.memoryId)).toEqual([second, first]);
    const visible = result.data.items[0];
    if (visible?.visibility !== 'visible') throw new Error('本空间记录应当可查看。');
    expect(visible.content).toBe('图表必须标注统计口径。');
    expect(visible.effectiveStatus).toBe('confirmed');
    // 读取排除清单不写足迹、不产生运行痕迹。
    expect(store.memories.listMemoryReads('any-run')).toEqual([]);
  });

  it('越范围与不存在的 ID 只回占位分支，不泄露正文或存在性', async () => {
    const { store, recall, taskId, directory, workspaceA, workspaceB } = await openWorld();
    const services = new MemoryService(store, directory);
    const foreign = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceB },
      '另一个空间的内部口径。',
    );
    const own = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceA },
      '本任务空间自己的口径。',
    );
    const context = saveContext(store, taskId, [foreign, 'missing-memory', own]);
    const result = recall.taskExclusions({
      taskId,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 同一份清单里：越范围与不存在的只回占位，本空间的正常可见。
    expect(result.data.items.slice(0, 2)).toEqual([
      { visibility: 'unavailable', memoryId: foreign },
      { visibility: 'unavailable', memoryId: 'missing-memory' },
    ]);
    const last = result.data.items[2];
    if (last?.visibility !== 'visible') throw new Error('本空间记录应当可查看。');
    expect(last.content).toBe('本任务空间自己的口径。');
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain('另一个空间的内部口径');
  });

  it('上下文修订过期或缺失时给出可操作错误，不返回半成品', async () => {
    const { store, recall, taskId, directory, workspaceA } = await openWorld();
    const services = new MemoryService(store, directory);
    const memoryId = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceA },
      '先核对材料版本再比较。',
    );
    const context = saveContext(store, taskId, [memoryId]);
    const stale = recall.taskExclusions({
      taskId,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision + 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe('REVISION_CONFLICT');
    expect(stale.error.currentRevision).toBe(context.revision);

    const missing = recall.taskExclusions({
      taskId,
      taskContextRevisionId: 'context-not-found',
      expectedTaskContextRevision: 1,
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('CONTEXT_REVISION_REQUIRED');
  });

  it('排除一项后再投影即消失，恢复后重新出现，全程不动其他绑定', async () => {
    const { store, recall, taskId, directory, workspaceA } = await openWorld();
    const services = new MemoryService(store, directory);
    const kept = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceA },
      '对外数据附口径说明。',
    );
    const dropped = await saveUserMemory(
      store,
      services,
      { kind: 'workspace', workspaceId: workspaceA },
      '同比只用同口径数据。',
    );
    let context = saveContext(store, taskId, [kept, dropped]);
    const projected = (): string[] => {
      const result = recall.taskExclusions({
        taskId,
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.data.items.map((item) => item.memoryId);
    };
    expect(projected()).toEqual([kept, dropped]);
    context = store.taskContexts.save(taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      excludedMemoryIds: [kept],
    });
    expect(projected()).toEqual([kept]);
  });
});
