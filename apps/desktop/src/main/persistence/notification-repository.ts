import { randomUUID } from 'node:crypto';

import type {
  CreateNotificationInput,
  NotificationKind,
  NotificationLevel,
  NotificationSummary,
  NotificationTarget,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface NotificationRow {
  id: string;
  level: NotificationLevel;
  kind: NotificationKind;
  title: string;
  detail: string | null;
  target_kind: string | null;
  target_id: string | null;
  schedule_id?: string | null;
  read: 0 | 1;
  created_at: number;
}

interface CountRow {
  count: number;
}

/** 滚动上限：通知是操作留档不是日志，超出后淘汰最旧，避免无限增长。 */
const RETENTION_LIMIT = 200;

const toTarget = (row: NotificationRow): NotificationTarget | undefined => {
  if (row.target_kind === 'task' && row.target_id) return { kind: 'task', taskId: row.target_id };
  if (row.target_kind === 'artifact' && row.target_id) {
    return { kind: 'artifact', artifactId: row.target_id };
  }
  if (row.target_kind === 'knowledge') return { kind: 'knowledge' };
  if (row.target_kind === 'schedule-rule' && row.target_id) {
    return { kind: 'schedule', scheduleId: row.target_id };
  }
  if (row.target_kind === 'schedule-occurrence' && row.target_id && row.schedule_id) {
    return { kind: 'schedule', scheduleId: row.schedule_id, occurrenceId: row.target_id };
  }
  return undefined;
};

const toSummary = (row: NotificationRow): NotificationSummary => {
  const target = toTarget(row);
  return {
    id: row.id,
    level: row.level,
    kind: row.kind,
    title: row.title,
    ...(row.detail === null ? {} : { detail: row.detail }),
    ...(target ? { target } : {}),
    read: row.read === 1,
    createdAt: row.created_at,
  };
};

/**
 * Notification 是一次操作结果的可回溯留档（ADR-0006）。
 * target 是设计上的必填意图：没有跳转目标的通知无法回溯。
 * `target_kind` 与 `target_id` 两列承载可辨识联合，读取时还原为联合类型。
 */
export class NotificationRepository {
  constructor(private readonly db: Database.Database) {}

  private selectRows(): string {
    return `SELECT n.*,
              CASE
                WHEN n.target_kind = 'schedule-rule' THEN n.target_id
                WHEN n.target_kind = 'schedule-occurrence' THEN o.schedule_id
              END AS schedule_id
            FROM notifications n
            LEFT JOIN schedule_occurrences o
              ON n.target_kind = 'schedule-occurrence' AND o.id = n.target_id`;
  }

  get(notificationId: string): NotificationSummary | undefined {
    const row = this.db.prepare(`${this.selectRows()} WHERE n.id = ?`).get(notificationId) as
      NotificationRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  /**
   * `read` 由调用方决定：仓储只管「怎么写」，「哪一类结果不该再打扰用户」是
   * `NotificationService` 的策略（docs/10 §11.5.1）。
   */
  save(input: CreateNotificationInput, options?: { read?: boolean }): NotificationSummary {
    const row: NotificationRow = {
      id: randomUUID(),
      level: input.level,
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? null,
      target_kind: targetKindOf(input.target),
      target_id: targetIdOf(input.target),
      ...(input.target?.kind === 'schedule' ? { schedule_id: input.target.scheduleId } : {}),
      read: options?.read ? 1 : 0,
      created_at: Date.now(),
    };
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO notifications
             (id, level, kind, title, detail, target_kind, target_id, read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.level,
          row.kind,
          row.title,
          row.detail,
          row.target_kind,
          row.target_id,
          row.read,
          row.created_at,
        );
      this.db
        .prepare(
          `DELETE FROM notifications
            WHERE rowid NOT IN (
              SELECT rowid FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT ?
            )`,
        )
        .run(RETENTION_LIMIT);
    });
    write();
    return toSummary(row);
  }

  list(): NotificationSummary[] {
    const rows = this.db
      .prepare(`${this.selectRows()} ORDER BY n.created_at DESC, n.rowid DESC LIMIT ?`)
      .all(RETENTION_LIMIT) as NotificationRow[];
    return rows.map(toSummary);
  }

  markRead(id: string): number {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
    return this.unreadCount();
  }

  markAllRead(): number {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    return this.unreadCount();
  }

  clear(): void {
    this.db.prepare('DELETE FROM notifications').run();
  }

  unreadCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM notifications WHERE read = 0')
      .get() as CountRow;
    return row.count;
  }
}

function targetIdOf(target: NotificationTarget | undefined): string | null {
  if (!target) return null;
  if (target.kind === 'task') return target.taskId;
  if (target.kind === 'artifact') return target.artifactId;
  if (target.kind === 'schedule') return target.occurrenceId ?? target.scheduleId;
  return null;
}

function targetKindOf(target: NotificationTarget | undefined): string | null {
  if (!target) return null;
  if (target.kind === 'schedule') {
    return target.occurrenceId ? 'schedule-occurrence' : 'schedule-rule';
  }
  return target.kind;
}
