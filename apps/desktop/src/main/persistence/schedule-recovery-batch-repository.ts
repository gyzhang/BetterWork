import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

export interface ScheduleRecoveryCursor {
  readonly scheduleId: string;
  readonly scheduledAt: number;
}

export interface ScheduleRecoveryBatch {
  readonly batchKey: string;
  readonly cutoffAt: number;
  readonly phase: 'processing' | 'completed';
  readonly cursor?: ScheduleRecoveryCursor;
  readonly coveredOccurrenceIds: readonly string[];
  readonly notificationId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

interface ScheduleRecoveryBatchRow {
  batch_key: string;
  cutoff_at: number;
  phase: ScheduleRecoveryBatch['phase'];
  cursor_schedule_id: string | null;
  cursor_scheduled_at: number | null;
  covered_occurrence_ids_json: string;
  notification_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

const validTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

const occurrenceIdsOf = (json: string): string[] => {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) {
    throw new Error('Schedule recovery batch occurrence IDs are invalid');
  }
  const ids: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error('Schedule recovery batch occurrence IDs are invalid');
    }
    ids.push(item);
  }
  return ids;
};

const toBatch = (row: ScheduleRecoveryBatchRow): ScheduleRecoveryBatch => {
  const common = {
    batchKey: row.batch_key,
    cutoffAt: row.cutoff_at,
    phase: row.phase,
    coveredOccurrenceIds: occurrenceIdsOf(row.covered_occurrence_ids_json),
    ...(row.notification_id === null ? {} : { notificationId: row.notification_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return {
    ...common,
    ...(row.cursor_schedule_id === null || row.cursor_scheduled_at === null
      ? {}
      : { cursor: { scheduleId: row.cursor_schedule_id, scheduledAt: row.cursor_scheduled_at } }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
};

/** 固定 cutoff 与游标、覆盖实例 ID 同批落库；恢复只续做未完成批次。 */
export class ScheduleRecoveryBatchRepository {
  constructor(private readonly db: Database.Database) {}

  private getRow(batchKey: string): ScheduleRecoveryBatchRow | undefined {
    return this.db
      .prepare('SELECT * FROM schedule_recovery_batches WHERE batch_key = ?')
      .get(batchKey) as ScheduleRecoveryBatchRow | undefined;
  }

  get(batchKey: string): ScheduleRecoveryBatch | undefined {
    const row = this.getRow(batchKey);
    return row ? toBatch(row) : undefined;
  }

  getProcessing(): ScheduleRecoveryBatch | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM schedule_recovery_batches WHERE phase = 'processing'
         ORDER BY created_at ASC, batch_key ASC LIMIT 1`,
      )
      .get() as ScheduleRecoveryBatchRow | undefined;
    return row ? toBatch(row) : undefined;
  }

  listCompletedWithoutNotification(limit = 100): ScheduleRecoveryBatch[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Schedule recovery notification limit must be between 1 and 500');
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_recovery_batches
         WHERE phase = 'completed' AND notification_id IS NULL
         ORDER BY completed_at ASC, batch_key ASC LIMIT ?`,
      )
      .all(limit) as ScheduleRecoveryBatchRow[];
    return rows.map(toBatch);
  }

  begin(input: { cutoffAt: number; createdAt: number; batchKey?: string }): ScheduleRecoveryBatch {
    validTimestamp(input.cutoffAt, 'cutoffAt');
    validTimestamp(input.createdAt, 'createdAt');
    const batchKey = input.batchKey?.trim() || randomUUID();
    const begin = this.db.transaction(() => {
      const processing = this.getProcessing();
      if (processing) return processing;
      const existing = this.get(batchKey);
      if (existing) return existing;
      this.db
        .prepare(
          `INSERT INTO schedule_recovery_batches (
             batch_key, cutoff_at, phase, cursor_schedule_id, cursor_scheduled_at,
             covered_occurrence_ids_json, notification_id, created_at, updated_at, completed_at
           ) VALUES (?, ?, 'processing', NULL, NULL, '[]', NULL, ?, ?, NULL)`,
        )
        .run(batchKey, input.cutoffAt, input.createdAt, input.createdAt);
      const saved = this.get(batchKey);
      if (!saved) throw new Error('Schedule recovery batch was not available after creation');
      return saved;
    });
    return begin();
  }

  recordOccurrence(input: {
    batchKey: string;
    cursor: ScheduleRecoveryCursor;
    occurrenceId: string;
    updatedAt: number;
  }): ScheduleRecoveryBatch {
    validTimestamp(input.cursor.scheduledAt, 'scheduledAt');
    validTimestamp(input.updatedAt, 'updatedAt');
    const current = this.get(input.batchKey);
    if (!current || current.phase !== 'processing') {
      throw new Error(`Schedule recovery batch is not processing: ${input.batchKey}`);
    }
    if (current.cursor) {
      const movedForward =
        input.cursor.scheduleId > current.cursor.scheduleId ||
        (input.cursor.scheduleId === current.cursor.scheduleId &&
          input.cursor.scheduledAt > current.cursor.scheduledAt);
      if (!movedForward) throw new Error('Schedule recovery cursor must move forward');
    }
    if (input.occurrenceId.trim().length === 0) {
      throw new Error('occurrenceId must not be empty');
    }
    const covered = new Set(current.coveredOccurrenceIds);
    covered.add(input.occurrenceId);
    const update = this.db
      .prepare(
        `UPDATE schedule_recovery_batches
         SET cursor_schedule_id = ?, cursor_scheduled_at = ?,
             covered_occurrence_ids_json = ?, updated_at = ?
         WHERE batch_key = ? AND phase = 'processing'`,
      )
      .run(
        input.cursor.scheduleId,
        input.cursor.scheduledAt,
        JSON.stringify([...covered]),
        input.updatedAt,
        input.batchKey,
      );
    if (update.changes !== 1) throw new Error('Schedule recovery batch changed during processing');
    const saved = this.get(input.batchKey);
    if (!saved) throw new Error('Schedule recovery batch disappeared after cursor update');
    return saved;
  }

  complete(input: { batchKey: string; completedAt: number }): ScheduleRecoveryBatch {
    validTimestamp(input.completedAt, 'completedAt');
    const update = this.db
      .prepare(
        `UPDATE schedule_recovery_batches
         SET phase = 'completed', completed_at = ?, updated_at = ?
         WHERE batch_key = ? AND phase = 'processing'`,
      )
      .run(input.completedAt, input.completedAt, input.batchKey);
    if (update.changes === 0) {
      const current = this.get(input.batchKey);
      if (current?.phase === 'completed') return current;
      throw new Error(`Schedule recovery batch cannot complete: ${input.batchKey}`);
    }
    const saved = this.get(input.batchKey);
    if (!saved) throw new Error('Schedule recovery batch disappeared after completion');
    return saved;
  }

  attachNotification(input: {
    batchKey: string;
    notificationId: string;
    updatedAt: number;
  }): ScheduleRecoveryBatch {
    const notificationId = input.notificationId.trim();
    if (!notificationId) throw new Error('notificationId must not be empty');
    validTimestamp(input.updatedAt, 'updatedAt');
    const update = this.db
      .prepare(
        `UPDATE schedule_recovery_batches SET notification_id = ?, updated_at = ?
         WHERE batch_key = ? AND phase = 'completed' AND notification_id IS NULL`,
      )
      .run(notificationId, input.updatedAt, input.batchKey);
    if (update.changes === 0) {
      const current = this.get(input.batchKey);
      if (current?.phase === 'completed' && current.notificationId === notificationId) {
        return current;
      }
      throw new Error(`Schedule recovery batch cannot attach a notification: ${input.batchKey}`);
    }
    const saved = this.get(input.batchKey);
    if (!saved) throw new Error('Schedule recovery batch disappeared after notification attach');
    return saved;
  }
}
