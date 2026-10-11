// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConversationAddresses } from './use-conversation-addresses';

const STORAGE_KEY = 'betterwork-conversation-addresses';

const installStorage = (initial: Record<string, string> = {}): void => {
  const store = new Map(Object.entries(initial));
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
    },
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConversationAddresses', () => {
  it('没有存储时使用默认值', () => {
    installStorage();
    const { result } = renderHook(() => useConversationAddresses());

    expect(result.current.addresses).toEqual({
      assistant: '罗伯特',
      user: '张三',
    });
  });

  it('从 localStorage 读取已存储的值', () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({ assistant: '小明', user: '小红' }),
    });

    const { result } = renderHook(() => useConversationAddresses());

    expect(result.current.addresses).toEqual({ assistant: '小明', user: '小红' });
  });

  it('update 同时更新状态与 localStorage', () => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          store.set(key, value);
        },
      },
    });

    const { result } = renderHook(() => useConversationAddresses());

    act(() => {
      result.current.update({ assistant: '李四', user: '王五' });
    });

    expect(result.current.addresses).toEqual({ assistant: '李四', user: '王五' });
    expect(JSON.parse(store.get(STORAGE_KEY) ?? '')).toEqual({
      assistant: '李四',
      user: '王五',
    });
  });

  it('存储格式损坏时退回默认值', () => {
    installStorage({ [STORAGE_KEY]: 'not json' });

    const { result } = renderHook(() => useConversationAddresses());

    expect(result.current.addresses).toEqual({
      assistant: '罗伯特',
      user: '张三',
    });
  });

  it('存储里缺字段时退回默认值', () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ assistant: '只有助手' }) });

    const { result } = renderHook(() => useConversationAddresses());

    expect(result.current.addresses).toEqual({
      assistant: '罗伯特',
      user: '张三',
    });
  });
});
