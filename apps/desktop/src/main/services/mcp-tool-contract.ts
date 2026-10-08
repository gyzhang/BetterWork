import { createHash } from 'node:crypto';

import { type McpToolSummary, mcpToolSummarySchema } from '@betterwork/agent-protocol';
import type { Tool } from '@modelcontextprotocol/client';
import { z } from 'zod';

export class McpToolContractError extends Error {}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};
export const mcpContractHash = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
export const mcpModelAlias = (connectionId: string, toolId: string): string =>
  `mcp_${mcpContractHash([connectionId, toolId]).slice(0, 60)}`;

const assertLocalSchema = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertLocalSchema(item);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && (typeof item !== 'string' || !item.startsWith('#')))
      throw new McpToolContractError('MCP Schema 不允许远程引用。');
    assertLocalSchema(item);
  }
};

export const summarizeMcpTool = (
  connectionId: string,
  tool: Tool,
  discoveredAt: number,
): McpToolSummary => {
  assertLocalSchema(tool.inputSchema);
  if (tool.outputSchema) assertLocalSchema(tool.outputSchema);
  z.fromJSONSchema(tool.inputSchema as Record<string, unknown>);
  if (tool.outputSchema) z.fromJSONSchema(tool.outputSchema as Record<string, unknown>);
  const contract = {
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
  return mcpToolSummarySchema.parse({
    id: `${connectionId}/${tool.name}`,
    connectionId,
    name: tool.name,
    ...contract,
    schemaHash: mcpContractHash(tool.inputSchema),
    contractHash: mcpContractHash(contract),
    discoveredAt,
    reviewed: false,
  });
};

export const mcpSafeResult = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') throw new McpToolContractError('MCP 工具结果无效。');
  if ('resultType' in value && value.resultType === 'input_required')
    throw new McpToolContractError('此 MCP 工具需要额外客户端输入，当前不支持。');
  if ('isError' in value && value.isError === true)
    throw new McpToolContractError('MCP 工具返回了工具级错误。');
  const structured = 'structuredContent' in value ? value.structuredContent : undefined;
  const content =
    'content' in value && Array.isArray(value.content) ? (value.content as unknown[]) : [];
  const text = content.flatMap((item) =>
    item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
      ? [item.text]
      : [],
  );
  const result = structured ?? (text.length ? text.join('\n') : content);
  const serialized = typeof result === 'string' ? result : JSON.stringify(result);
  if (!serialized || serialized.length > 100_000)
    throw new McpToolContractError('MCP 工具输出超过 100000 字符上限或无有效内容。');
  return result;
};
