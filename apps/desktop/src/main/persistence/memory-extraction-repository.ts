import { randomUUID } from 'node:crypto';

import {
  type ListCursor,
  type MaterialReference,
  MEMORY_EXTRACTION_CONCURRENCY,
  MEMORY_EXTRACTION_QUEUE_LIMIT,
  MEMORY_JOB_LIST_DEFAULT_LIMIT,
  MEMORY_JOB_LIST_MAX_LIMIT,
  type MemoryDependency,
  type MemoryExtractionFragment,
  memoryExtractionFragmentSchema,
  type MemoryExtractionJob,
  memoryExtractionJobSchema,
  type MemoryExtractionOutcome,
  memoryExtractionOutcomeSchema,
  type MemoryExtractionSource,
  type MemoryExtractionUsage,
  memoryExtractionUsageSchema,
  type MemoryJobErrorCode,
  memoryJobErrorCodeSchema,
  type MemoryJobStatus,
  type MemoryJobSummary,
  memoryJobSummarySchema,
  type MemoryJobTrigger,
  type WorkspaceMemorySettings,
  workspaceMemorySettingsSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { MemoryConflictError, MemoryValidationError } from './memory-repository';

/** §7.2：queued 上限是全局额度，超出的自动触发不排队、也不影响主 Run 终态。 */
export class MemoryQueueFullError extends Error {
  constructor(message = '自动提炼队列已满，本次不排队。') {
    super(message);
    this.name = 'MemoryQueueFullError';
  }
}

/** §7.3：revision/attempt/status 任一不符即拒绝落库，迟到结果不能覆盖已取消或已重试的作业。 */
export class MemoryJobStateConflictError extends Error {
  constructor(message = '作业状态已变化，本次结果不落库。') {
    super(message);
    this.name = 'MemoryJobStateConflictError';
  }
}

/** 关闭开关要连带取消本空间的自动作业，因此设置写入自带取消数量。 */
export interface MemorySettingsWriteOutcome {
  settings: WorkspaceMemorySettings;
  effect: 'created' | 'updated' | 'unchanged';
  cancelledJobCount: number;
}

export interface EnqueueExtractionJobInput {
  source: MemoryExtractionSource;
  workspaceId: string;
  taskId: string;
  fragments: readonly MemoryExtractionFragment[];
  /** §7.3：内容快照哈希，与触发类型＋真实来源 id 一起构成来源键。 */
  sourceVersionHash: string;
  trigger: MemoryJobTrigger;
  inputCodePoints: number;
  materialDependencies?: readonly MaterialReference[];
  memoryDependencies?: readonly MemoryDependency[];
  modelProfileId?: string;
  modelSnapshot?: Record<string, unknown>;
  consentRevision?: number;
  at?: number;
}

export interface JobEnqueueOutcome {
  job: MemoryExtractionJob;
  /** existing ＝ 同来源版本已经提炼过或已在队列里，不重复提交。 */
  effect: 'created' | 'existing';
}

export interface JobTerminalPatch {
  jobId: string;
  expectedRevision: number;
  expectedAttempt: number;
  errorCode?: MemoryJobErrorCode;
  at?: number;
}

export interface JobSuccessPatch extends Omit<JobTerminalPatch, 'errorCode'> {
  outcome: MemoryExtractionOutcome;
  outputCodePoints: number;
  usage?: MemoryExtractionUsage;
}

export interface MemoryJobListQuery {
  workspaceId: string;
  taskId?: string;
  cursor?: ListCursor;
  limit?: number;
}

export interface MemoryJobListPage {
  items: MemoryJobSummary[];
  nextCursor?: ListCursor;
}

interface JobRow {
  id: string;
  source_key: string;
  workspace_id: string;
  task_id: string;
  run_id: string | null;
  checkpoint_id: string | null;
  source_snapshot_json: string;
  source_version_hash: string;
  material_dependencies_json: string;
  memory_dependencies_json: string;
  model_profile_id: string | null;
  model_snapshot_json: string | null;
  trigger: MemoryJobTrigger;
  consent_revision: number | null;
  status: MemoryJobStatus;
  revision: number;
  attempt: number;
  input_code_points: number;
  output_code_points: number;
  usage_json: string | null;
  result_json: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  model_label: string | null;
}

interface SettingsRow {
  workspace_id: string;
  revision: number;
  auto_suggest_enabled: number;
  consent_version: string | null;
  consented_at: number | null;
  updated_at: number;
}

const ACTIVE_JOB_STATUSES: readonly MemoryJobStatus[] = ['queued', 'running'];
const RETRYABLE_JOB_STATUSES: readonly MemoryJobStatus[] = [
  'failed',
  'cancelled',
  'interrupted',
  'skipped',
];
const parseJson = (value: string): unknown => JSON.parse(value) as unknown;

/**
 * §7.3：来源键＝触发类型＋真实来源 id＋内容快照 hash。
 * 故意不含模型版本——换模型不得绕过同一来源版本的去重，否则同一轮回答会被反复提炼。
 */
export const extractionSourceKey = (
  source: MemoryExtractionSource,
  sourceVersionHash: string,
): string => {
  const sourceId = source.kind === 'run' ? source.runId : source.checkpointId;
  return `${source.kind}:${sourceId}:${sourceVersionHash}`;
};

const sourceOf = (row: JobRow): MemoryExtractionSource =>
  row.run_id === null
    ? { kind: 'checkpoint', checkpointId: row.checkpoint_id ?? '' }
    : { kind: 'run', runId: row.run_id };

const toJob = (row: JobRow): MemoryExtractionJob =>
  memoryExtractionJobSchema.parse({
    id: row.id,
    sourceKey: row.source_key,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    source: sourceOf(row),
    fragments: memoryExtractionFragmentSchema
      .array()
      .max(3)
      .parse(parseJson(row.source_snapshot_json)),
    sourceVersionHash: row.source_version_hash,
    materialDependencies: parseJson(row.material_dependencies_json),
    memoryDependencies: parseJson(row.memory_dependencies_json),
    ...(row.model_profile_id === null ? {} : { modelProfileId: row.model_profile_id }),
    ...(row.model_snapshot_json === null
      ? {}
      : { modelSnapshot: parseJson(row.model_snapshot_json) as Record<string, unknown> }),
    trigger: row.trigger,
    ...(row.consent_revision === null ? {} : { consentRevision: row.consent_revision }),
    status: row.status,
    revision: row.revision,
    attempt: row.attempt,
    inputCodePoints: row.input_code_points,
    outputCodePoints: row.output_code_points,
    ...(row.usage_json === null
      ? {}
      : { usage: memoryExtractionUsageSchema.parse(parseJson(row.usage_json)) }),
    ...(row.result_json === null
      ? {}
      : { outcome: memoryExtractionOutcomeSchema.parse(parseJson(row.result_json)) }),
    ...(row.error_code === null
      ? {}
      : { errorCode: memoryJobErrorCodeSchema.parse(row.error_code) }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  });

const toSummary = (row: JobRow): MemoryJobSummary => {
  const job = toJob(row);
  return memoryJobSummarySchema.parse({
    id: job.id,
    workspaceId: job.workspaceId,
    taskId: job.taskId,
    source: job.source,
    status: job.status,
    revision: job.revision,
    attempt: job.attempt,
    trigger: job.trigger,
    ...(row.model_label === null ? {} : { modelLabel: row.model_label.slice(0, 160) }),
    candidateCount: job.outcome?.candidateRevisionIds.length ?? 0,
    ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
};

/** consent_version 列是 TEXT，DTO 是正整数；读回必须是纯数字，否则视为存储损坏。 */
const parseConsentVersion = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw new MemoryValidationError('自动建议同意版本记录异常，请在设置中重新确认。');
  }
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : undefined;
};

const toSettings = (row: SettingsRow): WorkspaceMemorySettings =>
  workspaceMemorySettingsSchema.parse({
    workspaceId: row.workspace_id,
    revision: row.revision,
    autoSuggestEnabled: row.auto_suggest_enabled === 1,
    ...(parseConsentVersion(row.consent_version) === undefined
      ? {}
      : { consentVersion: parseConsentVersion(row.consent_version) }),
    ...(row.consented_at === null ? {} : { consentedAt: row.consented_at }),
    updatedAt: row.updated_at,
  });

/**
 * 自动建议设置与提炼作业生命周期（契约 §7.3、§8.2）。
 *
 * 这里只有状态机与额度，没有任何网络调用：排队失败不能把已成功的主 Run 改失败，
 * 迟到结果由 revision/attempt/status 三重条件更新挡下，启动收口把遗留 queued/running
 * 落成 interrupted 且不自动触网。
 */
export class MemoryExtractionRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** §8.2：没有行就是 revision 0／关闭，缺省绝不能触发模型调用。 */
  getSettings(workspaceId: string): WorkspaceMemorySettings {
    const row = this.db
      .prepare('SELECT * FROM workspace_memory_settings WHERE workspace_id = ?')
      .get(workspaceId) as SettingsRow | undefined;
    if (row) return toSettings(row);
    return workspaceMemorySettingsSchema.parse({
      workspaceId,
      revision: 0,
      autoSuggestEnabled: false,
      updatedAt: 0,
    });
  }

  /**
   * 设置写入与「关闭开关取消本空间自动作业」在同一事务里完成；
   * 回执由调用方在同一事务内用 MemoryOperationRepository.append 补写。
   */
  applySettings(input: {
    workspaceId: string;
    expectedRevision: number;
    autoSuggestEnabled: boolean;
    consentVersion?: number;
    at?: number;
  }): MemorySettingsWriteOutcome {
    const workspace = this.db
      .prepare('SELECT id FROM workspaces WHERE id = ?')
      .get(input.workspaceId);
    if (!workspace) throw new MemoryValidationError('工作空间不存在。');
    const current = this.getSettings(input.workspaceId);
    if (current.revision !== input.expectedRevision) {
      throw new MemoryConflictError(
        `期望设置修订 ${input.expectedRevision}，当前 ${current.revision}。`,
      );
    }
    if (input.autoSuggestEnabled && input.consentVersion === undefined) {
      throw new MemoryValidationError('开启自动建议必须提交当前同意版本。');
    }
    const sameConsent =
      input.consentVersion === undefined || input.consentVersion === current.consentVersion;
    if (current.autoSuggestEnabled === input.autoSuggestEnabled && sameConsent) {
      return {
        settings: current,
        effect: 'unchanged',
        cancelledJobCount: 0,
      };
    }
    const now = input.at ?? this.clock();
    const consentVersion = input.consentVersion ?? current.consentVersion;
    if (input.autoSuggestEnabled && consentVersion === undefined) {
      throw new MemoryValidationError('开启自动建议必须提交当前同意版本。');
    }
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workspace_memory_settings (
             workspace_id, revision, auto_suggest_enabled, consent_version, consented_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             revision = excluded.revision,
             auto_suggest_enabled = excluded.auto_suggest_enabled,
             consent_version = excluded.consent_version,
             consented_at = excluded.consented_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.workspaceId,
          current.revision + 1,
          input.autoSuggestEnabled ? 1 : 0,
          consentVersion === undefined ? null : String(consentVersion),
          input.consentVersion === undefined
            ? (current.consentedAt ?? null)
            : (current.consentedAt ?? now),
          now,
        );
      const cancelledJobCount = input.autoSuggestEnabled
        ? 0
        : this.cancelAutomaticJobs(input.workspaceId, now);
      return { settings: this.getSettings(input.workspaceId), cancelledJobCount };
    });
    const applied = run();
    return {
      settings: applied.settings,
      effect: current.revision === 0 ? 'created' : 'updated',
      cancelledJobCount: applied.cancelledJobCount,
    };
  }

  get(jobId: string): MemoryExtractionJob | undefined {
    const row = this.db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(jobId) as JobRow | undefined;
    return row ? toJob(row) : undefined;
  }

  findBySource(
    source: MemoryExtractionSource,
    sourceVersionHash: string,
  ): MemoryExtractionJob | undefined {
    const row = this.db
      .prepare(`${JOB_SELECT} WHERE j.source_key = ?`)
      .get(extractionSourceKey(source, sourceVersionHash)) as JobRow | undefined;
    return row ? toJob(row) : undefined;
  }

  /**
   * §7.3：同一来源版本只有一个逻辑作业；succeeded 即使 0 条也不再提炼。
   * queued 满 20 直接抛 MEMORY_QUEUE_FULL，由调用方记录安全诊断。
   */
  enqueue(input: EnqueueExtractionJobInput): JobEnqueueOutcome {
    const source = input.source;
    const existing = this.findBySource(source, input.sourceVersionHash);
    if (existing) return { job: existing, effect: 'existing' };
    this.assertSourceOwnership(input);
    if (this.countByStatus(['queued']) >= MEMORY_EXTRACTION_QUEUE_LIMIT) {
      throw new MemoryQueueFullError();
    }
    const now = input.at ?? this.clock();
    const runId = source.kind === 'run' ? source.runId : null;
    const checkpointId = source.kind === 'checkpoint' ? source.checkpointId : null;
    this.db
      .prepare(
        `INSERT INTO memory_extraction_jobs (
           id, source_key, workspace_id, task_id, run_id, checkpoint_id,
           source_snapshot_json, source_version_hash, material_dependencies_json,
           memory_dependencies_json, model_profile_id, model_snapshot_json, trigger,
           consent_revision, status, revision, attempt, input_code_points, output_code_points,
           usage_json, result_json, error_code, created_at, updated_at, started_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, 1, ?, 0, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        randomUUID(),
        extractionSourceKey(source, input.sourceVersionHash),
        input.workspaceId,
        input.taskId,
        runId,
        checkpointId,
        JSON.stringify(input.fragments),
        input.sourceVersionHash,
        JSON.stringify(input.materialDependencies ?? []),
        JSON.stringify(input.memoryDependencies ?? []),
        input.modelProfileId ?? null,
        input.modelSnapshot === undefined ? null : JSON.stringify(input.modelSnapshot),
        input.trigger,
        input.consentRevision ?? null,
        input.inputCodePoints,
        now,
        now,
      );
    const created = this.db
      .prepare(`${JOB_SELECT} WHERE j.source_key = ?`)
      .get(extractionSourceKey(source, input.sourceVersionHash)) as JobRow | undefined;
    if (!created) throw new MemoryValidationError('提炼作业登记后无法读回。');
    return { job: toJob(created), effect: 'created' };
  }

  /** §7.2：全局并发 1；同一时刻只有一个作业能从 queued 进入 running。 */
  claimNext(at = this.clock()): MemoryExtractionJob | undefined {
    if (this.countByStatus(['running']) >= MEMORY_EXTRACTION_CONCURRENCY) return undefined;
    const candidate = this.db
      .prepare(
        `SELECT id, updated_at FROM memory_extraction_jobs
          WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get() as { id: string; updated_at: number } | undefined;
    if (!candidate) return undefined;
    const startedAt = Math.max(at, candidate.updated_at);
    const result = this.db
      .prepare(
        `UPDATE memory_extraction_jobs
            SET status = 'running', started_at = ?, updated_at = ?
          WHERE id = ? AND status = 'queued'`,
      )
      .run(startedAt, startedAt, candidate.id);
    if (result.changes !== 1) return undefined;
    return this.get(candidate.id);
  }

  /** 执行前条件不满足：直接 skipped，不消耗模型调用。 */
  markSkipped(patch: JobTerminalPatch): MemoryExtractionJob {
    return this.finish(patch, 'skipped');
  }

  cancel(patch: JobTerminalPatch): MemoryExtractionJob {
    return this.finish(patch, 'cancelled');
  }

  fail(patch: JobTerminalPatch): MemoryExtractionJob {
    return this.finish(patch, 'failed');
  }

  /** 取消后先落终态再中止请求；成功落候选必须带 revision/attempt 双条件。 */
  succeed(patch: JobSuccessPatch): MemoryExtractionJob {
    const outcome = memoryExtractionOutcomeSchema.parse(patch.outcome);
    const at = patch.at ?? this.clock();
    const usage =
      patch.usage === undefined
        ? null
        : JSON.stringify(memoryExtractionUsageSchema.parse(patch.usage));
    const result = this.db
      .prepare(
        `UPDATE memory_extraction_jobs
            SET status = 'succeeded', result_json = ?, usage_json = ?, output_code_points = ?,
                error_code = NULL, finished_at = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND status = 'running' AND revision = ? AND attempt = ?`,
      )
      .run(
        JSON.stringify(outcome),
        usage,
        patch.outputCodePoints,
        at,
        at,
        patch.jobId,
        patch.expectedRevision,
        patch.expectedAttempt,
      );
    if (result.changes !== 1) {
      throw new MemoryJobStateConflictError();
    }
    const job = this.get(patch.jobId);
    if (!job) throw new MemoryJobStateConflictError();
    return job;
  }

  /** 手动重试：attempt 递增，回执由调用方在同一事务里补写。 */
  retry(input: {
    jobId: string;
    expectedRevision: number;
    consentVersion: number;
    at?: number;
  }): MemoryExtractionJob {
    const job = this.get(input.jobId);
    if (!job) throw new MemoryValidationError('提炼作业不存在。');
    if (job.revision !== input.expectedRevision) {
      throw new MemoryConflictError(
        `期望作业修订 ${input.expectedRevision}，当前 ${job.revision}。`,
      );
    }
    if (!RETRYABLE_JOB_STATUSES.includes(job.status)) {
      throw new MemoryJobStateConflictError(`${job.status} 状态的作业不能重试。`);
    }
    const now = input.at ?? this.clock();
    const result = this.db
      .prepare(
        `UPDATE memory_extraction_jobs
            SET status = 'queued', trigger = 'manual-retry', consent_revision = ?, attempt = attempt + 1,
                revision = revision + 1, error_code = NULL, finished_at = NULL, started_at = NULL,
                updated_at = ?
          WHERE id = ? AND revision = ? AND status IN ('failed', 'cancelled', 'interrupted', 'skipped')`,
      )
      .run(input.consentVersion, now, input.jobId, input.expectedRevision);
    if (result.changes !== 1) {
      throw new MemoryJobStateConflictError();
    }
    const retried = this.get(input.jobId);
    if (!retried) throw new MemoryJobStateConflictError();
    return retried;
  }

  countByStatus(statuses: readonly MemoryJobStatus[]): number {
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM memory_extraction_jobs WHERE status IN (${placeholders})`,
      )
      .get(...statuses) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  queuedCount(): number {
    return this.countByStatus(['queued']);
  }

  runningCount(): number {
    return this.countByStatus(['running']);
  }

  /** §9.2：列表只回脱敏摘要，不含模型原文输入与错误正文。 */
  listPage(input: MemoryJobListQuery): MemoryJobListPage {
    const limit = Math.min(input.limit ?? MEMORY_JOB_LIST_DEFAULT_LIMIT, MEMORY_JOB_LIST_MAX_LIMIT);
    const conditions = ['j.workspace_id = ?'];
    const parameters: unknown[] = [input.workspaceId];
    if (input.taskId !== undefined) {
      conditions.push('j.task_id = ?');
      parameters.push(input.taskId);
    }
    if (input.cursor) {
      conditions.push('(j.updated_at < ? OR (j.updated_at = ? AND j.id > ?))');
      parameters.push(input.cursor.updatedAt, input.cursor.updatedAt, input.cursor.id);
    }
    const rows = this.db
      .prepare(
        `${JOB_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY j.updated_at DESC, j.id ASC LIMIT ?`,
      )
      .all(...parameters, limit + 1) as JobRow[];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toSummary),
      ...(rows.length > limit && last
        ? { nextCursor: { version: 1, updatedAt: last.updated_at, id: last.id } }
        : {}),
    };
  }

  /** §7.3：启动收口遗留 queued/running，零网络。 */
  interruptLeftoverJobs(at = this.clock()): number {
    const placeholders = ACTIVE_JOB_STATUSES.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE memory_extraction_jobs
            SET status = 'interrupted', error_code = 'INTERRUPTED', finished_at = ?,
                revision = revision + 1, updated_at = ?
          WHERE status IN (${placeholders})`,
      )
      .run(at, at, ...ACTIVE_JOB_STATUSES);
    return result.changes;
  }

  /** 关闭开关只取消本空间的自动作业，手动重试作业不动。 */
  cancelAutomaticJobs(workspaceId: string, at = this.clock()): number {
    const placeholders = ACTIVE_JOB_STATUSES.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE memory_extraction_jobs
            SET status = 'cancelled', error_code = 'CANCELLED', finished_at = ?,
                revision = revision + 1, updated_at = ?
          WHERE workspace_id = ? AND trigger = 'automatic' AND status IN (${placeholders})`,
      )
      .run(at, at, workspaceId, ...ACTIVE_JOB_STATUSES);
    return result.changes;
  }

  private finish(patch: JobTerminalPatch, status: MemoryJobStatus): MemoryExtractionJob {
    const at = patch.at ?? this.clock();
    const result = this.db
      .prepare(
        `UPDATE memory_extraction_jobs
            SET status = ?, error_code = ?, finished_at = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND status IN ('queued', 'running') AND revision = ? AND attempt = ?`,
      )
      .run(
        status,
        patch.errorCode ?? null,
        at,
        at,
        patch.jobId,
        patch.expectedRevision,
        patch.expectedAttempt,
      );
    if (result.changes !== 1) {
      throw new MemoryJobStateConflictError();
    }
    const job = this.get(patch.jobId);
    if (!job) throw new MemoryJobStateConflictError();
    return job;
  }

  private assertSourceOwnership(input: EnqueueExtractionJobInput): void {
    const task = this.db
      .prepare('SELECT workspace_id FROM tasks WHERE id = ?')
      .get(input.taskId) as { workspace_id: string } | undefined;
    if (!task) throw new MemoryValidationError('提炼作业的任务不存在。');
    if (task.workspace_id !== input.workspaceId) {
      throw new MemoryValidationError('提炼作业的来源任务不属于该工作空间。');
    }
    if (input.source.kind === 'run') {
      const run = this.db
        .prepare('SELECT task_id FROM runs WHERE id = ?')
        .get(input.source.runId) as { task_id: string } | undefined;
      if (!run) throw new MemoryValidationError('提炼作业的来源运行不存在。');
      if (run.task_id !== input.taskId) {
        throw new MemoryValidationError('提炼作业的来源运行不属于该任务。');
      }
      return;
    }
    const checkpoint = this.db
      .prepare('SELECT task_id FROM discussion_checkpoints WHERE id = ?')
      .get(input.source.checkpointId) as { task_id: string } | undefined;
    if (!checkpoint) throw new MemoryValidationError('提炼作业的来源讨论节点不存在。');
    if (checkpoint.task_id !== input.taskId) {
      throw new MemoryValidationError('提炼作业的来源讨论节点不属于该任务。');
    }
  }
}

const JOB_SELECT = `
  SELECT j.*, mp.name AS model_label
    FROM memory_extraction_jobs j
    LEFT JOIN model_profiles mp ON mp.id = j.model_profile_id
`;
