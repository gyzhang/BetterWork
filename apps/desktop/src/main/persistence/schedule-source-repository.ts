import { createHash, randomUUID } from 'node:crypto';

import { materialListIdentity } from '@betterwork/agent-protocol';
import {
  type ListScheduleSourceItemsRequest,
  listScheduleSourceItemsRequestSchema,
  materialReferenceSchema,
  SCHEDULE_SOURCE_ITEM_MAX,
  SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  type ScheduleDomainErrorCode,
  type ScheduleSourceCursor,
  type ScheduleSourceItem,
  scheduleSourceItemSchema,
  type ScheduleSourceSnapshot,
  scheduleSourceSnapshotSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ScheduleSourceSnapshotRow {
  id: string;
  occurrence_id: string;
  workspace_id: string;
  status: ScheduleSourceSnapshot['status'];
  config_version: number;
  evaluated_at: number;
  manifest_hash: string;
  item_count: number;
  total_file_bytes: number;
  failure_code: ScheduleDomainErrorCode | null;
  created_at: number;
  completed_at: number | null;
}

interface ScheduleSourceItemRow {
  snapshot_id: string;
  ordinal: number;
  reference_json: string;
  purpose: ScheduleSourceItem['purpose'];
  origin: ScheduleSourceItem['origin'];
  display_name: string;
  source_path: string | null;
}

export interface ScheduleSourceItemsPage {
  items: ScheduleSourceItem[];
  nextCursor?: ScheduleSourceCursor;
}

export interface ScheduleSourceRecoveryRow {
  occurrenceId: string;
  occurrencePhase: 'preparing' | 'dispatched' | 'closed';
  preparationOutcome?: string;
  snapshotId?: string;
  snapshotStatus?: ScheduleSourceSnapshot['status'];
}

export class ScheduleSourceRepositoryError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleSourceRepositoryError';
  }
}

const EMPTY_MANIFEST_HASH = createHash('sha256').update('[]').digest('hex');

const validTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

const toSnapshot = (row: ScheduleSourceSnapshotRow): ScheduleSourceSnapshot =>
  scheduleSourceSnapshotSchema.parse({
    id: row.id,
    occurrenceId: row.occurrence_id,
    workspaceId: row.workspace_id,
    status: row.status,
    configVersion: row.config_version,
    evaluatedAt: row.evaluated_at,
    manifestHash: row.manifest_hash,
    itemCount: row.item_count,
    totalFileBytes: row.total_file_bytes,
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    createdAt: row.created_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  });

const toItem = (row: ScheduleSourceItemRow): ScheduleSourceItem =>
  scheduleSourceItemSchema.parse({
    snapshotId: row.snapshot_id,
    ordinal: row.ordinal,
    reference: materialReferenceSchema.parse(JSON.parse(row.reference_json) as unknown),
    purpose: row.purpose,
    origin: row.origin,
    displayName: row.display_name,
    ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
  });

/** Validate the full Task → Occurrence → ready source binding before persisting context IDs. */
export const assertScheduleSourceReadyForTask = (
  db: Database.Database,
  snapshotId: string,
  taskId: string,
  workspaceId?: string,
): ScheduleSourceSnapshot => {
  const row = db
    .prepare(
      `SELECT s.*, o.task_id AS occurrence_task_id,
              o.source_snapshot_id AS occurrence_source_snapshot_id,
              sc.workspace_id AS schedule_workspace_id, t.workspace_id AS task_workspace_id
         FROM schedule_source_snapshots s
         JOIN schedule_occurrences o ON o.id = s.occurrence_id
         JOIN schedules sc ON sc.id = o.schedule_id
         JOIN tasks t ON t.id = ?
        WHERE s.id = ?`,
    )
    .get(taskId, snapshotId) as
    | (ScheduleSourceSnapshotRow & {
        occurrence_task_id: string | null;
        occurrence_source_snapshot_id: string | null;
        schedule_workspace_id: string;
        task_workspace_id: string;
      })
    | undefined;
  if (!row) {
    throw new ScheduleSourceRepositoryError('schedule_source_missing', '定时来源快照不存在。');
  }
  if (row.status !== 'ready') {
    throw new ScheduleSourceRepositoryError('schedule_source_missing', '定时来源快照尚未就绪。');
  }
  if (
    row.occurrence_task_id !== taskId ||
    row.occurrence_source_snapshot_id !== snapshotId ||
    row.schedule_workspace_id !== row.task_workspace_id ||
    (workspaceId !== undefined && row.task_workspace_id !== workspaceId)
  ) {
    throw new ScheduleSourceRepositoryError(
      'schedule_source_conflict',
      '定时来源快照不属于该 Task 或 Workspace。',
    );
  }
  return toSnapshot(row);
};

export const scheduleSourceManifestHash = (items: readonly ScheduleSourceItem[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        items.map((item) => [
          item.ordinal,
          materialListIdentity(item.reference),
          item.reference,
          item.purpose,
          item.origin,
          item.displayName,
          item.sourcePath ?? null,
        ]),
      ),
    )
    .digest('hex');

/** The source manifest lives in the App DB and is visible only after one atomic ready commit. */
export class ScheduleSourceRepository {
  constructor(private readonly db: Database.Database) {}

  get(snapshotId: string): ScheduleSourceSnapshot | undefined {
    const row = this.db
      .prepare('SELECT * FROM schedule_source_snapshots WHERE id = ?')
      .get(snapshotId) as ScheduleSourceSnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  getByOccurrence(occurrenceId: string): ScheduleSourceSnapshot | undefined {
    const row = this.db
      .prepare('SELECT * FROM schedule_source_snapshots WHERE occurrence_id = ?')
      .get(occurrenceId) as ScheduleSourceSnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  assertReadyForTask(
    snapshotId: string,
    taskId: string,
    workspaceId?: string,
  ): ScheduleSourceSnapshot {
    return assertScheduleSourceReadyForTask(this.db, snapshotId, taskId, workspaceId);
  }

  createPreparing(input: {
    id?: string;
    occurrenceId: string;
    evaluatedAt: number;
    createdAt: number;
  }): ScheduleSourceSnapshot {
    validTimestamp(input.evaluatedAt, 'evaluatedAt');
    validTimestamp(input.createdAt, 'createdAt');
    const create = this.db.transaction((): ScheduleSourceSnapshot => {
      const occurrence = this.db
        .prepare(
          `SELECT o.id, o.schedule_id, o.config_version, o.phase, s.workspace_id
             FROM schedule_occurrences o
             JOIN schedules s ON s.id = o.schedule_id
            WHERE o.id = ?`,
        )
        .get(input.occurrenceId) as
        | {
            id: string;
            schedule_id: string;
            config_version: number;
            phase: 'preparing' | 'dispatched' | 'closed';
            workspace_id: string;
          }
        | undefined;
      if (!occurrence) {
        throw new ScheduleSourceRepositoryError('schedule_not_found', '定时实例不存在。');
      }
      const existing = this.getByOccurrence(input.occurrenceId);
      if (existing) {
        if (
          existing.workspaceId !== occurrence.workspace_id ||
          existing.configVersion !== occurrence.config_version
        ) {
          throw new ScheduleSourceRepositoryError(
            'schedule_source_conflict',
            '本期已有来源快照与实例配置不匹配。',
          );
        }
        return existing;
      }
      if (occurrence.phase !== 'preparing') {
        throw new ScheduleSourceRepositoryError(
          'schedule_conflict',
          '只有尚未完成的实例可以准备来源。',
        );
      }
      const snapshot = scheduleSourceSnapshotSchema.parse({
        id: input.id ?? randomUUID(),
        occurrenceId: input.occurrenceId,
        workspaceId: occurrence.workspace_id,
        status: 'preparing',
        configVersion: occurrence.config_version,
        evaluatedAt: input.evaluatedAt,
        manifestHash: EMPTY_MANIFEST_HASH,
        itemCount: 0,
        totalFileBytes: 0,
        createdAt: input.createdAt,
      });
      this.db
        .prepare(
          `INSERT INTO schedule_source_snapshots (
             id, occurrence_id, workspace_id, status, config_version, evaluated_at, manifest_hash,
             item_count, total_file_bytes, failure_code, created_at, completed_at
           ) VALUES (?, ?, ?, 'preparing', ?, ?, ?, 0, 0, NULL, ?, NULL)`,
        )
        .run(
          snapshot.id,
          snapshot.occurrenceId,
          snapshot.workspaceId,
          snapshot.configVersion,
          snapshot.evaluatedAt,
          snapshot.manifestHash,
          snapshot.createdAt,
        );
      const saved = this.get(snapshot.id);
      if (!saved) throw new Error('Preparing Schedule source snapshot was not readable');
      return saved;
    });
    return create();
  }

  publishReady(input: {
    snapshotId: string;
    items: readonly Omit<ScheduleSourceItem, 'snapshotId' | 'ordinal'>[];
    totalFileBytes: number;
    manifestHash: string;
    completedAt: number;
  }): ScheduleSourceSnapshot {
    validTimestamp(input.totalFileBytes, 'totalFileBytes');
    validTimestamp(input.completedAt, 'completedAt');
    if (
      input.totalFileBytes > SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX ||
      input.items.length > SCHEDULE_SOURCE_ITEM_MAX
    ) {
      throw new ScheduleSourceRepositoryError(
        'schedule_source_budget_exceeded',
        '本期来源超过固定数量或文件体积上限。',
      );
    }
    const items = input.items.map((item, ordinal) =>
      scheduleSourceItemSchema.parse({ snapshotId: input.snapshotId, ordinal, ...item }),
    );
    const calculatedManifestHash = scheduleSourceManifestHash(items);
    if (input.manifestHash !== calculatedManifestHash) {
      throw new ScheduleSourceRepositoryError(
        'schedule_source_conflict',
        '来源清单摘要与实际条目不一致。',
      );
    }
    const keys = new Set(items.map((item) => materialListIdentity(item.reference)));
    if (keys.size !== items.length) {
      throw new ScheduleSourceRepositoryError(
        'schedule_source_conflict',
        '本期来源清单包含重复材料引用。',
      );
    }

    const publish = this.db.transaction((): ScheduleSourceSnapshot => {
      const current = this.get(input.snapshotId);
      if (!current) {
        throw new ScheduleSourceRepositoryError('schedule_source_missing', '来源快照不存在。');
      }
      if (current.status === 'ready') {
        if (
          current.manifestHash === calculatedManifestHash &&
          current.itemCount === items.length &&
          current.totalFileBytes === input.totalFileBytes
        ) {
          return current;
        }
        throw new ScheduleSourceRepositoryError(
          'schedule_source_conflict',
          '已发布的来源快照不能被另一个清单替换。',
        );
      }
      if (current.status !== 'preparing') {
        throw new ScheduleSourceRepositoryError(
          'schedule_conflict',
          '失败或取消的来源快照不能重新发布。',
        );
      }
      const occurrence = this.db
        .prepare('SELECT phase FROM schedule_occurrences WHERE id = ?')
        .get(current.occurrenceId) as { phase: string } | undefined;
      if (!occurrence || occurrence.phase !== 'preparing') {
        throw new ScheduleSourceRepositoryError(
          'schedule_cancelled',
          '来源准备期间对应实例已结束。',
        );
      }
      const insert = this.db.prepare(
        `INSERT INTO schedule_source_items (
           snapshot_id, ordinal, reference_json, purpose, origin, display_name, source_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of items) {
        insert.run(
          item.snapshotId,
          item.ordinal,
          JSON.stringify(item.reference),
          item.purpose,
          item.origin,
          item.displayName,
          item.sourcePath ?? null,
        );
      }
      const changed = this.db
        .prepare(
          `UPDATE schedule_source_snapshots
              SET status = 'ready', manifest_hash = ?, item_count = ?, total_file_bytes = ?,
                  failure_code = NULL, completed_at = ?
            WHERE id = ? AND status = 'preparing'`,
        )
        .run(
          calculatedManifestHash,
          items.length,
          input.totalFileBytes,
          input.completedAt,
          input.snapshotId,
        );
      if (changed.changes !== 1) {
        throw new ScheduleSourceRepositoryError(
          'schedule_source_conflict',
          '来源快照已被其他准备操作收口。',
        );
      }
      const saved = this.get(input.snapshotId);
      if (!saved) throw new Error('Ready Schedule source snapshot was not readable');
      return saved;
    });
    return publish();
  }

  finish(input: {
    snapshotId: string;
    status: 'failed' | 'cancelled';
    failureCode: ScheduleDomainErrorCode;
    completedAt: number;
  }): ScheduleSourceSnapshot {
    validTimestamp(input.completedAt, 'completedAt');
    const finish = this.db.transaction((): ScheduleSourceSnapshot => {
      const current = this.get(input.snapshotId);
      if (!current) {
        throw new ScheduleSourceRepositoryError('schedule_source_missing', '来源快照不存在。');
      }
      if (current.status !== 'preparing') {
        if (current.status === input.status && current.failureCode === input.failureCode) {
          return current;
        }
        if (current.status === 'ready') return current;
        throw new ScheduleSourceRepositoryError(
          'schedule_source_conflict',
          '来源快照已经以另一终态收口。',
        );
      }
      const itemCount = this.db
        .prepare('SELECT COUNT(*) AS count FROM schedule_source_items WHERE snapshot_id = ?')
        .get(input.snapshotId) as { count: number };
      if (itemCount.count !== 0) {
        throw new ScheduleSourceRepositoryError(
          'schedule_source_conflict',
          '准备中的来源快照意外包含条目，拒绝发布部分清单。',
        );
      }
      this.db
        .prepare(
          `UPDATE schedule_source_snapshots
              SET status = ?, failure_code = ?, completed_at = ?
            WHERE id = ? AND status = 'preparing'`,
        )
        .run(input.status, input.failureCode, input.completedAt, input.snapshotId);
      const saved = this.get(input.snapshotId);
      if (!saved) throw new Error('Finished Schedule source snapshot was not readable');
      return saved;
    });
    return finish();
  }

  listItems(request: ListScheduleSourceItemsRequest): ScheduleSourceItemsPage {
    const query = listScheduleSourceItemsRequestSchema.parse(request);
    const snapshot = this.getByOccurrence(query.occurrenceId);
    if (!snapshot || snapshot.status !== 'ready') {
      throw new ScheduleSourceRepositoryError(
        'schedule_source_missing',
        '本期尚无可读取的完整来源清单。',
      );
    }
    if (query.cursor && query.cursor.snapshotId !== snapshot.id) {
      throw new ScheduleSourceRepositoryError(
        'schedule_source_conflict',
        '来源分页游标不属于本期清单。',
      );
    }
    const parameters: (string | number)[] = [snapshot.id];
    let cursorClause = '';
    if (query.cursor) {
      cursorClause = 'AND ordinal > ?';
      parameters.push(query.cursor.ordinal);
    }
    parameters.push(query.limit + 1);
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_source_items
          WHERE snapshot_id = ? ${cursorClause}
          ORDER BY ordinal LIMIT ?`,
      )
      .all(...parameters) as ScheduleSourceItemRow[];
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map(toItem);
    const lastItem = items.at(-1);
    return {
      items,
      ...(hasMore && lastItem
        ? { nextCursor: { version: 1, snapshotId: snapshot.id, ordinal: lastItem.ordinal } }
        : {}),
    };
  }

  listRetainedInputSnapshotFileKeys(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT json_extract(i.reference_json, '$.fileKey') AS file_key
           FROM schedule_source_items i
           JOIN schedule_source_snapshots s ON s.id = i.snapshot_id
          WHERE s.status = 'ready'
            AND json_extract(i.reference_json, '$.kind') = 'workspace-input-snapshot'
          ORDER BY file_key COLLATE BINARY`,
      )
      .all() as Array<{ file_key: string | null }>;
    return rows.flatMap((row) =>
      row.file_key?.startsWith('input-snapshots/') && !row.file_key.includes('..')
        ? [row.file_key]
        : [],
    );
  }

  listForRecovery(): ScheduleSourceRecoveryRow[] {
    const rows = this.db
      .prepare(
        `SELECT o.id AS occurrence_id, o.phase AS occurrence_phase,
                o.preparation_outcome, s.id AS snapshot_id, s.status AS snapshot_status
           FROM schedule_occurrences o
           LEFT JOIN schedule_source_snapshots s ON s.occurrence_id = o.id
          WHERE o.phase = 'preparing' OR s.status = 'preparing'
          ORDER BY o.created_at, o.id`,
      )
      .all() as Array<{
      occurrence_id: string;
      occurrence_phase: ScheduleSourceRecoveryRow['occurrencePhase'];
      preparation_outcome: string | null;
      snapshot_id: string | null;
      snapshot_status: ScheduleSourceSnapshot['status'] | null;
    }>;
    return rows.map((row) => ({
      occurrenceId: row.occurrence_id,
      occurrencePhase: row.occurrence_phase,
      ...(row.preparation_outcome === null ? {} : { preparationOutcome: row.preparation_outcome }),
      ...(row.snapshot_id === null ? {} : { snapshotId: row.snapshot_id }),
      ...(row.snapshot_status === null ? {} : { snapshotStatus: row.snapshot_status }),
    }));
  }
}
