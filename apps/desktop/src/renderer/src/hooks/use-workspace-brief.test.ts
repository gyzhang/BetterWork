// @vitest-environment jsdom

import type { WorkspaceBrief, WorkspaceMemoryBriefRequest } from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceBrief } from './use-workspace-brief';

/**
 * 工作空间简报取数（WM14，契约 §10）。
 *
 * 简报不落库、每次现取，所以这里只验两条纪律：
 * 失败与换空间都不允许把旧内容留在屏上当作现状。
 */

const HASH = 'a'.repeat(64);

const briefOf = (workspaceId: string): WorkspaceBrief => ({
  workspaceId,
  generatedAt: 1,
  goals: {
    items: [
      {
        memoryId: 'memory-1',
        revisionId: 'memory-1-r1',
        contentHash: HASH,
        content: `${workspaceId} 的口径`,
        scope: { kind: 'workspace', workspaceId },
        sourceAvailability: 'available',
        requiresMaterialSelection: false,
      },
    ],
    total: 1,
    truncated: false,
  },
  constraints: { items: [], total: 0, truncated: false },
  decisions: { items: [], total: 0, truncated: false },
  methods: { items: [], total: 0, truncated: false },
  openIssues: { items: [], total: 0, truncated: false },
  referenceVersions: { items: [], total: 0, truncated: false },
});

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

const memoryBrief = vi.fn<(input: WorkspaceMemoryBriefRequest) => Promise<unknown>>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { workspace: { memoryBrief } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  memoryBrief.mockReset();
});

describe('useWorkspaceBrief', () => {
  it('没有空间时不发请求也不保留上一次的简报', async () => {
    install();
    const { result } = renderHook(() =>
      useWorkspaceBrief({ workspaceId: undefined, expertId: undefined }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(memoryBrief).not.toHaveBeenCalled();
    expect(result.current.brief).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('取到简报后标记它属于哪个空间与专家', async () => {
    install();
    memoryBrief.mockResolvedValue({ ok: true, data: briefOf('workspace-1'), warnings: [] });
    const { result } = renderHook(() =>
      useWorkspaceBrief({ workspaceId: 'workspace-1', expertId: 'expert-1' }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(memoryBrief).toHaveBeenCalledWith({ workspaceId: 'workspace-1', expertId: 'expert-1' });
    expect(result.current.loadedFor).toBe('workspace-1|expert-1');
    expect(result.current.error).toBe('');
  });

  it('切换空间后旧请求的迟到响应不回填，界面上不出现别的空间的内容', async () => {
    install();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    memoryBrief
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { rerender, result } = renderHook(
      ({ workspaceId }: { workspaceId: string }) =>
        useWorkspaceBrief({ workspaceId, expertId: undefined }),
      { initialProps: { workspaceId: 'workspace-1' } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ workspaceId: 'workspace-2' });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => second.resolve({ ok: true, data: briefOf('workspace-2'), warnings: [] }));
    await act(async () => {
      await second.promise;
    });
    expect(result.current.brief?.goals.items[0]?.content).toBe('workspace-2 的口径');

    act(() => first.resolve({ ok: true, data: briefOf('workspace-1'), warnings: [] }));
    await act(async () => {
      await first.promise;
    });
    expect(result.current.brief?.goals.items[0]?.content).toBe('workspace-2 的口径');
    expect(result.current.loadedFor).toBe('workspace-2|-');
  });

  it('读取失败时清空简报并给出重试入口，重试会重新现取一次', async () => {
    install();
    memoryBrief
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'NOT_FOUND', message: '空间不存在。', retryable: false },
      })
      .mockResolvedValueOnce({ ok: true, data: briefOf('workspace-1'), warnings: [] });

    const { result } = renderHook(() =>
      useWorkspaceBrief({ workspaceId: 'workspace-1', expertId: undefined }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.brief).toBeUndefined();
    expect(result.current.loadedFor).toBeUndefined();
    expect(result.current.error).toBe('空间不存在。');
    expect(result.current.loading).toBe(false);

    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    expect(memoryBrief).toHaveBeenCalledTimes(2);
    expect(result.current.brief?.workspaceId).toBe('workspace-1');
    expect(result.current.error).toBe('');
  });

  it('IPC 传输失败也收口成可见错误，不抛到界面外', async () => {
    install();
    memoryBrief.mockRejectedValue(new Error('channel rejected'));
    const { result } = renderHook(() =>
      useWorkspaceBrief({ workspaceId: 'workspace-1', expertId: undefined }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.error).toBe('channel rejected');
    expect(result.current.brief).toBeUndefined();
  });
});
