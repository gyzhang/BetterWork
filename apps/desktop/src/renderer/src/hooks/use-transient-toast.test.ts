// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTransientToast } from './use-transient-toast';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTransientToast', () => {
  it('初始没有浮层', () => {
    const { result } = renderHook(() => useTransientToast());
    expect(result.current.toast).toBeUndefined();
  });

  it('showToast 写入 tone 与 message', () => {
    const { result } = renderHook(() => useTransientToast());

    act(() => result.current.showToast('success', '已保存'));

    expect(result.current.toast).toEqual({ tone: 'success', message: '已保存' });
  });

  it('dismissToast 清除浮层', () => {
    const { result } = renderHook(() => useTransientToast());

    act(() => result.current.showToast('success', '提示'));
    expect(result.current.toast).toBeDefined();

    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeUndefined();
  });

  it('连续 showToast 以最后一次为准', () => {
    const { result } = renderHook(() => useTransientToast());

    act(() => result.current.showToast('success', '第一条'));
    act(() => result.current.showToast('error', '第二条'));

    expect(result.current.toast).toEqual({ tone: 'error', message: '第二条' });
  });
});
