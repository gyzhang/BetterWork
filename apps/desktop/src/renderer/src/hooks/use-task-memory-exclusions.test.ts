// @vitest-environment jsdom

import type {
  Result,
  TaskMemoryExclusionsData,
  TaskMemoryExclusionsRequest,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTaskMemoryExclusions } from './use-task-memory-exclusions';

/**
 * 「本任务已排除」独立清单（MI03，契约 §11.2）。
 *
 * 这个投影必须做到三件事：不要求 prompt、切任务时不串数据、读失败与预览失败互不牵连。
 * 界面外观仍归光哥人工验收，这里只钉住行为。
 */

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  if (!resolve) throw new Error('Deferred promise did not initialize');
  return { promise, resolve };
};

const data = (taskId: string, memoryId: string): TaskMemoryExclusionsData => ({
  taskId,
  taskContextRevisionId: 'context-1',
  taskContextRevision: 3,
  items: [{ visibility: 'unavailable', memoryId }],
});

const okData = (value: TaskMemoryExclusionsData): Result<TaskMemoryExclusionsData> => ({
  ok: true,
  data: value,
  warnings: [],
});

const install = (
  taskExclusions: (input: TaskMemoryExclusionsRequest) => Promise<unknown>,
): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      memories: {
        taskExclusions,
        get: vi.fn(async (): Promise<unknown> => okData(data('t', 'm'))),
      },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

type HookQuery = Parameters<typeof useTaskMemoryExclusions>[0];

const query = (overrides: Partial<HookQuery> = {}): HookQuery => ({
  taskId: 'task-1',
  taskContextRevisionId: 'context-1',
  expectedTaskContextRevision: 3,
  ...overrides,
});

describe('useTaskMemoryExclusions', () => {
  it('不要求 prompt 也能读取清单，且越范围项只带占位', async () => {
    const taskExclusions = vi.fn(
      async (input: TaskMemoryExclusionsRequest): Promise<Result<TaskMemoryExclusionsData>> =>
        okData(data(input.taskId, 'memory-9')),
    );
    install(taskExclusions);
    const { result } = renderHook(() => useTaskMemoryExclusions(query()));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBe('');
    expect(result.current.items[0]).toEqual({ visibility: 'unavailable', memoryId: 'memory-9' });
    // 请求体里没有 prompt 字段：换问法或清空草稿都不影响清单读取。
    expect(taskExclusions.mock.calls[0]?.[0]).toEqual({
      taskId: 'task-1',
      taskContextRevisionId: 'context-1',
      expectedTaskContextRevision: 3,
    });
  });

  it('上下文尚未建立时不请求也不报错，并丢掉上一个任务的清单', async () => {
    const taskExclusions = vi.fn(
      async (input: TaskMemoryExclusionsRequest): Promise<Result<TaskMemoryExclusionsData>> =>
        okData(data(input.taskId, 'memory-1')),
    );
    install(taskExclusions);
    const { result, rerender } = renderHook(
      ({ value }: { value: HookQuery }) => useTaskMemoryExclusions(value),
      { initialProps: { value: query() } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({
      value: {
        taskId: undefined,
        taskContextRevisionId: undefined,
        expectedTaskContextRevision: undefined,
      },
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe('');
    expect(taskExclusions).toHaveBeenCalledTimes(1);
  });

  it('切任务后的迟到响应不得覆盖新任务的清单', async () => {
    const slow = deferred<Result<TaskMemoryExclusionsData>>();
    const fast = deferred<Result<TaskMemoryExclusionsData>>();
    const taskExclusions = vi
      .fn<(input: TaskMemoryExclusionsRequest) => Promise<Result<TaskMemoryExclusionsData>>>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise);
    install(taskExclusions);
    const { result, rerender } = renderHook(
      ({ value }: { value: HookQuery }) => useTaskMemoryExclusions(value),
      { initialProps: { value: query({ taskId: 'task-slow' }) } },
    );
    await waitFor(() => expect(taskExclusions).toHaveBeenCalledTimes(1));

    rerender({ value: query({ taskId: 'task-fast' }) });
    await waitFor(() => expect(taskExclusions).toHaveBeenCalledTimes(2));
    fast.resolve(okData(data('task-fast', 'memory-new')));
    await waitFor(() => expect(result.current.items[0]?.memoryId).toBe('memory-new'));

    // 旧任务的响应此刻才回来：必须被丢弃，不能把两个任务的清单混在一起。
    slow.resolve(okData(data('task-slow', 'memory-stale')));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items.map((item) => item.memoryId)).toEqual(['memory-new']);
  });

  it('读取失败给出可重试错误，不影响面板其余部分', async () => {
    const failure: Result<TaskMemoryExclusionsData> = {
      ok: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: '任务上下文已更新，请重新加载。',
        retryable: true,
      },
    };
    const taskExclusions = vi
      .fn<(input: TaskMemoryExclusionsRequest) => Promise<Result<TaskMemoryExclusionsData>>>()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(okData(data('task-1', 'memory-2')));
    install(taskExclusions);
    const { result } = renderHook(() => useTaskMemoryExclusions(query()));

    await waitFor(() => expect(result.current.error).toBe('任务上下文已更新，请重新加载。'));
    expect(result.current.items).toEqual([]);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items[0]?.memoryId).toBe('memory-2'));
    expect(result.current.error).toBe('');
  });
});
