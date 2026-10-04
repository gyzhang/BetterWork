import { randomUUID } from 'node:crypto';

import {
  type ListScheduleOccurrencesRequest,
  listScheduleOccurrencesRequestSchema,
  type ScheduleOccurrence,
  scheduleOccurrenceSchema,
  type SchedulePageCursor,
  schedulePageCursorSchema,
  type SchedulePreparationOutcome,
  schedulePreparationOutcomeSchema,
  type ScheduleResolvedPeriod,
  scheduleResolvedPeriodSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ScheduleOccurrenceRow {
  id: string;
  schedule_id: string;
  config_version: number;
  trigger: ScheduleOccurrence['trigger'];
  scheduled_at: number | null;
  requested_at: number;
  request_key: string | null;
  original_occurrence_id: string | null;
  period_json: string;
  phase: ScheduleOccurrence['phase'];
  preparation_outcome: SchedulePreparationOutcome | null;
  reason_code: ScheduleOccurrence['reasonCode'] | null;
  reason_detail: string | null;
  task_id: string | null;
  session_id: string | null;
  first_run_id: string | null;
  source_snapshot_id: string | null;
  created_at: number;
  prepared_at: number | null;
  finished_at: number | null;
}

interface ClaimableScheduleRow {
  id: string;
  workspace_id: string;
  revision: number;
  current_config_version: number;
  lifecycle: 'enabled' | 'paused' | 'archived';
  next_scheduled_at: number | null;
  enabled_config_version: number | null;
}

export interface ScheduleOccurrencePage {
  items: ScheduleOccurrence[];
  nextCursor?: SchedulePageCursor;
}

export type ScheduleOccurrenceClaim =
  | {
      kind: 'created' | 'existing' | 'skipped-overlap';
      occurrence: ScheduleOccurrence;
    }
  | { kind: 'busy'; existingOccurrenceId: string };

export interface ClaimScheduledOccurrenceInput {
  id?: string;
  scheduleId: string;
  scheduledAt: number;
  requestedAt: number;
  period: ScheduleResolvedPeriod;
  nextScheduledAt?: number;
}

export interface ClaimMissedOccurrenceInput extends ClaimScheduledOccurrenceInput {
  reasonCode?: ScheduleOccurrence['reasonCode'];
  reasonDetail: string;
}

export type ClaimManualOccurrenceInput =
  | {
      id?: string;
      scheduleId: string;
      trigger: 'manual-now';
      requestKey: string;
      requestedAt: number;
      period: ScheduleResolvedPeriod;
      expectedRevision?: number;
    }
  | {
      id?: string;
      scheduleId: string;
      trigger: 'manual-missed';
      requestKey: string;
      requestedAt: number;
      originalOccurrenceId: string;
      expectedRevision?: number;
    };

export class ScheduleOccurrenceError extends Error {
  constructor(
    readonly code:
      'schedule_not_found' | 'schedule_archived' | 'schedule_conflict' | 'schedule_invalid_timing',
    message: string,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = 'ScheduleOccurrenceError';
  }
}

export class ScheduleRequestKeyConflictError extends Error {
  constructor(scheduleId: string, requestKey: string) {
    super(`Schedule request key belongs to a different trigger: ${scheduleId}/${requestKey}`);
    this.name = 'ScheduleRequestKeyConflictError';
  }
}

export class ScheduleOccurrenceStateError extends Error {
  constructor(occurrenceId: string, phase: string | undefined) {
    super(`Schedule occurrence cannot close from phase ${phase ?? 'missing'}: ${occurrenceId}`);
    this.name = 'ScheduleOccurrenceStateError';
  }
}

const parseJson = <T>(value: string, parser: { parse(input: unknown): T }): T => {
  const decoded: unknown = JSON.parse(value);
  return parser.parse(decoded);
};

const validTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

const toOccurrence = (row: ScheduleOccurrenceRow): ScheduleOccurrence =>
  scheduleOccurrenceSchema.parse({
    id: row.id,
    scheduleId: row.schedule_id,
    configVersion: row.config_version,
    trigger: row.trigger,
    ...(row.scheduled_at === null ? {} : { scheduledAt: row.scheduled_at }),
    requestedAt: row.requested_at,
    ...(row.request_key === null ? {} : { requestKey: row.request_key }),
    ...(row.original_occurrence_id === null
      ? {}
      : { originalOccurrenceId: row.original_occurrence_id }),
    period: parseJson(row.period_json, scheduleResolvedPeriodSchema),
    phase: row.phase,
    ...(row.preparation_outcome === null ? {} : { preparationOutcome: row.preparation_outcome }),
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    ...(row.reason_detail === null ? {} : { reasonDetail: row.reason_detail }),
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.first_run_id === null ? {} : { firstRunId: row.first_run_id }),
    ...(row.source_snapshot_id === null ? {} : { sourceSnapshotId: row.source_snapshot_id }),
    createdAt: row.created_at,
    ...(row.prepared_at === null ? {} : { preparedAt: row.prepared_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  });

/** T2 占用和 cursor 推进只写 schedule_occurrences / schedules，二者共用一笔事务。 */
export class ScheduleOccurrenceRepository {
  constructor(private readonly db: Database.Database) {}

  private getRow(occurrenceId: string): ScheduleOccurrenceRow | undefined {
    return this.db.prepare('SELECT * FROM schedule_occurrences WHERE id = ?').get(occurrenceId) as
      ScheduleOccurrenceRow | undefined;
  }

  get(occurrenceId: string): ScheduleOccurrence | undefined {
    const row = this.getRow(occurrenceId);
    return row ? toOccurrence(row) : undefined;
  }

  /** T3 发布清单后关联来源快照；调用方将其与清单发布包在同一 AppStore 事务。 */
  attachSourceSnapshot(occurrenceId: string, sourceSnapshotId: string): ScheduleOccurrence {
    const current = this.get(occurrenceId);
    if (!current || current.phase !== 'preparing') {
      throw new ScheduleOccurrenceStateError(occurrenceId, current?.phase);
    }
    if (current.sourceSnapshotId === sourceSnapshotId) return current;
    if (current.sourceSnapshotId !== undefined) {
      throw new ScheduleOccurrenceStateError(occurrenceId, current.phase);
    }
    const source = this.db
      .prepare('SELECT occurrence_id FROM schedule_source_snapshots WHERE id = ?')
      .get(sourceSnapshotId) as { occurrence_id: string } | undefined;
    if (!source || source.occurrence_id !== occurrenceId) {
      throw new Error('Schedule source snapshot does not belong to occurrence');
    }
    const update = this.db
      .prepare(
        `UPDATE schedule_occurrences SET source_snapshot_id = ?
          WHERE id = ? AND phase = 'preparing' AND source_snapshot_id IS NULL`,
      )
      .run(sourceSnapshotId, occurrenceId);
    if (update.changes !== 1) {
      throw new ScheduleOccurrenceStateError(occurrenceId, this.get(occurrenceId)?.phase);
    }
    const saved = this.get(occurrenceId);
    if (!saved) throw new Error('Schedule occurrence unavailable after source attachment');
    return saved;
  }

  /** T3 原子关联新 Task/Session 与 ready 来源快照；外层事务同时保存 TaskContextRevision。 */
  attachPreparedTask(input: {
    occurrenceId: string;
    taskId: string;
    sessionId: string;
    sourceSnapshotId: string;
    preparedAt: number;
  }): ScheduleOccurrence {
    validTimestamp(input.preparedAt, 'preparedAt');
    const attach = this.db.transaction(() => {
      const current = this.get(input.occurrenceId);
      if (!current) throw new ScheduleOccurrenceStateError(input.occurrenceId, undefined);
      if (
        current.taskId === input.taskId &&
        current.sessionId === input.sessionId &&
        current.sourceSnapshotId === input.sourceSnapshotId &&
        current.preparedAt !== undefined
      ) {
        return current;
      }
      if (
        current.phase !== 'preparing' ||
        current.taskId !== undefined ||
        current.sessionId !== undefined ||
        current.preparedAt !== undefined ||
        current.firstRunId !== undefined ||
        current.sourceSnapshotId !== input.sourceSnapshotId
      ) {
        throw new ScheduleOccurrenceStateError(input.occurrenceId, current.phase);
      }

      const relation = this.db
        .prepare(
          `SELECT sc.workspace_id AS schedule_workspace_id, t.workspace_id AS task_workspace_id,
                  se.task_id AS session_task_id, ss.occurrence_id AS source_occurrence_id,
                  ss.workspace_id AS source_workspace_id, ss.config_version AS source_config_version,
                  ss.status AS source_status
             FROM schedule_occurrences o
             JOIN schedules sc ON sc.id = o.schedule_id
             JOIN tasks t ON t.id = ?
             JOIN sessions se ON se.id = ?
             JOIN schedule_source_snapshots ss ON ss.id = ?
            WHERE o.id = ?`,
        )
        .get(input.taskId, input.sessionId, input.sourceSnapshotId, input.occurrenceId) as
        | {
            schedule_workspace_id: string;
            task_workspace_id: string;
            session_task_id: string;
            source_occurrence_id: string;
            source_workspace_id: string;
            source_config_version: number;
            source_status: string;
          }
        | undefined;
      if (
        !relation ||
        relation.schedule_workspace_id !== relation.task_workspace_id ||
        relation.session_task_id !== input.taskId ||
        relation.source_occurrence_id !== input.occurrenceId ||
        relation.source_workspace_id !== relation.schedule_workspace_id ||
        relation.source_config_version !== current.configVersion ||
        relation.source_status !== 'ready'
      ) {
        throw new Error('Prepared Task, Session, and ready source must belong to the occurrence');
      }

      const update = this.db
        .prepare(
          `UPDATE schedule_occurrences
              SET task_id = ?, session_id = ?, prepared_at = ?
            WHERE id = ? AND phase = 'preparing' AND task_id IS NULL AND session_id IS NULL
              AND source_snapshot_id = ? AND prepared_at IS NULL AND first_run_id IS NULL`,
        )
        .run(
          input.taskId,
          input.sessionId,
          input.preparedAt,
          input.occurrenceId,
          input.sourceSnapshotId,
        );
      if (update.changes !== 1) {
        throw new ScheduleOccurrenceStateError(
          input.occurrenceId,
          this.get(input.occurrenceId)?.phase,
        );
      }
      const saved = this.get(input.occurrenceId);
      if (!saved) throw new Error('Prepared Schedule occurrence was not available');
      return saved;
    });
    return attach();
  }

  /** T4 在 Run、RunContextSnapshot 与记忆审计的同一事务里登记唯一首个 Run。 */
  dispatchRun(input: {
    occurrenceId: string;
    runId: string;
    taskId: string;
    sessionId: string;
    taskContextRevisionId: string;
  }): ScheduleOccurrence {
    const dispatch = this.db.transaction(() => {
      const current = this.get(input.occurrenceId);
      if (!current) throw new ScheduleOccurrenceStateError(input.occurrenceId, undefined);
      if (
        current.firstRunId === input.runId &&
        current.taskId === input.taskId &&
        current.sessionId === input.sessionId
      ) {
        return current;
      }
      if (
        current.phase !== 'preparing' ||
        current.taskId !== input.taskId ||
        current.sessionId !== input.sessionId ||
        !current.sourceSnapshotId ||
        current.preparedAt === undefined ||
        current.firstRunId !== undefined
      ) {
        throw new ScheduleOccurrenceStateError(input.occurrenceId, current.phase);
      }

      const relation = this.db
        .prepare(
          `SELECT r.task_id AS run_task_id, r.session_id AS run_session_id, r.status AS run_status,
                  rcs.task_id AS context_task_id,
                  rcs.task_context_revision_id AS context_revision_id,
                  rcs.expert_id AS context_expert_id,
                  rcs.expert_revision_id AS context_expert_revision_id,
                  rcs.schedule_source_snapshot_id AS context_source_snapshot_id,
                  sc.workspace_id AS schedule_workspace_id,
                  sc.lifecycle AS schedule_lifecycle,
                  sc.current_config_version AS current_config_version,
                  sr.expert_id AS schedule_expert_id,
                  sr.expert_revision_id AS schedule_expert_revision_id
             FROM runs r
             JOIN run_context_snapshots rcs ON rcs.run_id = r.id
             JOIN schedule_occurrences o ON o.id = ?
             JOIN schedules sc ON sc.id = o.schedule_id
             JOIN schedule_configs sr
               ON sr.schedule_id = o.schedule_id AND sr.version = o.config_version
            WHERE r.id = ?`,
        )
        .get(input.occurrenceId, input.runId) as
        | {
            run_task_id: string;
            run_session_id: string;
            run_status: string;
            context_task_id: string;
            context_revision_id: string | null;
            context_expert_id: string | null;
            context_expert_revision_id: string | null;
            context_source_snapshot_id: string | null;
            schedule_workspace_id: string;
            schedule_lifecycle: string;
            current_config_version: number;
            schedule_expert_id: string;
            schedule_expert_revision_id: string;
          }
        | undefined;
      const task = this.db
        .prepare('SELECT workspace_id FROM tasks WHERE id = ?')
        .get(input.taskId) as { workspace_id: string } | undefined;
      const taskContext = this.db
        .prepare(
          'SELECT task_id, schedule_source_snapshot_id FROM task_context_revisions WHERE id = ?',
        )
        .get(input.taskContextRevisionId) as
        { task_id: string; schedule_source_snapshot_id: string | null } | undefined;
      if (
        !relation ||
        !task ||
        relation.run_task_id !== input.taskId ||
        relation.run_session_id !== input.sessionId ||
        relation.run_status !== 'running' ||
        relation.schedule_lifecycle === 'archived' ||
        (current.trigger === 'scheduled' && relation.schedule_lifecycle !== 'enabled') ||
        relation.current_config_version !== current.configVersion ||
        relation.context_task_id !== input.taskId ||
        relation.context_revision_id !== input.taskContextRevisionId ||
        relation.context_source_snapshot_id !== current.sourceSnapshotId ||
        relation.context_expert_id !== relation.schedule_expert_id ||
        relation.context_expert_revision_id !== relation.schedule_expert_revision_id ||
        relation.schedule_workspace_id !== task.workspace_id ||
        taskContext?.task_id !== input.taskId ||
        taskContext.schedule_source_snapshot_id !== current.sourceSnapshotId
      ) {
        throw new Error('Scheduled Run context does not match its prepared occurrence');
      }

      const update = this.db
        .prepare(
          `UPDATE schedule_occurrences
              SET phase = 'dispatched', first_run_id = ?
            WHERE id = ? AND phase = 'preparing' AND task_id = ? AND session_id = ?
              AND source_snapshot_id = ? AND first_run_id IS NULL`,
        )
        .run(
          input.runId,
          input.occurrenceId,
          input.taskId,
          input.sessionId,
          current.sourceSnapshotId,
        );
      if (update.changes !== 1) {
        throw new ScheduleOccurrenceStateError(
          input.occurrenceId,
          this.get(input.occurrenceId)?.phase,
        );
      }
      const saved = this.get(input.occurrenceId);
      if (!saved) throw new Error('Dispatched Schedule occurrence was not available');
      return saved;
    });
    return dispatch();
  }

  private insert(occurrence: ScheduleOccurrence): void {
    this.db
      .prepare(
        `INSERT INTO schedule_occurrences (
           id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
           original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
           reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
           prepared_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        occurrence.id,
        occurrence.scheduleId,
        occurrence.configVersion,
        occurrence.trigger,
        occurrence.scheduledAt ?? null,
        occurrence.requestedAt,
        occurrence.requestKey ?? null,
        occurrence.originalOccurrenceId ?? null,
        JSON.stringify(occurrence.period),
        occurrence.phase,
        occurrence.preparationOutcome ?? null,
        occurrence.reasonCode ?? null,
        occurrence.reasonDetail ?? null,
        occurrence.taskId ?? null,
        occurrence.sessionId ?? null,
        occurrence.firstRunId ?? null,
        occurrence.sourceSnapshotId ?? null,
        occurrence.createdAt,
        occurrence.preparedAt ?? null,
        occurrence.finishedAt ?? null,
      );
  }

  private findAutomatic(scheduleId: string, scheduledAt: number): ScheduleOccurrence | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM schedule_occurrences
         WHERE schedule_id = ? AND trigger = 'scheduled' AND scheduled_at = ?`,
      )
      .get(scheduleId, scheduledAt) as ScheduleOccurrenceRow | undefined;
    return row ? toOccurrence(row) : undefined;
  }

  private findRequest(scheduleId: string, requestKey: string): ScheduleOccurrence | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM schedule_occurrences
         WHERE schedule_id = ? AND trigger IN ('manual-now', 'manual-missed') AND request_key = ?`,
      )
      .get(scheduleId, requestKey) as ScheduleOccurrenceRow | undefined;
    return row ? toOccurrence(row) : undefined;
  }

  findManualRequest(input: {
    scheduleId: string;
    requestKey: string;
    trigger: 'manual-now' | 'manual-missed';
    originalOccurrenceId?: string;
  }): ScheduleOccurrence | undefined {
    const duplicate = this.findRequest(input.scheduleId, input.requestKey.trim());
    if (!duplicate) return undefined;
    if (
      duplicate.trigger !== input.trigger ||
      (input.trigger === 'manual-missed' &&
        duplicate.originalOccurrenceId !== input.originalOccurrenceId)
    ) {
      throw new ScheduleRequestKeyConflictError(input.scheduleId, input.requestKey.trim());
    }
    return duplicate;
  }

  private findActive(scheduleId: string): ScheduleOccurrence | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM schedule_occurrences
         WHERE schedule_id = ? AND (
           phase = 'preparing' OR (
             phase = 'dispatched' AND EXISTS (
               SELECT 1 FROM runs r WHERE r.id = schedule_occurrences.first_run_id
                 AND r.status = 'running'
             )
           )
         )
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get(scheduleId) as ScheduleOccurrenceRow | undefined;
    return row ? toOccurrence(row) : undefined;
  }

  private getScheduleRow(scheduleId: string): ClaimableScheduleRow | undefined {
    return this.db
      .prepare(
        `SELECT id, workspace_id, revision, current_config_version, lifecycle,
                next_scheduled_at, enabled_config_version
         FROM schedules WHERE id = ?`,
      )
      .get(scheduleId) as ClaimableScheduleRow | undefined;
  }

  claimScheduled(input: ClaimScheduledOccurrenceInput): ScheduleOccurrenceClaim {
    return this.claimScheduledWithDisposition(input);
  }

  claimMissedScheduled(input: ClaimMissedOccurrenceInput): ScheduleOccurrenceClaim {
    return this.claimScheduledWithDisposition(input, {
      outcome: 'missed',
      ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
      reasonDetail: input.reasonDetail,
    });
  }

  skipScheduledForCapacity(
    input: ClaimScheduledOccurrenceInput & { reasonDetail: string },
  ): ScheduleOccurrenceClaim {
    return this.claimScheduledWithDisposition(input, {
      outcome: 'skipped-overlap',
      reasonCode: 'schedule_capacity',
      reasonDetail: input.reasonDetail,
    });
  }

  private claimScheduledWithDisposition(
    input: ClaimScheduledOccurrenceInput,
    disposition?: {
      outcome: 'missed' | 'skipped-overlap';
      reasonCode?: ScheduleOccurrence['reasonCode'];
      reasonDetail: string;
    },
  ): ScheduleOccurrenceClaim {
    validTimestamp(input.scheduledAt, 'scheduledAt');
    validTimestamp(input.requestedAt, 'requestedAt');
    if (input.nextScheduledAt !== undefined) {
      validTimestamp(input.nextScheduledAt, 'nextScheduledAt');
      if (input.nextScheduledAt <= input.scheduledAt) {
        throw new ScheduleOccurrenceError(
          'schedule_invalid_timing',
          'Next schedule cursor must be later than the claimed occurrence',
        );
      }
    }
    const period = scheduleResolvedPeriodSchema.parse(input.period);
    const claim = this.db.transaction((): ScheduleOccurrenceClaim => {
      const duplicate = this.findAutomatic(input.scheduleId, input.scheduledAt);
      if (duplicate) return { kind: 'existing', occurrence: duplicate };

      const schedule = this.getScheduleRow(input.scheduleId);
      if (!schedule) {
        throw new ScheduleOccurrenceError('schedule_not_found', 'Schedule does not exist');
      }
      if (schedule.lifecycle !== 'enabled' || schedule.enabled_config_version === null) {
        throw new ScheduleOccurrenceError(
          schedule.lifecycle === 'archived' ? 'schedule_archived' : 'schedule_conflict',
          'Schedule is not enabled for automatic dispatch',
        );
      }
      if (schedule.next_scheduled_at !== input.scheduledAt) {
        throw new ScheduleOccurrenceError(
          'schedule_conflict',
          'Scheduled time no longer matches the current schedule cursor',
        );
      }
      const effectiveConfig = this.db
        .prepare('SELECT period_rule FROM schedule_configs WHERE schedule_id = ? AND version = ?')
        .get(input.scheduleId, schedule.enabled_config_version) as
        { period_rule: ScheduleResolvedPeriod['rule'] } | undefined;
      if (!effectiveConfig || effectiveConfig.period_rule !== period.rule) {
        throw new ScheduleOccurrenceError(
          'schedule_invalid_timing',
          'Resolved period does not match the enabled configuration',
        );
      }

      const active = this.findActive(input.scheduleId);
      const createdAt = input.requestedAt;
      const overlap = disposition === undefined && active !== undefined;
      const terminalDisposition =
        disposition ??
        (overlap
          ? {
              outcome: 'skipped-overlap' as const,
              reasonCode: 'schedule_busy' as const,
              reasonDetail: '已有计划实例正在准备或运行',
            }
          : undefined);
      const occurrence = scheduleOccurrenceSchema.parse({
        id: input.id ?? randomUUID(),
        scheduleId: schedule.id,
        configVersion: schedule.enabled_config_version,
        trigger: 'scheduled',
        scheduledAt: input.scheduledAt,
        requestedAt: input.requestedAt,
        period,
        phase: terminalDisposition ? 'closed' : 'preparing',
        ...(terminalDisposition
          ? {
              preparationOutcome: terminalDisposition.outcome,
              ...(terminalDisposition.reasonCode === undefined
                ? {}
                : { reasonCode: terminalDisposition.reasonCode }),
              reasonDetail: terminalDisposition.reasonDetail,
              finishedAt: input.requestedAt,
            }
          : {}),
        createdAt,
      });
      this.insert(occurrence);
      const update = this.db
        .prepare(
          `UPDATE schedules
           SET last_processed_scheduled_at = ?, next_scheduled_at = ?
           WHERE id = ? AND lifecycle = 'enabled' AND enabled_config_version = ?
             AND next_scheduled_at = ?`,
        )
        .run(
          input.scheduledAt,
          input.nextScheduledAt ?? null,
          input.scheduleId,
          schedule.enabled_config_version,
          input.scheduledAt,
        );
      if (update.changes !== 1) {
        throw new ScheduleOccurrenceError(
          'schedule_conflict',
          'Schedule cursor changed before the occurrence could be claimed',
        );
      }
      const saved = this.get(occurrence.id);
      if (!saved) throw new Error('Schedule occurrence was not available after claim');
      return terminalDisposition?.outcome === 'skipped-overlap'
        ? { kind: 'skipped-overlap', occurrence: saved }
        : { kind: 'created', occurrence: saved };
    });
    return claim();
  }

  claimManual(input: ClaimManualOccurrenceInput): ScheduleOccurrenceClaim {
    validTimestamp(input.requestedAt, 'requestedAt');
    const requestKey = input.requestKey.trim();
    if (requestKey.length === 0 || requestKey.length > 200) {
      throw new Error('Schedule request key must contain 1 to 200 characters');
    }
    const claim = this.db.transaction((): ScheduleOccurrenceClaim => {
      const duplicate = this.findRequest(input.scheduleId, requestKey);
      if (duplicate) {
        if (
          duplicate.trigger !== input.trigger ||
          (input.trigger === 'manual-missed' &&
            duplicate.originalOccurrenceId !== input.originalOccurrenceId)
        ) {
          throw new ScheduleRequestKeyConflictError(input.scheduleId, requestKey);
        }
        return { kind: 'existing', occurrence: duplicate };
      }

      const schedule = this.getScheduleRow(input.scheduleId);
      if (!schedule) {
        throw new ScheduleOccurrenceError('schedule_not_found', 'Schedule does not exist');
      }
      if (schedule.lifecycle === 'archived') {
        throw new ScheduleOccurrenceError('schedule_archived', 'Archived Schedule cannot run');
      }
      if (input.expectedRevision !== undefined && schedule.revision !== input.expectedRevision) {
        throw new ScheduleOccurrenceError(
          'schedule_conflict',
          'Schedule revision changed before the manual occurrence could be claimed',
          schedule.revision,
        );
      }

      let period: ScheduleResolvedPeriod;
      let originalOccurrenceId: string | undefined;
      if (input.trigger === 'manual-now') {
        period = scheduleResolvedPeriodSchema.parse(input.period);
        const currentConfig = this.db
          .prepare('SELECT period_rule FROM schedule_configs WHERE schedule_id = ? AND version = ?')
          .get(input.scheduleId, schedule.current_config_version) as
          { period_rule: ScheduleResolvedPeriod['rule'] } | undefined;
        if (!currentConfig || currentConfig.period_rule !== period.rule) {
          throw new ScheduleOccurrenceError(
            'schedule_invalid_timing',
            'Resolved period does not match the current configuration',
          );
        }
      } else {
        const original = this.get(input.originalOccurrenceId);
        if (
          !original ||
          original.scheduleId !== input.scheduleId ||
          original.trigger !== 'scheduled' ||
          original.phase !== 'closed' ||
          original.preparationOutcome !== 'missed'
        ) {
          throw new ScheduleOccurrenceError(
            'schedule_conflict',
            'Manual missed execution must reference a missed occurrence of the same Schedule',
          );
        }
        period = original.period;
        originalOccurrenceId = original.id;
      }

      const active = this.findActive(input.scheduleId);
      if (active) return { kind: 'busy', existingOccurrenceId: active.id };

      const occurrence = scheduleOccurrenceSchema.parse({
        id: input.id ?? randomUUID(),
        scheduleId: schedule.id,
        configVersion: schedule.current_config_version,
        trigger: input.trigger,
        requestedAt: input.requestedAt,
        requestKey,
        ...(originalOccurrenceId ? { originalOccurrenceId } : {}),
        period,
        phase: 'preparing',
        createdAt: input.requestedAt,
      });
      this.insert(occurrence);
      const saved = this.get(occurrence.id);
      if (!saved) throw new Error('Schedule occurrence was not available after manual claim');
      return { kind: 'created', occurrence: saved };
    });
    return claim();
  }

  closePreparation(input: {
    occurrenceId: string;
    outcome: SchedulePreparationOutcome;
    finishedAt: number;
    reasonCode?: ScheduleOccurrence['reasonCode'];
    reasonDetail?: string;
    taskId?: string;
  }): ScheduleOccurrence {
    validTimestamp(input.finishedAt, 'finishedAt');
    const outcome = schedulePreparationOutcomeSchema.parse(input.outcome);
    const close = this.db.transaction(() => {
      const current = this.get(input.occurrenceId);
      if (!current || current.phase !== 'preparing') {
        throw new ScheduleOccurrenceStateError(input.occurrenceId, current?.phase);
      }
      if (outcome === 'needs-material') {
        if (!input.taskId) throw new Error('needs-material closure requires its draft Task');
        const task = this.db
          .prepare(
            `SELECT t.workspace_id
             FROM tasks t
             JOIN schedules s ON s.id = ?
             WHERE t.id = ?`,
          )
          .get(current.scheduleId, input.taskId) as { workspace_id: string } | undefined;
        const schedule = this.getScheduleRow(current.scheduleId);
        if (!task || !schedule || task.workspace_id !== schedule.workspace_id) {
          throw new Error('needs-material Task must belong to the Schedule Workspace');
        }
      }
      const next = scheduleOccurrenceSchema.parse({
        ...current,
        phase: 'closed',
        preparationOutcome: outcome,
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
        ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        finishedAt: input.finishedAt,
      });
      const update = this.db
        .prepare(
          `UPDATE schedule_occurrences
           SET phase = 'closed', preparation_outcome = ?, reason_code = ?, reason_detail = ?,
               task_id = ?, finished_at = ?
           WHERE id = ? AND phase = 'preparing'`,
        )
        .run(
          next.preparationOutcome,
          next.reasonCode ?? null,
          next.reasonDetail ?? null,
          next.taskId ?? null,
          next.finishedAt,
          input.occurrenceId,
        );
      if (update.changes !== 1) {
        throw new ScheduleOccurrenceStateError(
          input.occurrenceId,
          this.get(input.occurrenceId)?.phase,
        );
      }
      const saved = this.get(input.occurrenceId);
      if (!saved) throw new Error('Closed Schedule occurrence was not available');
      return saved;
    });
    return close();
  }

  /** 暂停/归档只关闭尚未派发的准备；已经关联 Run 的实例保留原状态继续收口。 */
  cancelPreparing(scheduleId: string, finishedAt: number): string[] {
    validTimestamp(finishedAt, 'finishedAt');
    const cancel = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT id FROM schedule_occurrences
           WHERE schedule_id = ? AND phase = 'preparing' ORDER BY created_at, id`,
        )
        .all(scheduleId) as { id: string }[];
      if (rows.length === 0) return [];
      this.db
        .prepare(
          `UPDATE schedule_occurrences
           SET phase = 'closed', preparation_outcome = 'cancelled',
               reason_code = 'schedule_cancelled', reason_detail = ?, finished_at = ?
           WHERE schedule_id = ? AND phase = 'preparing'`,
        )
        .run('规则已暂停或归档，准备中的实例已取消', finishedAt, scheduleId);
      return rows.map((row) => row.id);
    });
    return cancel();
  }

  listBySchedule(request: ListScheduleOccurrencesRequest): ScheduleOccurrencePage {
    const query = listScheduleOccurrencesRequestSchema.parse(request);
    const parameters: (string | number)[] = [query.scheduleId];
    let cursorClause = '';
    if (query.cursor) {
      const cursor = schedulePageCursorSchema.parse(query.cursor);
      cursorClause = 'AND (created_at < ? OR (created_at = ? AND id < ?))';
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_occurrences
         WHERE schedule_id = ? ${cursorClause}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...parameters, query.limit + 1) as ScheduleOccurrenceRow[];
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    const items = selected.map(toOccurrence);
    const last = selected.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: { version: 1, createdAt: last.created_at, id: last.id } }
        : {}),
    };
  }
}
