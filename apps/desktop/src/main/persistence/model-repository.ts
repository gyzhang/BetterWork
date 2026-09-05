import { randomUUID } from 'node:crypto';

import type {
  ModelConnectionStatus,
  ModelProfileInput,
  ModelProfileSummary,
  ModelRole,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  model: string;
  role: ModelRole;
  api_key: string;
  enabled: number;
  priority: number;
  max_context_tokens: number;
  max_output_tokens: number;
  temperature: number;
  connection_status: ModelConnectionStatus;
  last_tested_at: number | null;
  created_at: number;
  updated_at: number;
}

/** 执行链路真正需要的最小配置；apiKey 只存在于主进程，不出现在任何 Summary 里。 */
export interface RunnableModel {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

const toSummary = (row: ModelRow): ModelProfileSummary => ({
  id: row.id,
  name: row.name,
  provider: row.provider,
  baseUrl: row.base_url,
  model: row.model,
  role: row.role,
  apiKeyConfigured: row.api_key !== '',
  enabled: row.enabled === 1,
  priority: row.priority,
  connectionStatus: row.connection_status,
  ...(row.last_tested_at === null ? {} : { lastTestedAt: row.last_tested_at }),
  maxContextTokens: row.max_context_tokens,
  maxOutputTokens: row.max_output_tokens,
  temperature: row.temperature,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * 模型配置按能力角色（语言 / 视觉 / 嵌入）管理，priority 最小者为该角色默认。
 * API Key 明文存于本地 SQLite，对外只暴露 `apiKeyConfigured`；
 * 日志与错误信息绝不输出 Key。
 */
export class ModelRepository {
  constructor(private readonly db: Database.Database) {}

  list(): ModelProfileSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM model_profiles ORDER BY priority ASC, created_at ASC')
      .all() as ModelRow[];
    return rows.map(toSummary);
  }

  /** 含明文 Key，仅供主进程内部使用，不得跨 IPC 返回。 */
  getWithSecret(id: string): (ModelProfileSummary & { apiKey: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as
      ModelRow | undefined;
    return row ? { ...toSummary(row), apiKey: row.api_key } : undefined;
  }

  getForRun(role: ModelRole): RunnableModel | undefined {
    const row = this.db
      .prepare(
        `SELECT id, base_url, api_key, model, temperature, max_output_tokens
           FROM model_profiles WHERE role = ? AND enabled = 1 ORDER BY priority ASC LIMIT 1`,
      )
      .get(role) as
      | Pick<
          ModelRow,
          'id' | 'base_url' | 'api_key' | 'model' | 'temperature' | 'max_output_tokens'
        >
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      model: row.model,
      temperature: row.temperature,
      maxOutputTokens: row.max_output_tokens,
    };
  }

  save(input: ModelProfileInput & { id?: string | undefined }): string {
    const now = Date.now();
    const id = input.id ?? randomUUID();
    const existing = this.db.prepare('SELECT api_key FROM model_profiles WHERE id = ?').get(id) as
      { api_key: string } | undefined;

    if (existing) {
      // 留空表示「保持原有凭据」，编辑表单不回显 Key
      const apiKey = input.apiKey || existing.api_key;
      this.db
        .prepare(
          `UPDATE model_profiles
              SET name = ?, provider = ?, base_url = ?, model = ?, role = ?, api_key = ?,
                  enabled = ?, priority = COALESCE(?, priority), max_context_tokens = ?,
                  max_output_tokens = ?, temperature = ?,
                  connection_status = 'untested', last_tested_at = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          input.name,
          input.provider,
          input.baseUrl,
          input.model,
          input.role,
          apiKey,
          input.enabled ? 1 : 0,
          input.priority ?? null,
          input.maxContextTokens,
          input.maxOutputTokens,
          input.temperature,
          now,
          id,
        );
      return id;
    }

    const priority = this.db
      .prepare('SELECT COALESCE(MAX(priority), -1) + 1 AS next FROM model_profiles')
      .get() as { next: number };
    this.db
      .prepare(
        `INSERT INTO model_profiles
           (id, name, provider, base_url, model, role, api_key, enabled, priority,
            max_context_tokens, max_output_tokens, temperature,
            connection_status, last_tested_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', NULL, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.baseUrl,
        input.model,
        input.role,
        input.apiKey ?? '',
        input.enabled ? 1 : 0,
        input.priority ?? priority.next,
        input.maxContextTokens,
        input.maxOutputTokens,
        input.temperature,
        now,
        now,
      );
    return id;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM model_profiles WHERE id = ?').run(id).changes > 0;
  }

  /** 设为某角色默认＝把自己的 priority 归零、同角色其他配置顺延。只允许已启用的配置。 */
  setDefault(id: string): boolean {
    const target = this.db
      .prepare('SELECT role, enabled FROM model_profiles WHERE id = ?')
      .get(id) as { role: ModelRole; enabled: number } | undefined;
    if (!target || target.enabled !== 1) return false;
    const update = this.db.transaction(() => {
      this.db
        .prepare('UPDATE model_profiles SET priority = priority + 1 WHERE role = ? AND id != ?')
        .run(target.role, id);
      return (
        this.db.prepare('UPDATE model_profiles SET priority = 0 WHERE id = ?').run(id).changes > 0
      );
    });
    return update();
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return (
      this.db
        .prepare('UPDATE model_profiles SET enabled = ?, updated_at = ? WHERE id = ?')
        .run(enabled ? 1 : 0, Date.now(), id).changes > 0
    );
  }

  recordConnection(id: string, status: Exclude<ModelConnectionStatus, 'untested'>): void {
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE model_profiles SET connection_status = ?, last_tested_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(status, now, now, id);
  }
}
