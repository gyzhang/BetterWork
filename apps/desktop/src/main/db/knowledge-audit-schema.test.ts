import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from './index';

/**
 * KM02（契约 §5.1）：v30 之后 Evidence 与 RunMaterialRead 的两组部分唯一索引
 * 必须同时生效，且知识字段组要么整组存在、要么整组为空。
 */
const stores: Database.Database[] = [];
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});

const dbWithRun = (): Database.Database => {
  const db = openAppDatabase(':memory:');
  stores.push(db);
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
     VALUES ('r1', 't1', 's1', 'p', 'running', 1)`,
  ).run();
  return db;
};

const material = JSON.stringify({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'd1',
  knowledgeRevisionId: 'v1',
  contentHash: 'h1',
  sourcePath: '/notes/a.md',
});

const insertRead = (
  db: Database.Database,
  values: {
    id: string;
    operation: string;
    locator?: string;
    evidenceId?: string;
    toolCallId?: string;
    partIndex?: number;
    span?: string;
    textHash?: string;
    excerptHash?: string;
  },
): void => {
  db.prepare(
    `INSERT INTO run_material_reads
       (id, run_id, material_json, material_key, operation, locator, content_hash,
        excerpt_hash, captured_at, tool_call_id, knowledge_part_index, knowledge_span_json,
        text_hash, evidence_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    values.id,
    'r1',
    material,
    material,
    values.operation,
    values.locator ?? null,
    'h1',
    values.excerptHash ?? null,
    1,
    values.toolCallId ?? null,
    values.partIndex ?? null,
    values.span ?? null,
    values.textHash ?? null,
    values.evidenceId ?? null,
  );
};

const insertEvidence = (
  db: Database.Database,
  values: { id: string; locator: string; knowledgeJson?: string; dedupeKey?: string },
): void => {
  db.prepare(
    `INSERT INTO evidence
       (id, task_id, run_id, source_type, source_uri, title, locator, excerpt, content_hash,
        captured_at, knowledge_source_json, dedupe_key)
     VALUES (?, 't1', 'r1', 'local-file', '/notes/a.md', 'A', ?, 'x', 'h1', 1, ?, ?)`,
  ).run(values.id, values.locator, values.knowledgeJson ?? null, values.dedupeKey ?? null);
};

describe('KM02 v30 exact knowledge audit constraints', () => {
  it('keeps legacy four-column dedupe only for non-evidence rows', () => {
    const db = dbWithRun();
    insertRead(db, { id: 'legacy-1', operation: 'search', locator: 'page 1' });
    expect(() =>
      insertRead(db, { id: 'legacy-2', operation: 'search', locator: 'page 1' }),
    ).toThrow(/UNIQUE/iu);
  });

  it('records same-revision follow-up pages independently and enforces the knowledge field group', () => {
    const db = dbWithRun();
    insertEvidence(db, {
      id: 'ev-1',
      locator: 'page 1',
      knowledgeJson: '{}',
      dedupeKey: createHash('sha256').update('k1').digest('hex'),
    });
    insertRead(db, {
      id: 'page-1',
      operation: 'read',
      locator: 'page 1',
      evidenceId: 'ev-1',
      toolCallId: 'call-1',
      partIndex: 0,
      span: '{"sectionOrdinal":0,"start":0,"end":100}',
      textHash: 'th1',
      excerptHash: 'xh1',
    });
    // 同段后续页：旧表级 UNIQUE(run,material_key,op,locator) 已移除
    insertRead(db, {
      id: 'page-2',
      operation: 'read',
      locator: 'page 1',
      evidenceId: 'ev-1',
      toolCallId: 'call-2',
      partIndex: 0,
      span: '{"sectionOrdinal":0,"start":100,"end":200}',
      textHash: 'th1',
      excerptHash: 'xh2',
    });
    // 同 toolCall 同片段序号必须唯一
    expect(() =>
      insertRead(db, {
        id: 'page-dup',
        operation: 'read',
        locator: 'page 1',
        evidenceId: 'ev-1',
        toolCallId: 'call-1',
        partIndex: 0,
        span: '{"sectionOrdinal":0,"start":0,"end":50}',
        textHash: 'th1',
        excerptHash: 'xh3',
      }),
    ).toThrow(/UNIQUE/iu);
    // 半组字段被 CHECK 拒绝
    expect(() =>
      insertRead(db, {
        id: 'half-group',
        operation: 'read',
        locator: 'page 1',
        evidenceId: 'ev-1',
      }),
    ).toThrow(/CHECK constraint/iu);
  });

  it('splits evidence uniqueness between legacy rows and knowledge dedupe keys', () => {
    const db = dbWithRun();
    insertEvidence(db, { id: 'legacy-a', locator: 'page 1' });
    expect(() => insertEvidence(db, { id: 'legacy-b', locator: 'page 1' })).toThrow(/UNIQUE/iu);
    insertEvidence(db, {
      id: 'know-1',
      locator: 'page 1',
      knowledgeJson: '{"span":1}',
      dedupeKey: 'key-1',
    });
    // 知识行不受 (run, uri, locator) 约束；不同访问范围可以共存
    insertEvidence(db, {
      id: 'know-2',
      locator: 'page 1',
      knowledgeJson: '{"span":2}',
      dedupeKey: 'key-2',
    });
    expect(() =>
      insertEvidence(db, {
        id: 'know-dup',
        locator: 'page 1',
        knowledgeJson: '{"span":1}',
        dedupeKey: 'key-1',
      }),
    ).toThrow(/UNIQUE/iu);
  });

  it('maps the knowledge footprint group through the repository schema', () => {
    const db = dbWithRun();
    insertEvidence(db, {
      id: 'ev-9',
      locator: 'page 9',
      knowledgeJson: '{}',
      dedupeKey: 'key-9',
    });
    insertRead(db, {
      id: 'row-9',
      operation: 'read',
      locator: 'page 9',
      evidenceId: 'ev-9',
      toolCallId: 'call-9',
      partIndex: 2,
      span: '{"sectionOrdinal":3,"start":10,"end":20}',
      textHash: 'th9',
      excerptHash: 'xh9',
    });
    const rows = db.prepare('SELECT * FROM run_material_reads WHERE id = ?').all('row-9') as Array<
      Record<string, unknown>
    >;
    expect(rows[0]).toMatchObject({
      tool_call_id: 'call-9',
      knowledge_part_index: 2,
      text_hash: 'th9',
      evidence_id: 'ev-9',
    });
  });
});
