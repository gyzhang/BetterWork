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
});
