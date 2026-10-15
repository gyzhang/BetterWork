// @vitest-environment jsdom

import type { MemoryViewItem } from '@betterwork/agent-protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMemories } from './use-memories';

const memoryOf = (id: string): MemoryViewItem => ({
  id,
  revisionId: `rev-${id}`,
  revision: 1,
  scope: { kind: 'workspace', workspaceId: 'ws-1' },
  kind: 'semantic',
  content: `内容 ${id}`,
  sourceType: 'conversation',
  confidence: 0.8,
  status: 'confirmed',
  contentHash: 'a'.repeat(64),
  createdAt: 1,
  updatedAt: 1,
  facet: 'fact',
  normalizedHash: 'b'.repeat(64),
  recallPolicy: 'relevant',
  provenance: {
    schemaVersion: 1,
    verification: 'legacy-unverified',
    sourceType: 'conversation',
  },
  effectiveStatus: 'confirmed',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
});

const listMemories = vi.fn<() => Promise<unknown>>();
const createMemory = vi.fn<(input: never) => Promise<unknown>>();
const updateMemory = vi.fn<(input: never) => Promise<unknown>>();
const setStatus = vi.fn<(input: never) => Promise<unknown>>();
const resolveConflict = vi.fn<(input: never) => Promise<unknown>>();
const rebuildProjection = vi.fn<(input: never) => Promise<unknown>>();
const getMemory = vi.fn<(input: never) => Promise<unknown>>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      memories: {
        list: listMemories,
        create: createMemory,
        update: updateMemory,
        setStatus,
        resolveConflict,
        rebuildProjection,
        get: getMemory,
      },
    },
  });
};

const deferred = (): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
} => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
  listMemories.mockReset();
  createMemory.mockReset();
  updateMemory.mockReset();
  setStatus.mockReset();
  resolveConflict.mockReset();
  rebuildProjection.mockReset();
  getMemory.mockReset();
  vi.restoreAllMocks();
});

describe('useMemories', () => {
  it.each(['success', 'domain-failure', 'transport-failure'] as const)(
    'ends loading when a silent search supersedes a refresh with %s',
    async (outcome) => {
      const old = deferred();
      const current = deferred();
      listMemories
        .mockResolvedValueOnce({ ok: true, data: { items: [memoryOf('existing')] }, warnings: [] })
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      install();
      const { result } = renderHook(() => useMemories());
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.refresh());
      expect(result.current.loading).toBe(true);
      act(() => result.current.setQuery('no-match'));
      await act(async () => {
        if (outcome === 'success') current.resolve({ ok: true, data: { items: [] }, warnings: [] });
        else if (outcome === 'domain-failure')
          current.resolve({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'current failure', retryable: true },
          });
        else current.reject(new Error('current failure'));
      });
      expect(result.current.loading).toBe(false);
      await act(async () =>
        old.resolve({ ok: true, data: { items: [memoryOf('old')] }, warnings: [] }),
      );
      expect(result.current.loading).toBe(false);
      if (outcome === 'success') {
        expect(result.current.query).toBe('no-match');
        expect(result.current.memories).toEqual([]);
        expect(result.current.error).toBe('');
      } else {
        expect(result.current.memories.map((item) => item.id)).toEqual(['existing']);
        expect(result.current.error).toBe('current failure');
      }
    },
  );

  it('ends initial loading when a scope change takes over the request', async () => {
    const old = deferred();
    const current = deferred();
    listMemories.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    install();
    const { result } = renderHook(() => useMemories());
    act(() => result.current.setFilters({ workspaceId: 'ws-new', expertId: undefined, query: '' }));
    await act(async () => current.resolve({ ok: true, data: { items: [] }, warnings: [] }));
    await act(async () => old.reject(new Error('old failure')));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('挂载时拉取记忆列表', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [memoryOf('m-1')], nextCursor: undefined },
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.memories).toHaveLength(1);
    expect(result.current.error).toBe('');
  });

  it('列表拉取失败时保留 error 并停止 loading', async () => {
    listMemories.mockResolvedValue({
      ok: false,
      error: {
        code: 'IPC_FAILURE',
        message: '读取失败',
        retryable: true,
        currentRevision: undefined,
      },
    });
    install();

    const { result } = renderHook(() => useMemories());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('读取失败');
    expect(result.current.memories).toHaveLength(0);
  });

  it('setFilters 改变筛选后重新拉取', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: undefined },
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setFilters({ workspaceId: 'ws-2', expertId: undefined, query: '' }));
    await waitFor(() => expect(listMemories).toHaveBeenCalledTimes(2));
  });

  it('setQuery 只改检索词，保留当前范围筛选', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: undefined },
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setQuery('关键词'));
    await waitFor(() => expect(result.current.query).toBe('关键词'));
    expect(listMemories).toHaveBeenCalledTimes(2);
  });

  it('create 成功后静默刷新列表', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: undefined },
      warnings: [],
    });
    createMemory.mockResolvedValue({
      ok: true,
      data: {
        memoryId: 'm-new',
        operationId: 'op-new',
        revision: 2,
        projectionState: 'ready',
      },
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.create({
        operationId: 'op-new',
        facet: 'fact',
        content: '内容',
        scope: { kind: 'workspace', workspaceId: 'ws-1' },
        asUserInstruction: false,
      });
    });

    expect((outcome as { ok: boolean }).ok).toBe(true);
    expect(listMemories).toHaveBeenCalledTimes(2);
  });

  it('update 遇到 REVISION_CONFLICT 时保留草稿并报告冲突', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [memoryOf('m-1')], nextCursor: undefined },
      warnings: [],
    });
    updateMemory.mockResolvedValue({
      ok: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: '另有更新',
        retryable: true,
        currentRevision: 5,
      },
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update({
        operationId: 'op-1',
        id: 'm-1',
        expectedRevision: 1,
        patch: { content: '新内容' },
      });
    });

    expect(result.current.error).toBe('另有更新');
    expect(result.current.revisionConflict?.memoryId).toBe('m-1');
    expect(result.current.revisionConflict?.currentRevision).toBe(5);
    expect(result.current.revisionConflict?.expectedRevision).toBe(1);
  });

  it('clearRevisionConflict 清除冲突状态', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [memoryOf('m-1')], nextCursor: undefined },
      warnings: [],
    });
    updateMemory.mockResolvedValue({
      ok: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: '冲突',
        retryable: true,
        currentRevision: 3,
      },
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update({
        operationId: 'op-2',
        id: 'm-1',
        expectedRevision: 1,
        patch: { content: '内容' },
      });
    });
    expect(result.current.revisionConflict).toBeDefined();

    act(() => result.current.clearRevisionConflict());
    expect(result.current.revisionConflict).toBeUndefined();
  });

  it('truncated 由 nextCursor 决定', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [memoryOf('m-1')], nextCursor: 'cursor-1' },
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.truncated).toBe(true);
  });

  it('loadRevision 直接返回结果，不影响列表状态', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: undefined },
      warnings: [],
    });
    getMemory.mockResolvedValue({
      ok: true,
      data: memoryOf('m-1'),
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.loadRevision({ id: 'm-1' });
    });

    expect((outcome as { ok: boolean }).ok).toBe(true);
  });

  it('rebuildProjection 成功后更新投影状态', async () => {
    listMemories.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: undefined },
      warnings: [],
    });
    rebuildProjection.mockResolvedValue({
      ok: true,
      data: { projectionState: 'ready' },
      warnings: [],
    });
    install();

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rebuildProjection('op-1');
    });

    expect(result.current.projectionState).toBe('ready');
    expect(result.current.error).toBe('');
  });
});
