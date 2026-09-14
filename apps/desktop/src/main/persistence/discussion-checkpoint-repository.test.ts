import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '.';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('DiscussionCheckpointRepository', () => {
  it('stores an open checkpoint and makes a superseded retry visible', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/checkpoints', '检查点');
    const task = store.tasks.create(workspace.id, '经营报告', '完成本月报告');
    const first = store.discussionCheckpoints.create(task.task.id, {
      id: 'checkpoint-1',
      taskId: task.task.id,
      stage: 'report-outline',
      title: '报告大纲待审阅',
      summary: '已整理收入、毛利和现金流三部分。',
      artifactVersionIds: [],
    });
    const retry = store.discussionCheckpoints.create(task.task.id, {
      id: 'checkpoint-2',
      taskId: task.task.id,
      stage: 'report-outline',
      title: '报告大纲返工',
      summary: '补充预算偏差页。',
      feedback: '需要增加预算对比。',
      nextAction: '确认后生成 PPT 大纲。',
      artifactVersionIds: [],
      supersedesId: first.id,
    });

    expect(store.discussionCheckpoints.get(first.id)?.status).toBe('superseded');
    expect(retry.status).toBe('open');
    expect(store.discussionCheckpoints.listByTask(task.task.id)).toHaveLength(2);
    expect(
      store.discussionCheckpoints.create(task.task.id, {
        id: 'checkpoint-2',
        taskId: task.task.id,
        stage: 'report-outline',
        title: '重复提交',
        summary: '同一个客户端 ID 不重复创建。',
        artifactVersionIds: [],
      }),
    ).toEqual(retry);
  });

  it('rejects a Run from another Task', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/checkpoints-owner', '检查点');
    const firstTask = store.tasks.create(workspace.id, '任务一', '验证');
    const secondTask = store.tasks.create(workspace.id, '任务二', '验证');
    store.runs.create({
      id: 'checkpoint-owner-run',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '验证',
      status: 'running',
      createdAt: 1,
    });

    expect(() =>
      store.discussionCheckpoints.create(secondTask.task.id, {
        id: 'checkpoint-owner-mismatch',
        taskId: secondTask.task.id,
        runId: 'checkpoint-owner-run',
        stage: 'report',
        title: '错误归属',
        summary: '不应写入。',
        artifactVersionIds: [],
      }),
    ).toThrow('Discussion checkpoint Run does not belong to Task');
  });

  it('rejects an ArtifactVersion from another Task', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const firstWorkspace = store.workspaces.getOrCreate('/tmp/checkpoints-artifact-a', '检查点一');
    const secondWorkspace = store.workspaces.getOrCreate('/tmp/checkpoints-artifact-b', '检查点二');
    const firstTask = store.tasks.create(firstWorkspace.id, '任务一', '验证');
    const secondTask = store.tasks.create(secondWorkspace.id, '任务二', '验证');
    const artifact = store.artifacts.saveMarkdown({
      taskId: firstTask.task.id,
      origin: 'user-edit',
      title: '其他任务成果',
      content: '正文',
    });

    expect(() =>
      store.discussionCheckpoints.create(secondTask.task.id, {
        id: 'checkpoint-artifact-mismatch',
        taskId: secondTask.task.id,
        stage: 'report',
        title: '错误成果',
        summary: '不应写入。',
        artifactVersionIds: [artifact.currentVersionId],
      }),
    ).toThrow('Discussion checkpoint ArtifactVersion does not belong to Task');
  });

  it('rejects a client id already owned by another Task', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/checkpoints-id-owner', '检查点');
    const firstTask = store.tasks.create(workspace.id, '任务一', '验证');
    const secondTask = store.tasks.create(workspace.id, '任务二', '验证');
    store.discussionCheckpoints.create(firstTask.task.id, {
      id: 'checkpoint-shared-client-id',
      taskId: firstTask.task.id,
      stage: 'report',
      title: '任务一节点',
      summary: '属于任务一。',
      artifactVersionIds: [],
    });

    expect(() =>
      store.discussionCheckpoints.create(secondTask.task.id, {
        id: 'checkpoint-shared-client-id',
        taskId: secondTask.task.id,
        stage: 'report',
        title: '任务二节点',
        summary: '不应读取任务一节点。',
        artifactVersionIds: [],
      }),
    ).toThrow('Discussion checkpoint id already belongs to another Task');
  });
});
