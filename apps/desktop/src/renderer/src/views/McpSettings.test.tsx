// @vitest-environment jsdom
import type { McpConnectionSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpConnectionsState } from '../hooks/use-mcp-connections';
import { McpSettings } from './McpSettings';

afterEach(cleanup);
const connection: McpConnectionSummary = {
  id: 'conn',
  name: 'Remote MCP',
  revisionId: 'revision-1',
  revision: 1,
  lifecycle: 'disabled',
  status: 'unconfigured',
  stale: false,
  tools: [],
  createdAt: 1,
  updatedAt: 1,
  credentialSlots: [{ slot: 'http-token', configured: true, version: 3 }],
  transport: {
    kind: 'streamable-http',
    endpoint: 'https://mcp.example/mcp',
    networkMode: 'public',
    networkApproved: false,
    authentication: { mode: 'bearer' },
  },
};
const state = (connections: McpConnectionSummary[] = []): McpConnectionsState => ({
  connections,
  loading: false,
  error: '',
  refresh: vi.fn(),
  save: vi.fn(async () => ({ connection })),
  remove: vi.fn(async () => ({ deleted: true })),
  test: vi.fn(async () => ({ connection, tools: [] })),
  setLifecycle: vi.fn(async () => ({ connection })),
  reviewTool: vi.fn(async () => ({ connection })),
  cancel: vi.fn(async () => ({ cancelled: true })),
  prepareLogin: vi.fn(async (_id, operationId) => ({
    operationId,
    resource: 'https://mcp.example/mcp',
    issuers: ['https://auth.example'],
    scopes: ['report.read'],
  })),
  continueLogin: vi.fn(async () => ({ connection, tools: [] })),
  logout: vi.fn(async () => ({ connection })),
});

describe('MCP settings paths', () => {
  it('keeps saved secrets write-only and preserves the form after a failed save', async () => {
    const model = state([connection]);
    model.save = vi.fn(async () => {
      throw new Error('Version changed');
    });
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const token = screen.getByLabelText<HTMLInputElement>('Bearer Token');
    expect(token.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Version changed');
    expect(screen.getByDisplayValue('https://mcp.example/mcp')).toBeTruthy();
    expect(model.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevisionId: 'revision-1',
        secrets: [{ slot: 'http-token', expectedVersion: 3, mutation: { action: 'keep' } }],
      }),
    );
  });

  it('requires private destination approval and uses the exact loopback scope', async () => {
    const model = state();
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '新建连接' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Local HTTP' } });
    fireEvent.click(screen.getByRole('button', { name: '连接方式' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'HTTP · Streamable HTTP' }));
    fireEvent.change(screen.getByLabelText('服务地址'), {
      target: { value: 'http://127.0.0.1:3000/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: /网络范围/u }));
    fireEvent.click(screen.getByRole('menuitem', { name: '本机 loopback' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(model.save).not.toHaveBeenCalled());
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /允许连接/u }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(model.save).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            kind: 'streamable-http',
            networkMode: 'loopback',
            networkApproved: true,
          }),
        }),
      ),
    );
  });

  it('reviews issuer and scopes before browser login and routes cancellation to the same operation', async () => {
    const oauth = {
      ...connection,
      credentialSlots: [],
      transport: { ...connection.transport, authentication: { mode: 'oauth' as const } },
    };
    const model = state([oauth]);
    model.continueLogin = vi.fn(
      () => new Promise<Awaited<ReturnType<McpConnectionsState['continueLogin']>>>(() => {}),
    );
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByText(/report.read/u);
    expect(model.continueLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '在浏览器中继续' }));
    await waitFor(() =>
      expect(model.continueLogin).toHaveBeenCalledWith(
        expect.objectContaining({ issuer: 'https://auth.example', consent: true }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消登录' }));
    await waitFor(() => expect(model.cancel).toHaveBeenCalled());
    const prepare = vi.mocked(model.prepareLogin).mock.calls[0];
    expect(model.cancel).toHaveBeenCalledWith(connection.id, prepare?.[1]);
  });

  it('returns keyboard focus to the more-actions trigger after Escape', async () => {
    render(<McpSettings state={state([connection])} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    fireEvent.click(trigger);
    await screen.findByRole('menuitem', { name: '启用' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
