import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { revisionTextHash } from '../services/knowledge-text';
import { appMigrations, openAppDatabase, openKnowledgeDatabase } from './index';
import { knowledgeMigrations } from './knowledge-schema';
import { hasColumn, hasTable, migrate, type Migration, readSchemaVersion } from './migrate';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-migrate-'));
  temporaryDirectories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const migrationOf = (migrations: readonly Migration[], version: number): Migration => {
  const found = migrations.find((migration) => migration.version === version);
  if (!found) throw new Error(`Migration v${version} is not defined`);
  return found;
};

/** 造一个「迁移制度之前」的历史库：只有 v1 形状，没有 schema_migrations 表。 */
const createLegacyAppDatabase = (filePath: string): Database.Database => {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  migrationOf(appMigrations, 1).up(db);
  return db;
};

const seedLegacyWork = (db: Database.Database): void => {
  const now = Date.now();
  db.prepare(
    'INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('ws-1', '我的工作区', '/tmp/workspace', now, now);
  db.prepare(
    'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('task-1', 'ws-1', '季度复盘', '整理续约风险', now, now);
  db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(
    'session-1',
    'task-1',
    now,
  );
  db.prepare(
    'INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('run-1', 'task-1', 'session-1', '开始工作', 'completed', now, now);
  db.prepare(
    'INSERT INTO run_events (id, run_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('event-1', 'run-1', 0, 'run.completed', '{"type":"run.completed"}', now);
  db.prepare(
    `INSERT INTO evidence (id, task_id, run_id, source_type, source_uri, title, locator, excerpt, content_hash, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'ev-1',
    'task-1',
    'run-1',
    'local-file',
    '/tmp/a.md',
    '客户资料',
    '全文',
    '续约风险',
    'h1',
    now,
  );
  db.prepare(
    `INSERT INTO artifacts (id, workspace_id, task_id, type, title, current_version_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('art-1', 'ws-1', 'task-1', 'markdown', '复盘报告', 'ver-1', now, now);
  db.prepare(
    `INSERT INTO artifact_versions (id, artifact_id, version_number, content, content_hash, source_run_id, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('ver-1', 'art-1', 1, '# 复盘', 'h2', 'run-1', 'assistant-run', now);
  db.prepare('INSERT INTO artifact_version_evidence (version_id, evidence_id) VALUES (?, ?)').run(
    'ver-1',
    'ev-1',
  );
};

const countRows = (db: Database.Database, table: string): number => {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
};

/** 外键常开，因此绑定类用例必须建真实的父级链，不能塞伪造 id。 */
const seedSkillChain = (db: Database.Database, now: number): void => {
  db.prepare(
    'INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('ws-1', '工作区', '/tmp/ws', now, now);
  db.prepare(
    'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('task-1', 'ws-1', '制作演示', '生成 deck', now, now);
  db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(
    'session-1',
    'task-1',
    now,
  );
  db.prepare(
    'INSERT INTO runs (id, task_id, session_id, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('run-1', 'task-1', 'session-1', '生成 deck', 'running', now);
  db.prepare(
    `INSERT INTO skills (id, name, description, source_kind, enabled, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('skill-1', '样本能力', '描述', 'user', 1, 'rev-1', now, now);
  db.prepare(
    `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('rev-1', 'skill-1', 'hash-1', 'user/skill-1/revisions/hash-1', '{}', now);
  db.prepare(
    'INSERT INTO skill_runtime_profiles (id, skill_id, profile_hash, profile_json, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('prof-1', 'skill-1', 'profile-hash', '{"commands":[]}', now);
  db.prepare(
    `INSERT INTO skill_trust_grants (id, skill_id, revision_id, profile_hash, dependency_fingerprint, scope_hash, source, granted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('grant-1', 'skill-1', 'rev-1', 'profile-hash', 'dep', 'scope', 'user', now);
};

describe('application database migrations', () => {
  it('builds the current schema from scratch and enforces foreign keys', () => {
    const file = path.join(temporaryDirectory(), 'fresh.sqlite');
    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?)")
        .all(
          'skills',
          'skill_revisions',
          'skill_runtime_profiles',
          'skill_preferences',
          'skill_trust_grants',
        ),
    ).toHaveLength(5);

    expect(() =>
      db
        .prepare(
          'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('task-x', 'missing-workspace', '标题', '目标', 1, 1),
    ).toThrow(/FOREIGN KEY/iu);

    db.close();
  });

  it('adds Expert and capability columns to existing run snapshots', () => {
    const file = path.join(temporaryDirectory(), 'run-snapshot-v22.sqlite');
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, 20) });
    expect(readSchemaVersion(db)).toBe(20);
    const before = db.prepare('PRAGMA table_info(run_context_snapshots)').all() as Array<{
      name: string;
    }>;
    expect(before.some((column) => column.name === 'expert_id')).toBe(false);
    expect(before.some((column) => column.name === 'model_reference_json')).toBe(false);

    migrate(db, { migrations: appMigrations });

    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    const after = db.prepare('PRAGMA table_info(run_context_snapshots)').all() as Array<{
      name: string;
    }>;
    expect(after.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'expert_id',
        'expert_revision_id',
        'model_reference_json',
        'builtin_tool_policy_json',
        'mcp_tool_bindings_json',
      ]),
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO run_context_snapshots (
             run_id, task_id, workspace_id, expert_id, expert_revision_id,
             context_segment_id, materials_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'missing-run',
          'missing-task',
          'missing-workspace',
          'missing-expert',
          'missing-revision',
          'segment',
          '[]',
          1,
        ),
    ).toThrow(/FOREIGN KEY/iu);
    db.close();
  });

  it('preserves existing artifact relations and allows the other relation after v23', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, 14) });
    seedLegacyWork(db);
    db.prepare(
      `INSERT INTO artifact_input_relations (
         id, output_version_id, run_id, input_json, input_key, relation, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('relation-old', 'ver-1', 'run-1', '{"kind":"evidence"}', 'old', 'background', 1);

    migrate(db, { migrations: appMigrations });

    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    expect(
      db.prepare('SELECT relation FROM artifact_input_relations WHERE id = ?').get('relation-old'),
    ).toEqual({ relation: 'background' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO artifact_input_relations (
             id, output_version_id, run_id, input_json, input_key, relation, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('relation-other', 'ver-1', 'run-1', '{"kind":"other"}', 'other', 'other', 2),
    ).not.toThrow();
    db.close();
  });

  it('adopts a pre-migration database, keeps every row, and stamps only the baseline', () => {
    const file = path.join(temporaryDirectory(), 'legacy.sqlite');
    const legacy = createLegacyAppDatabase(file);
    seedLegacyWork(legacy);
    const before = {
      workspaces: countRows(legacy, 'workspaces'),
      tasks: countRows(legacy, 'tasks'),
      runs: countRows(legacy, 'runs'),
      runEvents: countRows(legacy, 'run_events'),
      evidence: countRows(legacy, 'evidence'),
      artifacts: countRows(legacy, 'artifacts'),
      versions: countRows(legacy, 'artifact_versions'),
      links: countRows(legacy, 'artifact_version_evidence'),
    };
    legacy.close();

    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    expect(db.prepare('SELECT COUNT(*) AS count FROM skill_preferences').get()).toEqual({
      count: 0,
    });
    expect({
      workspaces: countRows(db, 'workspaces'),
      tasks: countRows(db, 'tasks'),
      runs: countRows(db, 'runs'),
      runEvents: countRows(db, 'run_events'),
      evidence: countRows(db, 'evidence'),
      artifacts: countRows(db, 'artifacts'),
      versions: countRows(db, 'artifact_versions'),
      links: countRows(db, 'artifact_version_evidence'),
    }).toEqual(before);

    // 迁移后级联删除真正生效：删工作区带走任务、运行、证据与成果
    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');
    expect(countRows(db, 'tasks')).toBe(0);
    expect(countRows(db, 'runs')).toBe(0);
    expect(countRows(db, 'run_events')).toBe(0);
    expect(countRows(db, 'evidence')).toBe(0);
    expect(countRows(db, 'artifacts')).toBe(0);
    expect(countRows(db, 'artifact_versions')).toBe(0);
    expect(countRows(db, 'artifact_version_evidence')).toBe(0);
    db.close();
  });

  it('reconciles a legacy database that is missing columns added by the old ALTER path', () => {
    const file = path.join(temporaryDirectory(), 'legacy-columns.sqlite');
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE model_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL,
        model TEXT NOT NULL, role TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
        max_context_tokens INTEGER NOT NULL DEFAULT 8192,
        max_output_tokens INTEGER NOT NULL DEFAULT 8192,
        temperature REAL NOT NULL DEFAULT 0.7,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE artifact_versions (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_number INTEGER NOT NULL,
        content TEXT NOT NULL, content_hash TEXT NOT NULL, source_run_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER
      );
      CREATE TABLE run_events (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL,
        payload TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL, source_type TEXT NOT NULL,
        source_uri TEXT NOT NULL, title TEXT NOT NULL, locator TEXT NOT NULL, excerpt TEXT NOT NULL,
        content_hash TEXT NOT NULL, captured_at INTEGER NOT NULL
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, task_id TEXT NOT NULL, type TEXT NOT NULL,
        title TEXT NOT NULL, current_version_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE artifact_version_evidence (
        version_id TEXT NOT NULL, evidence_id TEXT NOT NULL, PRIMARY KEY(version_id, evidence_id)
      );
      CREATE TABLE search_engine_configs (
        provider TEXT PRIMARY KEY, api_key TEXT NOT NULL DEFAULT '', options TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
      );
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY, level TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
        detail TEXT, target_kind TEXT, target_id TEXT,
        read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
    `);
    legacy.close();

    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    const modelColumns = db.prepare('PRAGMA table_info(model_profiles)').all() as Array<{
      name: string;
    }>;
    expect(modelColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['connection_status', 'last_tested_at']),
    );
    const versionColumns = db.prepare('PRAGMA table_info(artifact_versions)').all() as Array<{
      name: string;
    }>;
    expect(versionColumns.map((column) => column.name)).toContain('origin');
    db.close();
  });

  it('is idempotent: reopening an already migrated database changes nothing', () => {
    const file = path.join(temporaryDirectory(), 'idempotent.sqlite');
    const first = openAppDatabase(file);
    seedLegacyWork(first);
    first.close();

    const second = openAppDatabase(file);
    expect(readSchemaVersion(second)).toBe(appMigrations.length);
    expect(countRows(second, 'tasks')).toBe(1);
    second.close();

    const third = openAppDatabase(file);
    expect(countRows(third, 'tasks')).toBe(1);
    third.close();
  });

  it('cleans orphan rows during migration and completes successfully', () => {
    const file = path.join(temporaryDirectory(), 'orphan.sqlite');
    const legacy = createLegacyAppDatabase(file);
    // 旧库没有外键约束，历史数据可能留下指向不存在任务的运行
    legacy
      .prepare(
        'INSERT INTO runs (id, task_id, session_id, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('run-orphan', 'task-missing', 'session-missing', '孤儿运行', 'completed', 1);
    legacy.close();

    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    expect(countRows(db, 'runs')).toBe(0);
    db.close();
  });

  it('adds execution tables whose ownership cascades from the run', () => {
    const file = path.join(temporaryDirectory(), 'executions.sqlite');
    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);

    const now = 1_700_000_000_000;
    db.prepare(
      'INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('ws-1', '工作区', '/tmp/ws', now, now);
    db.prepare(
      'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('task-1', 'ws-1', '制作演示', '生成 deck', now, now);
    db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(
      'session-1',
      'task-1',
      now,
    );
    db.prepare(
      'INSERT INTO runs (id, task_id, session_id, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('run-1', 'task-1', 'session-1', '生成 deck', 'running', now);
    db.prepare(
      `INSERT INTO skills (id, name, description, source_kind, enabled, current_revision_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('skill-1', '样本能力', '描述', 'user', 1, 'rev-1', now, now);
    db.prepare(
      `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('rev-1', 'skill-1', 'hash-1', 'user/skill-1/revisions/hash-1', '{}', now);
    db.prepare(
      'INSERT INTO skill_runtime_profiles (id, skill_id, profile_hash, profile_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('prof-1', 'skill-1', 'profile-hash', '{"commands":[]}', now);
    db.prepare(
      `INSERT INTO skill_trust_grants (id, skill_id, revision_id, profile_hash, dependency_fingerprint, scope_hash, source, granted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('grant-1', 'skill-1', 'rev-1', 'profile-hash', 'dep', 'scope', 'user', now);

    const insertBinding = db.prepare(
      `INSERT INTO run_skill_bindings (id, run_id, skill_revision_id, profile_revision_id, dependency_snapshot_ids_json, grant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertBinding.run('binding-1', 'run-1', 'rev-1', 'prof-1', '[]', 'grant-1', now);
    db.prepare(
      `INSERT INTO script_executions (id, run_id, binding_id, tool_call_id, command_id, argument_digest, work_dir_key, attempt_key, status, output_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'exec-1',
      'run-1',
      'binding-1',
      'tool-1',
      'svg-export',
      'digest',
      'work',
      'a-1',
      'queued',
      '[]',
      now,
    );

    expect(() =>
      db.prepare('UPDATE script_executions SET status = ? WHERE id = ?').run('stopping', 'exec-1'),
    ).toThrow();

    db.prepare('DELETE FROM runs WHERE id = ?').run('run-1');
    expect(countRows(db, 'run_skill_bindings')).toBe(0);
    expect(countRows(db, 'script_executions')).toBe(0);

    expect(() =>
      insertBinding.run('binding-2', 'run-missing', 'rev-1', 'prof-1', '[]', 'grant-1', now),
    ).toThrow();
    db.close();
  });

  it('adds environment tables and gives run bindings a real environment foreign key', () => {
    const file = path.join(temporaryDirectory(), 'environments.sqlite');
    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);

    const now = 1_700_000_000_000;
    seedSkillChain(db, now);
    db.prepare(
      `INSERT INTO runtime_environments (
         id, environment_key, base_json, platform_json, lock_hash, lock_json, path_key,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'env-1',
      'key-1',
      '{"kind":"local","path":"/usr/bin/python3","version":"3.12.14"}',
      '{"os":"darwin","arch":"arm64","abi":"cp312"}',
      'lock-hash',
      '{"lockVersion":1}',
      'environments/key-1/instance-1',
      'ready',
      now,
      now,
    );

    // 状态词汇受 CHECK 约束：写错的状态不会静默落库。
    expect(() =>
      db.prepare('UPDATE runtime_environments SET status = ? WHERE id = ?').run('broken', 'env-1'),
    ).toThrow();

    db.prepare(
      `INSERT INTO dependency_operations (
         id, environment_id, environment_key, kind, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('op-1', 'env-1', 'key-1', 'prepare', 'succeeded', now);
    expect(() =>
      db
        .prepare(
          `INSERT INTO dependency_operations (id, environment_id, environment_key, kind, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('op-2', 'env-missing', 'key-1', 'prepare', 'queued', now),
    ).toThrow(/FOREIGN KEY/iu);

    const insertBinding = db.prepare(
      `INSERT INTO run_skill_bindings (
         id, run_id, skill_revision_id, profile_revision_id, environment_id,
         dependency_snapshot_ids_json, grant_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertBinding.run('binding-1', 'run-1', 'rev-1', 'prof-1', 'env-1', '[]', 'grant-1', now);

    // A07 留下的 environment_id 现在有了归属：不存在的 id 直接被外键拒绝。
    expect(() =>
      insertBinding.run('binding-2', 'run-1', 'rev-1', 'prof-1', 'env-ghost', '[]', 'grant-1', now),
    ).toThrow(/FOREIGN KEY/iu);

    // 历史绑定引用的环境不允许删除：旧运行的可复现性优先于清理。
    expect(() =>
      db.prepare('DELETE FROM runtime_environments WHERE id = ?').run('env-1'),
    ).toThrow();

    db.prepare('UPDATE run_skill_bindings SET environment_id = NULL WHERE id = ?').run('binding-1');
    db.prepare('DELETE FROM dependency_operations WHERE id = ?').run('op-1');
    db.prepare('DELETE FROM runtime_environments WHERE id = ?').run('env-1');
    expect(countRows(db, 'runtime_environments')).toBe(0);
    db.close();
  });

  it('nulls a dangling environment reference while upgrading from v4', () => {
    const file = path.join(temporaryDirectory(), 'upgrade-v5.sqlite');
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const now = 1_700_000_000_000;
    migrate(db, { migrations: appMigrations.slice(0, 4) });
    expect(readSchemaVersion(db)).toBe(4);

    seedSkillChain(db, now);
    db.prepare(
      `INSERT INTO run_skill_bindings (
         id, run_id, skill_revision_id, profile_revision_id, environment_id,
         dependency_snapshot_ids_json, grant_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('binding-1', 'run-1', 'rev-1', 'prof-1', 'env-ghost', '[]', 'grant-1', now);

    migrate(db, { migrations: appMigrations });

    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    const row = db
      .prepare('SELECT environment_id FROM run_skill_bindings WHERE id = ?')
      .get('binding-1') as { environment_id: string | null };
    expect(row.environment_id).toBeNull();
    // 升级后外键真的生效，不只是把脏数据抹平。
    expect(() =>
      db
        .prepare(
          `INSERT INTO run_skill_bindings (
             id, run_id, skill_revision_id, profile_revision_id, environment_id,
             dependency_snapshot_ids_json, grant_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('binding-2', 'run-1', 'rev-1', 'prof-1', 'env-ghost', '[]', 'grant-1', now),
    ).toThrow(/FOREIGN KEY/iu);
    db.close();
  });

  it('adds a content addressed snapshot table for external toolchains', () => {
    const file = path.join(temporaryDirectory(), 'snapshots.sqlite');
    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);

    const now = 1_700_000_000_000;
    const insert = db.prepare(
      `INSERT INTO dependency_snapshots (
         id, origin, origin_commit, origin_state, manifest_hash, path_key,
         file_count, total_bytes, exclusions_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'snap-1',
      '/Users/fixture/ppt-master',
      '82dd5ccc',
      'dirty',
      'manifest-1',
      'dependency-assets/manifest-1',
      5,
      1024,
      '[{"path":".git","reason":"版本库对象不是运行所需内容"}]',
      now,
    );

    // 内容寻址：同一份清单不允许登记两份快照
    expect(() =>
      insert.run(
        'snap-2',
        '/Users/fixture/other',
        null,
        'unknown',
        'manifest-1',
        'dependency-assets/manifest-1',
        5,
        1024,
        '[]',
        now,
      ),
    ).toThrow(/UNIQUE/iu);
    // 版本状态只有三个合法值：读不到 git 身份时不能伪装成 clean
    expect(() =>
      insert.run(
        'snap-3',
        '/Users/fixture/other',
        null,
        'maybe-clean',
        'manifest-3',
        'dependency-assets/manifest-3',
        1,
        10,
        '[]',
        now,
      ),
    ).toThrow();
    expect(countRows(db, 'dependency_snapshots')).toBe(1);
    db.close();
  });

  it('rejects a migration list with duplicate or non-contiguous versions', () => {
    const db = new Database(':memory:');
    expect(() =>
      migrate(db, {
        migrations: [
          { version: 1, name: 'a', up: () => undefined },
          { version: 3, name: 'b', up: () => undefined },
        ],
      }),
    ).toThrow(/contiguous/iu);
    expect(() =>
      migrate(db, {
        migrations: [
          { version: 1, name: 'a', up: () => undefined },
          { version: 1, name: 'b', up: () => undefined },
        ],
      }),
    ).toThrow(/Duplicate/iu);
    db.close();
  });

  it('rolls back an invalid migration instead of stamping a schema with foreign key violations', () => {
    const db = new Database(':memory:');
    expect(() =>
      migrate(db, {
        migrations: [
          {
            version: 1,
            name: 'creates an orphan child row',
            up(database): void {
              database.exec(`
                CREATE TABLE parents (id TEXT PRIMARY KEY);
                CREATE TABLE children (
                  id TEXT PRIMARY KEY,
                  parent_id TEXT NOT NULL REFERENCES parents(id)
                );
                INSERT INTO children (id, parent_id) VALUES ('child-1', 'missing-parent');
              `);
            },
          },
        ],
      }),
    ).toThrow(/foreign key violation/iu);
    expect(readSchemaVersion(db)).toBe(0);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'children'").get(),
    ).toBeUndefined();
    db.close();
  });
});

describe('knowledge database migrations', () => {
  it('rebuilds a pre-migration full text index that cannot locate chunks', () => {
    const file = path.join(temporaryDirectory(), 'legacy-vault.sqlite');
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL, byte_size INTEGER NOT NULL, content_hash TEXT NOT NULL,
        content TEXT NOT NULL, imported_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE knowledge_chunks (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, locator TEXT NOT NULL,
        ordinal INTEGER NOT NULL, content TEXT NOT NULL, UNIQUE(document_id, ordinal)
      );
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(document_id UNINDEXED, title, content);
    `);
    legacy
      .prepare(
        `INSERT INTO knowledge_documents (id, title, source_path, format, byte_size, content_hash, content, imported_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'doc-1',
        '增长笔记',
        '/tmp/a.md',
        'markdown',
        10,
        'hash',
        'Retention risk requires action',
        1,
        1,
      );
    legacy.close();

    const db = openKnowledgeDatabase(file);
    expect(readSchemaVersion(db)).toBe(knowledgeMigrations.length);
    const columns = db.prepare('PRAGMA table_info(knowledge_fts)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('chunk_id');

    // 重建后旧内容仍可检索，且结果能定位到具体分块
    const hits = db
      .prepare(
        `SELECT c.locator FROM knowledge_fts f
           JOIN knowledge_chunks c ON c.id = f.chunk_id
          WHERE knowledge_fts MATCH ?`,
      )
      .all('"retention"') as Array<{ locator: string }>;
    expect(hits).toEqual([{ locator: '全文' }]);
    expect(countRows(db, 'knowledge_revisions')).toBe(1);
    expect(
      db
        .prepare('SELECT revision, content_hash FROM knowledge_revisions WHERE document_id = ?')
        .get('doc-1'),
    ).toEqual({ revision: 1, content_hash: 'hash' });

    // 分块外键生效：删文档带走分块
    db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run('doc-1');
    expect(countRows(db, 'knowledge_chunks')).toBe(0);
    // 修订没有随当前索引记录删除，历史材料仍可解释；未来引用关系负责阻止物理回收。
    expect(countRows(db, 'knowledge_revisions')).toBe(1);
    db.close();
  });

  it('KM01 v4 upgrades revision uniqueness and backfills text hashes from stored sections', () => {
    const file = path.join(temporaryDirectory(), 'vault-v3.sqlite');
    const db = new Database(file);
    migrate(db, { migrations: knowledgeMigrations.slice(0, 3) });
    db.prepare(
      `INSERT INTO knowledge_revisions
        (id, document_id, revision, title, source_path, format, byte_size, content_hash,
         content, page_count, parser_version, chunking_version, imported_at, created_at)
       VALUES ('rev-1', 'doc-1', 1, '旧修订', '/tmp/a.md', 'pdf', 3, 'hash-1',
         '甲\n\n乙方', 2, 'text-extract-v1', 'format-locator-v1', 1, 1)`,
    ).run();
    const insertChunk = db.prepare(
      'INSERT INTO knowledge_revision_chunks (id, revision_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)',
    );
    insertChunk.run('c-0', 'rev-1', '第 1 页', 0, '甲');
    insertChunk.run('c-1', 'rev-1', '第 2 页', 1, '乙方');
    db.close();

    const upgraded = openKnowledgeDatabase(file);
    expect(readSchemaVersion(upgraded)).toBe(knowledgeMigrations.length);
    const backfilled = upgraded
      .prepare('SELECT text_hash, section_count FROM knowledge_revisions WHERE id = ?')
      .get('rev-1') as { text_hash: string; section_count: number };
    expect(backfilled.section_count).toBe(2);
    expect(backfilled.text_hash).toBe(
      revisionTextHash([
        { ordinal: 0, locator: '第 1 页', content: '甲' },
        { ordinal: 1, locator: '第 2 页', content: '乙方' },
      ]),
    );

    // 新唯一键：同文档同原始哈希、不同解析版本可以作为追加修订共存
    expect(() =>
      upgraded
        .prepare(
          `INSERT INTO knowledge_revisions
            (id, document_id, revision, title, source_path, format, byte_size, content_hash,
             content, page_count, parser_version, chunking_version, text_hash, section_count,
             warnings_json, imported_at, created_at)
           VALUES ('rev-2', 'doc-1', 2, '新解析', '/tmp/a.md', 'pdf', 3, 'hash-1',
             '甲\n\n乙方', 2, 'text-extract-v2', 'format-locator-v1', 'x', 2, '[]', 2, 2)`,
        )
        .run(),
    ).not.toThrow();
    // 同解析身份仍然唯一，重复登记必须被拒绝
    expect(() =>
      upgraded
        .prepare(
          `INSERT INTO knowledge_revisions
            (id, document_id, revision, title, source_path, format, byte_size, content_hash,
             content, page_count, parser_version, chunking_version, text_hash, section_count,
             warnings_json, imported_at, created_at)
           VALUES ('rev-dup', 'doc-1', 3, '重复', '/tmp/a.md', 'pdf', 3, 'hash-1',
             '甲', 1, 'text-extract-v1', 'format-locator-v1', 'y', 1, '[]', 3, 3)`,
        )
        .run(),
    ).toThrow(/UNIQUE/iu);
    upgraded.close();

    // 重启幂等：不再重复回填或破坏已存哈希
    const again = openKnowledgeDatabase(file);
    expect(
      (
        again.prepare('SELECT text_hash FROM knowledge_revisions WHERE id = ?').get('rev-1') as {
          text_hash: string;
        }
      ).text_hash,
    ).toBe(backfilled.text_hash);
    again.close();
  });
});

it('creates managed input snapshot state with workspace ownership', () => {
  const db = openAppDatabase(':memory:');
  const now = 1_700_000_000_000;
  db.prepare(
    'INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('snapshot-workspace', '快照工作区', '/tmp/snapshot-workspace', now, now);
  db.prepare(
    `INSERT INTO input_snapshots
      (id, workspace_id, source_path, content_hash, byte_size, format, file_key, status,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'input-1',
    'snapshot-workspace',
    'data.csv',
    'hash-1',
    10,
    'csv',
    'input-snapshots/hash-1/content',
    'preparing',
    now,
    now,
  );
  expect(db.prepare('SELECT status FROM input_snapshots WHERE id = ?').get('input-1')).toEqual({
    status: 'preparing',
  });
  db.prepare('DELETE FROM workspaces WHERE id = ?').run('snapshot-workspace');
  expect(countRows(db, 'input_snapshots')).toBe(0);
  db.close();
});

it('migrates v7 through the latest schema without losing Markdown versions', () => {
  const file = path.join(temporaryDirectory(), 'v7.sqlite');
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  migrate(db, { migrations: appMigrations.filter((migration) => migration.version <= 7) });
  seedLegacyWork(db);
  migrate(db, { migrations: appMigrations });
  expect(readSchemaVersion(db)).toBe(appMigrations.length);
  expect(db.prepare('SELECT content FROM artifact_versions WHERE id = ?').get('ver-1')).toEqual({
    content: '# 复盘',
  });
  const columns = db.prepare('PRAGMA table_info(script_executions)').all() as Array<{
    name: string;
    dflt_value: string;
  }>;
  expect(columns.find((column) => column.name === 'verified_outputs_json')?.dflt_value).toBe(
    "'[]'",
  );
  expect(() =>
    db
      .prepare('INSERT INTO skill_dependency_selections VALUES (?, ?, ?)')
      .run('missing-grant', 'hash', '[]'),
  ).toThrow('FOREIGN KEY');
  migrate(db, { migrations: appMigrations });
  expect(db.pragma('foreign_key_check')).toEqual([]);
  db.close();
});

it('adds immutable expert revision tables and keeps their ownership constraints', () => {
  const db = new Database(':memory:');
  migrate(db, { migrations: appMigrations });
  const now = 1_700_000_000_000;
  db.prepare(
    `INSERT INTO experts (id, source_kind, lifecycle, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('expert-1', 'user', 'active', 'expert-revision-1', now, now);
  db.prepare(
    `INSERT INTO expert_revisions (
       id, expert_id, revision, name, summary, identity, principles_json,
       input_requirements_json, delivery_requirements_json, skill_preset_json,
       builtin_tool_policy_json, model_reference_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'expert-revision-1',
    'expert-1',
    1,
    '经营分析专家',
    '按规则完成经营分析',
    '负责经营分析',
    '[]',
    '[]',
    '[]',
    '[]',
    '{"mode":"application-defaults"}',
    '{"mode":"application-default"}',
    now,
  );
  expect(() =>
    db
      .prepare(
        `INSERT INTO expert_revisions (
           id, expert_id, revision, name, summary, identity, principles_json,
           input_requirements_json, delivery_requirements_json, skill_preset_json,
           builtin_tool_policy_json, model_reference_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'expert-revision-duplicate',
        'expert-1',
        1,
        '重复',
        '',
        '身份',
        '[]',
        '[]',
        '[]',
        '[]',
        '{"mode":"application-defaults"}',
        '{"mode":"application-default"}',
        now,
      ),
  ).toThrow('UNIQUE');
  const expertColumns = db.prepare('PRAGMA table_info(expert_revisions)').all() as Array<{
    name: string;
    dflt_value: string | null;
  }>;
  expect(expertColumns.find((column) => column.name === 'reference_materials_json')).toMatchObject({
    dflt_value: "'[]'",
  });
  db.prepare('DELETE FROM experts WHERE id = ?').run('expert-1');
  expect(countRows(db, 'expert_revisions')).toBe(0);
  db.close();
});

it('adds task context revisions with ordered snapshots and task ownership', () => {
  const db = new Database(':memory:');
  migrate(db, { migrations: appMigrations });
  const now = 1_700_000_000_000;
  db.prepare(
    `INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('ws-context', '工作区', '/tmp/context', now, now);
  db.prepare(
    `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('task-context', 'ws-context', '月度经营报告', '形成本月报告', now, now);
  db.prepare(
    `INSERT INTO task_context_revisions (
       id, task_id, revision, executor_json, skill_bindings_json,
       model_reference_json, builtin_tool_policy_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'context-revision-1',
    'task-context',
    1,
    '{"kind":"general"}',
    '[{"skillId":"skill-a","revisionId":"revision-a","source":"task-selection"}]',
    null,
    '{"mode":"allow-list","toolNames":["calculator"]}',
    now,
    now,
  );
  expect(() =>
    db
      .prepare(
        `INSERT INTO task_context_revisions (
           id, task_id, revision, executor_json, skill_bindings_json,
           model_reference_json, builtin_tool_policy_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'context-revision-duplicate',
        'task-context',
        1,
        '{"kind":"general"}',
        '[]',
        null,
        null,
        now,
        now,
      ),
  ).toThrow('UNIQUE');
  db.prepare('DELETE FROM tasks WHERE id = ?').run('task-context');
  expect(countRows(db, 'task_context_revisions')).toBe(0);
  db.close();
});

describe('credentials table (CF10)', () => {
  const tableExists = (db: Database.Database, name: string): boolean =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined;
  const indexExists = (db: Database.Database, name: string): boolean =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) !==
    undefined;

  it('creates the credentials table with a unique owner/slot index on a fresh database', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    expect(tableExists(db, 'credentials')).toBe(true);
    expect(indexExists(db, 'idx_credentials_owner_slot')).toBe(true);
    // 清空态：ciphertext 可为 NULL，但身份/版本元数据保留
    expect(() =>
      db
        .prepare(
          `INSERT INTO credentials (id, owner_kind, owner_id, slot, ciphertext, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run('c-clear', 'mcp-connection', 'conn-1', 'env:TOKEN', 3, 1, 1),
    ).not.toThrow();
    db.close();
  });

  it('upgrades a v23 database with credentials and stays idempotent on re-run', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, 23) });
    expect(readSchemaVersion(db)).toBe(23);
    expect(tableExists(db, 'credentials')).toBe(false);

    migrate(db, { migrations: appMigrations });
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    expect(tableExists(db, 'credentials')).toBe(true);

    // 再跑一次不得重复建表或重复打版本戳
    migrate(db, { migrations: appMigrations });
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    const stamps = db
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 24')
      .get() as { count: number };
    expect(stamps.count).toBe(1);
    db.close();
  });
});

describe('credential migration journal (CF11)', () => {
  const seedModel = (db: Database.Database, id: string, apiKey: string, now: number): void => {
    db.prepare(
      `INSERT INTO model_profiles (id, name, provider, base_url, model, role, api_key, created_at, updated_at)
       VALUES (?, '模型', 'p', 'https://e.invalid/v1', 'm', 'language', ?, ?, ?)`,
    ).run(id, apiKey, now, now);
  };
  const journalStatuses = (db: Database.Database): Array<{ owner_id: string; status: string }> =>
    db
      .prepare('SELECT owner_id, status FROM credential_migration_journal ORDER BY owner_id')
      .all() as Array<{ owner_id: string; status: string }>;

  it('creates the journal and seeds pending only for rows that hold a plaintext key', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, 24) });
    const now = 1_700_000_000_000;
    seedModel(db, 'm-key', 'sk-live', now);
    seedModel(db, 'm-empty', '', now);
    db.prepare(
      "INSERT INTO search_engine_configs (provider, api_key, updated_at) VALUES ('baidu_qianfan', 'sk-search', ?)",
    ).run(now);

    migrate(db, { migrations: appMigrations });

    const modelEntries = db
      .prepare(
        "SELECT owner_id FROM credential_migration_journal WHERE owner_kind = 'model-profile'",
      )
      .all() as Array<{ owner_id: string }>;
    expect(modelEntries.map((entry) => entry.owner_id)).toEqual(['m-key']);
    const searchEntry = db
      .prepare(
        "SELECT status FROM credential_migration_journal WHERE owner_kind = 'api-service-profile'",
      )
      .get() as { status: string };
    expect(searchEntry.status).toBe('pending');
    db.close();
  });

  it('is idempotent: re-running v25 does not duplicate or resurrect migrated rows', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations.slice(0, 24) });
    seedModel(db, 'm-key', 'sk', 1);
    migrate(db, { migrations: appMigrations });
    // 模拟已迁移完成：手动标 done 后重建不应回到 pending
    db.prepare(
      "UPDATE credential_migration_journal SET status = 'done' WHERE owner_id = 'm-key'",
    ).run();
    expect(journalStatuses(db)).toEqual([{ owner_id: 'm-key', status: 'done' }]);
    // 再跑一次全量迁移（幂等），journal 不重复、不新增
    migrate(db, { migrations: appMigrations });
    expect(journalStatuses(db)).toEqual([{ owner_id: 'm-key', status: 'done' }]);
    db.close();
  });
});

/** WM02/WM05/WM09/WM12 之前的应用库最新形状（v25 = 凭据迁移日志）。 */
const WM_BASELINE = 25;

/** 契约 §5.1 的归一化：NFC → 换行统一 → 去首尾空白，然后取 UTF-8 的 SHA-256。 */
const normalizeMemory = (content: string): string =>
  content.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const normalizedHashOf = (content: string): string => sha256Hex(normalizeMemory(content));

/** 契约 §8.4：facet 只能按 kind 机械映射到其中唯一无歧义的那一个。 */
const EXPECTED_LEGACY_FACET: Record<string, string> = {
  semantic: 'fact',
  episodic: 'experience',
  procedural: 'method',
  preference: 'preference',
};

interface LegacyMemoryFixture {
  readonly revisionId: string;
  readonly id: string;
  readonly revision: number;
  readonly kind: 'semantic' | 'episodic' | 'procedural' | 'preference';
  readonly content: string;
  readonly sourceType: 'user-explicit' | 'conversation' | 'artifact' | 'reflection';
  readonly sourceId: string | null;
  readonly sourceLocator: string | null;
  readonly status: 'candidate' | 'confirmed' | 'superseded';
  readonly supersedesId: string | null;
}

/**
 * 迁移前就存在的记忆行。内容刻意包含契约 §13.1 的去重对照：
 * 「不得合并 / 可以合并」「10万元 / 100万元」必须算出不同哈希，
 * 只差换行与首尾空白的两条必须算出同一个哈希。
 */
const LEGACY_MEMORIES: readonly LegacyMemoryFixture[] = [
  {
    revisionId: 'mrev-a1',
    id: 'mem-a',
    revision: 1,
    kind: 'semantic',
    content: '本期续约率为82%。',
    sourceType: 'conversation',
    sourceId: 'src-a1',
    sourceLocator: '第 1 段',
    status: 'superseded',
    supersedesId: null,
  },
  {
    revisionId: 'mrev-a2',
    id: 'mem-a',
    revision: 2,
    kind: 'semantic',
    content: '收入按回款金额统计，不使用签约金额。',
    sourceType: 'user-explicit',
    sourceId: 'src-a2',
    sourceLocator: '第 3 段',
    status: 'confirmed',
    supersedesId: 'mrev-a1',
  },
  {
    revisionId: 'mrev-b1',
    id: 'mem-b',
    revision: 1,
    kind: 'episodic',
    content: '不得合并',
    sourceType: 'conversation',
    sourceId: null,
    sourceLocator: null,
    status: 'candidate',
    supersedesId: null,
  },
  {
    revisionId: 'mrev-c1',
    id: 'mem-c',
    revision: 1,
    kind: 'episodic',
    content: '可以合并',
    sourceType: 'reflection',
    sourceId: null,
    sourceLocator: null,
    status: 'candidate',
    supersedesId: null,
  },
  {
    revisionId: 'mrev-d1',
    id: 'mem-d',
    revision: 1,
    kind: 'procedural',
    content: '先给结论，再给依据。  \r\n',
    sourceType: 'user-explicit',
    sourceId: 'src-d1',
    sourceLocator: null,
    status: 'superseded',
    supersedesId: null,
  },
  {
    revisionId: 'mrev-d2',
    id: 'mem-d',
    revision: 2,
    kind: 'procedural',
    content: '先给结论，再给依据。',
    sourceType: 'user-explicit',
    sourceId: 'src-d1',
    sourceLocator: null,
    status: 'confirmed',
    supersedesId: 'mrev-d1',
  },
  {
    revisionId: 'mrev-e1',
    id: 'mem-e',
    revision: 1,
    kind: 'preference',
    content: '预算上限 10万元',
    sourceType: 'artifact',
    sourceId: 'src-e1',
    sourceLocator: 'v1',
    status: 'confirmed',
    supersedesId: null,
  },
  {
    revisionId: 'mrev-f1',
    id: 'mem-f',
    revision: 1,
    kind: 'preference',
    content: '预算上限 100万元',
    sourceType: 'artifact',
    sourceId: null,
    sourceLocator: null,
    status: 'confirmed',
    supersedesId: null,
  },
];

const LEGACY_MEMORY_COLUMNS = `
  revision_id, id, revision, scope_kind, scope_id, expert_id, workspace_id,
  kind, content, source_type, source_id, source_locator, confidence, status,
  valid_from, valid_until, supersedes_id, content_hash, created_at, updated_at
`;

/** 造出 v25 形状的世界：一条被运行引用过的记忆链，加上没有来源可证的旧记忆。 */
const seedLegacyMemoryWorld = (db: Database.Database): void => {
  seedLegacyWork(db);
  const insert = db.prepare(
    `INSERT INTO memory_records (${LEGACY_MEMORY_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const memory of LEGACY_MEMORIES) {
    insert.run(
      memory.revisionId,
      memory.id,
      memory.revision,
      'workspace',
      'ws-1',
      null,
      'ws-1',
      memory.kind,
      memory.content,
      memory.sourceType,
      memory.sourceId,
      memory.sourceLocator,
      0.8,
      memory.status,
      null,
      null,
      memory.supersedesId,
      `legacy-hash-${memory.revisionId}`,
      1_700_000_000_000,
      1_700_000_000_000,
    );
  }
  // 旧写入路径只登记实际注入的记忆，且不记录任何请求阶段（§2.2 风险 4）。
  db.prepare(
    `INSERT INTO run_memory_reads (id, run_id, memory_id, memory_revision_id, content_hash, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('rmr-1', 'run-1', 'mem-a', 'mrev-a2', 'legacy-hash-mrev-a2', 1_700_000_000_500);
};

/** 升级前后都必须逐字保留的历史事实。 */
const legacyFacts = (db: Database.Database): unknown[] =>
  db.prepare(`SELECT ${LEGACY_MEMORY_COLUMNS} FROM memory_records ORDER BY revision_id`).all();

const readFacts = (db: Database.Database): unknown[] =>
  db
    .prepare(
      `SELECT id, run_id, memory_id, memory_revision_id, content_hash, captured_at
         FROM run_memory_reads ORDER BY id`,
    )
    .all();

const indexNames = (db: Database.Database): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);

/** 迁移后的记忆写入必须自带治理列：没有可伪造的默认值。 */
const insertGovernedMemory = (
  db: Database.Database,
  memory: {
    revisionId: string;
    id: string;
    revision?: number;
    kind?: string;
    facet?: string;
    content?: string;
    status?: string;
    topicKey?: string | null;
    normalizedHash?: string;
    provenanceJson?: string;
    candidateDisposition?: string | null;
    replacesRevisionId?: string | null;
  },
): void => {
  const content = memory.content ?? '收入按回款金额统计，不使用签约金额。';
  db.prepare(
    `INSERT INTO memory_records (
       revision_id, id, revision, scope_kind, scope_id, kind, facet, topic_key,
       normalized_hash, provenance_json, candidate_disposition, replaces_revision_id,
       content, source_type, confidence, status, content_hash, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    memory.revisionId,
    memory.id,
    memory.revision ?? 1,
    'workspace',
    'ws-1',
    memory.kind ?? 'semantic',
    memory.facet ?? 'fact',
    memory.topicKey ?? null,
    memory.normalizedHash ?? normalizedHashOf(content),
    memory.provenanceJson ??
      JSON.stringify({
        schemaVersion: 1,
        verification: 'legacy-unverified',
        sourceType: 'user-explicit',
      }),
    memory.candidateDisposition ?? null,
    memory.replacesRevisionId ?? null,
    content,
    'user-explicit',
    0.9,
    memory.status ?? 'confirmed',
    sha256Hex(content),
    1,
    1,
  );
};

const insertRead = (
  db: Database.Database,
  read: {
    id: string;
    runId: string;
    memoryId: string;
    memoryRevisionId: string;
    selectedForInjection: number;
    provenanceState: string;
  },
): void => {
  db.prepare(
    `INSERT INTO run_memory_reads (
       id, run_id, memory_id, memory_revision_id, content_hash, captured_at,
       selected_for_injection, replayed_via_run_ids_json, provenance_state
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).run(
    read.id,
    read.runId,
    read.memoryId,
    read.memoryRevisionId,
    'hash-1',
    2,
    read.selectedForInjection,
    read.provenanceState,
  );
};

const RUN_MEMORY_CONTEXT_INSERT = `INSERT INTO run_memory_contexts (
  run_id, schema_version, phase, recall_version, evaluated_at, query_hash,
  policy_snapshot_json, selected_items_json, replay_json,
  material_dependency_union_json, memory_dependency_union_json, decision_summary_json,
  authorization_hash, model_snapshot_json, request_hash,
  selected_at, request_prepared_at, dispatch_attempted_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * 契约 §8.4 要求「每批真实 SQLite 验证」：WM02/WM05/WM09/WM12 四个批次各自都要
 * 单独走一遍「从上一版本升级」与「失败回滚」，不能只让 WM02 一批代表全部。
 * 每批点名的表与收紧列就是该批落库的全部结构变更，回滚后必须一样都不留下。
 */
interface WmSchemaBatch {
  readonly version: number;
  readonly tables: readonly string[];
  readonly columns: readonly { readonly table: string; readonly column: string }[];
}

const WM_BATCHES: readonly WmSchemaBatch[] = [
  {
    version: 26,
    tables: ['memory_operations', 'memory_conflict_decisions'],
    columns: [
      { table: 'memory_records', column: 'facet' },
      { table: 'memory_records', column: 'normalized_hash' },
      { table: 'memory_records', column: 'provenance_json' },
      { table: 'memory_records', column: 'replaces_revision_id' },
    ],
  },
  {
    version: 27,
    tables: ['run_memory_contexts'],
    columns: [
      { table: 'run_memory_reads', column: 'selected_for_injection' },
      { table: 'run_memory_reads', column: 'replayed_via_run_ids_json' },
      { table: 'run_memory_reads', column: 'provenance_state' },
    ],
  },
  { version: 28, tables: ['workspace_memory_settings', 'memory_extraction_jobs'], columns: [] },
  { version: 29, tables: ['workspace_artifact_references'], columns: [] },
];

describe('work-centered memory schema (WM02/WM05/WM09/WM12)', () => {
  it('builds governance tables, columns and indexes on a fresh database', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    for (const table of [
      'memory_operations',
      'memory_conflict_decisions',
      'run_memory_contexts',
      'workspace_memory_settings',
      'memory_extraction_jobs',
      'workspace_artifact_references',
    ]) {
      expect(hasTable(db, table), table).toBe(true);
    }
    for (const column of [
      'facet',
      'topic_key',
      'normalized_hash',
      'provenance_json',
      'candidate_disposition',
      'replaces_revision_id',
    ]) {
      expect(hasColumn(db, 'memory_records', column), column).toBe(true);
    }
    for (const column of [
      'selected_for_injection',
      'replayed_via_run_ids_json',
      'provenance_state',
    ]) {
      expect(hasColumn(db, 'run_memory_reads', column), column).toBe(true);
    }
    expect(indexNames(db)).toEqual(
      expect.arrayContaining([
        'idx_memory_records_latest',
        'idx_memory_records_scope',
        'idx_memory_records_scope_hash',
        'idx_memory_records_topic_key',
        'idx_run_memory_reads_run',
        'idx_memory_conflict_decisions_left',
        'idx_memory_conflict_decisions_right',
        'idx_memory_conflict_decisions_winner',
        'idx_memory_extraction_jobs_status',
        'idx_workspace_artifact_references_active',
      ]),
    );
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('refuses to invent governance facts for rows written after the migration', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    seedLegacyWork(db);
    // 缺 normalized_hash / provenance_json / facet 的记忆写入不再有可能。
    expect(() =>
      db
        .prepare(
          `INSERT INTO memory_records (
             revision_id, id, revision, scope_kind, scope_id, kind, content,
             source_type, confidence, status, content_hash, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'mrev-x',
          'mem-x',
          1,
          'workspace',
          'ws-1',
          'semantic',
          '内容',
          'user-explicit',
          1,
          'confirmed',
          'h',
          1,
          1,
        ),
    ).toThrow(/NOT NULL/iu);
    // 运行读取必须自己声明请求阶段；历史重放来源是显式数组而不是猜测。
    insertGovernedMemory(db, { revisionId: 'mrev-x', id: 'mem-x' });
    expect(() =>
      db
        .prepare(
          `INSERT INTO run_memory_reads (
             id, run_id, memory_id, memory_revision_id, content_hash, captured_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('rmr-x', 'run-1', 'mem-x', 'mrev-x', 'h', 1),
    ).toThrow(/NOT NULL/iu);
    db.close();
  });

  it('keeps every legacy memory fact and backfills only what is mechanically derivable', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, WM_BASELINE) });
    seedLegacyMemoryWorld(db);
    const memoriesBefore = legacyFacts(db);

    migrate(db, { migrations: appMigrations });

    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    // id、revision、status、content、来源三字段与两个时间戳逐字保留。
    expect(legacyFacts(db)).toEqual(memoriesBefore);
    const rows = db
      .prepare(
        `SELECT revision_id, kind, content, facet, topic_key, normalized_hash, provenance_json,
                candidate_disposition, replaces_revision_id, source_type, source_id, source_locator
           FROM memory_records ORDER BY revision_id`,
      )
      .all() as Array<{
      revision_id: string;
      kind: string;
      content: string;
      facet: string;
      topic_key: string | null;
      normalized_hash: string;
      provenance_json: string;
      candidate_disposition: string | null;
      replaces_revision_id: string | null;
      source_type: string;
      source_id: string | null;
      source_locator: string | null;
    }>;
    expect(rows).toHaveLength(LEGACY_MEMORIES.length);
    for (const row of rows) {
      expect(row.facet).toBe(EXPECTED_LEGACY_FACET[row.kind]);
      expect(row.topic_key).toBeNull();
      expect(row.candidate_disposition).toBeNull();
      expect(row.replaces_revision_id).toBeNull();
      expect(row.normalized_hash).toBe(normalizedHashOf(row.content));
      expect(row.normalized_hash).toHaveLength(64);
      const provenance = JSON.parse(row.provenance_json) as Record<string, unknown>;
      expect(provenance).toEqual({
        schemaVersion: 1,
        verification: 'legacy-unverified',
        sourceType: row.source_type,
        ...(row.source_id === null ? {} : { sourceId: row.source_id }),
        ...(row.source_locator === null ? {} : { sourceLocator: row.source_locator }),
      });
    }
    // 不补造捕获时间、来源清单与确认人（§8.4）。
    for (const row of rows) {
      const provenance = JSON.parse(row.provenance_json) as Record<string, unknown>;
      expect(Object.keys(provenance)).not.toContain('capturedAt');
      expect(Object.keys(provenance)).not.toContain('sources');
      expect(Object.keys(provenance)).not.toContain('authority');
    }
    // 去重控制：数字/否定词差异必须分得开，换行与首尾空白差异必须合得上。
    const hashOf = (revisionId: string): string =>
      rows.find((row) => row.revision_id === revisionId)?.normalized_hash ?? '';
    expect(hashOf('mrev-b1')).not.toBe(hashOf('mrev-c1'));
    expect(hashOf('mrev-e1')).not.toBe(hashOf('mrev-f1'));
    expect(hashOf('mrev-d1')).toBe(hashOf('mrev-d2'));
    db.close();
  });

  it('marks legacy run memory reads as unknown provenance without inventing send facts', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, WM_BASELINE) });
    seedLegacyMemoryWorld(db);
    const readsBefore = readFacts(db);

    migrate(db, { migrations: appMigrations });

    expect(readFacts(db)).toEqual(readsBefore);
    const read = db
      .prepare(
        `SELECT provenance_state, selected_for_injection, replayed_via_run_ids_json, captured_at
           FROM run_memory_reads WHERE id = 'rmr-1'`,
      )
      .get() as {
      provenance_state: string;
      selected_for_injection: number;
      replayed_via_run_ids_json: string;
      captured_at: number;
    };
    expect(read.provenance_state).toBe('legacy_unknown');
    expect(read.selected_for_injection).toBe(1);
    expect(read.replayed_via_run_ids_json).toBe('[]');
    expect(read.captured_at).toBe(1_700_000_000_500);
    // 请求哈希不属于旧读取记录：这一列在 run_memory_reads 上根本不存在。
    expect(hasColumn(db, 'run_memory_reads', 'request_hash')).toBe(false);
    // 重建后外键依然有效：被引用的记忆修订不能静默删除。
    expect(() =>
      db.prepare('DELETE FROM memory_records WHERE revision_id = ?').run('mrev-a2'),
    ).toThrow(/FOREIGN KEY/iu);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('is idempotent: reopening an upgraded database changes nothing', () => {
    const file = path.join(temporaryDirectory(), 'work-centered-memory.sqlite');
    const first = new Database(file);
    first.pragma('journal_mode = WAL');
    first.pragma('foreign_keys = ON');
    migrate(first, { migrations: appMigrations.slice(0, WM_BASELINE) });
    seedLegacyMemoryWorld(first);
    first.close();

    const db = openAppDatabase(file);
    const snapshot = (): unknown => ({
      version: readSchemaVersion(db),
      schema: db
        .prepare(
          'SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name',
        )
        .all(),
      memories: countRows(db, 'memory_records'),
      operations: countRows(db, 'memory_operations'),
      stamps: countRows(db, 'schema_migrations'),
    });
    const before = snapshot();
    migrate(db, { migrations: appMigrations });
    expect(snapshot()).toEqual(before);
    db.close();

    const reopened = openAppDatabase(file);
    expect(readSchemaVersion(reopened)).toBe(appMigrations.length);
    expect(countRows(reopened, 'memory_records')).toBe(LEGACY_MEMORIES.length);
    expect(countRows(reopened, 'run_memory_reads')).toBe(1);
    reopened.close();
  });

  it('rolls back a failing WM02 batch without leaving a partial schema', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, { migrations: appMigrations.slice(0, WM_BASELINE) });
    seedLegacyMemoryWorld(db);
    const memoriesBefore = legacyFacts(db);
    const governance = migrationOf(appMigrations, WM_BASELINE + 1);
    const failing: Migration[] = [
      ...appMigrations.slice(0, WM_BASELINE),
      {
        version: WM_BASELINE + 1,
        name: 'wm02 that fails after the DDL',
        up(database): void {
          governance.up(database);
          throw new Error('forced WM02 failure');
        },
      },
    ];

    expect(() => migrate(db, { migrations: failing })).toThrow(/forced WM02 failure/u);

    expect(readSchemaVersion(db)).toBe(WM_BASELINE);
    expect(hasTable(db, 'memory_operations')).toBe(false);
    expect(hasTable(db, 'memory_conflict_decisions')).toBe(false);
    expect(hasColumn(db, 'memory_records', 'facet')).toBe(false);
    expect(hasColumn(db, 'memory_records', 'normalized_hash')).toBe(false);
    expect(legacyFacts(db)).toEqual(memoriesBefore);
    expect(indexNames(db)).not.toContain('idx_memory_records_scope_hash');
    db.close();
  });

  for (const batch of WM_BATCHES) {
    it(`upgrades v${batch.version - 1} to v${batch.version} in one step without touching legacy facts`, () => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      // 历史数据只在 v25 形状下种下：那才是「迁移之前就已存在」的库。
      migrate(db, { migrations: appMigrations.slice(0, WM_BASELINE) });
      seedLegacyMemoryWorld(db);
      migrate(db, { migrations: appMigrations.slice(0, batch.version - 1) });
      // 起点必须是紧邻的上一版本：跳迁移在这一步就会露馅。
      expect(readSchemaVersion(db)).toBe(batch.version - 1);
      const factsBefore = legacyFacts(db);

      migrate(db, { migrations: appMigrations.slice(0, batch.version) });

      expect(readSchemaVersion(db)).toBe(batch.version);
      expect(legacyFacts(db)).toEqual(factsBefore);
      expect(countRows(db, 'memory_records')).toBe(LEGACY_MEMORIES.length);
      for (const table of batch.tables) {
        expect(hasTable(db, table), table).toBe(true);
      }
      for (const column of batch.columns) {
        expect(hasColumn(db, column.table, column.column), `${column.table}.${column.column}`).toBe(
          true,
        );
      }
      // 迁移不写业务事实：治理表建出来时必须是空的，历史也没有被回填成回执。
      if (hasTable(db, 'memory_operations')) expect(countRows(db, 'memory_operations')).toBe(0);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      db.close();
    });

    it(`rolls back a failing v${batch.version} batch without leaving its tables or columns`, () => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      // 同上：数据落在 v25 形状上，被测批次是唯一没走通的那一步。
      migrate(db, { migrations: appMigrations.slice(0, WM_BASELINE) });
      seedLegacyMemoryWorld(db);
      migrate(db, { migrations: appMigrations.slice(0, batch.version - 1) });
      const factsBefore = legacyFacts(db);
      const step = migrationOf(appMigrations, batch.version);
      const failing: Migration[] = [
        ...appMigrations.slice(0, batch.version - 1),
        {
          version: batch.version,
          name: `v${batch.version} that fails after the DDL`,
          up(database): void {
            step.up(database);
            throw new Error(`forced v${batch.version} failure`);
          },
        },
      ];

      expect(() => migrate(db, { migrations: failing })).toThrow(
        `forced v${batch.version} failure`,
      );

      expect(readSchemaVersion(db)).toBe(batch.version - 1);
      for (const table of batch.tables) {
        expect(hasTable(db, table), table).toBe(false);
      }
      for (const column of batch.columns) {
        expect(hasColumn(db, column.table, column.column), `${column.table}.${column.column}`).toBe(
          false,
        );
      }
      expect(legacyFacts(db)).toEqual(factsBefore);
      db.close();
    });
  }

  it('binds conflict decisions to exact revisions and receipts', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    seedLegacyWork(db);
    insertGovernedMemory(db, { revisionId: 'mrev-left', id: 'mem-left', topicKey: '收入口径' });
    insertGovernedMemory(db, { revisionId: 'mrev-right', id: 'mem-right', topicKey: '收入口径' });
    insertGovernedMemory(db, { revisionId: 'mrev-third', id: 'mem-third', topicKey: '收入口径' });
    const insertOperation = db.prepare(
      `INSERT INTO memory_operations (operation_id, operation_kind, request_hash, result_json, committed_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insertOperation.run('op-1', 'resolve-conflict', 'req-1', '{"effect":"updated"}', 1);
    insertOperation.run('op-2', 'resolve-conflict', 'req-2', '{"effect":"updated"}', 2);
    const insertDecision = db.prepare(
      `INSERT INTO memory_conflict_decisions (
         id, operation_id, left_revision_id, right_revision_id, decision,
         winner_revision_id, applicability_note, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const keepBoth = (id: string, operationId: string, left: string, right: string): void => {
      insertDecision.run(
        id,
        operationId,
        left,
        right,
        'keep-both',
        null,
        '含税口径只用于季度对外报告',
        1,
      );
    };
    keepBoth('cd-1', 'op-1', 'mrev-left', 'mrev-right');
    // 左右必须按修订身份规范排序：反序落库被 CHECK 拒绝，同一对只有一种形状。
    expect(() => keepBoth('cd-2', 'op-1', 'mrev-right', 'mrev-left')).toThrow(/CHECK constraint/iu);
    // 一个操作回执只能挂一条裁决。
    expect(() => keepBoth('cd-3', 'op-1', 'mrev-left', 'mrev-right')).toThrow(/UNIQUE/iu);
    // 裁决必须挂在真实回执与真实修订上：回执外键与两个修订列的外键都要各自成立。
    // 幽灵修订必须落在规范顺序的位置上，否则先被「左右必须规范排序」的 CHECK 挡下，
    // 断言读到的就是另一个约束（§8.2 两个约束都要求，各自单独验才不互相掩盖）。
    expect(() => keepBoth('cd-4', 'op-ghost', 'mrev-left', 'mrev-right')).toThrow(/FOREIGN KEY/iu);
    expect(() => keepBoth('cd-ghost-left', 'op-2', 'mrev-aaa-ghost', 'mrev-left')).toThrow(
      /FOREIGN KEY/iu,
    );
    expect(() => keepBoth('cd-ghost-right', 'op-2', 'mrev-right', 'mrev-zzz-ghost')).toThrow(
      /FOREIGN KEY/iu,
    );
    // keep-both 必须给出适用条件；replace 必须给出属于这一对的胜出修订。
    expect(() =>
      insertDecision.run('cd-6', 'op-2', 'mrev-left', 'mrev-right', 'keep-both', null, null, 1),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      insertDecision.run('cd-7', 'op-2', 'mrev-left', 'mrev-right', 'replace', null, null, 1),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      insertDecision.run(
        'cd-8',
        'op-2',
        'mrev-left',
        'mrev-right',
        'replace',
        'mrev-third',
        null,
        1,
      ),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      insertDecision.run(
        'cd-9',
        'op-2',
        'mrev-left',
        'mrev-right',
        'replace',
        'mrev-right',
        null,
        1,
      ),
    ).not.toThrow();
    // 改判必须同时改掉配套字段，不允许只翻 decision 留下悬空的条件。
    expect(() =>
      db
        .prepare("UPDATE memory_conflict_decisions SET decision = 'replace' WHERE id = 'cd-1'")
        .run(),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare('UPDATE memory_conflict_decisions SET applicability_note = NULL WHERE id = ?')
        .run('cd-1'),
    ).toThrow(/CHECK constraint/iu);
    // 被裁决引用的修订与回执都删不掉（§8.3 RESTRICT）。
    expect(() =>
      db.prepare('DELETE FROM memory_records WHERE revision_id = ?').run('mrev-left'),
    ).toThrow(/FOREIGN KEY/iu);
    expect(() =>
      db.prepare('DELETE FROM memory_operations WHERE operation_id = ?').run('op-1'),
    ).toThrow(/FOREIGN KEY/iu);
    db.prepare('DELETE FROM memory_conflict_decisions WHERE id = ?').run('cd-1');
    expect(() =>
      db.prepare('DELETE FROM memory_records WHERE revision_id = ?').run('mrev-left'),
    ).toThrow(/FOREIGN KEY/iu);
    db.prepare('DELETE FROM memory_conflict_decisions').run();
    expect(() =>
      db.prepare('DELETE FROM memory_records WHERE revision_id = ?').run('mrev-left'),
    ).not.toThrow();
    expect(() =>
      db.prepare('DELETE FROM memory_operations WHERE operation_id = ?').run('op-1'),
    ).not.toThrow();
    db.close();
  });

  it('rejects contradictory governance fields on new memory revisions', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    seedLegacyWork(db);
    insertGovernedMemory(db, { revisionId: 'mrev-ok', id: 'mem-ok' });
    // 修订表按身份追加：同一 id 的两行必须并存（精确引用落在 revision_id 上，§8.1），
    // 但同一 (id, revision) 落不进第二行——追加式的修订链全靠这条唯一约束把守。
    insertGovernedMemory(db, { revisionId: 'mrev-ok-2', id: 'mem-ok', revision: 2 });
    expect(() =>
      insertGovernedMemory(db, { revisionId: 'mrev-ok-dup', id: 'mem-ok', revision: 2 }),
    ).toThrow(/UNIQUE/iu);
    // facet 必须由 kind 推出：semantic 不能写 method。
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-bad-facet',
        id: 'mem-bad-facet',
        facet: 'method',
      }),
    ).toThrow(/CHECK constraint/iu);
    // 「暂不采用」只属于 candidate。
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-bad-disposition',
        id: 'mem-bad-disposition',
        status: 'confirmed',
        candidateDisposition: 'rejected',
      }),
    ).toThrow(/CHECK constraint/iu);
    insertGovernedMemory(db, {
      revisionId: 'mrev-candidate',
      id: 'mem-candidate',
      status: 'candidate',
      candidateDisposition: 'rejected',
    });
    // 去重键必须是真摘要，来源必须是 JSON，议题键不得超长。
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-bad-hash',
        id: 'mem-bad-hash',
        normalizedHash: 'not-a-digest',
      }),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-bad-json',
        id: 'mem-bad-json',
        provenanceJson: '{',
      }),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-bad-topic',
        id: 'mem-bad-topic',
        topicKey: '议'.repeat(81),
      }),
    ).toThrow(/CHECK constraint/iu);
    // 跨记录替代指向精确修订，且不能指向自己。
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-replaces',
        id: 'mem-replaces',
        replacesRevisionId: 'mrev-ghost',
      }),
    ).toThrow(/FOREIGN KEY/iu);
    expect(() =>
      db
        .prepare('UPDATE memory_records SET replaces_revision_id = revision_id WHERE id = ?')
        .run('mem-ok'),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      insertGovernedMemory(db, {
        revisionId: 'mrev-replaces',
        id: 'mem-replaces',
        replacesRevisionId: 'mrev-ok',
      }),
    ).not.toThrow();
    expect(() =>
      db.prepare('DELETE FROM memory_records WHERE revision_id = ?').run('mrev-ok'),
    ).toThrow(/FOREIGN KEY/iu);
    db.close();
  });

  it('records one run memory context per run and keeps phases honest', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    seedLegacyWork(db);
    insertGovernedMemory(db, { revisionId: 'mrev-run', id: 'mem-run' });
    const insertContext = db.prepare(RUN_MEMORY_CONTEXT_INSERT);
    const insertSelectedContext = (): void => {
      insertContext.run(
        'run-1',
        1,
        'selected',
        'memory-recall-v1',
        1,
        'query-1',
        '{"recallVersion":"memory-recall-v1","budget":6000}',
        '[{"memoryId":"mem-run","revisionId":"mrev-run","hash":"h","order":1,"score":500,"reason":"match"}]',
        '[]',
        '[]',
        '[{"memoryId":"mem-run","revisionId":"mrev-run","hash":"h"}]',
        '{"excluded":{}}',
        'auth-1',
        null,
        null,
        1,
        null,
        null,
        1,
      );
    };
    insertSelectedContext();
    // 一次运行只有一份记忆决策快照：run_id 是主键。
    expect(insertSelectedContext).toThrow(/UNIQUE|PRIMARY KEY/iu);
    // 阶段没推进就不许留下请求哈希或阶段时间。
    expect(() =>
      db
        .prepare('UPDATE run_memory_contexts SET request_hash = ? WHERE run_id = ?')
        .run('r-1', 'run-1'),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare('UPDATE run_memory_contexts SET dispatch_attempted_at = ? WHERE run_id = ?')
        .run(5, 'run-1'),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare('UPDATE run_memory_contexts SET phase = ? WHERE run_id = ?')
        .run('queued', 'run-1'),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare('UPDATE run_memory_contexts SET request_prepared_at = ? WHERE run_id = ?')
        .run(0, 'run-1'),
    ).toThrow(/CHECK constraint/iu);
    insertRead(db, {
      id: 'rmr-new',
      runId: 'run-1',
      memoryId: 'mem-run',
      memoryRevisionId: 'mrev-run',
      selectedForInjection: 1,
      provenanceState: 'known',
    });
    expect(() =>
      insertRead(db, {
        id: 'rmr-new-2',
        runId: 'run-1',
        memoryId: 'mem-run',
        memoryRevisionId: 'mrev-run',
        selectedForInjection: 1,
        provenanceState: 'known',
      }),
    ).toThrow(/UNIQUE/iu);
    db.prepare('DELETE FROM runs WHERE id = ?').run('run-1');
    expect(countRows(db, 'run_memory_contexts')).toBe(0);
    expect(countRows(db, 'run_memory_reads')).toBe(0);
    // 审计删完后，被引用的修订才可以被清理。
    expect(() =>
      db.prepare('DELETE FROM memory_records WHERE revision_id = ?').run('mrev-run'),
    ).not.toThrow();
    db.close();
  });

  it('keeps auto-suggest off by default and validates extraction jobs', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    seedLegacyWork(db);
    db.prepare(
      `INSERT INTO workspace_memory_settings (workspace_id, revision, updated_at) VALUES (?, ?, ?)`,
    ).run('ws-1', 1, 1);
    expect(
      db
        .prepare(
          'SELECT auto_suggest_enabled FROM workspace_memory_settings WHERE workspace_id = ?',
        )
        .get('ws-1'),
    ).toEqual({ auto_suggest_enabled: 0 });
    expect(() =>
      db
        .prepare(
          `INSERT INTO workspace_memory_settings (
             workspace_id, revision, auto_suggest_enabled, updated_at
           ) VALUES (?, ?, 1, ?)`,
        )
        .run('ws-2', 1, 1),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare(
          `UPDATE workspace_memory_settings
              SET auto_suggest_enabled = 1, consent_version = '3', consented_at = 2 WHERE workspace_id = ?`,
        )
        .run('ws-1'),
    ).not.toThrow();

    const insertJob = db.prepare(
      `INSERT INTO memory_extraction_jobs (
         id, source_key, workspace_id, task_id, run_id, source_snapshot_json, source_version_hash,
         trigger, status, revision, attempt, input_code_points, output_code_points,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertJob.run(
      'job-1',
      'run:run-1:hash-1',
      'ws-1',
      'task-1',
      'run-1',
      '{"fragments":[]}',
      'hash-1',
      'automatic',
      'queued',
      1,
      1,
      0,
      0,
      1,
      1,
    );
    expect(() =>
      insertJob.run(
        'job-2',
        'run:run-1:hash-1',
        'ws-1',
        'task-1',
        'run-1',
        '{}',
        'hash-1',
        'automatic',
        'queued',
        1,
        1,
        0,
        0,
        1,
        1,
      ),
    ).toThrow(/UNIQUE/iu);
    const jobStatus = db.prepare('UPDATE memory_extraction_jobs SET status = ? WHERE id = ?');
    expect(() => jobStatus.run('done', 'job-1')).toThrow(/CHECK constraint/iu);
    expect(() =>
      db.prepare('UPDATE memory_extraction_jobs SET trigger = ? WHERE id = ?').run('auto', 'job-1'),
    ).toThrow(/CHECK constraint/iu);
    // 成功的作业不得带错误码，也没人能给「已提交」的幂等回执改名。
    expect(() =>
      db
        .prepare(
          `UPDATE memory_extraction_jobs
              SET status = 'succeeded', finished_at = 3, started_at = 2, error_code = 'TIMEOUT'
            WHERE id = ?`,
        )
        .run('job-1'),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare(
          `UPDATE memory_extraction_jobs
              SET status = 'failed', finished_at = 3, started_at = 2, error_code = 'MODEL_UNAVAILABLE'
            WHERE id = ?`,
        )
        .run('job-1'),
    ).not.toThrow();
    // 运行审计子表随 Run CASCADE；没有引用的工作区照旧可删。
    db.prepare('DELETE FROM runs WHERE id = ?').run('run-1');
    expect(countRows(db, 'memory_extraction_jobs')).toBe(0);
    db.prepare('DELETE FROM workspace_memory_settings WHERE workspace_id = ?').run('ws-1');
    db.prepare('DELETE FROM memory_extraction_jobs WHERE id = ?').run('job-1');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');
    expect(countRows(db, 'workspace_memory_settings')).toBe(0);
    db.close();
  });

  it('pins workspace references to exact versions and blocks silent loss', () => {
    const db = new Database(':memory:');
    migrate(db, { migrations: appMigrations });
    seedLegacyWork(db);
    const now = 1_700_000_000_000;
    db.prepare(
      'INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('ws-2', '市场研究', '/tmp/ws-2', now, now);
    const insertReference = db.prepare(
      `INSERT INTO workspace_artifact_references (
         id, workspace_id, artifact_version_id, content_hash, label, status, revision, selected_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    );
    // 参考标记只表达「用户指定这一版」，跨空间由服务层用 REFERENCE_WORKSPACE_MISMATCH 把关。
    insertReference.run('ref-1', 'ws-2', 'ver-1', 'h2', null, 1, now, now);
    expect(() => insertReference.run('ref-2', 'ws-2', 'ver-1', 'h2', null, 1, now, now)).toThrow(
      /UNIQUE/iu,
    );
    expect(() =>
      insertReference.run('ref-3', 'ws-2', 'ver-ghost', 'h3', null, 1, now, now),
    ).toThrow(/FOREIGN KEY/iu);
    expect(() =>
      insertReference.run('ref-4', 'ws-ghost', 'ver-1', 'h4', null, 1, now, now),
    ).toThrow(/FOREIGN KEY/iu);
    expect(() =>
      insertReference.run('ref-5', 'ws-2', 'ver-1', 'h5', '标'.repeat(121), 1, now, now),
    ).toThrow(/CHECK constraint/iu);
    expect(() =>
      db
        .prepare('UPDATE workspace_artifact_references SET status = ? WHERE id = ?')
        .run('archived', 'ref-1'),
    ).toThrow(/CHECK constraint/iu);
    // active≤20 无法用 CHECK 表达（SQLite 不允许子查询，本仓库也不用 trigger）：
    // 建 21 个版本一次插满，DDL 放行，上限由 workspace-reference-repository 在同一事务里统计。
    for (let version = 2; version <= 21; version += 1) {
      db.prepare(
        `INSERT INTO artifact_versions (id, artifact_id, version_number, content, content_hash, source_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(`ver-${version}`, 'art-1', version, `# 第 ${version} 版`, `h${version}`, 'run-1', now);
      insertReference.run(
        `ref-a${version}`,
        'ws-1',
        `ver-${version}`,
        `h${version}`,
        null,
        1,
        now,
        now,
      );
    }
    expect(countRows(db, 'workspace_artifact_references')).toBe(21);
    // 被另一空间参考标记绑定的版本，其 owner 工作区删不掉（§8.3 不得静默级联清除历史）。
    expect(() => db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1')).toThrow(
      /FOREIGN KEY/iu,
    );
    expect(() => db.prepare('DELETE FROM artifacts WHERE id = ?').run('art-1')).toThrow(
      /FOREIGN KEY/iu,
    );
    // 标记随自己的空间消失；失去引用后父对象删除行为回到原样。
    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-2');
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM workspace_artifact_references WHERE workspace_id = ?',
        )
        .get('ws-2'),
    ).toEqual({ count: 0 });
    db.prepare('DELETE FROM workspace_artifact_references WHERE workspace_id = ?').run('ws-1');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');
    expect(countRows(db, 'artifact_versions')).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });
});
