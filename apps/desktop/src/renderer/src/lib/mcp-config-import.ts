import {
  mcpTransportSchema,
  type SaveMcpConnectionRequest,
  saveMcpConnectionRequestSchema,
} from '@betterwork/agent-protocol';
import { z } from 'zod';

const MAX_MCP_CONFIG_IMPORT_CHARS = 512_000;
const MAX_MCP_CONFIG_IMPORT_SERVERS = 50;

const importedServerSchema = z
  .object({
    type: z.literal('stdio').optional(),
    command: z
      .string()
      .trim()
      .min(1, '启动命令不能为空')
      .max(2_000, '启动命令不能超过 2000 个字符'),
    args: z
      .array(z.string().max(2_000, '单个参数不能超过 2000 个字符'))
      .max(100, '参数不能超过 100 项')
      .default([]),
    cwd: z
      .string()
      .trim()
      .min(1, '工作目录不能为空')
      .max(4_000, '工作目录不能超过 4000 个字符')
      .optional(),
    env: z
      .record(
        z.string(),
        z
          .string()
          .max(8_192, '环境变量值不能超过 8192 个字符')
          .refine((value) => !/[\r\n]/u.test(value), '环境变量值不能包含换行'),
      )
      .default({}),
  })
  .strict();

export interface McpConfigImportServer {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env: Array<{ name: string; value: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeServerIssue(name: string, issues: z.ZodIssue[]): Error {
  const unknownFields = issues.find((issue) => issue.code === 'unrecognized_keys');
  if (unknownFields?.code === 'unrecognized_keys') {
    return new Error(
      `服务器「${name}」包含暂不支持的字段：${unknownFields.keys.join('、')}。导入仅支持 stdio 的 command、args、cwd 和 env。`,
    );
  }

  const issue = issues[0];
  const field = issue?.path.join('.') || '配置';
  return new Error(`服务器「${name}」的 ${field} 无效：${issue?.message ?? '格式错误'}`);
}

export function parseMcpServersConfig(source: string): McpConfigImportServer[] {
  if (source.length > MAX_MCP_CONFIG_IMPORT_CHARS)
    throw new Error('JSON 配置过大，请控制在 512000 个字符以内。');

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error('JSON 格式无效，请检查括号、逗号和引号。');
  }

  if (!isRecord(parsed)) throw new Error('配置需要包含 mcpServers 对象。');
  const mcpServers = parsed['mcpServers'];
  if (!isRecord(mcpServers)) throw new Error('配置需要包含 mcpServers 对象。');

  const entries = Object.entries(mcpServers);
  if (entries.length === 0) throw new Error('mcpServers 中没有可导入的连接。');
  if (entries.length > MAX_MCP_CONFIG_IMPORT_SERVERS)
    throw new Error(`一次最多导入 ${MAX_MCP_CONFIG_IMPORT_SERVERS} 个 MCP 连接。`);

  const names = new Set<string>();
  return entries.map(([rawName, rawServer]) => {
    const name = rawName.trim();
    if (!name || name.length > 160) throw new Error('服务器名称不能为空，且不能超过 160 个字符。');

    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) throw new Error(`配置中有重复的服务器名称「${name}」。`);
    names.add(normalizedName);

    if (!isRecord(rawServer)) throw new Error(`服务器「${name}」必须是 JSON 对象。`);
    if ('type' in rawServer && rawServer['type'] !== 'stdio')
      throw new Error(`服务器「${name}」不是 stdio 配置；当前导入只支持本地 stdio 服务。`);

    const server = importedServerSchema.safeParse(rawServer);
    if (!server.success) throw describeServerIssue(name, server.error.issues);

    const environment = Object.entries(server.data.env);
    const env = environment.map(([envName, value]) =>
      value ? { name: envName, secret: true } : { name: envName, value, secret: false },
    );
    const transport = mcpTransportSchema.safeParse({
      kind: 'stdio',
      command: server.data.command,
      args: server.data.args,
      ...(server.data.cwd ? { cwd: server.data.cwd } : {}),
      env,
    });
    if (!transport.success) {
      const issue = transport.error.issues[0];
      throw new Error(`服务器「${name}」的 stdio 配置无效：${issue?.message ?? '格式错误'}`);
    }

    return {
      name,
      command: server.data.command,
      args: server.data.args,
      ...(server.data.cwd ? { cwd: server.data.cwd } : {}),
      env: environment.map(([envName, value]) => ({ name: envName, value })),
    };
  });
}

export function createMcpImportSaveRequest(
  server: McpConfigImportServer,
): SaveMcpConnectionRequest {
  const transport = mcpTransportSchema.parse({
    kind: 'stdio',
    command: server.command,
    args: server.args,
    ...(server.cwd ? { cwd: server.cwd } : {}),
    env: server.env.map(({ name, value }) =>
      value ? { name, secret: true } : { name, value, secret: false },
    ),
  });

  return saveMcpConnectionRequestSchema.parse({
    name: server.name,
    transport,
    secrets: server.env
      .filter(({ value }) => value.length > 0)
      .map(({ name, value }) => ({
        slot: `env:${name}`,
        expectedVersion: 0,
        mutation: { action: 'replace', value },
      })),
  });
}
