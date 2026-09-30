// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMcpConnections } from './use-mcp-connections';

/**
 * MCP 连接清单取数的 IPC 收口（docs/12 §5 的 Renderer 小节）。
 *
 * 这个 hook 此前的状态里**连 `error` 字段都没有**：`listConnections()` 一失败，`loading`
 * 永远停在 true，`SettingsView` 就一直显示「正在加载连接…」。修它要先补出口，
 * 所以这里的两条同时钉住「出口存在」与「失败路径接得上」。
 */

const install = (list: () => Promise<unknown>): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { mcp: { listConnections: vi.fn(list) } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
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
