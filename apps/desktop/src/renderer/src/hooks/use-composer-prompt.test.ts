// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useComposerPrompt } from './use-composer-prompt';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useComposerPrompt', () => {
  it('保留已有草稿，并在最后一次输入停顿 300 毫秒后通知预览', async () => {
    vi.useFakeTimers();
    let draft = '沿用现有草稿';
    const onPromptChange = vi.fn();
    const onPromptSettled = vi.fn();
    const readPromptDraft = (): string => draft;
    const changeDraft = (value: string): void => {
      draft = value;
      onPromptChange(value);
    };
    const { result } = renderHook(() =>
      useComposerPrompt({ readPromptDraft, onPromptChange: changeDraft, onPromptSettled }),
    );

    expect(result.current.prompt).toBe(draft);
    await act(() => vi.advanceTimersByTime(299));
    expect(onPromptSettled).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTime(1));
    expect(onPromptSettled).toHaveBeenCalledExactlyOnceWith(draft);

    act(() => result.current.changePrompt('改写后的草稿'));
    expect(result.current.prompt).toBe('改写后的草稿');
    expect(onPromptChange).toHaveBeenCalledExactlyOnceWith('改写后的草稿');

    await act(() => vi.advanceTimersByTime(200));
    act(() => result.current.changePrompt('停顿前的最终草稿'));
    await act(() => vi.advanceTimersByTime(299));
    expect(onPromptSettled).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTime(1));
    expect(onPromptSettled).toHaveBeenCalledTimes(2);
    expect(onPromptSettled).toHaveBeenLastCalledWith('停顿前的最终草稿');
  });
});
