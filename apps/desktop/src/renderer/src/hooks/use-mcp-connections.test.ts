// @vitest-environment jsdom

import type { McpConnectionSummary } from '@betterwork/agent-protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMcpConnections } from './use-mcp-connections';

/**
 * MCP 连接清单取数的 IPC 收口（docs/12 §5 的 Renderer 小节）。
 *
 * 这个 hook 此前的状态里**连 `error` 字段都没有**：`listConnections()` 一失败，`loading`
 * 永远停在 true，`SettingsView` 就一直显示「正在加载连接…」。修它要先补出口，
 * 所以这里的两条同时钉住「出口存在」与「失败路径接得上」。
 */

const install = (
  list: () => Promise<unknown>,
  testConnection: (input: unknown) => Promise<unknown> = async () => ({}),
): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { mcp: { listConnections: vi.fn(list), testConnection } },
  });
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
});

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

describe('MCP refresh request ownership', () => {
  it('keeps the latest revision for the next action after an older list completes', async () => {
    const old = deferred();
    const current = deferred();
    const list = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const testConnection = vi.fn(async () => ({}));
    install(list, testConnection);
    const { result } = renderHook(() => useMcpConnections());
    act(() => result.current.refresh());
    await act(async () => current.resolve([{ id: 'connection', revisionId: 'new-revision' }]));
    await act(async () => old.resolve([{ id: 'connection', revisionId: 'old-revision' }]));
    await act(async () => {
      await result.current.test('connection', 'audit-operation');
    });
    expect(testConnection).toHaveBeenCalledWith({
      id: 'connection',
      operationId: 'audit-operation',
      expectedRevisionId: 'new-revision',
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it.each(['success', 'failure'] as const)(
    'does not end the current loading state for an older %s',
    async (outcome) => {
      const old = deferred();
      const current = deferred();
      install(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
      const { result } = renderHook(() => useMcpConnections());
      act(() => result.current.refresh());
      await act(async () => {
        if (outcome === 'success') old.resolve([]);
        else old.reject(new Error('old failure'));
      });
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBe('');
      await act(async () => current.reject(new Error('current failure')));
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('current failure');
    },
  );

  it('ignores a late failure after the latest list succeeds', async () => {
    const old = deferred();
    const current = deferred();
    install(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
    const { result } = renderHook(() => useMcpConnections());
    act(() => result.current.refresh());
    const connection = { id: 'connection', revisionId: 'new-revision' } as McpConnectionSummary;
    await act(async () => current.resolve([connection]));
    await act(async () => old.reject(new Error('old failure')));
    expect(result.current.connections).toEqual([connection]);
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(false);
  });
});

describe('useMcpConnections 的取数收口', () => {
  it('读取失败时停下转圈，并把这句话交到一个真实存在的出口', async () => {
    install(async () => {
      throw new Error('MCP 通道不可用');
    });

    const { result } = renderHook(() => useMcpConnections());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('MCP 通道不可用');
    expect(result.current.connections).toHaveLength(0);
  });

  it('读取成功时清除转圈且不报错', async () => {
    install(async () => []);

    const { result } = renderHook(() => useMcpConnections());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('');
  });
});
