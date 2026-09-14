import { randomUUID } from 'node:crypto';

import {
  type McpConnectionStatus,
  mcpConnectionStatusSchema,
  type McpConnectionSummary,
  mcpConnectionSummarySchema,
  type McpToolSummary,
  mcpToolSummarySchema,
  mcpTransportSchema,
  type SaveMcpConnectionRequest,
  saveMcpConnectionRequestSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface McpConnectionRow {
  id: string;
  name: string;
  transport_kind: 'stdio';
  command: string;
  args_json: string;
  cwd: string | null;
  status: McpConnectionStatus;
  server_name: string | null;
  server_version: string | null;
  tools_json: string;
  failure_message: string | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

const parseTools = (value: string): McpToolSummary[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Stored MCP tools must be an array');
  return parsed.map((item) => mcpToolSummarySchema.parse(item));
};

const toSummary = (row: McpConnectionRow): McpConnectionSummary => {
  const args: unknown = JSON.parse(row.args_json);
  if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
    throw new Error('Stored MCP args must be an array of strings');
  }
  return mcpConnectionSummarySchema.parse({
    id: row.id,
    name: row.name,
    transport: mcpTransportSchema.parse({
      kind: row.transport_kind,
      command: row.command,
      args,
      ...(row.cwd ? { cwd: row.cwd } : {}),
    }),
    status: mcpConnectionStatusSchema.parse(row.status),
    ...(row.server_name ? { serverName: row.server_name } : {}),
    ...(row.server_version ? { serverVersion: row.server_version } : {}),
    tools: parseTools(row.tools_json),
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    ...(row.last_checked_at === null ? {} : { lastCheckedAt: row.last_checked_at }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
};

export interface McpDiscoveryPatch {
  status: McpConnectionStatus;
  tools: McpToolSummary[];
  serverName?: string;
  serverVersion?: string;
  failureMessage?: string;
  lastCheckedAt: number;
}

export class McpConnectionRepository {
  constructor(private readonly db: Database.Database) {}

  list(): McpConnectionSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM mcp_connections ORDER BY updated_at DESC, id ASC')
      .all() as McpConnectionRow[];
    return rows.map(toSummary);
  }

  get(id: string): McpConnectionSummary | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_connections WHERE id = ?').get(id) as
      McpConnectionRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  save(input: SaveMcpConnectionRequest): McpConnectionSummary {
    const parsed = saveMcpConnectionRequestSchema.parse(input);
    const id = parsed.id ?? randomUUID();
    const existing = this.get(id);
    const now = Date.now();
    const transport = mcpTransportSchema.parse(parsed.transport);
    this.db
      .prepare(
        `INSERT INTO mcp_connections (
           id, name, transport_kind, command, args_json, cwd, status,
           server_name, server_version, tools_json, failure_message, last_checked_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'unconfigured', NULL, NULL, '[]', NULL, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           transport_kind = excluded.transport_kind,
           command = excluded.command,
           args_json = excluded.args_json,
           cwd = excluded.cwd,
           status = 'unconfigured',
           server_name = NULL,
           server_version = NULL,
           tools_json = '[]',
           failure_message = NULL,
           last_checked_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        parsed.name,
        transport.kind,
        transport.command,
        JSON.stringify(transport.args ?? []),
        transport.cwd ?? null,
        existing?.createdAt ?? now,
        now,
      );
    const saved = this.get(id);
    if (!saved) throw new Error('MCP connection was not available after save');
    return saved;
  }

  updateDiscovery(id: string, patch: McpDiscoveryPatch): McpConnectionSummary {
    if (!this.get(id)) throw new Error(`MCP connection does not exist: ${id}`);
    this.db
      .prepare(
        `UPDATE mcp_connections
            SET status = ?, server_name = ?, server_version = ?, tools_json = ?,
                failure_message = ?, last_checked_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.serverName ?? null,
        patch.serverVersion ?? null,
        JSON.stringify(patch.tools),
        patch.failureMessage ?? null,
        patch.lastCheckedAt,
        patch.lastCheckedAt,
        id,
      );
    const updated = this.get(id);
    if (!updated) throw new Error('MCP connection disappeared after discovery update');
    return updated;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM mcp_connections WHERE id = ?').run(id).changes > 0;
  }
}
