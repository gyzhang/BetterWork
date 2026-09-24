import { createHash } from 'node:crypto';

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

/**
 * 记忆正文的归一化（契约 §5.1）：只做 NFC、换行统一与首尾空白去除，
 * 数字、单位、标点与否定词一律保留——「不得合并 / 可以合并」「10万元 / 100万元」
 * 必须落到不同的哈希，因此这里不做大小写、全半角或任何语义折叠。
 */
const normalizeMemoryContent = (content: string): string =>
  content.normalize('NFC').replace(/\r\n?/gu, '\n').trim();

/** 与 contentHash 同一约定：SHA-256 的 UTF-8 十六进制摘要（64 字符）。 */
const normalizedHashOf = (content: string): string =>
  createHash('sha256').update(normalizeMemoryContent(content), 'utf8').digest('hex');

interface LegacyMemoryGovernanceRow {
  revision_id: string;
  kind: string;
  content: string;
  source_type: string;
  source_id: string | null;
  source_locator: string | null;
}

/**
 * 契约 §5.2 把七个细分面归到四种 kind；历史行只能机械按 kind 取其中唯一无歧义的那一个
 * （semantic 里 goal/constraint/decision 的区分需要语义判断，本期不猜）。
 * 未知 kind 直接抛错让整条迁移回滚，也不写一个看起来能用的面。
 */
const legacyFacetOf = (kind: string): string => {
  switch (kind) {
    case 'semantic':
      return 'fact';
    case 'episodic':
      return 'experience';
    case 'procedural':
      return 'method';
    case 'preference':
      return 'preference';
    default:
      throw new Error(`记忆分类 ${kind} 无法机械映射到细分面，迁移中止。`);
  }
};

/**
 * 契约 §5.3 的 legacy 分支：只把原 source_type / source_id / source_locator 原样带过来，
 * 并显式标注「未经复核」。不补造 sources、确认人、捕获时间，也不清空原值（§8.4）。
 */
const legacyProvenanceOf = (row: LegacyMemoryGovernanceRow): string =>
  JSON.stringify({
    schemaVersion: 1,
    verification: 'legacy-unverified',
    sourceType: row.source_type,
    ...(row.source_id === null ? {} : { sourceId: row.source_id }),
    ...(row.source_locator === null ? {} : { sourceLocator: row.source_locator }),
  });

/**
 * WM02 的 legacy 回填：对迁移当时已存在的每一行（含同一记忆身份的历史修订）
 * 计算 normalized_hash、机械映射 facet、写入 legacy 来源标记。
 * id、revision、status、content_hash 与两个时间戳都不参与改写。
 */
function backfillLegacyMemoryGovernance(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT revision_id, kind, content, source_type, source_id, source_locator FROM memory_records`,
    )
    .all() as LegacyMemoryGovernanceRow[];
  const update = db.prepare(
    `UPDATE memory_records
        SET facet = ?, normalized_hash = ?, provenance_json = ?
      WHERE revision_id = ?`,
  );
  for (const row of rows) {
    update.run(
      legacyFacetOf(row.kind),
      normalizedHashOf(row.content),
      legacyProvenanceOf(row),
      row.revision_id,
    );
  }
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
  {
    version: 4,
    name: 'add run skill bindings and script executions',
    up(db: Database.Database): void {
      // environment_id 故意不加外键：runtime_environments 由 A10 引入，
      // 届时按本文件约定走 rebuildTable 补外键，不在启动代码里探测后 ALTER。
      db.exec(`
        CREATE TABLE run_skill_bindings (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          skill_revision_id TEXT NOT NULL REFERENCES skill_revisions(id) ON DELETE CASCADE,
          profile_revision_id TEXT NOT NULL
            REFERENCES skill_runtime_profiles(id) ON DELETE CASCADE,
          environment_id TEXT,
          dependency_snapshot_ids_json TEXT NOT NULL DEFAULT '[]',
          grant_id TEXT NOT NULL REFERENCES skill_trust_grants(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE script_executions (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          binding_id TEXT NOT NULL REFERENCES run_skill_bindings(id) ON DELETE CASCADE,
          tool_call_id TEXT NOT NULL,
          command_id TEXT NOT NULL,
          argument_digest TEXT NOT NULL,
          input_hashes_json TEXT NOT NULL DEFAULT '[]',
          work_dir_key TEXT NOT NULL,
          attempt_key TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed-out')),
          reason TEXT CHECK (reason IN (
            'spawn-failed', 'execute-failed', 'validate-failed', 'publish-failed',
            'cleanup-failed', 'interrupted', 'timed-out', 'cancelled-by-user',
            'cancelled-by-run', 'cancelled-by-trust-revoke', 'cancelled-by-disable'
          )),
          report_hash TEXT,
          output_ids_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER
        );
        CREATE INDEX idx_run_skill_bindings_run ON run_skill_bindings(run_id);
        CREATE INDEX idx_script_executions_run ON script_executions(run_id, created_at DESC);
        CREATE INDEX idx_script_executions_open ON script_executions(status);
      `);
    },
  },
  {
    version: 5,
    name: 'add runtime environments and dependency operations',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE runtime_environments (
          id TEXT PRIMARY KEY,
          environment_key TEXT NOT NULL UNIQUE,
          base_json TEXT NOT NULL,
          platform_json TEXT NOT NULL,
          lock_hash TEXT NOT NULL,
          lock_json TEXT NOT NULL,
          path_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'unprepared', 'preparing', 'ready', 'failed', 'cancelled', 'invalid'
          )),
          failure_code TEXT,
          failure_summary TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          ready_at INTEGER
        );
        CREATE TABLE dependency_operations (
          id TEXT PRIMARY KEY,
          environment_id TEXT NOT NULL REFERENCES runtime_environments(id) ON DELETE CASCADE,
          environment_key TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('prepare', 'repair')),
          status TEXT NOT NULL CHECK (status IN (
            'queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'
          )),
          step TEXT CHECK (step IN (
            'resolve-interpreter', 'create-environment', 'install-packages',
            'probe-imports', 'finalize'
          )),
          message TEXT,
          failure_code TEXT,
          failure_summary TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER
        );
        CREATE INDEX idx_dependency_operations_environment
          ON dependency_operations(environment_id, created_at DESC);
        CREATE INDEX idx_dependency_operations_open ON dependency_operations(status);
        CREATE INDEX idx_runtime_environments_status ON runtime_environments(status);
      `);

      // A07 刻意留空的 environment_id 现在有了归属表：先清悬空引用，
      // 再按本文件约定用 rebuildTable 补外键，不在启动代码里探测后 ALTER。
      // RESTRICT 是有意的：历史绑定引用的环境不允许被清理（设计 §4.4）。
      db.exec(
        `UPDATE run_skill_bindings SET environment_id = NULL
         WHERE environment_id IS NOT NULL
           AND environment_id NOT IN (SELECT id FROM runtime_environments)`,
      );
      rebuildTable(
        db,
        'run_skill_bindings',
        `CREATE TABLE run_skill_bindings (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          skill_revision_id TEXT NOT NULL REFERENCES skill_revisions(id) ON DELETE CASCADE,
          profile_revision_id TEXT NOT NULL
            REFERENCES skill_runtime_profiles(id) ON DELETE CASCADE,
          environment_id TEXT REFERENCES runtime_environments(id) ON DELETE RESTRICT,
          dependency_snapshot_ids_json TEXT NOT NULL DEFAULT '[]',
          grant_id TEXT NOT NULL REFERENCES skill_trust_grants(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL
        )`,
        [
          'id',
          'run_id',
          'skill_revision_id',
          'profile_revision_id',
          'environment_id',
          'dependency_snapshot_ids_json',
          'grant_id',
          'created_at',
        ],
        ['CREATE INDEX idx_run_skill_bindings_run ON run_skill_bindings(run_id)'],
      );
    },
  },
  {
    version: 6,
    name: 'add dependency snapshots for external toolchains',
    up(db: Database.Database): void {
      // 内容寻址：manifest_hash 唯一，因此相同内容只有一个受管副本。
      // 不与 skills 建外键——快照是可被多个 Skill/绑定共享的工具链资产。
      db.exec(`
        CREATE TABLE dependency_snapshots (
          id TEXT PRIMARY KEY,
          origin TEXT NOT NULL,
          origin_commit TEXT,
          origin_state TEXT NOT NULL CHECK (origin_state IN ('clean', 'dirty', 'unknown')),
          manifest_hash TEXT NOT NULL UNIQUE,
          path_key TEXT NOT NULL,
          file_count INTEGER NOT NULL,
          total_bytes INTEGER NOT NULL,
          exclusions_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          verified_at INTEGER
        );
        CREATE INDEX idx_dependency_snapshots_created ON dependency_snapshots(created_at DESC);
      `);
    },
  },
  {
    version: 7,
    name: 'add file artifact support with artifact_files table',
    up(db: Database.Database): void {
      // 文件型成果的版本不在 DB 里存内容，content 改为可空；
      // content_hash 保留非空，两种类型都用它做内容寻址。
      rebuildTable(
        db,
        'artifact_versions',
        `CREATE TABLE artifact_versions (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          content TEXT,
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

      // artifact_files 与 version 一一对应；file_key 是 userData/artifact-files/<versionId>/ 下的相对路径。
      // 不与 script_executions 建外键——执行记录可被清理，文件归属由 artifact_versions 链路保证。
      db.exec(`
        CREATE TABLE artifact_files (
          version_id TEXT PRIMARY KEY REFERENCES artifact_versions(id) ON DELETE CASCADE,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          file_hash TEXT NOT NULL,
          file_key TEXT NOT NULL,
          execution_id TEXT NOT NULL,
          description TEXT,
          validation_structure TEXT NOT NULL
            CHECK (validation_structure IN ('pending', 'passed', 'failed', 'not-checked')),
          validation_visual TEXT NOT NULL
            CHECK (validation_visual IN ('pending', 'passed', 'failed', 'not-checked')),
          validation_manual_edit TEXT NOT NULL
            CHECK (validation_manual_edit IN ('pending', 'passed', 'failed', 'not-checked'))
        );
      `);
    },
  },
  {
    version: 8,
    name: 'verified-execution-outputs-and-dependency-selection',
    up(db: Database.Database): void {
      db.exec(`
        ALTER TABLE script_executions ADD COLUMN verified_outputs_json TEXT NOT NULL DEFAULT '[]';
        CREATE TABLE skill_dependency_selections (
          grant_id TEXT PRIMARY KEY REFERENCES skill_trust_grants(id) ON DELETE CASCADE,
          lock_hash TEXT NOT NULL,
          snapshot_ids_json TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 9,
    name: 'add experts and immutable expert revisions',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE experts (
          id TEXT PRIMARY KEY,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin', 'user')),
          lifecycle TEXT NOT NULL DEFAULT 'active'
            CHECK (lifecycle IN ('active', 'disabled', 'archived')),
          current_revision_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE expert_revisions (
          id TEXT PRIMARY KEY,
          expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision > 0),
          name TEXT NOT NULL,
          summary TEXT NOT NULL,
          avatar_key TEXT,
          identity TEXT NOT NULL,
          principles_json TEXT NOT NULL,
          input_requirements_json TEXT NOT NULL,
          delivery_requirements_json TEXT NOT NULL,
          skill_preset_json TEXT NOT NULL,
          builtin_tool_policy_json TEXT NOT NULL,
          model_reference_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(expert_id, revision)
        );
        CREATE INDEX idx_expert_revisions_expert
          ON expert_revisions(expert_id, revision DESC);
        CREATE INDEX idx_experts_lifecycle
          ON experts(lifecycle, updated_at DESC);
      `);
    },
  },
  {
    version: 10,
    name: 'add task context revisions',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE task_context_revisions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision > 0),
          executor_json TEXT NOT NULL,
          skill_bindings_json TEXT NOT NULL,
          model_reference_json TEXT,
          builtin_tool_policy_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(task_id, revision)
        );
        CREATE INDEX idx_task_context_revisions_task
          ON task_context_revisions(task_id, revision DESC);
      `);
    },
  },
  {
    version: 11,
    name: 'add managed input snapshots',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE input_snapshots (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          source_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          format TEXT NOT NULL,
          file_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'failed', 'cancelled')),
          failure_code TEXT,
          failure_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_input_snapshots_workspace
          ON input_snapshots(workspace_id, updated_at DESC);
        CREATE INDEX idx_input_snapshots_hash
          ON input_snapshots(workspace_id, content_hash, status);
      `);
    },
  },
  {
    version: 12,
    name: 'add task context material selections',
    up(db: Database.Database): void {
      db.exec(
        "ALTER TABLE task_context_revisions ADD COLUMN materials_json TEXT NOT NULL DEFAULT '[]'",
      );
    },
  },
  {
    version: 13,
    name: 'add run context snapshots',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE run_context_snapshots (
          run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          task_context_revision_id TEXT REFERENCES task_context_revisions(id) ON DELETE SET NULL,
          context_segment_id TEXT NOT NULL,
          materials_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_run_context_snapshots_task
          ON run_context_snapshots(task_id, created_at ASC);
      `);
    },
  },
  {
    version: 14,
    name: 'add run material reads and artifact input relations',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE run_material_reads (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          material_json TEXT NOT NULL,
          material_key TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('preview', 'search', 'read', 'parse')),
          locator TEXT,
          content_hash TEXT NOT NULL,
          excerpt_hash TEXT,
          captured_at INTEGER NOT NULL,
          UNIQUE(run_id, material_key, operation, locator)
        );
        CREATE INDEX idx_run_material_reads_run
          ON run_material_reads(run_id, captured_at ASC);
        CREATE TABLE artifact_input_relations (
          id TEXT PRIMARY KEY,
          output_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          input_json TEXT NOT NULL,
          input_key TEXT NOT NULL,
          relation TEXT NOT NULL CHECK (relation IN ('data', 'rule', 'comparison', 'structure', 'template', 'background')),
          created_at INTEGER NOT NULL,
          UNIQUE(output_version_id, input_key, relation)
        );
        CREATE INDEX idx_artifact_input_relations_run
          ON artifact_input_relations(run_id, created_at ASC);
      `);
    },
  },
  {
    version: 15,
    name: 'add memory records and run memory reads',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE memory_records (
          revision_id TEXT PRIMARY KEY,
          id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'workspace', 'expert', 'expert-workspace')),
          scope_id TEXT NOT NULL,
          expert_id TEXT REFERENCES experts(id) ON DELETE CASCADE,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('semantic', 'episodic', 'procedural', 'preference')),
          content TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('user-explicit', 'conversation', 'artifact', 'reflection')),
          source_id TEXT,
          source_locator TEXT,
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'superseded', 'expired', 'deleted')),
          valid_from INTEGER,
          valid_until INTEGER,
          supersedes_id TEXT,
          content_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(id, revision)
        );
        CREATE INDEX idx_memory_records_latest ON memory_records(id, revision DESC);
        CREATE INDEX idx_memory_records_scope ON memory_records(scope_kind, scope_id, status, updated_at DESC);
        CREATE TABLE run_memory_reads (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          memory_id TEXT NOT NULL,
          memory_revision_id TEXT NOT NULL REFERENCES memory_records(revision_id) ON DELETE RESTRICT,
          content_hash TEXT NOT NULL,
          captured_at INTEGER NOT NULL,
          UNIQUE(run_id, memory_revision_id)
        );
        CREATE INDEX idx_run_memory_reads_run ON run_memory_reads(run_id, captured_at ASC);
      `);
    },
  },
  {
    version: 16,
    name: 'add task context memory exclusions',
    up(db: Database.Database): void {
      db.exec(
        "ALTER TABLE task_context_revisions ADD COLUMN excluded_memory_ids_json TEXT NOT NULL DEFAULT '[]'",
      );
    },
  },
  {
    version: 17,
    name: 'add mcp connections and task tool bindings',
    up(db: Database.Database): void {
      db.exec(`
        ALTER TABLE task_context_revisions
          ADD COLUMN mcp_tool_bindings_json TEXT NOT NULL DEFAULT '[]';
        CREATE TABLE mcp_connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          transport_kind TEXT NOT NULL CHECK (transport_kind = 'stdio'),
          command TEXT NOT NULL,
          args_json TEXT NOT NULL,
          cwd TEXT,
          status TEXT NOT NULL CHECK (status IN ('unconfigured', 'connecting', 'ready', 'failed', 'disconnected')),
          server_name TEXT,
          server_version TEXT,
          tools_json TEXT NOT NULL DEFAULT '[]',
          failure_message TEXT,
          last_checked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_mcp_connections_updated ON mcp_connections(updated_at DESC, id ASC);
      `);
    },
  },
  {
    version: 18,
    name: 'add expert mcp tool presets',
    up(db: Database.Database): void {
      db.exec(
        "ALTER TABLE expert_revisions ADD COLUMN mcp_tool_bindings_json TEXT NOT NULL DEFAULT '[]'",
      );
    },
  },
  {
    version: 19,
    name: 'add discussion checkpoints',
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE discussion_checkpoints (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          stage TEXT NOT NULL CHECK (stage IN ('understanding', 'research-complete', 'report-outline', 'report', 'ppt-outline', 'ppt-complete', 'iteration')),
          status TEXT NOT NULL CHECK (status IN ('open', 'superseded')),
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          artifact_version_ids_json TEXT NOT NULL DEFAULT '[]',
          feedback TEXT,
          next_action TEXT,
          supersedes_id TEXT REFERENCES discussion_checkpoints(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_discussion_checkpoints_task
          ON discussion_checkpoints(task_id, created_at ASC, id ASC);
        CREATE INDEX idx_discussion_checkpoints_open
          ON discussion_checkpoints(task_id, status, updated_at DESC);
      `);
    },
  },
  {
    version: 20,
    name: 'add expert reference materials',
    up(db: Database.Database): void {
      db.exec(
        "ALTER TABLE expert_revisions ADD COLUMN reference_materials_json TEXT NOT NULL DEFAULT '[]'",
      );
    },
  },
  {
    version: 21,
    name: 'add run expert binding snapshot',
    up(db: Database.Database): void {
      db.exec(`
        ALTER TABLE run_context_snapshots
          ADD COLUMN expert_id TEXT REFERENCES experts(id) ON DELETE RESTRICT;
        ALTER TABLE run_context_snapshots
          ADD COLUMN expert_revision_id TEXT REFERENCES expert_revisions(id) ON DELETE RESTRICT;
      `);
    },
  },
  {
    version: 22,
    name: 'add run capability binding snapshot',
    up(db: Database.Database): void {
      db.exec(`
        ALTER TABLE run_context_snapshots
          ADD COLUMN model_reference_json TEXT;
        ALTER TABLE run_context_snapshots
          ADD COLUMN builtin_tool_policy_json TEXT;
        ALTER TABLE run_context_snapshots
          ADD COLUMN mcp_tool_bindings_json TEXT;
      `);
    },
  },
  {
    version: 23,
    name: 'allow other artifact input relation',
    up(db: Database.Database): void {
      rebuildTable(
        db,
        'artifact_input_relations',
        `
          CREATE TABLE artifact_input_relations (
            id TEXT PRIMARY KEY,
            output_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            input_json TEXT NOT NULL,
            input_key TEXT NOT NULL,
            relation TEXT NOT NULL CHECK (relation IN ('data', 'rule', 'comparison', 'structure', 'template', 'background', 'other')),
            created_at INTEGER NOT NULL,
            UNIQUE(output_version_id, input_key, relation)
          );
        `,
        ['id', 'output_version_id', 'run_id', 'input_json', 'input_key', 'relation', 'created_at'],
        [
          `CREATE INDEX idx_artifact_input_relations_run
             ON artifact_input_relations(run_id, created_at ASC);`,
        ],
      );
    },
  },
  {
    version: 24,
    name: 'add credentials table',
    up(db: Database.Database): void {
      // CF10：Main 唯一的加密凭据存储。owner_id 不建外键——凭据是被 owner 引用的独立聚合，
      // API/MCP/模型配置各自留在自己的聚合表里；(owner_kind, owner_id, slot) 唯一。
      db.exec(`
        CREATE TABLE credentials (
          id TEXT PRIMARY KEY,
          owner_kind TEXT NOT NULL CHECK (owner_kind IN ('api-service-profile', 'mcp-connection', 'model-profile')),
          owner_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          ciphertext BLOB,
          version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_credentials_owner_slot ON credentials(owner_kind, owner_id, slot);
      `);
    },
  },
  {
    version: 25,
    name: 'add credential migration journal',
    up(db: Database.Database): void {
      // CF11：journaled、版本化的 legacy 密钥入库进度表，不存任何 secret 值。
      db.exec(`
        CREATE TABLE credential_migration_journal (
          owner_kind TEXT NOT NULL CHECK (owner_kind IN ('api-service-profile', 'mcp-connection', 'model-profile')),
          owner_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
          error_code TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (owner_kind, owner_id, slot)
        );
      `);
      // 为现存明文 Key 播下 pending：模型按 id，搜索按 provider（CF20 之前搜索尚未 profile 化，
      // 这里用 api-service-profile 作为其未来归属，owner_id=provider 作为可重放的迁移映射）。
      const now = Date.now();
      db.prepare(
        `INSERT OR IGNORE INTO credential_migration_journal (owner_kind, owner_id, slot, status, updated_at)
         SELECT 'model-profile', id, 'api-key', 'pending', ? FROM model_profiles WHERE api_key <> ''`,
      ).run(now);
      db.prepare(
        `INSERT OR IGNORE INTO credential_migration_journal (owner_kind, owner_id, slot, status, updated_at)
         SELECT 'api-service-profile', provider, 'api-key', 'pending', ? FROM search_engine_configs WHERE api_key <> ''`,
      ).run(now);
    },
  },
  {
    version: 26,
    name: 'add memory governance columns operations and conflict decisions',
    up(db: Database.Database): void {
      // WM02（契约 §8.1、§8.2）。SQLite 不能用 ALTER 把列收紧成 NOT NULL，也不能补 CHECK，
      // 所以先加可空列 → 回填 legacy 值 → 按本文件约定用 rebuildTable 落成最终形状。
      db.exec(`
        ALTER TABLE memory_records ADD COLUMN facet TEXT;
        ALTER TABLE memory_records ADD COLUMN topic_key TEXT;
        ALTER TABLE memory_records ADD COLUMN normalized_hash TEXT;
        ALTER TABLE memory_records ADD COLUMN provenance_json TEXT;
        ALTER TABLE memory_records ADD COLUMN candidate_disposition TEXT;
        ALTER TABLE memory_records ADD COLUMN replaces_revision_id TEXT;
      `);
      backfillLegacyMemoryGovernance(db);
      rebuildTable(
        db,
        'memory_records',
        `CREATE TABLE memory_records (
          revision_id TEXT PRIMARY KEY,
          id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'workspace', 'expert', 'expert-workspace')),
          scope_id TEXT NOT NULL,
          expert_id TEXT REFERENCES experts(id) ON DELETE CASCADE,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('semantic', 'episodic', 'procedural', 'preference')),
          facet TEXT NOT NULL CHECK (facet IN (
            'goal', 'constraint', 'decision', 'fact', 'method', 'preference', 'experience'
          )),
          topic_key TEXT CHECK (topic_key IS NULL OR length(topic_key) BETWEEN 1 AND 80),
          normalized_hash TEXT NOT NULL CHECK (length(normalized_hash) = 64),
          provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
          candidate_disposition TEXT CHECK (
            candidate_disposition IS NULL OR candidate_disposition IN ('pending', 'rejected')
          ),
          -- 精确引用只能落在 revision_id 上：memory_records.id 在修订表里不唯一（§8.1）。
          replaces_revision_id TEXT REFERENCES memory_records(revision_id) ON DELETE RESTRICT,
          content TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('user-explicit', 'conversation', 'artifact', 'reflection')),
          source_id TEXT,
          source_locator TEXT,
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'superseded', 'expired', 'deleted')),
          valid_from INTEGER,
          valid_until INTEGER,
          supersedes_id TEXT,
          content_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          -- SQLite 要求表级约束排在全部列定义之后，以下四条都是表级 CHECK。
          -- 细分面必须由宿主按契约 §5.2 映射到 kind，不接受矛盾组合。
          CHECK (
            (kind = 'semantic' AND facet IN ('goal', 'constraint', 'decision', 'fact')) OR
            (kind = 'procedural' AND facet = 'method') OR
            (kind = 'preference' AND facet = 'preference') OR
            (kind = 'episodic' AND facet = 'experience')
          ),
          -- 只约束「处置标记只能出现在 candidate 上」；反向不成立：
          -- 历史 candidate 没有处置事实，回填 pending 等于伪造（§8.4）。
          CHECK (candidate_disposition IS NULL OR status = 'candidate'),
          -- 跨记录替代不得自我替代；「必须属于另一条记忆身份」由领域层校验，
          -- SQLite 的 CHECK 不允许子查询，写不进这一条。
          CHECK (replaces_revision_id IS NULL OR replaces_revision_id <> revision_id),
          UNIQUE(id, revision)
        )`,
        [
          'revision_id',
          'id',
          'revision',
          'scope_kind',
          'scope_id',
          'expert_id',
          'workspace_id',
          'kind',
          'facet',
          'topic_key',
          'normalized_hash',
          'provenance_json',
          'candidate_disposition',
          'replaces_revision_id',
          'content',
          'source_type',
          'source_id',
          'source_locator',
          'confidence',
          'status',
          'valid_from',
          'valid_until',
          'supersedes_id',
          'content_hash',
          'created_at',
          'updated_at',
        ],
        [
          'CREATE INDEX idx_memory_records_latest ON memory_records(id, revision DESC)',
          'CREATE INDEX idx_memory_records_scope ON memory_records(scope_kind, scope_id, status, updated_at DESC)',
        ],
      );
      db.exec(`
        -- 契约 §8.2 索引清单：scope 内去重（candidateDisposition/抑制）与议题冲突提示的查询入口。
        CREATE INDEX idx_memory_records_scope_hash ON memory_records(scope_kind, normalized_hash);
        CREATE INDEX idx_memory_records_topic_key ON memory_records(topic_key);
        -- 幂等回执：只有成功提交的事务才写这里（§8.2「错误重试不伪装成功」），
        -- 因此没有 status 列；同 operationId 携带不同请求哈希的冲突由领域层比对 request_hash 判定。
        -- operation_kind 不写 CHECK：词汇随 WM05/WM09/WM12 各自扩展，SQL 层不预先冻结。
        CREATE TABLE memory_operations (
          operation_id TEXT PRIMARY KEY,
          operation_kind TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          result_json TEXT NOT NULL CHECK (json_valid(result_json)),
          committed_at INTEGER NOT NULL CHECK (committed_at >= 0)
        );
        -- 冲突裁决绑定精确修订对，左右按修订身份规范排序，使同一对只有一种落库形状。
        CREATE TABLE memory_conflict_decisions (
          id TEXT PRIMARY KEY,
          operation_id TEXT NOT NULL UNIQUE
            REFERENCES memory_operations(operation_id) ON DELETE RESTRICT,
          left_revision_id TEXT NOT NULL REFERENCES memory_records(revision_id) ON DELETE RESTRICT,
          right_revision_id TEXT NOT NULL REFERENCES memory_records(revision_id) ON DELETE RESTRICT,
          decision TEXT NOT NULL CHECK (decision IN ('keep-both', 'replace')),
          winner_revision_id TEXT REFERENCES memory_records(revision_id) ON DELETE RESTRICT,
          applicability_note TEXT CHECK (
            applicability_note IS NULL OR length(applicability_note) BETWEEN 1 AND 300
          ),
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          CHECK (left_revision_id < right_revision_id),
          CHECK (
            winner_revision_id IS NULL
            OR winner_revision_id IN (left_revision_id, right_revision_id)
          ),
          CHECK ((decision = 'replace') = (winner_revision_id IS NOT NULL)),
          CHECK ((decision = 'keep-both') = (applicability_note IS NOT NULL))
        );
        -- 三个修订列都要能被 RESTRICT 反查，否则删除父行会退化成全表扫描。
        CREATE INDEX idx_memory_conflict_decisions_left
          ON memory_conflict_decisions(left_revision_id);
        CREATE INDEX idx_memory_conflict_decisions_right
          ON memory_conflict_decisions(right_revision_id);
        CREATE INDEX idx_memory_conflict_decisions_winner
          ON memory_conflict_decisions(winner_revision_id);
      `);
    },
  },
  {
    version: 27,
    name: 'add run memory read phases and run memory contexts',
    up(db: Database.Database): void {
      // WM05（契约 §8.1、§8.2）。同样走「可空列 → 回填 → rebuildTable 收紧」。
      db.exec(`
        ALTER TABLE run_memory_reads ADD COLUMN selected_for_injection INTEGER;
        ALTER TABLE run_memory_reads ADD COLUMN replayed_via_run_ids_json TEXT;
        ALTER TABLE run_memory_reads ADD COLUMN provenance_state TEXT;
      `);
      // 此刻表里的每一行都来自「只记录注入、不记录请求阶段」的旧写入路径：
      // MemoryRepository.recordReads 只登记实际注入的 confirmed 记忆，所以 selected 为 1；
      // 安全历史重放（WM06）尚未存在，重放来源为空数组；请求阶段一律 legacy_unknown。
      // 不改写 captured_at，也不补造任何请求哈希或发送时间（§8.4、§2.2 风险 4）。
      db.exec(`
        UPDATE run_memory_reads
           SET selected_for_injection = 1,
               replayed_via_run_ids_json = '[]',
               provenance_state = 'legacy_unknown'
      `);
      rebuildTable(
        db,
        'run_memory_reads',
        `CREATE TABLE run_memory_reads (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          -- memory_records.id 跨修订不唯一（§8.1），因此 memory_id 只是数据列，
          -- 精确引用与外键一律落在 revision_id 上。
          memory_id TEXT NOT NULL,
          memory_revision_id TEXT NOT NULL REFERENCES memory_records(revision_id) ON DELETE RESTRICT,
          content_hash TEXT NOT NULL,
          captured_at INTEGER NOT NULL,
          selected_for_injection INTEGER NOT NULL CHECK (selected_for_injection IN (0, 1)),
          replayed_via_run_ids_json TEXT NOT NULL CHECK (json_valid(replayed_via_run_ids_json)),
          provenance_state TEXT NOT NULL CHECK (provenance_state IN ('known', 'legacy_unknown')),
          UNIQUE(run_id, memory_revision_id)
        )`,
        [
          'id',
          'run_id',
          'memory_id',
          'memory_revision_id',
          'content_hash',
          'captured_at',
          'selected_for_injection',
          'replayed_via_run_ids_json',
          'provenance_state',
        ],
        ['CREATE INDEX idx_run_memory_reads_run ON run_memory_reads(run_id, captured_at ASC)'],
      );
      // 一次运行一份记忆决策快照：Run 审计子表随 Run CASCADE（§8.3）。
      // 依赖并集与选中项保存精确修订引用（§8.2），跨表真实性由 Main 校验，
      // 阶段只能前进、不得倒退由写入方（run-memory-context-repository.ts）把守，DDL 只校验时间互证。
      db.exec(`
        CREATE TABLE run_memory_contexts (
          run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
          schema_version INTEGER NOT NULL CHECK (schema_version > 0),
          phase TEXT NOT NULL CHECK (phase IN ('selected', 'request-prepared', 'dispatch-attempted')),
          recall_version TEXT NOT NULL,
          evaluated_at INTEGER NOT NULL CHECK (evaluated_at >= 0),
          query_hash TEXT NOT NULL,
          policy_snapshot_json TEXT NOT NULL CHECK (json_valid(policy_snapshot_json)),
          selected_items_json TEXT NOT NULL CHECK (json_valid(selected_items_json)),
          replay_json TEXT NOT NULL CHECK (json_valid(replay_json)),
          material_dependency_union_json TEXT NOT NULL CHECK (json_valid(material_dependency_union_json)),
          memory_dependency_union_json TEXT NOT NULL CHECK (json_valid(memory_dependency_union_json)),
          decision_summary_json TEXT NOT NULL CHECK (json_valid(decision_summary_json)),
          authorization_hash TEXT NOT NULL,
          model_snapshot_json TEXT CHECK (
            model_snapshot_json IS NULL OR json_valid(model_snapshot_json)
          ),
          request_hash TEXT,
          selected_at INTEGER NOT NULL CHECK (selected_at >= 0),
          request_prepared_at INTEGER CHECK (request_prepared_at >= 0),
          dispatch_attempted_at INTEGER CHECK (dispatch_attempted_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          -- 没有推进到相应阶段就不许留下该阶段的时间与请求哈希（§6.4 反伪造）。
          CHECK (request_prepared_at IS NULL OR phase IN ('request-prepared', 'dispatch-attempted')),
          CHECK (request_hash IS NULL OR phase IN ('request-prepared', 'dispatch-attempted')),
          CHECK (dispatch_attempted_at IS NULL OR phase = 'dispatch-attempted'),
          CHECK (phase != 'dispatch-attempted' OR request_prepared_at IS NOT NULL),
          -- 阶段时间单调。
          CHECK (request_prepared_at IS NULL OR request_prepared_at >= selected_at),
          CHECK (
            dispatch_attempted_at IS NULL
            OR dispatch_attempted_at >= COALESCE(request_prepared_at, selected_at)
          ),
          CHECK (updated_at >= selected_at)
        );
      `);
    },
  },
  {
    version: 28,
    name: 'add workspace memory settings and extraction jobs',
    up(db: Database.Database): void {
      // WM09（契约 §8.2、§8.3）。无行即 revision 0 / off，因此默认值必须是关闭：
      // 自动建议是逐空间 opt-in，缺省绝不能触发模型调用。
      db.exec(`
        CREATE TABLE workspace_memory_settings (
          workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL CHECK (revision > 0),
          auto_suggest_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_suggest_enabled IN (0, 1)),
          consent_version TEXT,
          consented_at INTEGER CHECK (consented_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          -- 开启必须带当前同意；关闭态可以完全没有同意记录（§3.3）。
          CHECK (auto_suggest_enabled = 0 OR consent_version IS NOT NULL),
          CHECK (consented_at IS NULL OR consent_version IS NOT NULL)
        );
        -- 作业是运行期可恢复状态，不是历史审计事实，因此父对象一律随其删除；
        -- 迟到的模型结果由 revision/attempt/status 在领域层拒绝（§7.3）。
        -- model_profile_id 与 consent_revision 不建外键：作业只保存当时的解析结果，
        -- 删除模型配置或改动设置不得改写、也不得被历史作业锁住（§8.3 的多态引用处理）。
        CREATE TABLE memory_extraction_jobs (
          id TEXT PRIMARY KEY,
          source_key TEXT NOT NULL UNIQUE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
          checkpoint_id TEXT REFERENCES discussion_checkpoints(id) ON DELETE CASCADE,
          source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
          source_version_hash TEXT NOT NULL,
          material_dependencies_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(material_dependencies_json)),
          memory_dependencies_json TEXT NOT NULL DEFAULT '[]'
            CHECK (json_valid(memory_dependencies_json)),
          model_profile_id TEXT,
          model_snapshot_json TEXT CHECK (
            model_snapshot_json IS NULL OR json_valid(model_snapshot_json)
          ),
          trigger TEXT NOT NULL CHECK (trigger IN ('automatic', 'manual-retry')),
          consent_revision INTEGER CHECK (consent_revision >= 0),
          status TEXT NOT NULL CHECK (status IN (
            'queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'skipped'
          )),
          revision INTEGER NOT NULL CHECK (revision > 0),
          attempt INTEGER NOT NULL CHECK (attempt > 0),
          input_code_points INTEGER NOT NULL CHECK (input_code_points >= 0),
          output_code_points INTEGER NOT NULL CHECK (output_code_points >= 0),
          usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
          result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
          error_code TEXT,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          started_at INTEGER CHECK (started_at >= 0),
          finished_at INTEGER CHECK (finished_at >= 0),
          -- 只有未成功的状态才允许带安全错误码；成功作业不得被错误码污染。
          CHECK (error_code IS NULL OR status IN ('failed', 'cancelled', 'interrupted', 'skipped')),
          CHECK (started_at IS NULL OR started_at >= created_at),
          CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
          CHECK (updated_at >= created_at)
        );
        CREATE INDEX idx_memory_extraction_jobs_status
          ON memory_extraction_jobs(status, created_at);
        CREATE INDEX idx_memory_extraction_jobs_workspace
          ON memory_extraction_jobs(workspace_id, created_at DESC);
        CREATE INDEX idx_memory_extraction_jobs_run ON memory_extraction_jobs(run_id);
        CREATE INDEX idx_memory_extraction_jobs_checkpoint
          ON memory_extraction_jobs(checkpoint_id);
      `);
    },
  },
  {
    version: 29,
    name: 'add workspace artifact version references',
    up(db: Database.Database): void {
      // WM12（契约 §8.2）。同空间 active≤20 无法用 CHECK 表达——SQLite 的 CHECK 不允许子查询，
      // 本仓库也不使用 trigger；REFERENCE_LIMIT 由 workspace-reference-repository 在同一事务内
      // 统计 active 行数并把守。artifact_version_id 用 RESTRICT：被参考标记绑定的精确版本
      // 不得随父对象静默消失（§8.3），删除入口返回 HISTORY_REFERENCE_BLOCKS_DELETE。
      db.exec(`
        CREATE TABLE workspace_artifact_references (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          artifact_version_id TEXT NOT NULL
            REFERENCES artifact_versions(id) ON DELETE RESTRICT,
          content_hash TEXT NOT NULL,
          label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
          status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
          revision INTEGER NOT NULL CHECK (revision > 0),
          selected_at INTEGER NOT NULL CHECK (selected_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          CHECK (updated_at >= selected_at),
          UNIQUE(workspace_id, artifact_version_id)
        );
        CREATE INDEX idx_workspace_artifact_references_active
          ON workspace_artifact_references(workspace_id, status, selected_at DESC);
        CREATE INDEX idx_workspace_artifact_references_version
          ON workspace_artifact_references(artifact_version_id);
      `);
    },
  },
  {
    version: 30,
    name: 'KM02 exact knowledge evidence and footprints',
    up(db: Database.Database): void {
      // 知识契约 §5.1/§13.2：Evidence 增加精确来源与去重键，旧 unique 拆成两组部分唯一索引；
      // run_material_reads 重建以移除表级 UNIQUE(run_id,material_key,operation,locator)，
      // 允许同段后续页；旧行不回填虚构 toolCall/span。
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
          knowledge_source_json TEXT,
          dedupe_key TEXT
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
        [
          'CREATE UNIQUE INDEX evidence_run_uri_locator ON evidence(run_id, source_uri, locator) WHERE knowledge_source_json IS NULL',
          'CREATE UNIQUE INDEX evidence_knowledge_dedupe ON evidence(run_id, dedupe_key) WHERE knowledge_source_json IS NOT NULL',
        ],
      );
      rebuildTable(
        db,
        'run_material_reads',
        `CREATE TABLE run_material_reads (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          material_json TEXT NOT NULL,
          material_key TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('preview', 'search', 'read', 'parse')),
          locator TEXT,
          content_hash TEXT NOT NULL,
          excerpt_hash TEXT,
          captured_at INTEGER NOT NULL,
          tool_call_id TEXT,
          knowledge_part_index INTEGER CHECK (knowledge_part_index IS NULL OR knowledge_part_index >= 0),
          knowledge_span_json TEXT,
          text_hash TEXT,
          evidence_id TEXT REFERENCES evidence(id) ON DELETE CASCADE,
          CHECK (
            (evidence_id IS NULL AND tool_call_id IS NULL AND knowledge_part_index IS NULL
              AND knowledge_span_json IS NULL AND text_hash IS NULL)
              OR
            (evidence_id IS NOT NULL AND tool_call_id IS NOT NULL AND knowledge_part_index IS NOT NULL
              AND knowledge_span_json IS NOT NULL AND text_hash IS NOT NULL
              AND operation IN ('search', 'read'))
          )
        )`,
        [
          'id',
          'run_id',
          'material_json',
          'material_key',
          'operation',
          'locator',
          'content_hash',
          'excerpt_hash',
          'captured_at',
        ],
        [
          'CREATE INDEX idx_run_material_reads_run ON run_material_reads(run_id, captured_at ASC)',
          'CREATE UNIQUE INDEX run_material_reads_knowledge_part ON run_material_reads(run_id, tool_call_id, knowledge_part_index) WHERE evidence_id IS NOT NULL',
          'CREATE UNIQUE INDEX run_material_reads_legacy_key ON run_material_reads(run_id, material_key, operation, locator) WHERE evidence_id IS NULL',
        ],
      );
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
