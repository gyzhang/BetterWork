import { randomUUID } from 'node:crypto';

import type {
  ModelConnectionStatus,
  ModelProfileInput,
  ModelProfileSummary,
  ModelRole,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { API_KEY_SLOT, type CredentialAvailability } from './credential-repository';

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

interface ModelRoleRow {
  role: ModelRole;
  priority: number;
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

const ROLE_ORDER: readonly ModelRole[] = ['language', 'vision', 'embedding'];

const toSummary = (
  row: ModelRow,
  roles: readonly ModelRoleRow[],
  hasCredential: CredentialAvailability | undefined,
): ModelProfileSummary => ({
  id: row.id,
  name: row.name,
  provider: row.provider,
  baseUrl: row.base_url,
  model: row.model,
  roles: roles.map(({ role }) => role),
  rolePriorities: Object.fromEntries(roles.map(({ role, priority }) => [role, priority])),
  // 迁移完成后明文列已清空，“已配置凭据”必须以 credentials 表为准；两边任一存在都算配置。
  apiKeyConfigured:
    row.api_key !== '' ||
    (hasCredential?.({ ownerKind: 'model-profile', ownerId: row.id, slot: API_KEY_SLOT }) ?? false),
  enabled: row.enabled === 1,
  connectionStatus: row.connection_status,
  ...(row.last_tested_at === null ? {} : { lastTestedAt: row.last_tested_at }),
  maxContextTokens: row.max_context_tokens,
  maxOutputTokens: row.max_output_tokens,
  temperature: row.temperature,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * 模型配置可以承担多个能力角色，每种角色独立排序，priority 最小者为该角色默认。
 * 旧 model_profiles.role / priority 列保留为兼容快照；新代码以 model_profile_roles 为准。
 * API Key 迁移后以 `credentials` 表的密文为准，旧明文列仅作回滚窗口。
 */
export class ModelRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly hasCredential?: CredentialAvailability,
  ) {}

  list(): ModelProfileSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM model_profiles ORDER BY created_at ASC, id ASC')
      .all() as ModelRow[];
    const roleRows = this.db
      .prepare('SELECT profile_id, role, priority FROM model_profile_roles ORDER BY profile_id')
      .all() as Array<{ profile_id: string } & ModelRoleRow>;
    const byProfile = new Map<string, ModelRoleRow[]>();
    for (const roleRow of roleRows) {
      const assignments = byProfile.get(roleRow.profile_id) ?? [];
      assignments.push({ role: roleRow.role, priority: roleRow.priority });
      byProfile.set(roleRow.profile_id, assignments);
    }
    return rows.map((row) => {
      const assignments = (byProfile.get(row.id) ?? []).sort(
        (left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role),
      );
      return toSummary(row, assignments, this.hasCredential);
    });
  }

  /** 含明文 Key，仅供主进程内部使用，不得跨 IPC 返回。 */
  getWithSecret(id: string): (ModelProfileSummary & { apiKey: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as
      ModelRow | undefined;
    if (!row) return undefined;
    const roles = this.db
      .prepare('SELECT role, priority FROM model_profile_roles WHERE profile_id = ?')
      .all(id) as ModelRoleRow[];
    roles.sort((left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role));
    return { ...toSummary(row, roles, this.hasCredential), apiKey: row.api_key };
  }

  getForRun(role: ModelRole): RunnableModel | undefined {
    const row = this.db
      .prepare(
        `SELECT p.id, p.base_url, p.api_key, p.model, p.temperature, p.max_output_tokens
           FROM model_profiles p
           JOIN model_profile_roles r ON r.profile_id = p.id
          WHERE r.role = ? AND p.enabled = 1
          ORDER BY r.priority ASC, p.created_at ASC, p.id ASC LIMIT 1`,
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

  /**
   * 某能力角色当前的默认配置 id（该角色 priority 最小者）。
   * 语义索引需要先把「具体 profileId」固定进设置里，不能只拿运行时解析结果。
   */
  getDefaultProfileId(role: ModelRole): string | undefined {
    const row = this.db
      .prepare(
        `SELECT p.id FROM model_profiles p
          JOIN model_profile_roles r ON r.profile_id = p.id
          WHERE r.role = ? AND p.enabled = 1
          ORDER BY r.priority ASC, p.created_at ASC, p.id ASC LIMIT 1`,
      )
      .get(role) as { id: string } | undefined;
    return row?.id;
  }

  /** 供 legacy 凭据迁移读取本聚合的明文 Key（回滚窗口）；行不存在返回 undefined。 */
  readPlaintextApiKey(id: string): string | undefined {
    const row = this.db.prepare('SELECT api_key FROM model_profiles WHERE id = ?').get(id) as
      { api_key: string } | undefined;
    return row?.api_key;
  }

  /** 迁移完成后清空本聚合的明文 Key 列；列本身保留作回滚窗口，行消失后不再被读到。 */
  clearPlaintextApiKey(id: string): void {
    this.db.prepare("UPDATE model_profiles SET api_key = '' WHERE id = ?").run(id);
  }

  save(input: ModelProfileInput & { id?: string | undefined }): string {
    const now = Date.now();
    const id = input.id ?? randomUUID();
    const transaction = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT api_key FROM model_profiles WHERE id = ?')
        .get(id) as { api_key: string } | undefined;
      const apiKey = input.apiKey || existing?.api_key || '';
      const previous = existing
        ? (this.db
            .prepare('SELECT role, priority FROM model_profile_roles WHERE profile_id = ?')
            .all(id) as ModelRoleRow[])
        : [];
      const previousPriorities = new Map(previous.map(({ role, priority }) => [role, priority]));
      const roles = ROLE_ORDER.filter((role) => input.roles.includes(role));
      const primaryRole = roles[0];
      if (!primaryRole) throw new Error('至少选择一个模型角色');

      const assignments = roles.map((role) => {
        const prior = previousPriorities.get(role);
        if (prior !== undefined) return { role, priority: prior };
        const row = this.db
          .prepare(
            'SELECT COALESCE(MAX(priority), -1) + 1 AS next FROM model_profile_roles WHERE role = ?',
          )
          .get(role) as { next: number };
        return { role, priority: row.next };
      });
      const primaryPriority = assignments.find(({ role }) => role === primaryRole)?.priority ?? 0;

      if (existing) {
        this.db
          .prepare(
            `UPDATE model_profiles
                SET name = ?, provider = ?, base_url = ?, model = ?, role = ?, api_key = ?,
                    enabled = ?, priority = ?, max_context_tokens = ?, max_output_tokens = ?,
                    temperature = ?, connection_status = 'untested', last_tested_at = NULL,
                    updated_at = ?
              WHERE id = ?`,
          )
          .run(
            input.name,
            input.provider,
            input.baseUrl,
            input.model,
            primaryRole,
            apiKey,
            input.enabled ? 1 : 0,
            primaryPriority,
            input.maxContextTokens,
            input.maxOutputTokens,
            input.temperature,
            now,
            id,
          );
        this.db.prepare('DELETE FROM model_profile_roles WHERE profile_id = ?').run(id);
      } else {
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
            primaryRole,
            apiKey,
            input.enabled ? 1 : 0,
            primaryPriority,
            input.maxContextTokens,
            input.maxOutputTokens,
            input.temperature,
            now,
            now,
          );
      }

      const insertRole = this.db.prepare(
        'INSERT INTO model_profile_roles (profile_id, role, priority) VALUES (?, ?, ?)',
      );
      for (const assignment of assignments)
        insertRole.run(id, assignment.role, assignment.priority);
      return id;
    });
    return transaction();
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM model_profiles WHERE id = ?').run(id).changes > 0;
  }

  /** 设为某角色默认＝把自己的 priority 归零、同角色其他配置顺延。只允许已启用的配置。 */
  setDefault(id: string, role: ModelRole): boolean {
    const target = this.db
      .prepare(
        `SELECT p.enabled FROM model_profiles p
           JOIN model_profile_roles r ON r.profile_id = p.id
          WHERE p.id = ? AND r.role = ?`,
      )
      .get(id, role) as { enabled: number } | undefined;
    if (!target || target.enabled !== 1) return false;
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE model_profile_roles SET priority = priority + 1 WHERE role = ? AND profile_id != ?',
        )
        .run(role, id);
      const changed =
        this.db
          .prepare('UPDATE model_profile_roles SET priority = 0 WHERE profile_id = ? AND role = ?')
          .run(id, role).changes > 0;
      this.db
        .prepare(
          `UPDATE model_profiles SET priority = COALESCE(
             (SELECT priority FROM model_profile_roles WHERE profile_id = model_profiles.id AND role = model_profiles.role),
             priority
           ) WHERE role = ?`,
        )
        .run(role);
      return changed;
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
