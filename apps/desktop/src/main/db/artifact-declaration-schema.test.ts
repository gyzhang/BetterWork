import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { appMigrations } from './app-schema';
import { migrate, readSchemaVersion } from './migrate';

/**
 * KM05（契约 §6.1、§13.2）：v32 给每个成果版本补声明种类，
 * 迁移前已有输入关系的版本只能被标成 legacy（历史关联，不等于采用），
 * 同时建立 Run 级声明账本，随运行删除一起清理。
 */
const stores: Database.Database[] = [];
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});

const throughVersion = (upto: number): Database.Database => {
  const db = new Database(':memory:');
  stores.push(db);
  db.pragma('foreign_keys = ON');
  migrate(db, { migrations: appMigrations.filter((item) => item.version <= upto) });
  expect(readSchemaVersion(db)).toBe(upto);
  db.prepare(
    `INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
     VALUES ('w1', 'w', '/tmp/w1', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
     VALUES ('t1', 'w1', '任务', '目标', 1, 1)`,
  ).run();
  db.prepare(`INSERT INTO sessions (id, task_id, created_at) VALUES ('s1', 't1', 1)`).run();
  db.prepare(
    `INSERT INTO runs (id, task_id, session_id, prompt, status, created_at)
     VALUES ('r1', 't1', 's1', 'p', 'completed', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO artifacts (id, workspace_id, task_id, type, title, current_version_id, created_at, updated_at)
     VALUES ('a1', 'w1', 't1', 'markdown', '成果', 'v1', 1, 1)`,
  ).run();
  return db;
};

const insertVersion = (db: Database.Database, id: string, number: number): void => {
  db.prepare(
    `INSERT INTO artifact_versions
       (id, artifact_id, version_number, content, content_hash, source_run_id, origin, created_at)
     VALUES (?, 'a1', ?, '正文', 'h', 'r1', 'assistant-run', 1)`,
  ).run(id, number);
};

describe('artifact source declaration migration (v32)', () => {
  it('把已有输入关系的旧版本标成 legacy，其余默认 none', () => {
    const db = throughVersion(31);
    insertVersion(db, 'v1', 1);
    insertVersion(db, 'v2', 2);
    db.prepare(
      `INSERT INTO artifact_input_relations
         (id, output_version_id, run_id, input_json, input_key, relation, created_at)
       VALUES ('rel-1', 'v1', 'r1', '{"kind":"evidence","evidenceId":"e1"}', 'k1', 'data', 1)`,
    ).run();

    migrate(db, { migrations: appMigrations.filter((item) => item.version <= 32) });

    expect(readSchemaVersion(db)).toBe(32);
    expect(
      db
        .prepare('SELECT id, source_declaration FROM artifact_versions ORDER BY version_number')
        .all(),
    ).toEqual([
      { id: 'v1', source_declaration: 'legacy' },
      { id: 'v2', source_declaration: 'none' },
    ]);
    // 关系内容原样保留，只是不再被当作采用声明
    expect(db.prepare('SELECT COUNT(*) AS total FROM artifact_input_relations').get()).toEqual({
      total: 1,
    });
  });

  it('新版本默认 none，拒绝未知声明种类，并按运行唯一保存声明账本', () => {
    const db = throughVersion(32);
    insertVersion(db, 'v1', 1);
    expect(
      db.prepare('SELECT source_declaration FROM artifact_versions WHERE id = ?').get('v1'),
    ).toEqual({ source_declaration: 'none' });
    expect(() =>
      db
        .prepare("UPDATE artifact_versions SET source_declaration = 'invented' WHERE id = 'v1'")
        .run(),
    ).toThrow(/constraint/iu);

    db.prepare(
      `INSERT INTO run_artifact_source_declarations (run_id, inputs_json, created_at, updated_at)
       VALUES ('r1', '[]', 1, 1)`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO run_artifact_source_declarations (run_id, inputs_json, created_at, updated_at)
           VALUES ('r1', '[]', 1, 1)`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint/iu);

    db.prepare("DELETE FROM runs WHERE id = 'r1'").run();
    expect(
      db.prepare('SELECT COUNT(*) AS total FROM run_artifact_source_declarations').get(),
    ).toEqual({ total: 0 });
  });
});
