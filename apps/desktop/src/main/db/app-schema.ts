import type Database from 'better-sqlite3';

import { hasColumn, hasTable, type Migration, rebuildTable } from './migrate';

/**
 * 应用状态库（`betterwork.db`）的 schema 演进。
 *
 * 约定：
 * - v1 固定为「迁移制度引入之前」的形状，历史库对账到 v1 后打版本戳，
 *   再走 v2 及以后的增量迁移，因此历史库不会漏掉任何后续变更。
 * - 每条迁移只描述一次不可逆变更，不写 `IF NOT EXISTS` 兜底逻辑；
 *   幂等性由 `schema_migrations` 保证。
 * - SQLite 无法用 ALTER 增删外键，补外键一律走 `rebuildTable`。
 */

/** v1：迁移制度之前的完整形状（含历史上用 ALTER 补过的列）。 */
const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, sequence)
  );
  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_uri TEXT NOT NULL,
    title TEXT NOT NULL,
    locator TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    UNIQUE(run_id, source_uri, locator)
  );
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    current_version_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS artifact_versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source_run_id TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'assistant-run',
    created_at INTEGER NOT NULL,
    UNIQUE(artifact_id, version_number)
  );
  CREATE TABLE IF NOT EXISTS artifact_version_evidence (
    version_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY(version_id, evidence_id)
  );
  CREATE TABLE IF NOT EXISTS model_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    role TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    max_context_tokens INTEGER NOT NULL DEFAULT 8192,
    max_output_tokens INTEGER NOT NULL DEFAULT 8192,
    temperature REAL NOT NULL DEFAULT 0.7,
    connection_status TEXT NOT NULL DEFAULT 'untested',
    last_tested_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS search_engine_configs (
    provider TEXT PRIMARY KEY,
    api_key TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 0,
    connection_status TEXT NOT NULL DEFAULT 'untested',
    last_tested_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    target_kind TEXT,
    target_id TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
`;

/**
 * v2：补齐外键。此前只有 `run_events.run_id` 声明了外键，
 * 而且因为没开 `PRAGMA foreign_keys`，连它也不生效——
 * 删除任务会留下一堆指向不存在实体的孤儿行。
 *
 * 刻意不加外键的两处：
 * - `artifacts.current_version_id`：与 `artifact_versions.artifact_id` 互为父子，
 *   加约束会形成插入死锁；当前版本一致性由 ArtifactRepository 的事务保证。
 * - `artifact_versions.source_run_id`：`user-edit` 版本没有来源 Run，存空串。
 */
function addForeignKeys(db: Database.Database): void {
  db.exec('DELETE FROM runs WHERE task_id NOT IN (SELECT id FROM tasks)');
  db.exec('DELETE FROM sessions WHERE task_id NOT IN (SELECT id FROM tasks)');
  db.exec('DELETE FROM tasks WHERE workspace_id NOT IN (SELECT id FROM workspaces)');
  db.exec('DELETE FROM run_events WHERE run_id NOT IN (SELECT id FROM runs)');
  db.exec('DELETE FROM evidence WHERE run_id NOT IN (SELECT id FROM runs)');
  db.exec('DELETE FROM evidence WHERE task_id NOT IN (SELECT id FROM tasks)');
  db.exec(
    'DELETE FROM artifact_version_evidence WHERE version_id NOT IN (SELECT id FROM artifact_versions)',
  );
  db.exec(
    'DELETE FROM artifact_version_evidence WHERE evidence_id NOT IN (SELECT id FROM evidence)',
  );
  db.exec('DELETE FROM artifact_versions WHERE artifact_id NOT IN (SELECT id FROM artifacts)');
  db.exec('DELETE FROM runs WHERE session_id NOT IN (SELECT id FROM sessions)');
  db.exec('DELETE FROM artifacts WHERE workspace_id NOT IN (SELECT id FROM workspaces)');
  db.exec('DELETE FROM artifacts WHERE task_id NOT IN (SELECT id FROM tasks)');

  rebuildTable(
    db,
    'tasks',
    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    ['id', 'workspace_id', 'title', 'goal', 'created_at', 'updated_at'],
  );

  rebuildTable(
    db,
    'sessions',
    `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    )`,
    ['id', 'task_id', 'created_at'],
  );

  rebuildTable(
    db,
    'runs',
    `CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )`,
    ['id', 'task_id', 'session_id', 'prompt', 'status', 'created_at', 'completed_at'],
  );

  rebuildTable(
    db,
    'evidence',
    `CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_uri TEXT NOT NULL,
      title TEXT NOT NULL,
      locator TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      UNIQUE(run_id, source_uri, locator)
    )`,
    [
      'id',
      'task_id',
      'run_id',
      'source_type',
      'source_uri',
      'title',
      'locator',
      'excerpt',
      'content_hash',
      'captured_at',
    ],
  );

  rebuildTable(
    db,
    'artifacts',
    `CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      current_version_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    [
      'id',
      'workspace_id',
      'task_id',
      'type',
      'title',
      'current_version_id',
      'created_at',
      'updated_at',
    ],
  );

  rebuildTable(
    db,
    'artifact_versions',
    `CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'assistant-run',
      created_at INTEGER NOT NULL,
      UNIQUE(artifact_id, version_number)
    )`,
    [
      'id',
      'artifact_id',
      'version_number',
      'content',
      'content_hash',
      'source_run_id',
      'origin',
      'created_at',
    ],
  );

  rebuildTable(
    db,
    'artifact_version_evidence',
    `CREATE TABLE artifact_version_evidence (
      version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      PRIMARY KEY(version_id, evidence_id)
    )`,
    ['version_id', 'evidence_id'],
  );
}

export const appMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial application state schema',
    up(db: Database.Database): void {
      db.exec(INITIAL_SCHEMA);
    },
  },
  {
    version: 2,
    name: 'enforce foreign keys across task, run, evidence and artifact tables',
    up: addForeignKeys,
  },
  {
    version: 3,
    name: 'add skill revisions profiles preferences and trust grants',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin', 'user')),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          current_revision_id TEXT NOT NULL,
          current_profile_revision_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE skill_revisions (
          id TEXT PRIMARY KEY,
          skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
          content_hash TEXT NOT NULL,
          original_version TEXT,
          resource_key TEXT NOT NULL,
          frontmatter_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(skill_id, content_hash)
        );
        CREATE TABLE skill_runtime_profiles (
          id TEXT PRIMARY KEY,
          skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
          profile_hash TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(skill_id, profile_hash)
        );
        CREATE TABLE skill_preferences (
          skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
          trust_preference TEXT NOT NULL DEFAULT 'untrusted'
            CHECK (trust_preference IN ('untrusted', 'trusted', 'revoked')),
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE skill_trust_grants (
          id TEXT PRIMARY KEY,
          skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
          revision_id TEXT NOT NULL REFERENCES skill_revisions(id) ON DELETE CASCADE,
          profile_hash TEXT NOT NULL,
          dependency_fingerprint TEXT NOT NULL,
          scope_hash TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('builtin-release', 'user')),
          granted_at INTEGER NOT NULL,
          revoked_at INTEGER
        );
        CREATE INDEX idx_skill_revisions_skill ON skill_revisions(skill_id, created_at DESC);
        CREATE INDEX idx_skill_profiles_skill ON skill_runtime_profiles(skill_id, created_at DESC);
        CREATE INDEX idx_skill_grants_active ON skill_trust_grants(skill_id, revoked_at);
      `);
    },
  },
];

/**
 * 历史库对账：迁移制度之前，启动代码用 `PRAGMA table_info` 探测后 ALTER 补列。
 * 那些 ALTER 在任何一次旧版本启动时都已执行，这里只做防御性补齐，
 * 让极端情况（例如手工改过的库）也能安全进入迁移轨道。
 */
export function reconcileLegacyAppDatabase(db: Database.Database): void {
  if (!hasColumn(db, 'model_profiles', 'connection_status')) {
    db.exec(
      "ALTER TABLE model_profiles ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'untested'",
    );
  }
  if (!hasColumn(db, 'model_profiles', 'last_tested_at')) {
    db.exec('ALTER TABLE model_profiles ADD COLUMN last_tested_at INTEGER');
  }
  if (!hasColumn(db, 'artifact_versions', 'origin')) {
    db.exec(
      "ALTER TABLE artifact_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'assistant-run'",
    );
  }
}

export function detectLegacyAppDatabase(db: Database.Database): boolean {
  return hasTable(db, 'workspaces');
}
