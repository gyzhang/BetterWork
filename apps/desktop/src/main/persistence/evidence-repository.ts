import { createHash, randomUUID } from 'node:crypto';

import {
  type EvidenceSummary,
  type KnowledgeEvidenceSource,
  knowledgeEvidenceSourceSchema,
} from '@betterwork/agent-protocol';
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
  knowledge_source_json: string | null;
  dedupe_key: string | null;
}

/** 新增证据时由调用方给出的字段；id、sourceType 与 capturedAt 由仓储负责。 */
export type NewEvidence = Omit<EvidenceSummary, 'id' | 'sourceType' | 'capturedAt'>;

const toSummary = (row: EvidenceRow): EvidenceSummary => {
  const knowledgeSource = row.knowledge_source_json
    ? knowledgeEvidenceSourceSchema.parse(JSON.parse(row.knowledge_source_json))
    : undefined;
  return {
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
    ...(knowledgeSource ? { knowledgeSource } : {}),
  };
};

/**
 * 知识 Evidence 去重键（契约 §5.1）：runId + revisionId + textHash + span + operation + excerptHash
 * 的稳定序列化哈希；同一访问文本复用 Evidence ID，不同修订同定位绝不合并。
 */
export const knowledgeEvidenceDedupeKey = (input: {
  runId: string;
  source: KnowledgeEvidenceSource;
  excerptHash: string;
}): string => {
  const stable = JSON.stringify([
    input.runId,
    input.source.reference.kind,
    input.source.reference.knowledgeDocumentId,
    input.source.reference.knowledgeRevisionId,
    input.source.reference.contentHash,
    input.source.textHash,
    input.source.span.sectionOrdinal,
    input.source.span.start,
    input.source.span.end,
    input.source.operation,
    input.excerptHash,
  ]);
  return createHash('sha256').update(stable).digest('hex');
};

/**
 * Evidence 是可回溯证据。本地资料、网页与 MCP 来源共用一张表，
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

  saveMcp(input: NewEvidence): void {
    this.save('mcp-tool', input);
  }

  get(id: string): EvidenceSummary | undefined {
    const row = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as
      EvidenceRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  listByTask(taskId: string): EvidenceSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY captured_at DESC, rowid DESC')
      .all(taskId) as EvidenceRow[];
    return rows.map(toSummary);
  }

  /**
   * 知识 Evidence（契约 §5.1）：按去重键幂等，返回持久化后的完整摘要；
   * web/MCP 保存行为不变，旧 local-file 行不猜 reference/span。
   */
  saveKnowledge(
    input: NewEvidence & { knowledgeSource: KnowledgeEvidenceSource },
  ): EvidenceSummary {
    const run = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(input.runId) as
      { task_id: string } | undefined;
    if (!run) throw new Error('Evidence Run does not exist');
    if (run.task_id !== input.taskId) throw new Error('Evidence Run does not belong to task');
    const parsed = knowledgeEvidenceSourceSchema.parse(input.knowledgeSource);
    const excerptHash = createHash('sha256').update(input.excerpt).digest('hex');
    const dedupeKey = knowledgeEvidenceDedupeKey({
      runId: input.runId,
      source: parsed,
      excerptHash,
    });
    const existing = this.db
      .prepare('SELECT * FROM evidence WHERE run_id = ? AND dedupe_key = ?')
      .get(input.runId, dedupeKey) as EvidenceRow | undefined;
    if (existing) return toSummary(existing);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO evidence
           (id, task_id, run_id, source_type, source_uri, title, locator, excerpt, content_hash,
            captured_at, knowledge_source_json, dedupe_key)
         VALUES (?, ?, ?, 'local-file', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.runId,
        input.sourceUri,
        input.title,
        input.locator,
        input.excerpt,
        input.contentHash,
        Date.now(),
        JSON.stringify(parsed),
        dedupeKey,
      );
    const saved = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as EvidenceRow;
    return toSummary(saved);
  }

  private save(sourceType: EvidenceSummary['sourceType'], input: NewEvidence): void {
    const run = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(input.runId) as
      { task_id: string } | undefined;
    if (!run) throw new Error('Evidence Run does not exist');
    if (run.task_id !== input.taskId) throw new Error('Evidence Run does not belong to task');
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
