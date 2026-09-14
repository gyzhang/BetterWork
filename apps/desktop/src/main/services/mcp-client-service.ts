import { createHash } from 'node:crypto';

import type { AgentTool, ToolExecutionContext } from '@betterwork/agent-core';
import {
  type McpConnectionSummary,
  type McpTestResult,
  type McpToolBinding,
  mcpToolBindingSchema,
  type McpToolSummary,
  mcpToolSummarySchema,
  type SaveMcpConnectionRequest,
  saveMcpConnectionRequestSchema,
} from '@betterwork/agent-protocol';
import { Client, type Tool as SdkTool } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import type { AppStore } from '../persistence';

const maxOutputChars = 100_000;
const connectionTimeoutMs = 10_000;
const callTimeoutMs = 60_000;

export class McpClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'McpClientError';
  }
}

interface ActiveConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: Map<string, McpToolSummary>;
}

const stableToolId = (connectionId: string, name: string): string => `${connectionId}/${name}`;

const toolNameForModel = (tool: McpToolSummary): string =>
  `mcp_${tool.connectionId}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 180);

const hashSchema = (schema: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(schema)).digest('hex');

const schemaRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpClientError('MCP 工具输入 Schema 必须是对象。');
  }
  return value as Record<string, unknown>;
};

const toToolSummary = (
  connectionId: string,
  tool: SdkTool,
  discoveredAt: number,
): McpToolSummary => {
  const inputSchema = schemaRecord(tool.inputSchema);
  return mcpToolSummarySchema.parse({
    id: stableToolId(connectionId, tool.name),
    connectionId,
    name: tool.name,
    description: tool.description ?? '',
    inputSchema,
    schemaHash: hashSchema(inputSchema),
    discoveredAt,
  });
};

const safeResult = (result: {
  isError: boolean | undefined;
  content: readonly unknown[] | undefined;
  structuredContent: unknown;
}): unknown => {
  if (result.isError) throw new McpClientError('MCP 工具返回了工具级错误。');
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = result.content ?? [];
  const textParts = content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    if ('text' in item && typeof item.text === 'string') return [item.text];
    return [];
  });
  const value = textParts.length > 0 ? textParts.join('\n') : content;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (serialized.length > maxOutputChars) {
    throw new McpClientError(`MCP 工具输出超过 ${maxOutputChars} 字符上限。`);
  }
  return value;
};

export class McpClientService {
  private readonly active = new Map<string, ActiveConnection>();

  constructor(private readonly store: AppStore) {}

  listConnections(): McpConnectionSummary[] {
    return this.store.mcpConnections.list();
  }

  getConnection(id: string): McpConnectionSummary | null {
    return this.store.mcpConnections.get(id) ?? null;
  }

  async saveConnection(input: SaveMcpConnectionRequest): Promise<McpConnectionSummary> {
    const parsed = saveMcpConnectionRequestSchema.parse(input);
    if (parsed.id) {
      const state = this.active.get(parsed.id);
      if (state) {
        await state.client.close().catch(() => undefined);
        this.active.delete(parsed.id);
      }
    }
    return this.store.mcpConnections.save(parsed);
  }

  async deleteConnection(id: string): Promise<boolean> {
    const state = this.active.get(id);
    if (state) {
      await state.client.close().catch(() => undefined);
      this.active.delete(id);
    }
    return this.store.mcpConnections.delete(id);
  }

  async testConnection(id: string): Promise<McpTestResult> {
    const tools = await this.discover(id, true);
    const connection = this.getConnection(id);
    if (!connection) throw new McpClientError('MCP 连接不存在。');
    return { connection, tools };
  }

  async createAgentTools(bindings: readonly McpToolBinding[]): Promise<AgentTool[]> {
    const tools: AgentTool[] = [];
    const seen = new Set<string>();
    for (const rawBinding of bindings) {
      const binding = mcpToolBindingSchema.parse(rawBinding);
      const bindingKey = `${binding.connectionId}\u0000${binding.toolId}`;
      if (seen.has(bindingKey)) continue;
      seen.add(bindingKey);
      const connectionId = binding.connectionId;
      const state = await this.ensureConnected(connectionId);
      if (state.tools.size === 0) await this.discover(connectionId, false);
      const tool = state.tools.get(binding.toolId);
      if (!tool) {
        throw new McpClientError(`MCP 工具不存在或尚未发现：${binding.toolId}`);
      }
      tools.push({
        name: toolNameForModel(tool),
        description: `${tool.description}（MCP：${tool.connectionId}）`,
        inputSchema: tool.inputSchema,
        execute: (input, context) => this.callTool(tool, input, context),
      });
    }
    return tools;
  }

  async shutdown(): Promise<void> {
    const states = [...this.active.values()];
    this.active.clear();
    await Promise.allSettled(states.map((state) => state.client.close()));
  }

  private async discover(id: string, force: boolean): Promise<McpToolSummary[]> {
    const state = await this.ensureConnected(id);
    if (!force && state.tools.size > 0) return [...state.tools.values()];
    const checkedAt = Date.now();
    try {
      const result = await state.client.listTools(
        { ...(force ? {} : {}) },
        { cacheMode: 'bypass' },
      );
      const summaries = (result.tools ?? []).map((tool) => toToolSummary(id, tool, checkedAt));
      state.tools.clear();
      for (const summary of summaries) state.tools.set(summary.id, summary);
      const serverVersion = state.client.getServerVersion();
      this.store.mcpConnections.updateDiscovery(id, {
        status: 'ready',
        tools: summaries,
        ...(serverVersion?.name ? { serverName: serverVersion.name } : {}),
        ...(serverVersion?.version ? { serverVersion: serverVersion.version } : {}),
        lastCheckedAt: checkedAt,
      });
      return summaries;
    } catch (error) {
      this.store.mcpConnections.updateDiscovery(id, {
        status: 'failed',
        tools: [],
        failureMessage: error instanceof Error ? error.message : String(error),
        lastCheckedAt: checkedAt,
      });
      throw new McpClientError('MCP 工具发现失败。', { cause: error });
    }
  }

  private async ensureConnected(id: string): Promise<ActiveConnection> {
    const existing = this.active.get(id);
    if (existing) return existing;
    const connection = this.store.mcpConnections.get(id);
    if (!connection) throw new McpClientError(`MCP 连接不存在：${id}`);
    this.store.mcpConnections.updateDiscovery(id, {
      status: 'connecting',
      tools: [],
      lastCheckedAt: Date.now(),
    });
    const transport = new StdioClientTransport({
      command: connection.transport.command,
      args: connection.transport.args,
      ...(connection.transport.cwd ? { cwd: connection.transport.cwd } : {}),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', () => undefined);
    const client = new Client({ name: 'betterwork', version: '0.0.1' });
    const state: ActiveConnection = { client, transport, tools: new Map() };
    this.active.set(id, state);
    transport.onclose = () => {
      if (this.active.get(id) !== state) return;
      this.active.delete(id);
      this.store.mcpConnections.updateDiscovery(id, {
        status: 'disconnected',
        tools: [],
        lastCheckedAt: Date.now(),
      });
    };
    try {
      await client.connect(transport, { timeout: connectionTimeoutMs });
      return state;
    } catch (error) {
      this.active.delete(id);
      await client.close().catch(() => undefined);
      this.store.mcpConnections.updateDiscovery(id, {
        status: 'failed',
        tools: [],
        failureMessage: error instanceof Error ? error.message : String(error),
        lastCheckedAt: Date.now(),
      });
      throw new McpClientError('MCP 连接失败。', { cause: error });
    }
  }

  private async callTool(
    tool: McpToolSummary,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const state = await this.ensureConnected(tool.connectionId);
    try {
      const result = await state.client.callTool(
        { name: tool.name, arguments: input },
        {
          signal: context.signal,
          timeout: callTimeoutMs,
          onprogress: (progress) => {
            if (progress.message) context.reportProgress(progress.message);
          },
        },
      );
      return safeResult({
        isError: result.isError,
        content: result.content,
        structuredContent: result.structuredContent,
      });
    } catch (error) {
      throw new McpClientError(`MCP 工具调用失败：${tool.name}`, { cause: error });
    }
  }
}
