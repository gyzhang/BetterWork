// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTaskScroll } from './use-task-scroll';

afterEach(cleanup);

describe('task reading position', () => {
  it('follows at the bottom, pauses when reading above, and resumes only on request', () => {
    const { result, rerender } = renderHook(({ content }) => useTaskScroll('task', content, 1), {
      initialProps: { content: 0 },
    });
    const container = document.createElement('div');
    Object.defineProperties(container, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 300 },
    });
    result.current.containerRef.current = container;
    rerender({ content: 1 });
    expect(container.scrollTop).toBe(1000);
    act(() => {
      container.scrollTop = 200;
      result.current.onScroll();
    });
    rerender({ content: 2 });
    expect(container.scrollTop).toBe(200);
    expect(result.current.detached).toBe(true);
    act(() => result.current.jumpToLatest());
    expect(container.scrollTop).toBe(1000);
    expect(result.current.detached).toBe(false);
  });
  it('opens history at the latest answer start instead of the end of a long answer', () => {
    const { result, rerender } = renderHook(({ count }) => useTaskScroll('history', count, count), {
      initialProps: { count: 0 },
    });
    const container = document.createElement('div');
    Object.defineProperties(container, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 300 },
    });
    const reply = document.createElement('div');
    reply.getBoundingClientRect = () => ({ top: 600 }) as DOMRect;
    result.current.containerRef.current = container;
    result.current.latestReplyRef.current = reply;
    rerender({ count: 1 });
    expect(container.scrollTop).toBe(576);
    expect(result.current.detached).toBe(true);
  });
});
