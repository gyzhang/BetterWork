import {
  type ScheduleNotificationReceipt,
  scheduleNotificationReceiptSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ScheduleNotificationReceiptRow {
  occurrence_id: string;
  outcome_key: string;
  notification_id: string;
  created_at: number;
}

const toReceipt = (row: ScheduleNotificationReceiptRow): ScheduleNotificationReceipt =>
  scheduleNotificationReceiptSchema.parse({
    occurrenceId: row.occurrence_id,
    outcomeKey: row.outcome_key,
    notificationId: row.notification_id,
    createdAt: row.created_at,
  });

/** Keeps the initial Schedule outcome notification idempotent beyond notification retention. */
export class ScheduleNotificationRepository {
  constructor(private readonly db: Database.Database) {}

  get(occurrenceId: string, outcomeKey: string): ScheduleNotificationReceipt | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM schedule_notification_receipts
         WHERE occurrence_id = ? AND outcome_key = ?`,
      )
      .get(occurrenceId, outcomeKey) as ScheduleNotificationReceiptRow | undefined;
    return row ? toReceipt(row) : undefined;
  }

  create(input: ScheduleNotificationReceipt): ScheduleNotificationReceipt {
    const receipt = scheduleNotificationReceiptSchema.parse(input);
    const existing = this.get(receipt.occurrenceId, receipt.outcomeKey);
    if (existing) {
      if (existing.notificationId !== receipt.notificationId) {
        throw new Error('Schedule notification outcome already has a different receipt');
      }
      return existing;
    }
    this.db
      .prepare(
        `INSERT INTO schedule_notification_receipts (
           occurrence_id, outcome_key, notification_id, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(receipt.occurrenceId, receipt.outcomeKey, receipt.notificationId, receipt.createdAt);
    return receipt;
  }
}
