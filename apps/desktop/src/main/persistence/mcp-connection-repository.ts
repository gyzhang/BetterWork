import { randomUUID } from 'node:crypto';

import {
  type McpConnectionSummary,
  mcpConnectionSummarySchema,
  type McpLifecycleRequest,
  type McpReviewRequest,
  type McpToolBinding,
  type SaveMcpConnectionRequest,
  saveMcpConnectionRequestSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ConnectionRow {
  id: string;
  lifecycle: 'enabled' | 'disabled' | 'archived';
  current_revision_id: string;
  created_at: number;
  updated_at: number;
}
interface RevisionRow {
  id: string;
  connection_id: string;
  revision: number;
  name: string;
  transport_json: string;
  created_at: number;
}
interface CatalogRow {
  data_json: string;
}
interface SlotRow {
  slot: string;
  version: number;
  configured: number;
}
interface CountRow {
  count: number;
}
export interface McpAuthorization {
  connection_id: string;
  revision_id: string;
  issuer: string;
  resource: string;
  slot: string;
}

export type McpDiscoveryPatch = Pick<
  McpConnectionSummary,
  | 'status'
  | 'tools'
  | 'serverName'
  | 'serverVersion'
  | 'protocolVersion'
  | 'failureMessage'
  | 'lastCheckedAt'
  | 'stale'
>;

export class McpConnectionRepository {
  constructor(private readonly db: Database.Database) {}

  list(): McpConnectionSummary[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM mcp_connections WHERE lifecycle <> 'archived' ORDER BY updated_at DESC, id ASC",
      )
      .all() as ConnectionRow[];
    return rows.map((row) => this.summary(row, row.current_revision_id));
  }

  get(id: string, revisionId?: string): McpConnectionSummary | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_connections WHERE id = ?').get(id) as
      ConnectionRow | undefined;
    return row ? this.summary(row, revisionId ?? row.current_revision_id) : undefined;
  }

  assertRevision(id: string, expected: string | undefined): McpConnectionSummary {
    const current = this.get(id);
    if (
      !current ||
      !expected ||
      current.revisionId !== expected ||
      current.lifecycle === 'archived'
    )
      throw new Error('MCP 配置已变化或已移除，请重新读取后再操作。');
    return current;
  }

  save(input: SaveMcpConnectionRequest, createId?: string): McpConnectionSummary {
    const parsed = saveMcpConnectionRequestSchema.parse(input);
    const id = parsed.id ?? createId ?? randomUUID();
    const existing = parsed.id ? this.assertRevision(id, parsed.expectedRevisionId) : undefined;
    const revisionId = randomUUID();
    const now = Date.now();
    this.db.transaction(() => {
      if (parsed.id) this.assertRevision(id, parsed.expectedRevisionId);
      else
        this.db
          .prepare(
            `INSERT INTO mcp_connections (id, name, transport_kind, command, args_json, status, tools_json, created_at, updated_at, lifecycle) VALUES (?, ?, 'stdio', '', '[]', 'unconfigured', '[]', ?, ?, 'disabled')`,
          )
          .run(id, parsed.name, now, now);
      this.db
        .prepare(
          'INSERT INTO mcp_connection_revisions (id, connection_id, revision, name, transport_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          revisionId,
          id,
          (existing?.revision ?? 0) + 1,
          parsed.name,
          JSON.stringify(parsed.transport),
          now,
        );
      if (existing && JSON.stringify(existing.transport) === JSON.stringify(parsed.transport))
        this.db
          .prepare(
            'INSERT INTO mcp_oauth_authorizations SELECT connection_id, ?, issuer, resource, slot FROM mcp_oauth_authorizations WHERE connection_id = ? AND revision_id = ?',
          )
          .run(revisionId, id, existing.revisionId);
      this.db
        .prepare(
          'UPDATE mcp_connections SET name = ?, current_revision_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(parsed.name, revisionId, now, id);
    })();
    const result = this.get(id);
    if (!result) throw new Error('MCP 连接保存后不可用。');
    return result;
  }

  updateDiscovery(id: string, patch: McpDiscoveryPatch, revisionId?: string): McpConnectionSummary {
    const connection = this.get(id, revisionId);
    if (!connection?.revisionId) throw new Error('MCP 连接修订不存在。');
    const data = {
      ...patch,
      tools: patch.status === 'ready' ? patch.tools : connection.tools,
      stale: patch.status !== 'ready',
    };
    this.db
      .prepare(
        'INSERT INTO mcp_catalogs (revision_id, data_json) VALUES (?, ?) ON CONFLICT(revision_id) DO UPDATE SET data_json = excluded.data_json',
      )
      .run(connection.revisionId, JSON.stringify(data));
    const result = this.get(id, connection.revisionId);
    if (!result) throw new Error('MCP 连接检测后不可用。');
    return result;
  }

  review(input: McpReviewRequest): McpConnectionSummary {
    const connection = this.assertRevision(input.connectionId, input.connectionRevisionId);
    const tool = connection.tools.find((candidate) => candidate.id === input.toolId);
    if (connection.stale || !tool || tool.contractHash !== input.contractHash)
      throw new Error('MCP 工具合同已变化，请重新检测并审阅。');
    if (tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true)
      throw new Error('此 MCP 工具声明为非只读或破坏性工具，不能启用。');
    this.db
      .prepare(
        'INSERT OR IGNORE INTO mcp_tool_reviews (revision_id, tool_id, contract_hash, reviewed_at) VALUES (?, ?, ?, ?)',
      )
      .run(input.connectionRevisionId, input.toolId, input.contractHash, Date.now());
    return this.assertRevision(input.connectionId, input.connectionRevisionId);
  }

  isReviewed(binding: McpToolBinding): boolean {
    if (!binding.connectionRevisionId || !binding.contractHash) return false;
    return !!this.db
      .prepare(
        'SELECT 1 FROM mcp_tool_reviews WHERE revision_id = ? AND tool_id = ? AND contract_hash = ?',
      )
      .get(binding.connectionRevisionId, binding.toolId, binding.contractHash);
  }

  setLifecycle(input: McpLifecycleRequest): McpConnectionSummary {
    this.assertRevision(input.id, input.expectedRevisionId);
    this.db
      .prepare('UPDATE mcp_connections SET lifecycle = ?, updated_at = ? WHERE id = ?')
      .run(input.lifecycle, Date.now(), input.id);
    return this.assertRevision(input.id, input.expectedRevisionId);
  }

  delete(id: string, expectedRevisionId?: string): boolean {
    this.assertRevision(id, expectedRevisionId);
    return (
      this.db
        .prepare("UPDATE mcp_connections SET lifecycle = 'archived', updated_at = ? WHERE id = ?")
        .run(Date.now(), id).changes > 0
    );
  }

  affectedReferences(id: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM run_mcp_tool_bindings WHERE connection_id = ?')
      .get(id) as CountRow;
    return row.count;
  }

  saveRunBinding(
    runId: string,
    binding: McpToolBinding,
    alias: string,
    versions: Record<string, number>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO run_mcp_tool_bindings (id, run_id, connection_id, revision_id, tool_id, contract_hash, model_alias, credential_versions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        runId,
        binding.connectionId,
        binding.connectionRevisionId,
        binding.toolId,
        binding.contractHash,
        alias,
        JSON.stringify(versions),
      );
  }

  authorization(id: string, revisionId: string): McpAuthorization | undefined {
    return this.db
      .prepare('SELECT * FROM mcp_oauth_authorizations WHERE connection_id = ? AND revision_id = ?')
      .get(id, revisionId) as McpAuthorization | undefined;
  }
  authorize(value: McpAuthorization): void {
    this.assertRevision(value.connection_id, value.revision_id);
    this.db
      .prepare(
        'INSERT INTO mcp_oauth_authorizations VALUES (?, ?, ?, ?, ?) ON CONFLICT(connection_id, revision_id) DO UPDATE SET issuer = excluded.issuer, resource = excluded.resource, slot = excluded.slot',
      )
      .run(value.connection_id, value.revision_id, value.issuer, value.resource, value.slot);
  }
  clearAuthorization(id: string): void {
    this.db.prepare('DELETE FROM mcp_oauth_authorizations WHERE connection_id = ?').run(id);
  }

  private summary(row: ConnectionRow, revisionId: string): McpConnectionSummary {
    const revision = this.db
      .prepare('SELECT * FROM mcp_connection_revisions WHERE id = ? AND connection_id = ?')
      .get(revisionId, row.id) as RevisionRow | undefined;
    if (!revision) throw new Error('MCP 配置修订不属于此连接。');
    const catalog = this.db
      .prepare('SELECT * FROM mcp_catalogs WHERE revision_id = ?')
      .get(revisionId) as CatalogRow | undefined;
    const data: unknown = catalog
      ? JSON.parse(catalog.data_json)
      : { status: 'unconfigured', tools: [], stale: false };
    const slots = this.db
      .prepare(
        'SELECT slot, version, ciphertext IS NOT NULL AS configured FROM credentials WHERE owner_kind = ? AND owner_id = ?',
      )
      .all('mcp-connection', row.id) as SlotRow[];
    const summary = mcpConnectionSummarySchema.parse({
      id: row.id,
      name: revision.name,
      transport: JSON.parse(revision.transport_json) as unknown,
      revisionId: revision.id,
      revision: revision.revision,
      lifecycle: row.lifecycle,
      ...(data as McpDiscoveryPatch),
      credentialSlots: slots.map((slot) => ({
        slot: slot.slot,
        version: slot.version,
        configured: slot.configured === 1,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return {
      ...summary,
      tools: summary.tools.map((tool) => ({
        ...tool,
        reviewed: this.isReviewed({
          connectionId: row.id,
          connectionRevisionId: revision.id,
          toolId: tool.id,
          ...(tool.contractHash ? { contractHash: tool.contractHash } : {}),
        }),
      })),
    };
  }
}
