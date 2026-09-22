import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CreateDiscussionCheckpointRequest } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { DiscussionCheckpointService } from './discussion-checkpoint-service';

/** 触发是后台入队，等一个宏任务让 promise 落地。 */
const settle = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('DiscussionCheckpointService 的提炼触发', () => {
  const stores: AppStore[] = [];
  const directories: string[] = [];

  const setup = async (): Promise<{
    store: AppStore;
    service: (requester?: { requestExtractionForCheckpoint(id: string): Promise<unknown> }) => DiscussionCheckpointService;
    taskId: string;
  }> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-checkpoint-'));
    directories.push(directory);
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(directory, '讨论空间');
    const task = store.tasks.create(workspace.id, '口径讨论', '确认收入口径');
    return {
      store,
      taskId: task.task.id,
      service: (requester) => new DiscussionCheckpointService(store, requester),
    };
  };

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const checkpoint = (
    taskId: string,
    overrides: Partial<CreateDiscussionCheckpointRequest> = {},
  ): CreateDiscussionCheckpointRequest => ({
    id: randomUUID(),
    taskId,
    stage: 'report',
    title: '收入口径节点',
    summary: '按回款金额确认收入。',
    artifactVersionIds: [],
    ...overrides,
  });

  it('含人工反馈的节点把自身登记为一次提炼来源', async () => {
    const { service, taskId } = await setup();
    const requested: string[] = [];
    const created = service({
      requestExtractionForCheckpoint: async (checkpointId) => {
        requested.push(checkpointId);
        return { ok: true, data: { status: 'queued' }, warnings: [] };
      },
    }).create(taskId, checkpoint(taskId, { feedback: '以后先给结论再给证据。' }));

    await settle();
    expect(requested).toEqual([created.id]);
  });

  it('只有背景总结或空白反馈时不登记提炼来源', async () => {
    const { service, taskId } = await setup();
    const requested: string[] = [];
    const requester = {
      requestExtractionForCheckpoint: async (checkpointId: string): Promise<unknown> => {
        requested.push(checkpointId);
        return undefined;
      },
    };

    service(requester).create(taskId, checkpoint(taskId));
    service(requester).create(taskId, checkpoint(taskId, { feedback: '   ' }));
    await settle();
    expect(requested).toEqual([]);
  });

  it('入队失败不改变节点写入结果，也不向上抛错', async () => {
    const { store, service, taskId } = await setup();
    const created = service({
      requestExtractionForCheckpoint: async () => {
        throw new Error('队列已满');
      },
    }).create(taskId, checkpoint(taskId, { feedback: '结论放在第一段。' }));

    await settle();
    expect(store.discussionCheckpoints.get(created.id)?.feedback).toBe('结论放在第一段。');
  });
});
