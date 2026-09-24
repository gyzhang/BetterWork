import { randomUUID } from 'node:crypto';

import type {
  KnowledgeJobCursor,
  KnowledgeJobDetail,
  KnowledgeJobFailure,
  KnowledgeJobItemStatus,
  KnowledgeJobItemSummary,
  KnowledgeJobKind,
  KnowledgeJobPage,
  KnowledgeJobPhase,
  KnowledgeJobStatus,
  KnowledgeJobSummary,
} from '@betterwork/agent-protocol';
import {
  knowledgeJobDetailSchema,
  knowledgeJobItemSummarySchema,
  knowledgeJobSummarySchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { KnowledgeServiceError } from './knowledge-errors';

/**
 * 持久作业与条目（知识契约 §8.1、§8.2）。
 *
 * 作业状态只由条目聚合或显式收口（取消、中断）决定；每次状态变化都在同一事务里
 * 递增该作业的 `sequence`，让 UI 能按序合并事件而不回放原始请求内容。
 */

export type JobTarget =
  | { kind: 'import-file'; sourcePath: string; fileName: string }
  | { kind: 'document'; documentId: string }
  | { kind: 'revision'; documentId: string; revisionId: string; sourcePath: string }
  | { kind: 'check-document'; documentId: string };

interface JobRow {
  id: string;
  kind: KnowledgeJobKind;
  status: KnowledgeJobStatus;
  attempt: number;
  sequence: number;
  retry_of_job_id: string | null;
  request_json: string;
  space_id: string | null;
  total_count: number;
  completed_count: number;
  failed_count: number;
  created_at: number;
  updated_at: number;
  failure_code: string | null;
  failure_message: string | null;
}

interface ItemRow {
  id: string;
  job_id: string;
  target_json: string;
  status: KnowledgeJobItemStatus;
  phase: KnowledgeJobPhase;
  attempt: number;
  completed_units: number;
  total_units: number | null;
  result_revision_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

const TERMINAL_JOB_STATUSES = new Set<KnowledgeJobStatus>([
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);

const isTerminal = (status: KnowledgeJobStatus): boolean => TERMINAL_JOB_STATUSES.has(status);

const parseTarget = (value: string): JobTarget => JSON.parse(value) as JobTarget;

const failureOf = (row: { failure_code: string | null; failure_message: string | null }) =>
  row.failure_code && row.failure_message
    ? { code: row.failure_code, message: row.failure_message }
    : undefined;

const toSummary = (row: JobRow): KnowledgeJobSummary => {
  const failure = failureOf(row);
  return knowledgeJobSummarySchema.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempt: row.attempt,
    sequence: row.sequence,
    ...(row.retry_of_job_id ? { retryOfJobId: row.retry_of_job_id } : {}),
    ...(row.space_id ? { spaceId: row.space_id } : {}),
    totalCount: row.total_count,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(failure ? { failure } : {}),
  });
};

const toItemSummary = (row: ItemRow): KnowledgeJobItemSummary => {
  const target = parseTarget(row.target_json);
  const failure = failureOf(row);
  return knowledgeJobItemSummarySchema.parse({
    id: row.id,
    jobId: row.job_id,
    ...('documentId' in target ? { documentId: target.documentId } : {}),
    ...('fileName' in target ? { fileName: target.fileName } : {}),
    status: row.status,
    phase: row.phase,
    attempt: row.attempt,
    completedUnits: row.completed_units,
    ...(row.total_units === null ? {} : { totalUnits: row.total_units }),
    ...(row.result_revision_id ? { resultRevisionId: row.result_revision_id } : {}),
    ...(failure ? { failure } : {}),
  });
};

const JOB_COLUMNS = `id, kind, status, attempt, sequence, retry_of_job_id, request_json, space_id,
     total_count, completed_count, failed_count, created_at, updated_at, failure_code,
     failure_message`;

const ITEM_COLUMNS = `id, job_id, target_json, status, phase, attempt, completed_units, total_units,
     result_revision_id, failure_code, failure_message`;

const unsafeMessage = (value: string): string =>
  value.replace(/\/\/[^/@\s]+:[^@\s]+@/gu, '//[redacted]@').slice(0, 500);

export class KnowledgeJobStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createJob(input: {
    kind: KnowledgeJobKind;
    request: unknown;
    targets: readonly JobTarget[];
    firstPhase: KnowledgeJobPhase;
    attempt?: number | undefined;
    retryOfJobId?: string | undefined;
    spaceId?: string | undefined;
  }): KnowledgeJobSummary {
    const now = Date.now();
    const jobId = randomUUID();
    const write = this.db.transaction((): KnowledgeJobSummary => {
      this.db
        .prepare(
          `INSERT INTO knowledge_jobs
            (kind, status, attempt, sequence, retry_of_job_id, request_json, space_id,
             total_count, completed_count, failed_count, created_at, updated_at, id)
           VALUES (?, 'queued', ?, 1, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        )
        .run(
          input.kind,
          input.attempt ?? 1,
          input.retryOfJobId ?? null,
          JSON.stringify(input.request ?? {}),
          input.spaceId ?? null,
          input.targets.length,
          now,
          now,
          jobId,
        );
      const insertItem = this.db.prepare(
        `INSERT INTO knowledge_job_items
          (id, job_id, target_json, status, phase, attempt, completed_units, total_units,
           result_revision_id, failure_code, failure_message)
         VALUES (?, ?, ?, 'queued', ?, 1, 0, NULL, NULL, NULL, NULL)`,
      );
      for (const target of input.targets) {
        insertItem.run(randomUUID(), jobId, JSON.stringify(target), input.firstPhase);
      }
      const created = this.job(jobId);
      if (!created)
        throw new KnowledgeServiceError('INDEX_CONFIGURATION_CHANGED', '作业创建后不可见。');
      return created;
    });
    return write();
  }

  job(id: string): KnowledgeJobSummary | undefined {
    const row = this.db
      .prepare(`SELECT ${JOB_COLUMNS} FROM knowledge_jobs WHERE id = ?`)
      .get(id) as JobRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  detail(id: string): KnowledgeJobDetail | undefined {
    const job = this.job(id);
    if (!job) return undefined;
    return knowledgeJobDetailSchema.parse({ job, items: this.itemsOf(id) });
  }

  itemsOf(jobId: string): KnowledgeJobItemSummary[] {
    const rows = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM knowledge_job_items WHERE job_id = ? ORDER BY rowid`)
      .all(jobId) as ItemRow[];
    return rows.map(toItemSummary);
  }

  /** 一次只跑一个持久作业，其余排队。 */
  nextQueued(): KnowledgeJobSummary | undefined {
    if (this.runningJob()) return undefined;
    const row = this.db
      .prepare(
        `SELECT ${JOB_COLUMNS} FROM knowledge_jobs WHERE status = 'queued'
          ORDER BY created_at ASC, rowid ASC LIMIT 1`,
      )
      .get() as JobRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  runningJob(): KnowledgeJobSummary | undefined {
    const row = this.db
      .prepare(`SELECT ${JOB_COLUMNS} FROM knowledge_jobs WHERE status = 'running' LIMIT 1`)
      .get() as JobRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  markRunning(id: string): KnowledgeJobSummary {
    return this.transition(id, { status: 'running' });
  }

  claimItem(jobId: string): KnowledgeJobItemSummary | undefined {
    const claim = this.db.transaction((): KnowledgeJobItemSummary | undefined => {
      const row = this.db
        .prepare(
          `SELECT ${ITEM_COLUMNS} FROM knowledge_job_items
            WHERE job_id = ? AND status = 'queued' ORDER BY rowid LIMIT 1`,
        )
        .get(jobId) as ItemRow | undefined;
      if (!row) return undefined;
      this.db.prepare("UPDATE knowledge_job_items SET status = 'running' WHERE id = ?").run(row.id);
      this.refreshCounts(jobId);
      const claimed = this.item(row.id);
      return claimed;
    });
    return claim();
  }

  item(id: string): KnowledgeJobItemSummary | undefined {
    const row = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM knowledge_job_items WHERE id = ?`)
      .get(id) as ItemRow | undefined;
    return row ? toItemSummary(row) : undefined;
  }

  updateItem(
    id: string,
    patch: {
      status?: KnowledgeJobItemStatus;
      phase?: KnowledgeJobPhase;
      completedUnits?: number;
      totalUnits?: number;
      resultRevisionId?: string;
      failure?: KnowledgeJobFailure;
    },
  ): KnowledgeJobItemSummary | undefined {
    const write = this.db.transaction((): KnowledgeJobItemSummary | undefined => {
      const current = this.db
        .prepare(`SELECT ${ITEM_COLUMNS} FROM knowledge_job_items WHERE id = ?`)
        .get(id) as ItemRow | undefined;
      if (!current) return undefined;
      this.db
        .prepare(
          `UPDATE knowledge_job_items
              SET status = ?, phase = ?, completed_units = ?, total_units = ?,
                  result_revision_id = ?, failure_code = ?, failure_message = ?
            WHERE id = ?`,
        )
        .run(
          patch.status ?? current.status,
          patch.phase ?? current.phase,
          patch.completedUnits ?? current.completed_units,
          patch.totalUnits ?? current.total_units,
          patch.resultRevisionId ?? current.result_revision_id,
          patch.failure?.code ?? current.failure_code,
          patch.failure ? unsafeMessage(patch.failure.message) : current.failure_message,
          id,
        );
      this.refreshCounts(current.job_id);
      return this.item(id);
    });
    return write();
  }

  /** 取消优先：未完成的条目统一 cancelled，已完成/已失败的结果保留。 */
  cancelUnfinishedItems(jobId: string): void {
    const write = this.db.transaction((): void => {
      this.db
        .prepare(
          `UPDATE knowledge_job_items SET status = 'cancelled'
            WHERE job_id = ? AND status IN ('queued', 'running')`,
        )
        .run(jobId);
      this.refreshCounts(jobId);
    });
    write();
  }

  /** 收尾：显式状态优先，否则按条目聚合；同时递增 sequence 供事件合并。 */
  finish(
    id: string,
    input?: { status?: KnowledgeJobStatus; failure?: KnowledgeJobFailure },
  ): KnowledgeJobSummary {
    const write = this.db.transaction((): KnowledgeJobSummary => {
      const current = this.db
        .prepare(`SELECT ${JOB_COLUMNS} FROM knowledge_jobs WHERE id = ?`)
        .get(id) as JobRow | undefined;
      if (!current)
        throw new KnowledgeServiceError('INDEX_CONFIGURATION_CHANGED', '作业已不存在。');
      const status = input?.status ?? this.aggregate(id, current.status);
      this.db
        .prepare(
          `UPDATE knowledge_jobs
              SET status = ?, sequence = sequence + 1, updated_at = ?, failure_code = ?, failure_message = ?
            WHERE id = ?`,
        )
        .run(
          status,
          Date.now(),
          input?.failure?.code ?? null,
          input?.failure ? unsafeMessage(input.failure.message) : null,
          id,
        );
      const finished = this.job(id);
      if (!finished)
        throw new KnowledgeServiceError('INDEX_CONFIGURATION_CHANGED', '作业收尾后不可见。');
      return finished;
    });
    return write();
  }

  /** 进度事件：只递增 sequence 与更新时间，不改状态。 */
  touch(id: string): KnowledgeJobSummary {
    return this.transition(id, {});
  }

  targetsOf(
    jobId: string,
  ): { itemId: string; target: JobTarget; status: KnowledgeJobItemStatus }[] {
    const rows = this.db
      .prepare(
        `SELECT id, target_json, status FROM knowledge_job_items WHERE job_id = ? ORDER BY rowid`,
      )
      .all(jobId) as Array<{ id: string; target_json: string; status: KnowledgeJobItemStatus }>;
    return rows.map((row) => ({
      itemId: row.id,
      target: parseTarget(row.target_json),
      status: row.status,
    }));
  }

  listPage(input: { limit: number; cursor?: KnowledgeJobCursor | undefined }): KnowledgeJobPage {
    const jobs = input.cursor
      ? (this.db
          .prepare(
            `SELECT ${JOB_COLUMNS} FROM knowledge_jobs
              WHERE (created_at, id) < (?, ?)
              ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(input.cursor.createdAt, input.cursor.id, input.limit + 1) as JobRow[])
      : (this.db
          .prepare(
            `SELECT ${JOB_COLUMNS} FROM knowledge_jobs ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(input.limit + 1) as JobRow[]);
    const hasMore = jobs.length > input.limit;
    const page = hasMore ? jobs.slice(0, input.limit) : jobs;
    const last = page.at(-1);
    return {
      jobs: page.map(toSummary),
      ...(hasMore && last ? { nextCursor: { createdAt: last.created_at, id: last.id } } : {}),
    };
  }

  /** 启动收口：queued/running 一律 interrupted，终态不改。 */
  recoverInterrupted(): KnowledgeJobSummary[] {
    const write = this.db.transaction((): KnowledgeJobSummary[] => {
      const rows = this.db
        .prepare(`SELECT id FROM knowledge_jobs WHERE status IN ('queued', 'running')`)
        .all() as Array<{ id: string }>;
      const recovered: KnowledgeJobSummary[] = [];
      for (const row of rows) {
        this.db
          .prepare(
            `UPDATE knowledge_job_items SET status = 'interrupted'
              WHERE job_id = ? AND status IN ('queued', 'running')`,
          )
          .run(row.id);
        this.refreshCounts(row.id);
        const updated = this.finish(row.id, {
          status: 'interrupted',
          failure: { code: 'INTERRUPTED', message: '应用在完成前退出，作业已中断。' },
        });
        recovered.push(updated);
      }
      return recovered;
    });
    return write();
  }

  private transition(
    id: string,
    change: { status?: KnowledgeJobStatus; failure?: KnowledgeJobFailure },
  ): KnowledgeJobSummary {
    const write = this.db.transaction((): KnowledgeJobSummary => {
      this.db
        .prepare(
          `UPDATE knowledge_jobs
              SET status = COALESCE(?, status), sequence = sequence + 1, updated_at = ?,
                  failure_code = COALESCE(?, failure_code),
                  failure_message = COALESCE(?, failure_message)
            WHERE id = ?`,
        )
        .run(
          change.status ?? null,
          Date.now(),
          change.failure?.code ?? null,
          change.failure ? unsafeMessage(change.failure.message) : null,
          id,
        );
      const updated = this.job(id);
      if (!updated)
        throw new KnowledgeServiceError('INDEX_CONFIGURATION_CHANGED', '作业已不存在。');
      return updated;
    });
    return write();
  }

  private refreshCounts(jobId: string): void {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
           FROM knowledge_job_items WHERE job_id = ?`,
      )
      .get(jobId) as { total: number; completed: number | null; failed: number | null };
    this.db
      .prepare(
        `UPDATE knowledge_jobs
            SET total_count = ?, completed_count = ?, failed_count = ?, sequence = sequence + 1, updated_at = ?
          WHERE id = ?`,
      )
      .run(row.total, row.completed ?? 0, row.failed ?? 0, Date.now(), jobId);
  }

  private aggregate(jobId: string, fallback: KnowledgeJobStatus): KnowledgeJobStatus {
    const rows = this.db
      .prepare('SELECT status FROM knowledge_job_items WHERE job_id = ?')
      .all(jobId) as Array<{ status: KnowledgeJobItemStatus }>;
    if (rows.length === 0) return isTerminal(fallback) ? fallback : 'succeeded';
    const statuses = rows.map((row) => row.status);
    if (statuses.every((status) => status === 'succeeded')) return 'succeeded';
    if (statuses.every((status) => status === 'failed')) return 'failed';
    if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
    if (statuses.some((status) => status === 'interrupted')) return 'interrupted';
    if (statuses.some((status) => status === 'succeeded')) return 'partial';
    return fallback;
  }
}
