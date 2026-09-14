import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

export type InputSnapshotStatus = 'preparing' | 'ready' | 'failed' | 'cancelled';

export interface InputSnapshot {
  id: string;
  workspaceId: string;
  sourcePath: string;
  contentHash: string;
  byteSize: number;
  format: string;
  fileKey: string;
  status: InputSnapshotStatus;
  failureCode?: string;
  failureMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateInputSnapshotInput {
  id?: string;
  workspaceId: string;
  sourcePath: string;
  contentHash: string;
  byteSize: number;
  format: string;
  fileKey: string;
  createdAt: number;
}

interface InputSnapshotRow {
  id: string;
  workspace_id: string;
  source_path: string;
  content_hash: string;
  byte_size: number;
  format: string;
  file_key: string;
  status: InputSnapshotStatus;
  failure_code: string | null;
  failure_message: string | null;
  created_at: number;
  updated_at: number;
}

const toSnapshot = (row: InputSnapshotRow): InputSnapshot => ({
  id: row.id,
  workspaceId: row.workspace_id,
  sourcePath: row.source_path,
  contentHash: row.content_hash,
  byteSize: row.byte_size,
  format: row.format,
  fileKey: row.file_key,
  status: row.status,
  ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  ...(row.failure_message === null ? {} : { failureMessage: row.failure_message }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class InputSnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  createPreparing(input: CreateInputSnapshotInput): InputSnapshot {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO input_snapshots
          (id, workspace_id, source_path, content_hash, byte_size, format, file_key, status,
           failure_code, failure_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'preparing', NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.sourcePath,
        input.contentHash,
        input.byteSize,
        input.format,
        input.fileKey,
        input.createdAt,
        input.createdAt,
      );
    const snapshot = this.get(id);
    if (!snapshot) throw new Error(`Input snapshot ${id} was not readable after insert`);
    return snapshot;
  }

  get(id: string): InputSnapshot | undefined {
    const row = this.db.prepare('SELECT * FROM input_snapshots WHERE id = ?').get(id) as
      InputSnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  findReadyByHash(workspaceId: string, contentHash: string): InputSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM input_snapshots
          WHERE workspace_id = ? AND content_hash = ? AND status = 'ready'
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(workspaceId, contentHash) as InputSnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  list(status?: InputSnapshotStatus): InputSnapshot[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM input_snapshots WHERE status = ? ORDER BY updated_at DESC')
          .all(status) as InputSnapshotRow[])
      : (this.db
          .prepare('SELECT * FROM input_snapshots ORDER BY updated_at DESC')
          .all() as InputSnapshotRow[]);
    return rows.map(toSnapshot);
  }

  markReady(id: string, updatedAt: number): InputSnapshot | undefined {
    this.db
      .prepare(
        `UPDATE input_snapshots
            SET status = 'ready', failure_code = NULL, failure_message = NULL, updated_at = ?
          WHERE id = ? AND status IN ('preparing', 'ready')`,
      )
      .run(updatedAt, id);
    return this.get(id);
  }

  markFailed(id: string, code: string, message: string, updatedAt: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE input_snapshots
            SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = ?
          WHERE id = ? AND status IN ('preparing', 'ready')`,
      )
      .run(code, message, updatedAt, id);
    return result.changes === 1;
  }

  markCancelled(id: string, updatedAt: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE input_snapshots
            SET status = 'cancelled', failure_code = 'cancelled',
                failure_message = '快照准备已取消。', updated_at = ?
          WHERE id = ? AND status = 'preparing'`,
      )
      .run(updatedAt, id);
    return result.changes === 1;
  }
}
