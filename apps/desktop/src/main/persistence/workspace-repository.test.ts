import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('WorkspaceRepository', () => {
  it('registers the identity chosen at creation and keeps one row per folder', () => {
    const store = openStore();
    const created = store.workspaces.create('/tmp/identity', '售前材料包', 'chart', 'plum');
    expect(created).toMatchObject({
      name: '售前材料包',
      rootPath: '/tmp/identity',
      iconId: 'chart',
      accentId: 'plum',
    });
    expect('hiddenAt' in created).toBe(false);

    // 缺省身份走列默认，不替调用方猜一个图标以外的东西。
    const plain = store.workspaces.create('/tmp/plain', '临时工作');
    expect(plain).toMatchObject({ iconId: 'folder', accentId: 'moss' });

    // 路径已登记时报错而不是静默复用：新建对话框不能把用户领进一个她没建出来的空间。
    expect(() => store.workspaces.create('/tmp/identity', '另一个名字')).toThrow(
      '已经登记为工作空间',
    );
    expect(
      store.workspaces.listAll().filter((space) => space.rootPath === '/tmp/identity'),
    ).toHaveLength(1);

    // getOrCreate 是默认工作空间的幂等引导，语义与 create 相反。
    const first = store.workspaces.getOrCreate('/tmp/boot', '我的工作区');
    expect(store.workspaces.getOrCreate('/tmp/boot', '我的工作区')).toMatchObject({ id: first.id });
  });

  it('changes only the identity fields it is given', () => {
    const store = openStore();
    const created = store.workspaces.create('/tmp/edit', 'GienWork', 'code', 'azure');

    const renamed = store.workspaces.updateIdentity(created.id, { name: 'GienWork 第三季度' });
    expect(renamed).toMatchObject({
      name: 'GienWork 第三季度',
      iconId: 'code',
      accentId: 'azure',
    });

    const recolored = store.workspaces.updateIdentity(created.id, { accentId: 'amber' });
    expect(recolored).toMatchObject({
      name: 'GienWork 第三季度',
      iconId: 'code',
      accentId: 'amber',
    });

    expect(() => store.workspaces.updateIdentity('missing', { name: '越界' })).toThrow(
      '已经不在了',
    );
  });

  it('hides and restores a workspace without touching its data', () => {
    const store = openStore();
    const created = store.workspaces.create('/tmp/hide', '要隐藏的空间');
    const task = store.tasks.create(created.id, '隐藏后仍在', '确认数据一行不动');

    const hidden = store.workspaces.setHidden(created.id, true);
    expect(hidden.hiddenAt).toBeTypeOf('number');
    expect(store.workspaces.get(created.id)?.name).toBe('要隐藏的空间');

    const shown = store.workspaces.setHidden(created.id, false);
    expect('hiddenAt' in shown).toBe(false);
    expect(store.tasks.listRecent(created.id).map((item) => item.id)).toEqual([task.task.id]);
  });

  it('groups workspaces with one page of tasks each and the true totals', () => {
    const store = openStore();
    const now = Date.now();
    const busy = store.workspaces.create('/tmp/busy', '活跃空间', 'project', 'teal');
    const quiet = store.workspaces.create('/tmp/quiet', '安静空间');
    const empty = store.workspaces.create('/tmp/empty', '新建的空空间');

    // 22 条任务：分组只带一页，但总数必须报真实值，否则「展示更多」无从计数。
    for (let index = 0; index < 22; index += 1) {
      const task = store.tasks.create(busy.id, `任务 ${index}`, '目标');
      store.tasks.touch(task.task.id, now - index);
    }
    const quietTask = store.tasks.create(quiet.id, '较早的任务', '目标');
    store.tasks.touch(quietTask.task.id, now - 100_000);

    const groups = store.workspaces.listTaskGroups();
    const ids = groups.map((group) => group.workspace.id);
    const byId = new Map(groups.map((group) => [group.workspace.id, group]));
    expect(new Set(ids)).toEqual(new Set([busy.id, quiet.id, empty.id]));
    // 空间按各自最近一次任务活动排序，因此较早的那个必须排在后面。
    expect(ids.indexOf(busy.id)).toBeLessThan(ids.indexOf(quiet.id));

    expect(byId.get(busy.id)).toMatchObject({
      workspace: { name: '活跃空间', iconId: 'project', accentId: 'teal' },
      totalTasks: 22,
    });
    expect(byId.get(busy.id)?.tasks).toHaveLength(20);
    // 组内按最近活动倒序，第一条就是刚被顶上去的那条。
    expect(byId.get(busy.id)?.tasks[0]?.title).toBe('任务 0');
    expect(byId.get(quiet.id)).toMatchObject({ totalTasks: 1 });
    // 没有任务的空间也要可见，否则用户建完就找不到它。
    expect(byId.get(empty.id)).toMatchObject({ totalTasks: 0, tasks: [] });

    store.workspaces.setHidden(quiet.id, true);
    const visible = store.workspaces.listTaskGroups().map((group) => group.workspace.id);
    expect(visible).not.toContain(quiet.id);
    expect(visible).toContain(busy.id);
  });
});
