// @vitest-environment jsdom

import {
  DEFAULT_ENABLE_BUILTIN_EXPERTS,
  DEFAULT_ENABLE_BUILTIN_SKILLS,
  DEFAULT_MAX_SKILL_TOOL_ROUNDS,
  type RunSettings,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRunSettings } from './use-run-settings';

const settingsOf = (overrides: Partial<RunSettings> = {}): RunSettings => ({
  maxSkillToolRounds: DEFAULT_MAX_SKILL_TOOL_ROUNDS,
  enableBuiltinSkills: DEFAULT_ENABLE_BUILTIN_SKILLS,
  enableBuiltinExperts: DEFAULT_ENABLE_BUILTIN_EXPERTS,
  ...overrides,
});

const getSettings = vi.fn<() => Promise<RunSettings>>();
const saveSettings = vi.fn<(input: never) => Promise<RunSettings>>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      runSettings: { get: getSettings, save: saveSettings },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  getSettings.mockReset();
  saveSettings.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRunSettings', () => {
  it('挂载时拉取设置并填入初始状态', async () => {
    getSettings.mockResolvedValue(settingsOf({ maxSkillToolRounds: 50 }));
    install();

    const { result } = renderHook(() => useRunSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings?.maxSkillToolRounds).toBe(50);
    expect(result.current.draft).toBe('50');
    expect(result.current.error).toBe('');
  });

  it('拉取失败时写入 error', async () => {
    getSettings.mockRejectedValue(new Error('channel rejected'));
    install();

    const { result } = renderHook(() => useRunSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('channel rejected');
  });

  it('开关立即提交', async () => {
    getSettings.mockResolvedValue(settingsOf());
    saveSettings.mockResolvedValue(settingsOf({ enableBuiltinSkills: false }));
    install();

    const { result } = renderHook(() => useRunSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setEnableBuiltinSkills(false));

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(result.current.enableBuiltinSkills).toBe(false);
  });

  it('轮数输入在有效值稳定后提交（防抖）', async () => {
    getSettings.mockResolvedValue(settingsOf());
    saveSettings.mockResolvedValue(settingsOf({ maxSkillToolRounds: 100 }));
    install();

    const { result } = renderHook(() => useRunSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.useFakeTimers();
    act(() => result.current.setDraft('100'));
    expect(saveSettings).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(saveSettings).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('无效轮数（超范围）不触发保存', async () => {
    getSettings.mockResolvedValue(settingsOf());
    install();

    const { result } = renderHook(() => useRunSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.useFakeTimers();
    act(() => result.current.setDraft('9999'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(saveSettings).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('保存失败时写入 error', async () => {
    getSettings.mockResolvedValue(settingsOf());
    saveSettings.mockRejectedValue(new Error('写入失败'));
    install();

    const { result } = renderHook(() => useRunSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setEnableBuiltinExperts(false));
    await waitFor(() => expect(result.current.error).toBe('写入失败'));
  });

  it('retrySave 重新提交当前值', async () => {
    getSettings.mockResolvedValue(settingsOf());
    saveSettings.mockRejectedValueOnce(new Error('第一次失败'));
    saveSettings.mockResolvedValueOnce(settingsOf());
    install();

    const { result } = renderHook(() => useRunSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setEnableBuiltinExperts(false));
    await waitFor(() => expect(result.current.error).toBe('第一次失败'));

    await act(async () => {
      result.current.retrySave();
      await Promise.resolve();
    });

    expect(saveSettings).toHaveBeenCalledTimes(2);
  });
});
