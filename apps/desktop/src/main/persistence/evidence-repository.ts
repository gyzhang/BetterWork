import { randomUUID } from 'node:crypto';

import type { EvidenceSummary } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface EvidenceRow {
  id: string;
  task_id: string;
  run_id: string;
  source_type: EvidenceSummary['sourceType'];
  source_uri: string;
  title: string;
  locator: string;
  excerpt: string;
  content_hash: string;
  captured_at: number;
}

/** 新增证据时由调用方给出的字段；id、sourceType 与 capturedAt 由仓储负责。 */
export type NewEvidence = Omit<EvidenceSummary, 'id' | 'sourceType' | 'capturedAt'>;

const toSummary = (row: EvidenceRow): EvidenceSummary => ({
  id: row.id,
  taskId: row.task_id,
  runId: row.run_id,
  sourceType: row.source_type,
  sourceUri: row.source_uri,
  title: row.title,
  locator: row.locator,
  excerpt: row.excerpt,
  contentHash: row.content_hash,
  capturedAt: row.captured_at,
});

/**
 * Evidence 是可回溯证据。本地资料与网页来源共用一张表，
 * 靠 `UNIQUE(run_id, source_uri, locator)` 在同一次 Run 内天然去重，
 * 因此重复登记同一条来源是安全的 INSERT OR IGNORE。
 */
export class EvidenceRepository {
  constructor(private readonly db: Database.Database) {}

  saveLocal(input: NewEvidence): void {
    this.save('local-file', input);
  }

  saveWeb(input: NewEvidence): void {
    this.save('web-page', input);
  }

  listByTask(taskId: string): EvidenceSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY captured_at DESC, rowid DESC')
      .all(taskId) as EvidenceRow[];
    return rows.map(toSummary);
  }

  private save(sourceType: EvidenceSummary['sourceType'], input: NewEvidence): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO evidence
           (id, task_id, run_id, source_type, source_uri, title, locator, excerpt, content_hash, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.taskId,
        input.runId,
        sourceType,
        input.sourceUri,
        input.title,
        input.locator,
        input.excerpt,
        input.contentHash,
        Date.now(),
      );
  }
}
