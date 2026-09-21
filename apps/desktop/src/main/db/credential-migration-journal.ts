import { type CredentialOwnerKind, credentialOwnerKindSchema } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export type CredentialMigrationStatus = 'pending' | 'done' | 'failed';

/** 一条 legacy 密钥的迁移进度（不含任何 secret 值）。 */
export interface CredentialJournalEntry {
  ownerKind: CredentialOwnerKind;
  ownerId: string;
  slot: string;
  status: CredentialMigrationStatus;
  errorCode?: string;
}

interface JournalRow {
  owner_kind: string;
  owner_id: string;
  slot: string;
  status: CredentialMigrationStatus;
  error_code: string | null;
}

const toEntry = (row: JournalRow): CredentialJournalEntry => ({
  ownerKind: credentialOwnerKindSchema.parse(row.owner_kind),
  ownerId: row.owner_id,
  slot: row.slot,
  status: row.status,
  ...(row.error_code ? { errorCode: row.error_code } : {}),
});

/**
 * credential_migration_journal 的仓储：只记录 owner 三元组 + 状态 + 错误码，绝不写 secret 值。
 * v25 迁移为现存明文 Key 播 pending；CredentialMigrationService 逐条推进；崩溃后按当前状态重放。
 */
export class CredentialMigrationJournalRepository {
  constructor(private readonly db: Database.Database) {}

  statusOf(
    ownerKind: CredentialOwnerKind,
    ownerId: string,
    slot: string,
  ): CredentialMigrationStatus | 'none' {
    const row = this.db
      .prepare(
        'SELECT status FROM credential_migration_journal WHERE owner_kind = ? AND owner_id = ? AND slot = ?',
      )
      .get(ownerKind, ownerId, slot) as { status: CredentialMigrationStatus } | undefined;
    return row?.status ?? 'none';
  }

  /** 若该 owner/slot 尚无迁移记录则播一条 pending（幂等）；v25 种子与测试用。 */
  ensurePending(ownerKind: CredentialOwnerKind, ownerId: string, slot: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO credential_migration_journal (owner_kind, owner_id, slot, status, updated_at)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .run(ownerKind, ownerId, slot, Date.now());
  }

  listPending(): CredentialJournalEntry[] {
    const rows = this.db
      .prepare(
        `SELECT owner_kind, owner_id, slot, status, error_code
           FROM credential_migration_journal WHERE status = 'pending'
          ORDER BY owner_kind, owner_id, slot`,
      )
      .all() as JournalRow[];
    return rows.map(toEntry);
  }

  /** 已完成迁移的 owner：启动扫描用它们确认明文列有没有被重新写回。 */
  listDone(): CredentialJournalEntry[] {
    const rows = this.db
      .prepare(
        `SELECT owner_kind, owner_id, slot, status, error_code
           FROM credential_migration_journal WHERE status = 'done'
          ORDER BY owner_kind, owner_id, slot`,
      )
      .all() as JournalRow[];
    return rows.map(toEntry);
  }

  markDone(ownerKind: CredentialOwnerKind, ownerId: string, slot: string): void {
    this.db
      .prepare(
        `INSERT INTO credential_migration_journal (owner_kind, owner_id, slot, status, error_code, updated_at)
         VALUES (?, ?, ?, 'done', NULL, ?)
         ON CONFLICT(owner_kind, owner_id, slot) DO UPDATE SET
           status = 'done', error_code = NULL, updated_at = excluded.updated_at`,
      )
      .run(ownerKind, ownerId, slot, Date.now());
  }

  markFailed(
    ownerKind: CredentialOwnerKind,
    ownerId: string,
    slot: string,
    errorCode: string,
  ): void {
    this.db
      .prepare(
        `UPDATE credential_migration_journal
            SET status = 'failed', error_code = ?, updated_at = ?
          WHERE owner_kind = ? AND owner_id = ? AND slot = ?`,
      )
      .run(errorCode, Date.now(), ownerKind, ownerId, slot);
  }
}
