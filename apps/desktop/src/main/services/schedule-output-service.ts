import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { open as openAsync, unlink as unlinkAsync } from 'node:fs/promises';
import path from 'node:path';

import { type ArtifactVersionDetail, type ScheduleOutputReceipt } from '@betterwork/agent-protocol';

import { hashBytes, managedPath, readManagedFile } from '../infrastructure/managed-files';
import type { AppStore } from '../persistence';
import { ScheduleOutputRepositoryError } from '../persistence/schedule-output-repository';
import type { FileArtifactService } from './file-artifact-service';

export interface ScheduleOutputServiceOptions {
  readonly now?: () => number;
  readonly fileArtifacts?: Pick<FileArtifactService, 'readVersionBytes'>;
  readonly saveTimeoutMs?: number;
  readonly writeTemporary?: (filePath: string, bytes: Buffer, signal: AbortSignal) => Promise<void>;
}

export interface ScheduleOutputRecoveryResult {
  readonly examined: number;
  readonly saved: number;
  readonly failed: number;
  readonly unresolved: number;
}

class ScheduleOutputFileError extends Error {
  constructor(
    readonly code:
      | 'schedule_output_collision'
      | 'schedule_output_save_failed'
      | 'schedule_workspace_unavailable',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleOutputFileError';
  }
}

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

const lstatIfPresent = (filePath: string): ReturnType<typeof lstatSync> | undefined => {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
};

const writeTemporaryFile = async (
  filePath: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<void> => {
  const file = await openAsync(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(bytes, { signal });
    await file.sync();
  } finally {
    await file.close();
  }
};

const truncateCodePoints = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join('');

const cleanFilenamePart = (value: string): string => {
  const filenameCharacters = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0);
    const isControl =
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
    return isControl || '/\\:<>?*"|'.includes(character) ? '_' : character;
  }).join('');
  const cleaned = filenameCharacters
    .replace(/\s+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[._]+|[._]+$/gu, '');
  return truncateCodePoints(cleaned || '未命名', 60);
};

const requestedAtLabel = (requestedAt: number, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(requestedAt);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = values.get('hour');
  const minute = values.get('minute');
  if (!year || !month || !day || !hour || !minute) {
    throw new Error('Unable to format Schedule request time for output filename');
  }
  return `${year}${month}${day}_${hour}${minute}`;
};

const filenameVersionId = (versionId: string): string =>
  /^[A-Za-z0-9_-]+$/u.test(versionId) ? versionId : encodeURIComponent(versionId);

const contentHashOf = (detail: ArtifactVersionDetail): string =>
  detail.type === 'markdown' ? detail.contentHash : detail.fileHash;

const relativePathFor = (
  name: string,
  label: string,
  versionNumber: number,
  versionId: string,
  extension: '.md' | '.pptx',
): string =>
  `定时成果/${cleanFilenamePart(name)}-${cleanFilenamePart(label)}-v${versionNumber}-${filenameVersionId(versionId)}${extension}`;

const temporaryPathFor = (receipt: ScheduleOutputReceipt): string => {
  const token = createHash('sha256')
    .update(`${receipt.id}:${receipt.attempt}`)
    .digest('hex')
    .slice(0, 32);
  return `定时成果/.betterwork-schedule-${token}.tmp`;
};

const readOwnedTemporary = (root: string, relativePath: string): Buffer => {
  const target = managedPath(root, relativePath);
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.nlink > 2 || metadata.size > 100 * 1024 * 1024) {
      throw new Error('定时成果临时文件不是本期保存的普通文件。');
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

/** 把本期首个 Run 已登记的 ArtifactVersion 转成稳定 pending 回执，不读 Artifact.latest 内容。 */
export class ScheduleOutputService {
  private readonly savesInFlight = new Map<string, Promise<ScheduleOutputReceipt>>();
  private readonly now: () => number;
  private readonly fileArtifacts: Pick<FileArtifactService, 'readVersionBytes'> | undefined;
  private readonly saveTimeoutMs: number;
  private readonly writeTemporary: NonNullable<ScheduleOutputServiceOptions['writeTemporary']>;

  constructor(
    private readonly store: AppStore,
    options: ScheduleOutputServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.fileArtifacts = options.fileArtifacts;
    this.saveTimeoutMs = options.saveTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.saveTimeoutMs) || this.saveTimeoutMs < 1) {
      throw new Error('saveTimeoutMs must be a positive safe integer');
    }
    this.writeTemporary = options.writeTemporary ?? writeTemporaryFile;
  }

  registerOccurrenceOutputs(occurrenceId: string): ScheduleOutputReceipt[] {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence) {
      throw new ScheduleOutputRepositoryError('schedule_not_found', '定时实例不存在。');
    }
    if (!occurrence.firstRunId || !occurrence.taskId) return [];

    const schedule = this.store.schedules.get(occurrence.scheduleId);
    const config = this.store.schedules.getConfig(occurrence.scheduleId, occurrence.configVersion);
    const task = this.store.tasks.getSummary(occurrence.taskId);
    const run = this.store.runs.get(occurrence.firstRunId);
    if (!schedule || !config || !task || !run) {
      throw new ScheduleOutputRepositoryError('schedule_conflict', '本期成果来源关系不可用。');
    }
    if (
      task.workspaceId !== schedule.schedule.workspaceId ||
      run.taskId !== occurrence.taskId ||
      run.sessionId !== occurrence.sessionId
    ) {
      throw new ScheduleOutputRepositoryError('schedule_conflict', '本期首个 Run 归属不匹配。');
    }

    const expectedTypes = new Set(config.expectedArtifactTypes);
    const candidates = this.store.artifacts
      .list(occurrence.taskId)
      .flatMap((artifact) =>
        this.store.artifacts
          .listVersions(artifact.id)
          .filter(
            (version) =>
              version.sourceRunId === run.id &&
              expectedTypes.has(version.type) &&
              version.origin === 'assistant-run',
          )
          .map((version) => ({ artifactId: artifact.id, version })),
      )
      .sort(
        (left, right) =>
          left.artifactId.localeCompare(right.artifactId) ||
          left.version.versionNumber - right.version.versionNumber ||
          left.version.id.localeCompare(right.version.id),
      );
    const periodLabel =
      occurrence.period.rule === 'none'
        ? requestedAtLabel(occurrence.requestedAt, occurrence.period.timeZone)
        : occurrence.period.label;
    const receipts: ScheduleOutputReceipt[] = [];
    for (const candidate of candidates) {
      const detail = this.store.artifacts.getVersionDetail(candidate.version.id);
      if (
        !detail ||
        detail.sourceRunId !== run.id ||
        detail.type !== candidate.version.type ||
        detail.origin !== 'assistant-run'
      ) {
        throw new ScheduleOutputRepositoryError(
          'schedule_conflict',
          '登记成果版本无法读取或与本期首个 Run 不一致。',
        );
      }
      const extension = detail.type === 'markdown' ? '.md' : '.pptx';
      receipts.push(
        this.store.scheduleOutputs.createPending({
          occurrenceId,
          artifactVersionId: detail.id,
          relativePath: relativePathFor(
            config.name,
            periodLabel,
            detail.versionNumber,
            detail.id,
            extension,
          ),
          contentHash: contentHashOf(detail),
          createdAt: this.now(),
        }),
      );
    }
    return receipts;
  }

  saveReceipt(receiptId: string, timeoutMs = this.saveTimeoutMs): Promise<ScheduleOutputReceipt> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      return Promise.reject(new Error('timeoutMs must be a positive safe integer'));
    }
    const inFlight = this.savesInFlight.get(receiptId);
    if (inFlight) return inFlight;

    const saving = Promise.resolve()
      .then(() => this.saveReceiptOnce(receiptId, timeoutMs))
      .finally(() => {
        if (this.savesInFlight.get(receiptId) === saving) {
          this.savesInFlight.delete(receiptId);
        }
      });
    this.savesInFlight.set(receiptId, saving);
    return saving;
  }

  private async saveReceiptOnce(
    receiptId: string,
    timeoutMs: number,
  ): Promise<ScheduleOutputReceipt> {
    const current = this.store.scheduleOutputs.get(receiptId);
    if (!current) {
      throw new ScheduleOutputRepositoryError('schedule_not_found', '定时成果回执不存在。');
    }
    if (current.status === 'saved' || current.status === 'failed') return current;
    const saving =
      current.status === 'pending'
        ? this.store.scheduleOutputs.claimSaving({
            receiptId,
            expectedAttempt: current.attempt,
            updatedAt: this.now(),
          })
        : current;

    try {
      await this.publishBytes(saving, timeoutMs);
    } catch (error) {
      const failure =
        error instanceof ScheduleOutputFileError
          ? error
          : new ScheduleOutputFileError(
              'schedule_output_save_failed',
              '无法读取或保存本期登记的成果版本。',
              { cause: error },
            );
      return this.store.scheduleOutputs.markFailed({
        receiptId,
        expectedAttempt: saving.attempt,
        failureCode: failure.code,
        failureDetail: failure.message,
        updatedAt: this.now(),
      });
    }
    // Keep this commit outside the filesystem catch: a DB failure after link publication must
    // leave `saving` for startup recovery to verify the already-published bytes.
    return this.store.scheduleOutputs.markSaved({
      receiptId,
      expectedAttempt: saving.attempt,
      updatedAt: this.now(),
    });
  }

  async retryFailedReceipt(input: {
    receiptId: string;
    expectedAttempt: number;
  }): Promise<ScheduleOutputReceipt> {
    const pending = this.store.scheduleOutputs.retryFailed({
      ...input,
      updatedAt: this.now(),
    });
    return this.saveReceipt(pending.id);
  }

  /** Startup resumes pending/saving disk work only; it never creates or restarts a model Run. */
  async recoverIncomplete(): Promise<ScheduleOutputRecoveryResult> {
    const incomplete = this.store.scheduleOutputs.listIncomplete();
    let saved = 0;
    let failed = 0;
    let unresolved = 0;
    for (const receipt of incomplete) {
      try {
        const result = await this.saveReceipt(receipt.id);
        if (result.status === 'saved') saved += 1;
        else if (result.status === 'failed') failed += 1;
        else unresolved += 1;
      } catch {
        unresolved += 1;
      }
    }
    return { examined: incomplete.length, saved, failed, unresolved };
  }

  private readArtifactVersionBytes(receipt: ScheduleOutputReceipt): Buffer {
    const occurrence = this.store.scheduleOccurrences.get(receipt.occurrenceId);
    const detail = this.store.artifacts.getVersionDetail(receipt.artifactVersionId);
    const artifact = detail ? this.store.artifacts.getDetail(detail.artifactId) : undefined;
    if (
      !occurrence?.firstRunId ||
      !occurrence.taskId ||
      !detail ||
      !artifact ||
      artifact.taskId !== occurrence.taskId ||
      detail.sourceRunId !== occurrence.firstRunId ||
      detail.origin !== 'assistant-run'
    ) {
      throw new ScheduleOutputFileError(
        'schedule_output_save_failed',
        '本期原始成果版本已不可用。',
      );
    }
    let bytes: Buffer;
    if (detail.type === 'markdown') {
      bytes = Buffer.from(detail.content, 'utf8');
    } else {
      if (!this.fileArtifacts) {
        throw new ScheduleOutputFileError(
          'schedule_output_save_failed',
          'PPTX 版本文件读取服务不可用。',
        );
      }
      bytes = this.fileArtifacts.readVersionBytes(detail.id);
    }
    if (hashBytes(bytes) !== receipt.contentHash) {
      throw new ScheduleOutputFileError(
        'schedule_output_save_failed',
        '原始成果版本的内容 hash 校验失败。',
      );
    }
    return bytes;
  }

  private resolveWorkspaceRoot(receipt: ScheduleOutputReceipt): string {
    const workspace = this.store.workspaces.get(receipt.workspaceId);
    if (!workspace) {
      throw new ScheduleOutputFileError(
        'schedule_workspace_unavailable',
        '原工作空间已不可用，未保存定时成果。',
      );
    }
    try {
      const info = lstatSync(workspace.rootPath);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('Workspace root is not a regular directory');
      }
      const canonicalRoot = realpathSync(workspace.rootPath);
      const canonicalInfo = lstatSync(canonicalRoot);
      if (!canonicalInfo.isDirectory() || canonicalInfo.isSymbolicLink()) {
        throw new Error('Canonical workspace root is not a regular directory');
      }
      return canonicalRoot;
    } catch (error) {
      throw new ScheduleOutputFileError(
        'schedule_workspace_unavailable',
        '原工作空间目录不存在或不可安全访问，未保存定时成果。',
        { cause: error },
      );
    }
  }

  private async publishBytes(receipt: ScheduleOutputReceipt, timeoutMs: number): Promise<void> {
    const root = this.resolveWorkspaceRoot(receipt);
    let ownedTemporaryPath: string | undefined;
    try {
      const targetPath = managedPath(root, receipt.relativePath, true);
      const targetDirectory = path.dirname(targetPath);
      const directoryInfo = lstatSync(targetDirectory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        throw new ScheduleOutputFileError(
          'schedule_output_save_failed',
          '定时成果目录不是安全的普通目录。',
        );
      }
      const temporaryRelativePath = temporaryPathFor(receipt);
      const temporaryPath = managedPath(root, temporaryRelativePath, true);
      ownedTemporaryPath = temporaryPath;
      const existingTemporary = lstatIfPresent(temporaryPath);
      const existingTarget = lstatIfPresent(targetPath);

      if (existingTarget) {
        if (existingTemporary) {
          const temporaryBytes = readOwnedTemporary(root, temporaryRelativePath);
          if (hashBytes(temporaryBytes) !== receipt.contentHash) {
            throw new ScheduleOutputFileError(
              'schedule_output_save_failed',
              '本期保存临时文件 hash 不匹配，已清理本回执拥有的临时文件。',
            );
          }
          await unlinkAsync(temporaryPath);
        }
        const existingBytes = readManagedFile(root, receipt.relativePath);
        if (hashBytes(existingBytes) !== receipt.contentHash) {
          throw new ScheduleOutputFileError(
            'schedule_output_collision',
            '目标文件已存在且内容不同，已保留现有文件。',
          );
        }
        return;
      }

      if (existingTemporary) {
        const temporaryBytes = readOwnedTemporary(root, temporaryRelativePath);
        if (hashBytes(temporaryBytes) !== receipt.contentHash) {
          await unlinkAsync(temporaryPath);
          throw new ScheduleOutputFileError(
            'schedule_output_save_failed',
            '本期保存临时文件 hash 不匹配，已清理本回执拥有的临时文件。',
          );
        }
      } else {
        const bytes = this.readArtifactVersionBytes(receipt);
        const controller = new AbortController();
        let timeout: NodeJS.Timeout | undefined;
        const writing = this.writeTemporary(temporaryPath, bytes, controller.signal);
        try {
          const result = await Promise.race([
            writing.then(() => 'written' as const),
            new Promise<'timeout'>((resolve) => {
              timeout = setTimeout(() => resolve('timeout'), timeoutMs);
            }),
          ]);
          if (result === 'timeout') {
            controller.abort(new Error('定时成果保存超时'));
            await writing.catch((error: unknown) => {
              if (!controller.signal.aborted) throw error;
            });
            throw new ScheduleOutputFileError(
              'schedule_output_save_failed',
              '保存定时成果超时，原始 ArtifactVersion 已保留。',
            );
          }
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      }

      // Re-check each component immediately before the non-overwriting hard-link publication.
      managedPath(root, receipt.relativePath);
      try {
        linkSync(temporaryPath, targetPath);
      } catch (error) {
        if (hasCode(error, 'EEXIST')) {
          const conflictingBytes = readManagedFile(root, receipt.relativePath);
          if (hashBytes(conflictingBytes) !== receipt.contentHash) {
            await unlinkAsync(temporaryPath);
            throw new ScheduleOutputFileError(
              'schedule_output_collision',
              '目标文件已被创建且内容不同，已保留现有文件。',
            );
          }
        } else {
          throw error;
        }
      }
      await unlinkAsync(temporaryPath);
      const directoryDescriptor = await openAsync(targetDirectory, constants.O_RDONLY);
      try {
        await directoryDescriptor.sync();
      } finally {
        await directoryDescriptor.close();
      }
      const publishedBytes = readManagedFile(root, receipt.relativePath);
      if (hashBytes(publishedBytes) !== receipt.contentHash) {
        throw new ScheduleOutputFileError(
          'schedule_output_save_failed',
          '发布后的定时成果 hash 校验失败。',
        );
      }
    } catch (error) {
      if (ownedTemporaryPath && lstatIfPresent(ownedTemporaryPath)) {
        try {
          await unlinkAsync(ownedTemporaryPath);
        } catch (cleanupError) {
          if (!hasCode(cleanupError, 'ENOENT')) {
            throw new ScheduleOutputFileError(
              'schedule_output_save_failed',
              '保存失败且本回执临时文件无法安全清理。',
              { cause: cleanupError },
            );
          }
        }
      }
      if (error instanceof ScheduleOutputFileError) throw error;
      throw new ScheduleOutputFileError(
        'schedule_output_save_failed',
        '写入定时成果目录失败，原始 ArtifactVersion 已保留。',
        { cause: error },
      );
    }
  }
}
