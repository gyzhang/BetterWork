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

describe('application database migrations', () => {
  it('builds the current schema from scratch and enforces foreign keys', () => {
    const file = path.join(temporaryDirectory(), 'fresh.sqlite');
    const db = openAppDatabase(file);
    expect(readSchemaVersion(db)).toBe(appMigrations.length);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

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
