// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  installApi,
  previousRun,
  previousTask,
  skill,
  workspaceFixture,
} from './app-test-fixtures';

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('App API fixture defaults', () => {
  it('keeps tasks and runs empty until a test opts into historical data', async () => {
    const api = installApi();

    await expect(api.tasks.list({ workspaceId: workspaceFixture.id })).resolves.toEqual([]);
    await expect(api.tasks.get({ id: previousTask.id })).resolves.toBeNull();
    await expect(api.workspace.listTaskGroups()).resolves.toEqual([
      { workspace: workspaceFixture, tasks: [], totalTasks: 0 },
    ]);
    await expect(api.runs.list({ taskId: previousTask.id })).resolves.toEqual([]);
  });

  it('shares explicitly provided historical tasks across App task APIs', async () => {
    const api = installApi({ tasks: [previousTask], runs: [previousRun] });

    await expect(api.tasks.list({ workspaceId: workspaceFixture.id })).resolves.toEqual([
      previousTask,
    ]);
    await expect(api.tasks.get({ id: previousTask.id })).resolves.toEqual(previousTask);
    await expect(api.workspace.listTaskGroups()).resolves.toEqual([
      { workspace: workspaceFixture, tasks: [previousTask], totalTasks: 1 },
    ]);
    await expect(api.runs.list({ taskId: previousTask.id })).resolves.toEqual([previousRun]);
    await expect(api.runs.list({ taskId: 'another-task' })).resolves.toEqual([]);
  });

  it('keeps Skill methods empty or explicitly unconfigured by default', async () => {
    const api = installApi();

    expect(await api.skills.list()).toEqual([]);
    await expect(api.skills.get({ id: skill.id })).resolves.toBeNull();
    await expect(
      api.skills.refreshDependencyGrant({ skillId: skill.id, lockId: 'lock-unconfigured' }),
    ).rejects.toThrow('App 测试没有配置 Skill 依赖授权结果');
    await expect(api.skills.testRun({ skillId: skill.id })).rejects.toThrow(
      'App 测试没有配置 Skill 试运行结果',
    );
  });
});
