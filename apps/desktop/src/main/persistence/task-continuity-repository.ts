import { createHash, randomUUID } from 'node:crypto';

import {
  type TaskContinuityBrief,
  taskContinuityBriefSchema,
  type TaskContinuityRevision,
  taskContinuityRevisionSchema,
  type TaskContinuityRevisionSourceKind,
  taskContinuityRevisionSourceKindSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface TaskGoalRow {
  goal: string;
}

interface RunOwnerRow {
  status: string;
}

interface TaskContinuityRevisionRow {
  id: string;
  task_id: string;
  revision: number;
  schema_version: number;
  brief_json: string;
  source_kind: TaskContinuityRevisionSourceKind;
  source_run_id: string | null;
  brief_hash: string;
  created_at: number;
}

export type TaskContinuityErrorCode =
  | 'task-not-found'
  | 'revision-not-initialized'
  | 'revision-already-initialized'
  | 'invalid-revision-source'
  | 'run-task-mismatch'
  | 'revision-idempotency-conflict'
  | 'corrupt-data';

export class TaskContinuityError extends Error {
  constructor(
    readonly code: TaskContinuityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TaskContinuityError';
  }
}

export class TaskContinuityRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Task Continuity revision conflict: expected ${expectedRevision}, current ${currentRevision}`,
    );
    this.name = 'TaskContinuityRevisionConflictError';
  }
}

export interface AppendTaskContinuityRevisionInput {
  taskId: string;
  expectedRevision: number;
  brief: TaskContinuityBrief;
  sourceKind: Exclude<TaskContinuityRevisionSourceKind, 'task-goal'>;
  sourceRunId?: string;
  at?: number;
}

const briefHash = (brief: TaskContinuityBrief): string =>
  createHash('sha256').update(JSON.stringify(brief)).digest('hex');

const briefSourceRunIds = (brief: TaskContinuityBrief): string[] => [
  ...(brief.objective.sourceRunId === undefined ? [] : [brief.objective.sourceRunId]),
  ...brief.activeRequirements.flatMap(
    (requirement) => requirement.sources?.map((source) => source.runId) ?? [],
  ),
  ...(brief.progress?.sourceRunId === undefined ? [] : [brief.progress.sourceRunId]),
];

const toRevision = (row: TaskContinuityRevisionRow): TaskContinuityRevision => {
  let parsedBrief: unknown;
  try {
    parsedBrief = JSON.parse(row.brief_json) as unknown;
  } catch (error) {
    throw new TaskContinuityError('corrupt-data', 'Task Continuity revision 包含无效 JSON。', {
      cause: error,
    });
  }
  const result = taskContinuityRevisionSchema.safeParse({
    id: row.id,
    taskId: row.task_id,
    revision: row.revision,
    schemaVersion: row.schema_version,
    brief: parsedBrief,
    sourceKind: row.source_kind,
    ...(row.source_run_id === null ? {} : { sourceRunId: row.source_run_id }),
    briefHash: row.brief_hash,
    createdAt: row.created_at,
  });
  if (!result.success) {
    throw new TaskContinuityError(
      'corrupt-data',
      `Task Continuity revision 未通过 Schema 校验：${result.error.message}`,
      { cause: result.error },
    );
  }
  if (briefHash(result.data.brief) !== result.data.briefHash) {
    throw new TaskContinuityError(
      'corrupt-data',
      'Task Continuity revision 的 Brief hash 不匹配。',
    );
  }
  return result.data;
};

/** Task 连续简报的追加式版本仓储；不读取历史消息，也不写其他聚合。 */
export class TaskContinuityRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** 仅从已持久化的 tasks.goal 创建首版，不对已有 Task 做隐式补齐。 */
  initializeFromTaskGoal(taskId: string): TaskContinuityRevision {
    const initialize = this.db.transaction(() => {
      const task = this.db.prepare('SELECT goal FROM tasks WHERE id = ?').get(taskId) as
        TaskGoalRow | undefined;
      if (!task) throw new TaskContinuityError('task-not-found', 'Task 不存在。');
      if (this.getLatest(taskId)) {
        throw new TaskContinuityError(
          'revision-already-initialized',
          'Task Continuity 初始 revision 已存在。',
        );
      }
      const brief = taskContinuityBriefSchema.parse({
        schemaVersion: 1,
        objective: { text: task.goal, source: 'task-goal' },
        activeRequirements: [],
      });
      const revision = taskContinuityRevisionSchema.parse({
        id: randomUUID(),
        taskId,
        revision: 1,
        schemaVersion: brief.schemaVersion,
        brief,
        sourceKind: 'task-goal',
        briefHash: briefHash(brief),
        createdAt: this.clock(),
      });
      this.insert(revision);
      return revision;
    });
    return initialize();
  }

  getLatest(taskId: string): TaskContinuityRevision | undefined {
    const row = this.db
      .prepare(
        `SELECT id, task_id, revision, schema_version, brief_json, source_kind,
                source_run_id, brief_hash, created_at
           FROM task_continuity_revisions
          WHERE task_id = ?
          ORDER BY revision DESC
          LIMIT 1`,
      )
      .get(taskId) as TaskContinuityRevisionRow | undefined;
    return row ? toRevision(row) : undefined;
  }

  getRevision(taskId: string, revision: number): TaskContinuityRevision | undefined {
    const row = this.db
      .prepare(
        `SELECT id, task_id, revision, schema_version, brief_json, source_kind,
                source_run_id, brief_hash, created_at
           FROM task_continuity_revisions
          WHERE task_id = ? AND revision = ?`,
      )
      .get(taskId, revision) as TaskContinuityRevisionRow | undefined;
    return row ? toRevision(row) : undefined;
  }

  append(input: AppendTaskContinuityRevisionInput): TaskContinuityRevision {
    const brief = taskContinuityBriefSchema.parse(input.brief);
    const sourceKind = taskContinuityRevisionSourceKindSchema.parse(input.sourceKind);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new TaskContinuityError('invalid-revision-source', 'expectedRevision 必须是正整数。');
    }
    if (sourceKind === 'task-goal') {
      throw new TaskContinuityError('invalid-revision-source', 'task-goal 只能用于初始 revision。');
    }
    if (sourceKind === 'assistant-summary' && input.sourceRunId === undefined) {
      throw new TaskContinuityError('invalid-revision-source', '助手摘要必须关联来源 Run。');
    }
    const hash = briefHash(brief);
    const append = this.db.transaction(() => {
      const task = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(input.taskId) as
        { id: string } | undefined;
      if (!task) throw new TaskContinuityError('task-not-found', 'Task 不存在。');

      const sourceRunIds = new Set([
        ...briefSourceRunIds(brief),
        ...(input.sourceRunId === undefined ? [] : [input.sourceRunId]),
      ]);
      for (const sourceRunId of sourceRunIds) {
        this.assertTerminalRunBelongsToTask(sourceRunId, input.taskId);
      }

      if (sourceKind === 'assistant-summary' && input.sourceRunId !== undefined) {
        const existing = this.db
          .prepare(
            `SELECT id, task_id, revision, schema_version, brief_json, source_kind,
                    source_run_id, brief_hash, created_at
               FROM task_continuity_revisions
              WHERE task_id = ? AND source_run_id = ?`,
          )
          .get(input.taskId, input.sourceRunId) as TaskContinuityRevisionRow | undefined;
        if (existing) {
          const revision = toRevision(existing);
          if (revision.sourceKind !== sourceKind || revision.briefHash !== hash) {
            throw new TaskContinuityError(
              'revision-idempotency-conflict',
              '同一 Task/Run 幂等键已用于不同的 Task Continuity 更新。',
            );
          }
          return revision;
        }
      }

      const current = this.getLatest(input.taskId);
      if (!current) {
        throw new TaskContinuityError(
          'revision-not-initialized',
          'Task 尚无初始 Task Continuity revision。',
        );
      }
      if (current.revision !== input.expectedRevision) {
        throw new TaskContinuityRevisionConflictError(input.expectedRevision, current.revision);
      }

      const revision = taskContinuityRevisionSchema.parse({
        id: randomUUID(),
        taskId: input.taskId,
        revision: current.revision + 1,
        schemaVersion: brief.schemaVersion,
        brief,
        sourceKind,
        ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
        briefHash: hash,
        createdAt: input.at ?? this.clock(),
      });
      this.insert(revision);
      return revision;
    });
    return append();
  }

  private assertTerminalRunBelongsToTask(runId: string, taskId: string): void {
    const run = this.db
      .prepare('SELECT status FROM runs WHERE id = ? AND task_id = ?')
      .get(runId, taskId) as RunOwnerRow | undefined;
    if (!run) {
      throw new TaskContinuityError('run-task-mismatch', '来源 Run 不存在或不属于该 Task。');
    }
    if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
      throw new TaskContinuityError(
        'invalid-revision-source',
        'Task Continuity revision 只能引用已进入终态的 Run。',
      );
    }
  }

  private insert(revision: TaskContinuityRevision): void {
    this.db
      .prepare(
        `INSERT INTO task_continuity_revisions (
           id, task_id, revision, schema_version, brief_json, source_kind,
           source_run_id, brief_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revision.id,
        revision.taskId,
        revision.revision,
        revision.schemaVersion,
        JSON.stringify(revision.brief),
        revision.sourceKind,
        revision.sourceRunId ?? null,
        revision.briefHash,
        revision.createdAt,
      );
  }
}
