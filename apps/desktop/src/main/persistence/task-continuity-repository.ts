import { createHash, randomUUID } from 'node:crypto';

import {
  type TaskContinuityBrief,
  taskContinuityBriefSchema,
  type TaskContinuityOmission,
  taskContinuityOmissionsSchema,
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

interface RunTaskRow {
  task_id: string;
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

interface RunContinuityContextRow {
  run_id: string;
  task_id: string;
  revision_id: string;
  schema_version: number;
  brief_json: string;
  brief_hash: string;
  prepared_at: number;
  first_provider_request_at: number | null;
  omissions_json: string;
}

export interface RunContinuityContext {
  runId: string;
  taskId: string;
  revisionId: string;
  schemaVersion: 1;
  brief: TaskContinuityBrief;
  briefHash: string;
  preparedAt: number;
  firstProviderRequestAt?: number;
  omissions: TaskContinuityOmission[];
}

export type TaskContinuityErrorCode =
  | 'task-not-found'
  | 'revision-not-initialized'
  | 'revision-already-initialized'
  | 'invalid-revision-source'
  | 'run-task-mismatch'
  | 'revision-idempotency-conflict'
  | 'source-prompt-hash-mismatch'
  | 'artifact-version-unavailable'
  | 'source-run-not-completed'
  | 'run-context-not-found'
  | 'run-context-already-prepared'
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

const toRunContinuityContext = (row: RunContinuityContextRow): RunContinuityContext => {
  let parsedBrief: unknown;
  try {
    parsedBrief = JSON.parse(row.brief_json) as unknown;
  } catch (error) {
    throw new TaskContinuityError('corrupt-data', 'Run Continuity snapshot 包含无效 JSON。', {
      cause: error,
    });
  }
  const parsed = taskContinuityBriefSchema.safeParse(parsedBrief);
  if (!parsed.success) {
    throw new TaskContinuityError(
      'corrupt-data',
      `Run Continuity snapshot 未通过 Schema 校验：${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  if (briefHash(parsed.data) !== row.brief_hash) {
    throw new TaskContinuityError('corrupt-data', 'Run Continuity snapshot 的 Brief hash 不匹配。');
  }
  let parsedOmissions: unknown;
  try {
    parsedOmissions = JSON.parse(row.omissions_json) as unknown;
  } catch (error) {
    throw new TaskContinuityError('corrupt-data', 'Run Continuity 省略审计包含无效 JSON。', {
      cause: error,
    });
  }
  const omissions = taskContinuityOmissionsSchema.safeParse(parsedOmissions);
  if (!omissions.success) {
    throw new TaskContinuityError(
      'corrupt-data',
      `Run Continuity 省略审计未通过 Schema 校验：${omissions.error.message}`,
      { cause: omissions.error },
    );
  }
  if (
    row.schema_version !== parsed.data.schemaVersion ||
    !Number.isSafeInteger(row.prepared_at) ||
    row.prepared_at < 0 ||
    (row.first_provider_request_at !== null &&
      (!Number.isSafeInteger(row.first_provider_request_at) ||
        row.first_provider_request_at < row.prepared_at))
  ) {
    throw new TaskContinuityError('corrupt-data', 'Run Continuity snapshot 元数据无效。');
  }
  return {
    runId: row.run_id,
    taskId: row.task_id,
    revisionId: row.revision_id,
    schemaVersion: parsed.data.schemaVersion,
    brief: parsed.data,
    briefHash: row.brief_hash,
    preparedAt: row.prepared_at,
    ...(row.first_provider_request_at === null
      ? {}
      : { firstProviderRequestAt: row.first_provider_request_at }),
    omissions: omissions.data,
  };
};

const isBriefSubset = (snapshot: TaskContinuityBrief, revision: TaskContinuityBrief): boolean => {
  if (JSON.stringify(snapshot.objective) !== JSON.stringify(revision.objective)) return false;
  if (
    snapshot.activeRequirements.some(
      (requirement) =>
        !revision.activeRequirements.some(
          (candidate) => JSON.stringify(candidate) === JSON.stringify(requirement),
        ),
    )
  ) {
    return false;
  }
  return (
    snapshot.progress === undefined ||
    JSON.stringify(snapshot.progress) === JSON.stringify(revision.progress)
  );
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

  /** 在 Run 行已持久化后冻结本次实际注入的 Brief；只允许基于最新 revision 的完整项子集。 */
  prepareRunContext(input: {
    runId: string;
    taskId: string;
    revisionId: string;
    brief: TaskContinuityBrief;
    omissions?: readonly TaskContinuityOmission[];
    preparedAt?: number;
  }): RunContinuityContext {
    const brief = taskContinuityBriefSchema.parse(input.brief);
    const omissions = taskContinuityOmissionsSchema.parse([...(input.omissions ?? [])]);
    const prepare = this.db.transaction(() => {
      const run = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(input.runId) as
        RunTaskRow | undefined;
      if (!run || run.task_id !== input.taskId) {
        throw new TaskContinuityError('run-task-mismatch', 'Run 不存在或不属于该 Task。');
      }
      const revision = this.getLatest(input.taskId);
      if (!revision || revision.id !== input.revisionId) {
        throw new TaskContinuityError(
          'revision-not-initialized',
          'Run Continuity snapshot 必须基于 Task 当前最新 revision。',
        );
      }
      if (!isBriefSubset(brief, revision.brief)) {
        throw new TaskContinuityError(
          'invalid-revision-source',
          'Run Continuity snapshot 不能增加或改写 Task Brief 内容。',
        );
      }

      const existing = this.db
        .prepare(
          `SELECT run_id, task_id, revision_id, schema_version, brief_json, brief_hash,
                  prepared_at, first_provider_request_at, omissions_json
             FROM run_continuity_contexts WHERE run_id = ?`,
        )
        .get(input.runId) as RunContinuityContextRow | undefined;
      const hash = briefHash(brief);
      if (existing) {
        const context = toRunContinuityContext(existing);
        if (
          context.taskId !== input.taskId ||
          context.revisionId !== input.revisionId ||
          context.briefHash !== hash ||
          JSON.stringify(context.omissions) !== JSON.stringify(omissions)
        ) {
          throw new TaskContinuityError(
            'run-context-already-prepared',
            'Run 已经固定了不同的 Task Continuity snapshot。',
          );
        }
        return context;
      }

      const preparedAt = input.preparedAt ?? this.clock();
      this.db
        .prepare(
          `INSERT INTO run_continuity_contexts (
             run_id, task_id, revision_id, schema_version, brief_json, brief_hash, prepared_at,
             omissions_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          input.taskId,
          revision.id,
          brief.schemaVersion,
          JSON.stringify(brief),
          hash,
          preparedAt,
          JSON.stringify(omissions),
        );
      const inserted = this.db
        .prepare(
          `SELECT run_id, task_id, revision_id, schema_version, brief_json, brief_hash,
                  prepared_at, first_provider_request_at, omissions_json
             FROM run_continuity_contexts WHERE run_id = ?`,
        )
        .get(input.runId) as RunContinuityContextRow | undefined;
      if (!inserted) throw new TaskContinuityError('corrupt-data', 'Run snapshot 写入后无法读取。');
      return toRunContinuityContext(inserted);
    });
    return prepare();
  }

  getRunContext(runId: string): RunContinuityContext | undefined {
    const row = this.db
      .prepare(
        `SELECT run_id, task_id, revision_id, schema_version, brief_json, brief_hash,
                prepared_at, first_provider_request_at, omissions_json
           FROM run_continuity_contexts WHERE run_id = ?`,
      )
      .get(runId) as RunContinuityContextRow | undefined;
    return row ? toRunContinuityContext(row) : undefined;
  }

  /** 首次 Provider 请求前写一次审计时间；重复读取幂等，数据库触发器锁定其余快照字段。 */
  markFirstProviderRequest(runId: string): RunContinuityContext {
    const mark = this.db.transaction(() => {
      const current = this.getRunContext(runId);
      if (!current) {
        throw new TaskContinuityError(
          'run-context-not-found',
          'Run 缺少 Task Continuity snapshot。',
        );
      }
      if (current.firstProviderRequestAt !== undefined) return current;
      const requestedAt = Math.max(this.clock(), current.preparedAt);
      this.db
        .prepare(
          `UPDATE run_continuity_contexts SET first_provider_request_at = ?
            WHERE run_id = ? AND first_provider_request_at IS NULL`,
        )
        .run(requestedAt, runId);
      const updated = this.getRunContext(runId);
      if (!updated) {
        throw new TaskContinuityError('run-context-not-found', 'Run snapshot 在派发审计时消失。');
      }
      return updated;
    });
    return mark();
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

      this.assertProgressArtifactsBelongToTask(brief, input.taskId);
      this.assertRequirementPromptHashesMatch(brief);
      if (sourceKind === 'assistant-summary' && input.sourceRunId !== undefined) {
        const sourceRun = this.getRunSource(input.sourceRunId, input.taskId);
        if (sourceRun.status !== 'completed') {
          throw new TaskContinuityError(
            'source-run-not-completed',
            '只有 completed Run 可以产生助手进度。',
          );
        }
        const progress = brief.progress;
        if (
          progress?.authoredBy !== 'assistant-summary' ||
          progress.sourceRunId !== input.sourceRunId ||
          progress.sourcePromptHash !== this.promptHash(sourceRun.prompt)
        ) {
          throw new TaskContinuityError(
            'source-prompt-hash-mismatch',
            '助手进度必须绑定来源 Run 的精确 prompt hash。',
          );
        }
        for (const versionId of progress.artifactVersionIds) {
          if (this.getArtifactVersionSourceRunId(versionId) !== input.sourceRunId) {
            throw new TaskContinuityError(
              'artifact-version-unavailable',
              '助手进度只能列出由来源 Run 登记的 ArtifactVersion。',
            );
          }
        }
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
      if (
        sourceKind === 'assistant-summary' &&
        (JSON.stringify(brief.objective) !== JSON.stringify(current.brief.objective) ||
          JSON.stringify(brief.activeRequirements) !==
            JSON.stringify(current.brief.activeRequirements))
      ) {
        throw new TaskContinuityError(
          'invalid-revision-source',
          '确定性 Run 进度更新不能改写 Task 目标或活跃要求。',
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
    const run = this.getRunSource(runId, taskId);
    if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
      throw new TaskContinuityError(
        'invalid-revision-source',
        'Task Continuity revision 只能引用已进入终态的 Run。',
      );
    }
  }

  private getRunSource(runId: string, taskId: string): { status: string; prompt: string } {
    const run = this.db
      .prepare('SELECT status, prompt FROM runs WHERE id = ? AND task_id = ?')
      .get(runId, taskId) as (RunOwnerRow & { prompt: string }) | undefined;
    if (!run) {
      throw new TaskContinuityError('run-task-mismatch', '来源 Run 不存在或不属于该 Task。');
    }
    return run;
  }

  private promptHash(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex');
  }

  private assertRequirementPromptHashesMatch(brief: TaskContinuityBrief): void {
    for (const requirement of brief.activeRequirements) {
      for (const source of requirement.sources ?? []) {
        const run = this.db.prepare('SELECT prompt FROM runs WHERE id = ?').get(source.runId) as
          { prompt: string } | undefined;
        if (!run || this.promptHash(run.prompt) !== source.promptHash) {
          throw new TaskContinuityError(
            'source-prompt-hash-mismatch',
            '活跃要求的来源 prompt hash 与持久化 Run 不匹配。',
          );
        }
      }
    }
  }

  private assertProgressArtifactsBelongToTask(brief: TaskContinuityBrief, taskId: string): void {
    for (const versionId of brief.progress?.artifactVersionIds ?? []) {
      const row = this.db
        .prepare(
          `SELECT a.task_id FROM artifact_versions v
             JOIN artifacts a ON a.id = v.artifact_id
            WHERE v.id = ?`,
        )
        .get(versionId) as { task_id: string } | undefined;
      if (!row || row.task_id !== taskId) {
        throw new TaskContinuityError(
          'artifact-version-unavailable',
          'Task Continuity 进度引用的 ArtifactVersion 不存在或不属于当前 Task。',
        );
      }
    }
  }

  private getArtifactVersionSourceRunId(versionId: string): string | undefined {
    const row = this.db
      .prepare('SELECT source_run_id FROM artifact_versions WHERE id = ?')
      .get(versionId) as { source_run_id: string } | undefined;
    return row?.source_run_id || undefined;
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
