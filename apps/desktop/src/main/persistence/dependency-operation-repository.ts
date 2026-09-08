import { randomUUID } from 'node:crypto';

import type {
  DependencyOperation,
  DependencyOperationKind,
  DependencyOperationStatus,
  DependencyOperationStep,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export interface CreateOperationInput {
  id?: string;
  environmentId: string;
  environmentKey: string;
  kind: DependencyOperationKind;
}

export interface OperationProgressPatch {
  step?: DependencyOperationStep;
  message?: string;
}

export interface OperationTerminalPatch extends OperationProgressPatch {
  failureCode?: string;
  failureSummary?: string;
  finishedAt: number;
}

interface OperationRow {
  id: string;
  environment_id: string;
  environment_key: string;
  kind: DependencyOperationKind;
  status: DependencyOperationStatus;
  step: DependencyOperationStep | null;
  message: string | null;
  failure_code: string | null;
  failure_summary: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const TERMINAL_STATUSES: readonly DependencyOperationStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
];

export const isTerminalOperationStatus = (status: DependencyOperationStatus): boolean =>
  TERMINAL_STATUSES.includes(status);

const toOperation = (row: OperationRow): DependencyOperation => ({
  id: row.id,
  environmentId: row.environment_id,
  environmentKey: row.environment_key,
  kind: row.kind,
  status: row.status,
  ...(row.step === null ? {} : { step: row.step }),
  ...(row.message === null ? {} : { message: row.message }),
  ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  ...(row.failure_summary === null ? {} : { failureSummary: row.failure_summary }),
  createdAt: row.created_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
});

/**
 * 依赖准备作业仓储：只写 `dependency_operations`。
 *
 * 每次准备/修复都有独立 operationId 与持久化进度，因此 IPC 不需要占用一个长等待
 * （契约 §11）。终态写入是条件更新：重复结束、迟到的取消与启动恢复都不会把已终态
 * 的作业改写第二次。
 */
export class DependencyOperationRepository {
  constructor(private readonly db: Database.Database) {}

  createOperation(input: CreateOperationInput): DependencyOperation {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO dependency_operations (
           id, environment_id, environment_key, kind, status, step, message,
           failure_code, failure_summary, created_at, started_at, finished_at
         ) VALUES (?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, ?, NULL, NULL)`,
      )
      .run(id, input.environmentId, input.environmentKey, input.kind, Date.now());
    const operation = this.getOperation(id);
    if (!operation) throw new Error(`Dependency operation ${id} was not readable after insert`);
    return operation;
  }

  getOperation(id: string): DependencyOperation | undefined {
    const row = this.db.prepare('SELECT * FROM dependency_operations WHERE id = ?').get(id) as
      OperationRow | undefined;
    return row ? toOperation(row) : undefined;
  }

  listOperationsByEnvironment(environmentId: string): DependencyOperation[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM dependency_operations WHERE environment_id = ? ORDER BY created_at DESC',
      )
      .all(environmentId) as OperationRow[];
    return rows.map(toOperation);
  }

  /** 同一环境键同时只允许一个未终态作业；后来者观察它，而不是再起一个。 */
  findOpenOperation(environmentKey: string): DependencyOperation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM dependency_operations
         WHERE environment_key = ? AND status IN ('queued', 'running')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(environmentKey) as OperationRow | undefined;
    return row ? toOperation(row) : undefined;
  }

  /** queued → running 是条件更新：并发启动只有一个作业能真正开跑。 */
  markRunning(id: string, patch: OperationProgressPatch, startedAt: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE dependency_operations
         SET status = 'running', step = COALESCE(?, step), message = COALESCE(?, message),
             started_at = COALESCE(started_at, ?)
         WHERE id = ? AND status = 'queued'`,
      )
      .run(patch.step ?? null, patch.message ?? null, startedAt, id);
    return result.changes === 1;
  }

  updateProgress(id: string, patch: OperationProgressPatch): boolean {
    const result = this.db
      .prepare(
        `UPDATE dependency_operations
         SET step = COALESCE(?, step), message = COALESCE(?, message)
         WHERE id = ? AND status IN ('queued', 'running')`,
      )
      .run(patch.step ?? null, patch.message ?? null, id);
    return result.changes === 1;
  }

  finishOperation(
    id: string,
    status: DependencyOperationStatus,
    patch: OperationTerminalPatch,
  ): boolean {
    if (!isTerminalOperationStatus(status)) {
      throw new Error(`finishOperation requires a terminal status, got ${status}`);
    }
    const result = this.db
      .prepare(
        `UPDATE dependency_operations
         SET status = ?, step = COALESCE(?, step), message = COALESCE(?, message),
             failure_code = ?, failure_summary = ?, finished_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`,
      )
      .run(
        status,
        patch.step ?? null,
        patch.message ?? null,
        patch.failureCode ?? null,
        patch.failureSummary ?? null,
        patch.finishedAt,
        id,
      );
    return result.changes === 1;
  }

  /** 启动恢复：上次进程被强杀留下的作业收口为 interrupted，不自动重放。 */
  failInterruptedOperations(finishedAt: number): number {
    const result = this.db
      .prepare(
        `UPDATE dependency_operations
         SET status = 'interrupted', failure_code = 'interrupted',
             failure_summary = '算台在准备过程中退出，本次作业已中断', finished_at = ?
         WHERE status IN ('queued', 'running')`,
      )
      .run(finishedAt);
    return result.changes;
  }
}
