import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  type MaterialPurpose,
  type MaterialReference,
  materialReferenceSchema,
  SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX,
  SCHEDULE_WORKSPACE_FILE_MAX,
  SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX,
  SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  type ScheduleDomainErrorCode,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { InputSnapshotError, type InputSnapshotService } from './input-snapshot-service';

const SUPPORTED_FORMATS = new Set([
  'md',
  'markdown',
  'txt',
  'text',
  'pdf',
  'docx',
  'xlsx',
  'csv',
  'pptx',
]);

const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.betterwork']);
const OPERATING_SYSTEM_METADATA_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const TEMPORARY_FILE_SUFFIXES = new Set([
  '.lock',
  '.part',
  '.temp',
  '.tmp',
  '.swp',
  '.swo',
  '.crdownload',
  '.download',
]);

export type ScheduleDirectoryExclusionReason =
  | 'operating-system-metadata'
  | 'temporary-file'
  | 'managed-directory'
  | 'symbolic-link'
  | 'special-file'
  | 'unsupported-format';

export interface ScheduleDirectoryExclusions {
  counts: Record<ScheduleDirectoryExclusionReason, number>;
  unsupportedFormats: Record<string, number>;
}

export interface ScheduleDirectorySource {
  reference: Extract<MaterialReference, { kind: 'workspace-input-snapshot' }>;
  purpose: MaterialPurpose;
  origin: 'workspace-directory';
  displayName: string;
  sourcePath: string;
}

export interface ScheduleDirectorySourceCollection {
  scheduleId: string;
  configVersion: number;
  workspaceId: string;
  items: ScheduleDirectorySource[];
  fileCount: number;
  totalFileBytes: number;
  excluded: ScheduleDirectoryExclusions;
}

export class ScheduleDirectorySourceError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleDirectorySourceError';
  }
}

interface ScannedFile {
  relativePath: string;
  format: string;
  byteSize: number;
}

interface InventoryEntry {
  relativePath: string;
  kind: string;
  device: number;
  inode: number;
  mode: number;
  byteSize: number;
  modifiedAt: number;
}

interface DirectoryScan {
  canonicalRoot: string;
  files: ScannedFile[];
  fileCount: number;
  totalFileBytes: number;
  excluded: ScheduleDirectoryExclusions;
  inventoryHash: string;
}

interface DirectoryRequest {
  scheduleId: string;
  signal?: AbortSignal;
}

const lexicalCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isOperatingSystemMetadata = (name: string): boolean =>
  OPERATING_SYSTEM_METADATA_NAMES.has(name) || name.startsWith('._');

const isTemporaryFile = (name: string): boolean => {
  if (name.startsWith('~$') || (name.startsWith('.#') && name.length > 2)) return true;
  const extension = path.extname(name).toLowerCase();
  return TEMPORARY_FILE_SUFFIXES.has(extension);
};

const signatureEntry = (relativePath: string, kind: string, stats: Stats): InventoryEntry => ({
  relativePath,
  kind,
  device: stats.dev,
  inode: stats.ino,
  mode: stats.mode,
  byteSize: stats.size,
  // These timestamps detect a source changing during preparation; they never assign a business period.
  modifiedAt: stats.mtimeMs,
});

const increment = (
  counts: Record<ScheduleDirectoryExclusionReason, number>,
  key: ScheduleDirectoryExclusionReason,
): void => {
  counts[key] += 1;
};

const isMissingEntry = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export class ScheduleDirectorySourcesService {
  constructor(
    private readonly store: AppStore,
    private readonly snapshots: Pick<InputSnapshotService, 'create'>,
  ) {}

  async collect(request: DirectoryRequest): Promise<ScheduleDirectorySourceCollection> {
    const schedule = this.store.schedules.get(request.scheduleId);
    if (!schedule) {
      throw new ScheduleDirectorySourceError('schedule_not_found', '定时任务不存在');
    }
    if (schedule.schedule.lifecycle === 'archived') {
      throw new ScheduleDirectorySourceError('schedule_archived', '已归档规则不能准备新一期材料');
    }
    const workspace = this.store.workspaces.get(schedule.schedule.workspaceId);
    if (!workspace) {
      throw new ScheduleDirectorySourceError('schedule_workspace_unavailable', '工作空间不存在');
    }

    this.throwIfAborted(request.signal);
    const before = await this.scan(workspace.rootPath, request.signal);
    const items: ScheduleDirectorySource[] = [];
    for (const file of before.files) {
      this.throwIfAborted(request.signal);
      try {
        const receipt = await this.snapshots.create({
          workspaceId: workspace.id,
          workspaceRoot: workspace.rootPath,
          sourcePath: file.relativePath,
          ...(request.signal ? { signal: request.signal } : {}),
        });
        const snapshot = receipt.snapshot;
        if (
          snapshot.status !== 'ready' ||
          snapshot.workspaceId !== workspace.id ||
          snapshot.byteSize !== file.byteSize ||
          snapshot.format !== file.format
        ) {
          throw new ScheduleDirectorySourceError(
            'schedule_source_conflict',
            `文件在准备期间发生变化：${file.relativePath}`,
          );
        }
        const relativePath = path.normalize(file.relativePath);
        const reference = materialReferenceSchema.parse({
          kind: 'workspace-input-snapshot',
          snapshotId: snapshot.id,
          workspaceId: snapshot.workspaceId,
          contentHash: snapshot.contentHash,
          format: snapshot.format,
          fileKey: snapshot.fileKey,
          sourcePath: relativePath,
        });
        if (reference.kind !== 'workspace-input-snapshot') {
          throw new Error('InputSnapshotService returned a non-snapshot material reference.');
        }
        items.push({
          reference,
          purpose: isScheduleOutput(relativePath) ? 'historical-comparison' : 'other',
          origin: 'workspace-directory',
          displayName: relativePath,
          sourcePath: relativePath,
        });
      } catch (error) {
        throw this.mapSnapshotError(error, file.relativePath, request.signal);
      }
    }

    this.throwIfAborted(request.signal);
    const after = await this.scan(workspace.rootPath, request.signal);
    const latestSchedule = this.store.schedules.get(request.scheduleId);
    if (
      before.canonicalRoot !== after.canonicalRoot ||
      before.inventoryHash !== after.inventoryHash ||
      !latestSchedule ||
      latestSchedule.schedule.revision !== schedule.schedule.revision ||
      latestSchedule.schedule.lifecycle !== schedule.schedule.lifecycle ||
      latestSchedule.schedule.currentConfigVersion !== schedule.schedule.currentConfigVersion
    ) {
      throw new ScheduleDirectorySourceError(
        'schedule_source_conflict',
        '工作空间文件或定时配置在准备期间发生变化，请重新检查后再试。',
      );
    }

    return {
      scheduleId: schedule.schedule.id,
      configVersion: schedule.schedule.currentConfigVersion,
      workspaceId: workspace.id,
      items,
      fileCount: before.fileCount,
      totalFileBytes: before.totalFileBytes,
      excluded: before.excluded,
    };
  }

  private async scan(workspaceRoot: string, signal?: AbortSignal): Promise<DirectoryScan> {
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(workspaceRoot);
      const rootStats = await lstat(canonicalRoot);
      if (!rootStats.isDirectory()) throw new Error('Workspace root is not a directory');
    } catch (error) {
      throw new ScheduleDirectorySourceError(
        'schedule_workspace_unavailable',
        '工作空间目录无法访问或不是目录。',
        { cause: error },
      );
    }

    const files: ScannedFile[] = [];
    const inventory: InventoryEntry[] = [];
    const excluded: ScheduleDirectoryExclusions = {
      counts: {
        'operating-system-metadata': 0,
        'temporary-file': 0,
        'managed-directory': 0,
        'symbolic-link': 0,
        'special-file': 0,
        'unsupported-format': 0,
      },
      unsupportedFormats: {},
    };
    let fileCount = 0;
    let totalFileBytes = 0;

    const visit = async (directory: string, directoryDepth: number): Promise<void> => {
      this.throwIfAborted(signal);
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isMissingEntry(error)) {
          throw new ScheduleDirectorySourceError(
            'schedule_source_conflict',
            '工作空间目录在枚举期间发生变化。',
            { cause: error },
          );
        }
        throw new ScheduleDirectorySourceError(
          'schedule_workspace_unavailable',
          '工作空间目录无法完整枚举。',
          { cause: error },
        );
      }
      entries.sort((left, right) => lexicalCompare(left.name, right.name));
      for (const entry of entries) {
        this.throwIfAborted(signal);
        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.relative(canonicalRoot, absolutePath);
        let stats: Stats;
        try {
          stats = await lstat(absolutePath);
        } catch (error) {
          throw new ScheduleDirectorySourceError(
            'schedule_source_conflict',
            `文件在枚举期间发生变化：${relativePath}`,
            { cause: error },
          );
        }

        if (stats.isSymbolicLink()) {
          increment(excluded.counts, 'symbolic-link');
          inventory.push(signatureEntry(relativePath, 'symbolic-link', stats));
          continue;
        }
        if (stats.isDirectory()) {
          if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
            increment(excluded.counts, 'managed-directory');
            inventory.push(signatureEntry(relativePath, 'excluded-directory', stats));
            continue;
          }
          const nextDepth = directoryDepth + 1;
          if (nextDepth > SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX) {
            throw new ScheduleDirectorySourceError(
              'schedule_source_budget_exceeded',
              `工作空间目录深度超过 ${SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX} 层。`,
            );
          }
          inventory.push(signatureEntry(relativePath, 'directory', stats));
          await visit(absolutePath, nextDepth);
          continue;
        }
        if (!stats.isFile()) {
          increment(excluded.counts, 'special-file');
          inventory.push(signatureEntry(relativePath, 'special-file', stats));
          continue;
        }

        if (isOperatingSystemMetadata(entry.name)) {
          increment(excluded.counts, 'operating-system-metadata');
          inventory.push(signatureEntry(relativePath, 'metadata', stats));
          continue;
        }
        if (isTemporaryFile(entry.name)) {
          increment(excluded.counts, 'temporary-file');
          inventory.push(signatureEntry(relativePath, 'temporary-file', stats));
          continue;
        }

        fileCount += 1;
        if (fileCount > SCHEDULE_WORKSPACE_FILE_MAX) {
          throw new ScheduleDirectorySourceError(
            'schedule_source_budget_exceeded',
            `工作空间普通文件超过 ${SCHEDULE_WORKSPACE_FILE_MAX} 项，请缩小资料范围。`,
          );
        }
        const extension = path.extname(entry.name).toLowerCase().replace(/^\./u, '');
        inventory.push(
          signatureEntry(
            relativePath,
            SUPPORTED_FORMATS.has(extension) ? extension : 'unsupported',
            stats,
          ),
        );
        if (!SUPPORTED_FORMATS.has(extension)) {
          increment(excluded.counts, 'unsupported-format');
          excluded.unsupportedFormats[extension || '(无扩展名)'] =
            (excluded.unsupportedFormats[extension || '(无扩展名)'] ?? 0) + 1;
          continue;
        }
        if (
          !Number.isSafeInteger(stats.size) ||
          stats.size > SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX
        ) {
          throw new ScheduleDirectorySourceError(
            'schedule_source_budget_exceeded',
            `文件超过 ${SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX / (1024 * 1024)} MiB 或大小无法安全计算：${relativePath}`,
          );
        }
        totalFileBytes += stats.size;
        if (totalFileBytes > SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX) {
          throw new ScheduleDirectorySourceError(
            'schedule_source_budget_exceeded',
            `工作空间受支持文件总量超过 ${SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX / (1024 * 1024)} MiB，请缩小资料范围。`,
          );
        }
        files.push({ relativePath, format: extension, byteSize: stats.size });
      }
    };

    await visit(canonicalRoot, 0);
    files.sort((left, right) => lexicalCompare(left.relativePath, right.relativePath));
    inventory.sort((left, right) => lexicalCompare(left.relativePath, right.relativePath));
    const inventoryHash = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    return { canonicalRoot, files, fileCount, totalFileBytes, excluded, inventoryHash };
  }

  private mapSnapshotError(error: unknown, relativePath: string, signal?: AbortSignal): Error {
    if (error instanceof ScheduleDirectorySourceError) return error;
    if (signal?.aborted || (error instanceof InputSnapshotError && error.code === 'cancelled')) {
      return new ScheduleDirectorySourceError('schedule_cancelled', '本期材料准备已取消。', {
        cause: error,
      });
    }
    if (error instanceof InputSnapshotError) {
      const code =
        error.code === 'source_too_large'
          ? 'schedule_source_budget_exceeded'
          : error.code === 'source_changed' ||
              error.code === 'source_missing' ||
              error.code === 'symlink_rejected'
            ? 'schedule_source_conflict'
            : error.code === 'workspace_missing'
              ? 'schedule_workspace_unavailable'
              : 'schedule_source_missing';
      return new ScheduleDirectorySourceError(code, `无法稳定快照工作空间文件：${relativePath}`, {
        cause: error,
      });
    }
    return new ScheduleDirectorySourceError(
      'schedule_source_missing',
      `无法快照工作空间文件：${relativePath}`,
      { cause: error },
    );
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ScheduleDirectorySourceError('schedule_cancelled', '本期材料准备已取消。');
    }
  }
}

const isScheduleOutput = (relativePath: string): boolean =>
  relativePath.split(path.sep)[0] === '定时成果';
