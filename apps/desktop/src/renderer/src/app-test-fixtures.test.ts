// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { installApi, skill } from './app-test-fixtures';

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('App API fixture defaults', () => {
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
