// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useExperts } from './use-experts';

/**
 * 专家列表取数的 IPC 收口（docs/12 §5 的 Renderer 小节）。
 *
 * 与 `use-skills` 的 `refresh` 同源缺陷：失败时 `loading` 只在成功路径清除，界面停在转圈上，
 * 而 `ExpertsView.tsx:994` 那句 `{state.error && <InlineError …/>}` 永远等不到内容——
 * 出口本来就修好了，只是失败路径没接上去。
 */

const install = (list: () => Promise<unknown>): { list: ReturnType<typeof vi.fn> } => {
  const api = { experts: { list: vi.fn(list) } };
  Object.defineProperty(window, 'betterwork', { configurable: true, value: api });
  return { list: api.experts.list };
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
});

describe('useExperts 的取数收口', () => {
  it('读取失败时停下转圈，并把这句话交给 ExpertsView 已有的内联出口', async () => {
    const { list } = install(async () => {
      throw new Error('专家通道不可用');
    });

    const { result } = renderHook(() => useExperts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('专家通道不可用');
    expect(result.current.experts).toHaveLength(0);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('读取成功时清除转圈且不报错', async () => {
    install(async () => []);

    const { result } = renderHook(() => useExperts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('');
  });
});
