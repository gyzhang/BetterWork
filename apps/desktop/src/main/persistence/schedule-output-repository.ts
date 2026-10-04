import { randomUUID } from 'node:crypto';

import {
  scheduleConfigDraftSchema,
  type ScheduleDomainErrorCode,
  type ScheduleOutputReceipt,
  scheduleOutputReceiptSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ScheduleOutputReceiptRow {
  id: string;
  occurrence_id: string;
  artifact_version_id: string;
  workspace_id: string;
  relative_path: string;
  content_hash: string;
  status: ScheduleOutputReceipt['status'];
  attempt: number;
  failure_code: ScheduleDomainErrorCode | null;
  failure_detail: string | null;
  created_at: number;
  updated_at: number;
}

export class ScheduleOutputRepositoryError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleOutputRepositoryError';
  }
}

const validTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

const isSafeRelativePath = (relativePath: string): boolean => {
  if (relativePath.includes('\\') || relativePath.startsWith('/')) return false;
  const segments = relativePath.split('/');
  return (
    segments[0] === '定时成果' &&
    segments.length === 2 &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
};

const toReceipt = (row: ScheduleOutputReceiptRow): ScheduleOutputReceipt =>
  scheduleOutputReceiptSchema.parse({
    id: row.id,
    occurrenceId: row.occurrence_id,
    artifactVersionId: row.artifact_version_id,
    workspaceId: row.workspace_id,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    status: row.status,
    attempt: row.attempt,
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    ...(row.failure_detail === null ? {} : { failureDetail: row.failure_detail }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

/** 定时成果回执只接受本期首个 Run 已登记且类型符合固定配置的版本。 */
export class ScheduleOutputRepository {
  constructor(private readonly db: Database.Database) {}

  private getRow(receiptId: string): ScheduleOutputReceiptRow | undefined {
    return this.db.prepare('SELECT * FROM schedule_output_receipts WHERE id = ?').get(receiptId) as
      ScheduleOutputReceiptRow | undefined;
  }

  get(receiptId: string): ScheduleOutputReceipt | undefined {
    const row = this.getRow(receiptId);
    return row ? toReceipt(row) : undefined;
  }

  listByOccurrence(occurrenceId: string): ScheduleOutputReceipt[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_output_receipts
         WHERE occurrence_id = ? ORDER BY created_at ASC, artifact_version_id ASC, id ASC`,
      )
      .all(occurrenceId) as ScheduleOutputReceiptRow[];
    return rows.map(toReceipt);
  }

  listIncomplete(): ScheduleOutputReceipt[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM schedule_output_receipts
         WHERE status IN ('pending', 'saving') ORDER BY created_at ASC, id ASC`,
      )
      .all() as ScheduleOutputReceiptRow[];
    return rows.map(toReceipt);
  }

  createPending(input: {
    id?: string;
    occurrenceId: string;
    artifactVersionId: string;
    relativePath: string;
    contentHash: string;
    createdAt: number;
  }): ScheduleOutputReceipt {
    validTimestamp(input.createdAt, 'createdAt');
    if (!isSafeRelativePath(input.relativePath)) {
      throw new ScheduleOutputRepositoryError(
        'schedule_conflict',
        '定时成果相对路径必须位于定时成果目录且只包含文件名。',
      );
    }
    const insert = this.db.transaction((): ScheduleOutputReceipt => {
      const provenance = this.db
        .prepare(
          `SELECT o.first_run_id, o.task_id, sc.workspace_id AS schedule_workspace_id,
                  t.workspace_id AS task_workspace_id, r.task_id AS run_task_id,
                  av.source_run_id, a.task_id AS artifact_task_id, a.type AS artifact_type,
                  av.content_hash AS markdown_content_hash, af.file_hash AS presentation_file_hash,
                  cfg.expected_artifact_types_json
             FROM artifact_versions av
             JOIN artifacts a ON a.id = av.artifact_id
             LEFT JOIN artifact_files af ON af.version_id = av.id
             JOIN schedule_occurrences o ON o.id = ?
             JOIN schedules sc ON sc.id = o.schedule_id
             JOIN schedule_configs cfg
               ON cfg.schedule_id = o.schedule_id AND cfg.version = o.config_version
             LEFT JOIN tasks t ON t.id = o.task_id
             LEFT JOIN runs r ON r.id = o.first_run_id
            WHERE av.id = ?`,
        )
        .get(input.occurrenceId, input.artifactVersionId) as
        | {
            first_run_id: string | null;
            task_id: string | null;
            schedule_workspace_id: string;
            task_workspace_id: string | null;
            run_task_id: string | null;
            source_run_id: string;
            artifact_task_id: string;
            artifact_type: 'markdown' | 'presentation';
            markdown_content_hash: string | null;
            presentation_file_hash: string | null;
            expected_artifact_types_json: string;
          }
        | undefined;
      if (!provenance) {
        throw new ScheduleOutputRepositoryError('schedule_not_found', '成果版本不存在。');
      }
      let expectedTypes: string[];
      try {
        const decoded: unknown = JSON.parse(provenance.expected_artifact_types_json);
        expectedTypes = scheduleConfigDraftSchema.shape.expectedArtifactTypes.parse(decoded);
      } catch (error) {
        throw new ScheduleOutputRepositoryError(
          'schedule_conflict',
          '本期固定配置的成果类型无效。',
          { cause: error },
        );
      }
      if (
        !provenance.first_run_id ||
        !provenance.task_id ||
        provenance.run_task_id !== provenance.task_id ||
        provenance.task_workspace_id !== provenance.schedule_workspace_id ||
        provenance.artifact_task_id !== provenance.task_id ||
        provenance.source_run_id !== provenance.first_run_id ||
        !expectedTypes.includes(provenance.artifact_type)
      ) {
        throw new ScheduleOutputRepositoryError(
          'schedule_conflict',
          '成果版本不属于本期首个 Run 或不符合本期固定成果类型。',
        );
      }
      const registeredHash =
        provenance.artifact_type === 'markdown'
          ? provenance.markdown_content_hash
          : provenance.presentation_file_hash;
      if (!registeredHash || registeredHash !== input.contentHash) {
        throw new ScheduleOutputRepositoryError(
          'schedule_conflict',
          '回执内容 hash 与登记的 ArtifactVersion 不匹配。',
        );
      }

      const existing = this.db
        .prepare(
          `SELECT * FROM schedule_output_receipts
           WHERE workspace_id = ? AND artifact_version_id = ?`,
        )
        .get(provenance.schedule_workspace_id, input.artifactVersionId) as
        ScheduleOutputReceiptRow | undefined;
      if (existing) {
        const receipt = toReceipt(existing);
        if (
          receipt.occurrenceId !== input.occurrenceId ||
          receipt.relativePath !== input.relativePath ||
          receipt.contentHash !== input.contentHash
        ) {
          throw new ScheduleOutputRepositoryError(
            'schedule_conflict',
            '该 ArtifactVersion 已有不同的定时成果回执。',
          );
        }
        return receipt;
      }

      const receipt = scheduleOutputReceiptSchema.parse({
        id: input.id ?? randomUUID(),
        occurrenceId: input.occurrenceId,
        artifactVersionId: input.artifactVersionId,
        workspaceId: provenance.schedule_workspace_id,
        relativePath: input.relativePath,
        contentHash: input.contentHash,
        status: 'pending',
        attempt: 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
      this.db
        .prepare(
          `INSERT INTO schedule_output_receipts (
             id, occurrence_id, artifact_version_id, workspace_id, relative_path,
             content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, NULL, NULL, ?, ?)`,
        )
        .run(
          receipt.id,
          receipt.occurrenceId,
          receipt.artifactVersionId,
          receipt.workspaceId,
          receipt.relativePath,
          receipt.contentHash,
          receipt.createdAt,
          receipt.updatedAt,
        );
      return receipt;
    });
    return insert();
  }

  /** pending → saving uses attempt as a compare-and-set token; file I/O happens in the service. */
  claimSaving(input: {
    receiptId: string;
    expectedAttempt: number;
    updatedAt: number;
  }): ScheduleOutputReceipt {
    if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 1) {
      throw new Error('expectedAttempt must be a positive safe integer');
    }
    validTimestamp(input.updatedAt, 'updatedAt');
    const update = this.db
      .prepare(
        `UPDATE schedule_output_receipts
         SET status = 'saving', updated_at = ?
         WHERE id = ? AND attempt = ? AND status = 'pending'`,
      )
      .run(input.updatedAt, input.receiptId, input.expectedAttempt);
    if (update.changes !== 1) {
      throw new ScheduleOutputRepositoryError(
        'schedule_conflict',
        '定时成果回执已变化，不能领取该保存尝试。',
      );
    }
    const receipt = this.get(input.receiptId);
    if (!receipt) throw new Error('Schedule output receipt disappeared after claim');
    return receipt;
  }

  retryFailed(input: {
    receiptId: string;
    expectedAttempt: number;
    updatedAt: number;
  }): ScheduleOutputReceipt {
    if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 1) {
      throw new Error('expectedAttempt must be a positive safe integer');
    }
    validTimestamp(input.updatedAt, 'updatedAt');
    const receipt = this.get(input.receiptId);
    if (!receipt || receipt.status !== 'failed' || receipt.attempt !== input.expectedAttempt) {
      throw new ScheduleOutputRepositoryError(
        'schedule_conflict',
        '定时成果回执已变化，不能重试该保存尝试。',
      );
    }
    const nextAttempt = receipt.attempt + 1;
    const pathParts = receipt.relativePath.split('/');
    const oldFilename = pathParts[1];
    if (!oldFilename) throw new Error('Stored Schedule output path is invalid');
    const extensionIndex = oldFilename.lastIndexOf('.');
    const filename =
      extensionIndex <= 0
        ? `${oldFilename}-attempt-${nextAttempt}`
        : `${oldFilename.slice(0, extensionIndex)}-attempt-${nextAttempt}${oldFilename.slice(extensionIndex)}`;
    const relativePath = `定时成果/${filename}`;
    const update = this.db
      .prepare(
        `UPDATE schedule_output_receipts
         SET relative_path = ?, status = 'pending', attempt = ?, failure_code = NULL,
             failure_detail = NULL, updated_at = ?
         WHERE id = ? AND attempt = ? AND status = 'failed'`,
      )
      .run(relativePath, nextAttempt, input.updatedAt, input.receiptId, input.expectedAttempt);
    if (update.changes !== 1) {
      throw new ScheduleOutputRepositoryError(
        'schedule_conflict',
        '定时成果回执已变化，不能重试该保存尝试。',
      );
    }
    const retried = this.get(input.receiptId);
    if (!retried) throw new Error('Schedule output receipt disappeared after retry');
    return retried;
  }

  markSaved(input: {
    receiptId: string;
    expectedAttempt: number;
    updatedAt: number;
  }): ScheduleOutputReceipt {
    validTimestamp(input.updatedAt, 'updatedAt');
    const update = this.db
      .prepare(
        `UPDATE schedule_output_receipts
         SET status = 'saved', failure_code = NULL, failure_detail = NULL, updated_at = ?
         WHERE id = ? AND attempt = ? AND status = 'saving'`,
      )
      .run(input.updatedAt, input.receiptId, input.expectedAttempt);
    if (update.changes !== 1) {
      const current = this.get(input.receiptId);
      if (current?.attempt === input.expectedAttempt && current.status === 'saved') return current;
      throw new ScheduleOutputRepositoryError(
        'schedule_conflict',
        '定时成果回执已变化，不能确认保存完成。',
      );
    }
    const saved = this.get(input.receiptId);
    if (!saved) throw new Error('Schedule output receipt disappeared after completion');
    return saved;
  }

  markFailed(input: {
    receiptId: string;
    expectedAttempt: number;
    failureCode: Extract<
      ScheduleDomainErrorCode,
      'schedule_output_collision' | 'schedule_output_save_failed' | 'schedule_workspace_unavailable'
    >;
    failureDetail: string;
    updatedAt: number;
  }): ScheduleOutputReceipt {
    validTimestamp(input.updatedAt, 'updatedAt');
    const failureDetail = Array.from(input.failureDetail.trim()).slice(0, 2_000).join('');
    if (!failureDetail) throw new Error('failureDetail must not be empty');
    const update = this.db
      .prepare(
        `UPDATE schedule_output_receipts
         SET status = 'failed', failure_code = ?, failure_detail = ?, updated_at = ?
         WHERE id = ? AND attempt = ? AND status = 'saving'`,
      )
      .run(
        input.failureCode,
        failureDetail,
        input.updatedAt,
        input.receiptId,
        input.expectedAttempt,
      );
    if (update.changes !== 1) {
      const current = this.get(input.receiptId);
      if (current?.attempt === input.expectedAttempt && current.status === 'failed') return current;
      throw new ScheduleOutputRepositoryError(
        'schedule_conflict',
        '定时成果回执已变化，不能收口此次保存失败。',
      );
    }
    const failed = this.get(input.receiptId);
    if (!failed) throw new Error('Schedule output receipt disappeared after failure');
    return failed;
  }
}
