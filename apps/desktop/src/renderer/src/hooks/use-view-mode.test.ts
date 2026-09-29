// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useViewMode } from './use-view-mode';

const originalLocalStorage = window.localStorage;

/**
 * 这个 jsdom 环境没有 `localStorage`（`window.localStorage` 是 undefined），所以按仓库既有
 * 约定（`SkillsView.test.tsx`）用 `Object.defineProperty` 装一份内存 store，而不是引第二套做法。
 */
function installStorage(
  overrides: Partial<Pick<Storage, 'getItem' | 'setItem'>> = {},
  initial: Record<string, string> = {},
): { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> } {
  const store = new Map(Object.entries(initial));
  const getItem =
    overrides.getItem ?? vi.fn((key: string): string | null => store.get(key) ?? null);
  const setItem =
    overrides.setItem ??
    vi.fn((key: string, value: string): void => {
      store.set(key, value);
    });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem, setItem },
  });
  return {
    getItem: getItem as ReturnType<typeof vi.fn>,
    setItem: setItem as ReturnType<typeof vi.fn>,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

/**
 * 卡片／列表偏好的唯一读写（docs/10 §10.1）。
 *
 * 这个 hook 是「同一块内容的卡片／列表切换」在全仓的唯一 storage 出口，页面各自只给 key。
 * 值得钉的是两件容易被改坏又不会有人注意的事：**只认 `'list'` 这一个字面量**（存进去的是
 * 别的值时必须退回 `grid`，不能把它当模式名透传），以及 **storage 不可用时降级成本次会话内
 * 有效**——读失败要兜底成 `grid` 而不是抛错炸掉整页，写失败仍要让用户看到切换生效。
 */
describe('useViewMode', () => {
  it('没有存过偏好时缺省是卡片视图', () => {
    installStorage();

    const { result } = renderHook(() => useViewMode('betterwork-skills-view'));

    expect(result.current.viewMode).toBe('grid');
  });

  it('读回已存的列表偏好', () => {
    installStorage({}, { 'betterwork-skills-view': 'list' });

    const { result } = renderHook(() => useViewMode('betterwork-skills-view'));

    expect(result.current.viewMode).toBe('list');
  });

  it('存的是别的字面量时退回卡片视图，不把它当模式名透传', () => {
    installStorage({}, { 'betterwork-skills-view': 'cards' });

    const { result } = renderHook(() => useViewMode('betterwork-skills-view'));

    expect(result.current.viewMode).toBe('grid');
  });

  it('切换同时改状态与写回 storage', () => {
    const { setItem } = installStorage();
    const { result } = renderHook(() => useViewMode('betterwork-skills-view'));

    act(() => {
      result.current.changeViewMode('list');
    });

    expect(result.current.viewMode).toBe('list');
    expect(setItem).toHaveBeenCalledWith('betterwork-skills-view', 'list');
  });

  it('每个页面用自己的 key，偏好互不覆盖', () => {
    installStorage();
    const skills = renderHook(() => useViewMode('betterwork-skills-view'));
    const experts = renderHook(() => useViewMode('betterwork-experts-view'));

    act(() => {
      skills.result.current.changeViewMode('list');
    });

    expect(experts.result.current.viewMode).toBe('grid');
  });

  it('storage 读不了时兜底成卡片视图，不炸整页', () => {
    installStorage({
      getItem: (): string | null => {
        throw new Error('storage denied');
      },
    });

    const { result } = renderHook(() => useViewMode('betterwork-skills-view'));

    expect(result.current.viewMode).toBe('grid');
  });

  it('storage 写不了时本次会话内仍然生效', () => {
    installStorage({
      setItem: (): void => {
        throw new Error('storage denied');
      },
    });
    const { result } = renderHook(() => useViewMode('betterwork-skills-view'));

    act(() => {
      result.current.changeViewMode('list');
    });

    expect(result.current.viewMode, '写失败不该把用户的切换吞掉').toBe('list');
  });
});
