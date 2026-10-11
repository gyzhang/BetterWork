// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppearance } from './use-appearance';

vi.mock('../appearance', () => ({
  bootstrapAppearance: () => ({ mode: 'system', scheme: 'jade' }),
  applyAppearance: (preference: { mode: string }) =>
    preference.mode === 'dark' ? 'dark' : 'light',
  persistAppearance: vi.fn(),
  getWindowTheme: () => ({ backgroundColor: '#fff', symbolColor: '#000' }),
}));

const updateTheme = vi.fn<() => Promise<void>>();

const install = (): void => {
  updateTheme.mockResolvedValue(undefined);
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { chrome: { updateTheme } },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  updateTheme.mockReset();
  vi.restoreAllMocks();
});

describe('useAppearance', () => {
  it('初始偏好由 bootstrapAppearance 提供', () => {
    install();
    const { result } = renderHook(() => useAppearance());

    expect(result.current.preference).toEqual({ mode: 'system', scheme: 'jade' });
    expect(result.current.resolved).toBe('light');
  });

  it('update 更新偏好并同步主题到主进程', () => {
    install();
    const { result } = renderHook(() => useAppearance());

    act(() => {
      result.current.update({ mode: 'dark', scheme: 'ink' });
    });

    expect(result.current.preference).toEqual({ mode: 'dark', scheme: 'ink' });
    expect(result.current.resolved).toBe('dark');
  });

  it('挂载时同步窗口主题', async () => {
    install();

    renderHook(() => useAppearance());
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateTheme).toHaveBeenCalled();
  });
});
