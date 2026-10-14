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

describe('MCP connection workflows and failure recovery', () => {
  const fillImport = (servers: object): void => {
    fireEvent.click(screen.getByRole('button', { name: '导入 JSON' }));
    fireEvent.change(screen.getByLabelText('mcpServers 配置 JSON'), {
      target: { value: JSON.stringify({ mcpServers: servers }) },
    });
  };
  const tool = (id: string, hints: { readOnlyHint?: boolean; destructiveHint?: boolean } = {}) => ({
    id,
    connectionId: connection.id,
    name: id,
    description: `Description ${id}`,
    inputSchema: { type: 'object' },
    schemaHash: 'schema',
    contractHash: 'a'.repeat(64),
    reviewed: false,
    discoveredAt: 1,
    annotations: hints,
  });

  it('imports only new names and preserves secrets as mutations', async () => {
    const model = state([connection]);
    render(<McpSettings state={model} />);
    fillImport({
      'Remote MCP': { command: 'existing' },
      New: { command: 'node', args: ['server.js'], env: { TOKEN: 'synthetic-token' } },
    });
    expect(screen.getByText(/跳过 1 个已有同名连接/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导入连接' }));
    await waitFor(() => expect(model.refresh).toHaveBeenCalledOnce());
    expect(model.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'New',
        secrets: [
          {
            slot: 'env:TOKEN',
            expectedVersion: 0,
            mutation: { action: 'replace', value: 'synthetic-token' },
          },
        ],
      }),
    );
    expect(screen.queryByLabelText('mcpServers 配置 JSON')).toBeNull();
    expect(await screen.findByText(/1 个 MCP 连接已导入/u)).toBeTruthy();
  });

  it('retries only the failed import and retains its editable input', async () => {
    const model = state();
    model.save = vi
      .fn()
      .mockResolvedValueOnce({ connection })
      .mockRejectedValueOnce(new Error('second rejected'))
      .mockResolvedValue({ connection });
    render(<McpSettings state={model} />);
    fillImport({
      First: { command: 'node', args: ['first.js'] },
      Second: { command: 'node', args: ['second.js'] },
    });
    fireEvent.click(screen.getByRole('button', { name: '导入连接' }));
    expect((await screen.findByRole('alert')).textContent).toContain('已导入 1 项，1 项未保存');
    const retained = JSON.parse(
      screen.getByLabelText<HTMLTextAreaElement>('mcpServers 配置 JSON').value,
    ) as { mcpServers: object };
    expect(Object.keys(retained.mcpServers)).toEqual(['Second']);
    fireEvent.click(screen.getByRole('button', { name: '导入连接' }));
    await waitFor(() => expect(model.save).toHaveBeenCalledTimes(3));
    expect(vi.mocked(model.save).mock.calls.map(([request]) => request.name)).toEqual([
      'First',
      'Second',
      'Second',
    ]);
    await waitFor(() => expect(screen.queryByLabelText('mcpServers 配置 JSON')).toBeNull());
  });

  it.each(['invalid JSON', 'all duplicated'] as const)('blocks import for %s', (reason) => {
    const model = state([connection]);
    render(<McpSettings state={model} />);
    fillImport({ 'Remote MCP': { command: 'node' } });
    if (reason === 'invalid JSON')
      fireEvent.change(screen.getByLabelText('mcpServers 配置 JSON'), {
        target: { value: '{broken' },
      });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导入连接' }).disabled).toBe(true);
    expect(model.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByLabelText('mcpServers 配置 JSON')).toBeNull();
  });

  it('allows only marked read-only tools in the read-only batch', async () => {
    const tools = [
      tool('read', { readOnlyHint: true }),
      tool('already', { readOnlyHint: true }),
      tool('write', { readOnlyHint: false }),
      tool('unknown'),
      { ...tool('unhashed', { readOnlyHint: true }), contractHash: undefined },
    ];
    tools[1]!.reviewed = true;
    const model = state([{ ...connection, tools }]);
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByText('工具与诊断'));
    fireEvent.click(screen.getByRole('button', { name: /允许全部只读工具（1）/u }));
    await waitFor(() =>
      expect(model.reviewTool).toHaveBeenCalledExactlyOnceWith({
        connectionId: 'conn',
        connectionRevisionId: 'revision-1',
        toolId: 'read',
        contractHash: 'a'.repeat(64),
        userConfirmed: true,
      }),
    );
    expect(await screen.findByText(/已允许 1 个只读工具/u)).toBeTruthy();
  });

  it('requires a separate explicit confirmation before the risky batch', async () => {
    const model = state([
      {
        ...connection,
        tools: [
          tool('write', { readOnlyHint: false }),
          tool('delete', { destructiveHint: true }),
          tool('unknown'),
        ],
      },
    ]);
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByText('工具与诊断'));
    fireEvent.click(screen.getByRole('button', { name: /允许这些工具（2）/u }));
    expect(model.reviewTool).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog').textContent).toContain('write、delete');
    fireEvent.click(screen.getByRole('button', { name: '我了解风险，允许使用' }));
    await waitFor(() => expect(model.reviewTool).toHaveBeenCalledTimes(2));
    expect(vi.mocked(model.reviewTool).mock.calls.map(([input]) => input.toolId)).toEqual([
      'write',
      'delete',
    ]);
  });

  it('keeps partial review failures actionable without announcing total success', async () => {
    const model = state([
      {
        ...connection,
        tools: [tool('first', { readOnlyHint: true }), tool('second', { readOnlyHint: true })],
      },
    ]);
    model.reviewTool = vi
      .fn()
      .mockResolvedValueOnce({ connection })
      .mockRejectedValueOnce(new Error('contract changed'));
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByText('工具与诊断'));
    fireEvent.click(screen.getByRole('button', { name: /允许全部只读工具/u }));
    expect((await screen.findByRole('alert')).textContent).toContain('1 个工具已允许，1 个失败');
    expect(screen.queryByText(/已允许 2 个只读工具/u)).toBeNull();
    expect(model.refresh).toHaveBeenCalledOnce();
  });

  it('disables review of a stale tool catalog', () => {
    const model = state([
      { ...connection, stale: true, tools: [tool('read', { readOnlyHint: true })] },
    ]);
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByText('工具与诊断'));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /允许全部只读工具/u }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '允许使用' }).disabled).toBe(true);
  });

  it.each(['success', 'failure'] as const)(
    'handles connection detection %s and restores its controls',
    async (outcome) => {
      const model = state([connection]);
      if (outcome === 'failure')
        model.test = vi
          .fn()
          .mockRejectedValue(
            new Error("Error invoking remote method 'mcp:test': McpClientError: detection failed"),
          );
      render(<McpSettings state={model} />);
      fireEvent.click(screen.getByRole('button', { name: '检测' }));
      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>('button', { name: '检测' }).disabled).toBe(
          false,
        ),
      );
      expect(model.test).toHaveBeenCalledWith('conn', expect.any(String));
      if (outcome === 'success') expect(model.refresh).toHaveBeenCalledOnce();
      else expect(screen.getByRole('alert').textContent).toContain('detection failed');
    },
  );

  it.each(['enabled', 'disabled'] as const)(
    'toggles lifecycle %s with the current revision',
    async (lifecycle) => {
      const model = state([{ ...connection, lifecycle }]);
      render(<McpSettings state={model} />);
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
      fireEvent.click(
        screen.getByRole('menuitem', { name: lifecycle === 'enabled' ? '停用' : '启用' }),
      );
      await waitFor(() =>
        expect(model.setLifecycle).toHaveBeenCalledWith({
          id: 'conn',
          expectedRevisionId: 'revision-1',
          lifecycle: lifecycle === 'enabled' ? 'disabled' : 'enabled',
        }),
      );
    },
  );

  it('confirms removal and reports removal failure through the inline outlet', async () => {
    const model = state([connection]);
    model.remove = vi.fn().mockRejectedValue(new Error('removal failed'));
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '移除' }));
    expect(model.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除连接' }));
    expect((await screen.findByRole('alert')).textContent).toContain('removal failed');
    expect(model.remove).toHaveBeenCalledExactlyOnceWith('conn');
  });

  it('shows a retriable read failure instead of an empty-state claim', () => {
    const model = { ...state(), error: 'read failed' };
    render(<McpSettings state={model} />);
    expect(screen.queryByText('还没有 MCP 连接')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(model.refresh).toHaveBeenCalledOnce();
  });
});

describe('MCP configuration and secret mutation forms', () => {
  const choose = (label: string, option: string): void => {
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('menuitem', { name: option }));
  };
  const fill = (label: string, value: string): void => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  };

  it('saves a custom stdio configuration with ordinary and write-only secret environment slots', async () => {
    const model = state();
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '新建连接' }));
    fill('名称', 'Custom');
    fill('启动命令', '/custom/node');
    fill('服务参数（每行一个）', 'server.js\n--readonly');
    fill('工作目录（可选）', '/work');
    fireEvent.click(screen.getByText('环境变量'));
    fill('普通环境变量（每行 NAME=value）', 'REGION=cn\nMODE=readonly');
    fireEvent.click(screen.getByRole('button', { name: '添加机密变量' }));
    fill('机密变量 1 的名称', 'TOKEN');
    fill('TOKEN 的新值', 'synthetic-secret');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(model.save).toHaveBeenCalledExactlyOnceWith({
        name: 'Custom',
        transport: {
          kind: 'stdio',
          command: '/custom/node',
          args: ['server.js', '--readonly'],
          cwd: '/work',
          env: [
            { name: 'REGION', value: 'cn', secret: false },
            { name: 'MODE', value: 'readonly', secret: false },
            { name: 'TOKEN', secret: true },
          ],
        },
        secrets: [
          {
            slot: 'env:TOKEN',
            expectedVersion: 0,
            mutation: { action: 'replace', value: 'synthetic-secret' },
          },
        ],
      }),
    );
    expect(screen.queryByLabelText('启动命令')).toBeNull();
  });

  it.each(['内置 · 记忆', '内置 · 顺序思考', '内置 · 网页抓取'] as const)(
    'saves %s as a bundled runtime rather than an executable path',
    async (option) => {
      const model = state();
      render(<McpSettings state={model} />);
      fireEvent.click(screen.getByRole('button', { name: '新建连接' }));
      fill('名称', 'Bundled');
      choose('服务来源', option);
      expect(screen.queryByLabelText('启动命令')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() =>
        expect(model.save).toHaveBeenCalledWith(
          expect.objectContaining({
            transport: {
              kind: 'stdio',
              runtime: {
                kind: 'bundled',
                serverId:
                  option === '内置 · 记忆'
                    ? 'memory'
                    : option === '内置 · 顺序思考'
                      ? 'sequential-thinking'
                      : 'fetch',
              },
              args: [],
              env: [],
            },
          }),
        ),
      );
    },
  );

  it.each(['replace', 'clear'] as const)(
    'writes a %s HTTP token mutation against the stored version',
    async (action) => {
      const model = state([connection]);
      render(<McpSettings state={model} />);
      fireEvent.click(screen.getByRole('button', { name: '编辑' }));
      if (action === 'replace') fill('Bearer Token', 'synthetic-token');
      else {
        fireEvent.click(screen.getByText('高级选项'));
        fireEvent.click(screen.getByRole('switch', { name: '清空已保存的认证机密' }));
      }
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() =>
        expect(model.save).toHaveBeenCalledWith(
          expect.objectContaining({
            id: connection.id,
            expectedRevisionId: connection.revisionId,
            secrets: [
              {
                slot: 'http-token',
                expectedVersion: 3,
                mutation:
                  action === 'clear'
                    ? { action: 'clear' }
                    : { action: 'replace', value: 'synthetic-token' },
              },
            ],
          }),
        ),
      );
    },
  );

  it('saves a custom API Key header and explicitly enables handshake-only legacy fallback', async () => {
    const model = state([connection]);
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    choose('认证方式', 'API Key 请求头');
    fill('API Key 请求头名称', 'X-Api-Key');
    fill('API Key', 'synthetic-key');
    fireEvent.click(screen.getByText('高级选项'));
    fireEvent.click(screen.getByRole('switch', { name: '兼容旧 SSE 服务（仅握手时回退）' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(model.save).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            authentication: { mode: 'api-key-header', headerName: 'X-Api-Key' },
            allowLegacySse: true,
          }),
          secrets: [
            {
              slot: 'http-token',
              expectedVersion: 3,
              mutation: { action: 'replace', value: 'synthetic-key' },
            },
          ],
        }),
      ),
    );
  });

  it('saves an explicit OAuth identity, callback and exact approved authentication origins', async () => {
    const model = state([connection]);
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    choose('认证方式', 'OAuth 浏览器登录');
    fireEvent.click(screen.getByText('高级选项'));
    fill('预注册 issuer（可选）', 'https://auth.example');
    fill('预注册 Client ID（可选）', 'fixture-client');
    fill('Client Secret（可选）', 'synthetic-secret');
    fill('客户端元数据文档 URL（可选）', 'https://client.example/metadata');
    fill('固定 loopback 回调端口（可选）', '54321');
    fill(
      '额外认证目的地（每行网络范围和完整 origin）',
      'private https://auth.internal:8443\nloopback http://127.0.0.1:7000',
    );
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(model.save).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            authentication: {
              mode: 'oauth',
              issuer: 'https://auth.example',
              clientId: 'fixture-client',
              clientMetadataUrl: 'https://client.example/metadata',
              callbackPort: 54321,
              approvedOrigins: [
                { networkMode: 'private', origin: 'https://auth.internal:8443' },
                { networkMode: 'loopback', origin: 'http://127.0.0.1:7000' },
              ],
            },
          }),
          secrets: [
            {
              slot: 'oauth-client-secret',
              expectedVersion: 0,
              mutation: { action: 'replace', value: 'synthetic-secret' },
            },
          ],
        }),
      ),
    );
  });

  it('rejects malformed OAuth destination declarations without discarding the draft', async () => {
    const model = state([connection]);
    render(<McpSettings state={model} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    choose('认证方式', 'OAuth 浏览器登录');
    fireEvent.click(screen.getByText('高级选项'));
    fill('额外认证目的地（每行网络范围和完整 origin）', 'public https://extra.example');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert').textContent).toContain('认证目的地请按');
    expect(model.save).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('额外认证目的地（每行网络范围和完整 origin）')
        .value,
    ).toBe('public https://extra.example');
  });
});
