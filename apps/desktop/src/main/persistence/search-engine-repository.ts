import type Database from 'better-sqlite3';
import type {
  ModelConnectionStatus,
  SearchEngineConfigInput,
  SearchEngineSummary,
  SearchProviderId,
} from '@betterwork/agent-protocol';

interface SearchEngineRow {
  provider: SearchProviderId;
  api_key: string;
  options: string;
  enabled: number;
  connection_status: ModelConnectionStatus;
  last_tested_at: number | null;
  updated_at: number;
}

/** 执行链路需要的最小配置；apiKey 只存在于主进程。 */
export interface EnabledSearchEngine {
  provider: SearchProviderId;
  apiKey: string;
  webTopK: number;
}

const DEFAULT_WEB_TOP_K = 10;
const WEB_TOP_K_RANGE = { min: 1, max: 20 } as const;

/** options 是自由 JSON 列，读取时必须容错：损坏的值退回默认而不是让启动失败。 */
const parseWebTopK = (raw: string): number => {
  try {
    const parsed = JSON.parse(raw) as { webTopK?: unknown };
    const value = Number(parsed.webTopK);
    return Number.isInteger(value) && value >= WEB_TOP_K_RANGE.min && value <= WEB_TOP_K_RANGE.max
      ? value
      : DEFAULT_WEB_TOP_K;
  } catch {
    return DEFAULT_WEB_TOP_K;
  }
};

const toSummary = (row: SearchEngineRow): SearchEngineSummary => ({
  provider: row.provider,
  apiKeyConfigured: row.api_key !== '',
  enabled: row.enabled === 1,
  webTopK: parseWebTopK(row.options),
  connectionStatus: row.connection_status,
  ...(row.last_tested_at === null ? {} : { lastTestedAt: row.last_tested_at }),
  updatedAt: row.updated_at,
});

const toEnabled = (row: SearchEngineRow): EnabledSearchEngine => ({
  provider: row.provider,
  apiKey: row.api_key,
  webTopK: parseWebTopK(row.options),
});

/**
 * 搜索引擎配置：每个服务商一行，`enabled` 全局唯一——
 * 用户可以配置多家，但同一时刻只有一家对智能体生效。
 */
export class SearchEngineRepository {
  constructor(private readonly db: Database.Database) {}

  list(): SearchEngineSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM search_engine_configs ORDER BY updated_at DESC')
      .all() as SearchEngineRow[];
    return rows.map(toSummary);
  }

  /** 含明文 Key，仅供主进程内部使用。 */
  get(provider: SearchProviderId): EnabledSearchEngine | undefined {
    const row = this.db
      .prepare('SELECT * FROM search_engine_configs WHERE provider = ?')
      .get(provider) as SearchEngineRow | undefined;
    return row ? toEnabled(row) : undefined;
  }

  getEnabled(): EnabledSearchEngine | undefined {
    const row = this.db
      .prepare('SELECT * FROM search_engine_configs WHERE enabled = 1 LIMIT 1')
      .get() as SearchEngineRow | undefined;
    return row ? toEnabled(row) : undefined;
  }

  save(input: SearchEngineConfigInput): SearchProviderId {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT * FROM search_engine_configs WHERE provider = ?')
      .get(input.provider) as SearchEngineRow | undefined;
    // 留空表示保持原有凭据；只有 Key 真正变化时才把连接状态重置为未测试
    const apiKey = input.apiKey || (existing?.api_key ?? '');
    const keyChanged = input.apiKey !== '' && input.apiKey !== existing?.api_key;

    const write = this.db.transaction(() => {
      if (input.enabled) {
        this.db.prepare('UPDATE search_engine_configs SET enabled = 0').run();
      }
      if (existing) {
        this.db
          .prepare(
            `UPDATE search_engine_configs
                SET api_key = ?, options = ?, enabled = ?, connection_status = ?,
                    last_tested_at = ?, updated_at = ?
              WHERE provider = ?`,
          )
          .run(
            apiKey,
            JSON.stringify({ webTopK: input.webTopK }),
            input.enabled ? 1 : 0,
            keyChanged ? 'untested' : existing.connection_status,
            keyChanged ? null : existing.last_tested_at,
            now,
            input.provider,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO search_engine_configs
               (provider, api_key, options, enabled, connection_status, last_tested_at, updated_at)
             VALUES (?, ?, ?, ?, 'untested', NULL, ?)`,
          )
          .run(
            input.provider,
            apiKey,
            JSON.stringify({ webTopK: input.webTopK }),
            input.enabled ? 1 : 0,
            now,
          );
      }
    });
    write();
    return input.provider;
  }

  /**
   * 记录一次连通性测试结果。用 upsert 而不是 update：
   * 「先测试、后保存」是常见顺序，此时配置行还不存在，
   * 纯 update 会影响 0 行并把测试结果丢掉。
   * 被测的 Key 一并写入，否则状态会与实际凭据不一致。
   * 刻意不碰 `enabled`——启用只由保存动作决定。
   */
  recordConnection(
    provider: SearchProviderId,
    status: Exclude<ModelConnectionStatus, 'untested'>,
    apiKey: string,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO search_engine_configs
           (provider, api_key, options, enabled, connection_status, last_tested_at, updated_at)
         VALUES (?, ?, '{}', 0, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           api_key = excluded.api_key,
           connection_status = excluded.connection_status,
           last_tested_at = excluded.last_tested_at,
           updated_at = excluded.updated_at`,
      )
      .run(provider, apiKey, status, now, now);
  }
}
