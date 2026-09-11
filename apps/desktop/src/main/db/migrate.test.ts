import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { appMigrations, openAppDatabase, openKnowledgeDatabase } from './index';
import { knowledgeMigrations } from './knowledge-schema';
import { migrate, type Migration, readSchemaVersion } from './migrate';

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

    // 分块外键生效：删文档带走分块
    db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run('doc-1');
    expect(countRows(db, 'knowledge_chunks')).toBe(0);
    db.close();
  });
});

it('migrates v7 to v8 without inventing verified outputs or losing Markdown versions', () => {
  const file = path.join(temporaryDirectory(), 'v7.sqlite');
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  migrate(db, { migrations: appMigrations.filter((migration) => migration.version <= 7) });
  seedLegacyWork(db);
  migrate(db, { migrations: appMigrations });
  expect(readSchemaVersion(db)).toBe(8);
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
