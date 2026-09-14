import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { McpClientService } from './mcp-client-service';

const stores: AppStore[] = [];
const fixturePath = path.resolve(process.cwd(), 'scripts/fixtures/mcp-finance-readonly-server.mjs');

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('McpClientService', () => {
  it('discovers and calls a read-only stdio tool through the AgentTool boundary', async () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const service = new McpClientService(store);
    const connection = store.mcpConnections.save({
      name: '财务替身',
      transport: { kind: 'stdio', command: process.execPath, args: [fixturePath] },
    });

    const discovered = await service.testConnection(connection.id);
    expect(discovered.tools).toHaveLength(1);
    const tool = discovered.tools[0];
    if (!tool) throw new Error('MCP tool was not discovered');
    const agentTools = await service.createAgentTools([
      { connectionId: connection.id, toolId: tool.id },
      { connectionId: connection.id, toolId: tool.id },
    ]);
    expect(agentTools).toHaveLength(1);
    const result = await agentTools[0]?.execute(
      { month: '2026-08' },
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        workspacePath: '/tmp',
        signal: new AbortController().signal,
        reportProgress: () => undefined,
      },
    );
    expect(result).toEqual(
      JSON.stringify({
        month: '2026-08',
        revenue: 1200000,
        cost: 760000,
        source: 'fixture-ledger',
      }),
    );
    expect(store.mcpConnections.get(connection.id)?.status).toBe('ready');
    await service.shutdown();
  });

  it('validates MCP tool input against the discovered JSON Schema before calling', async () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const service = new McpClientService(store);
    const connection = store.mcpConnections.save({
      name: '财务替身',
      transport: { kind: 'stdio', command: process.execPath, args: [fixturePath] },
    });
    const discovered = await service.testConnection(connection.id);
    const tool = discovered.tools[0];
    if (!tool) throw new Error('MCP tool was not discovered');
    const agentTools = await service.createAgentTools([
      { connectionId: connection.id, toolId: tool.id },
    ]);

    await expect(
      agentTools[0]?.execute(
        { month: '2099-98' },
        {
          runId: 'run-large-structured-output',
          toolCallId: 'call-large-structured-output',
          workspacePath: '/tmp',
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow('MCP 工具输出超过');
    await expect(
      agentTools[0]?.execute(
        { month: 'invalid-month' },
        {
          runId: 'run-invalid-input',
          toolCallId: 'call-invalid-input',
          workspacePath: '/tmp',
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow('MCP 工具输入不符合 Schema');
    await service.shutdown();
  });

  it('enforces the output limit for MCP structured and text results', async () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const service = new McpClientService(store);
    const connection = store.mcpConnections.save({
      name: '财务替身',
      transport: { kind: 'stdio', command: process.execPath, args: [fixturePath] },
    });
    const discovered = await service.testConnection(connection.id);
    const tool = discovered.tools[0];
    if (!tool) throw new Error('MCP tool was not discovered');
    const agentTools = await service.createAgentTools([
      { connectionId: connection.id, toolId: tool.id },
    ]);

    await expect(
      agentTools[0]?.execute(
        { month: '2099-99' },
        {
          runId: 'run-large-output',
          toolCallId: 'call-large-output',
          workspacePath: '/tmp',
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow('MCP 工具输出超过');
    await service.shutdown();
  });

  it('rejects an unbound or unknown tool instead of exposing the full catalog', async () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const service = new McpClientService(store);
    const connection = store.mcpConnections.save({
      name: '财务替身',
      transport: { kind: 'stdio', command: process.execPath, args: [fixturePath] },
    });
    await expect(
      service.createAgentTools([
        { connectionId: connection.id, toolId: `${connection.id}/missing` },
      ]),
    ).rejects.toThrow('MCP 工具不存在');
    await service.shutdown();
  });
});
