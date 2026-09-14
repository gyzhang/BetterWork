import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  constants,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import { isAbortError } from '@betterwork/agent-core';

import type { AppStore, InputSnapshot } from '../persistence';

const maxBytes = 100 * 1024 * 1024;
const stableReadAttempts = 2;
const hashPattern = /^[a-f0-9]{64}$/u;

export type InputSnapshotFailureCode =
  | 'workspace_missing'
  | 'source_missing'
  | 'outside_workspace'
  | 'symlink_rejected'
  | 'special_file_rejected'
  | 'source_too_large'
  | 'source_changed'
  | 'read_failed'
  | 'write_failed'
  | 'snapshot_missing'
  | 'snapshot_corrupt'
  | 'cancelled';

export class InputSnapshotError extends Error {
  constructor(
    readonly code: InputSnapshotFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'InputSnapshotError';
  }
}

export interface CreateInputSnapshotRequest {
  workspaceId: string;
  workspaceRoot: string;
  sourcePath: string;
  signal?: AbortSignal;
}

export interface InputSnapshotReceipt {
  snapshot: InputSnapshot;
  reused: boolean;
}

interface SafeSource {
  absolutePath: string;
  relativePath: string;
}

interface StableFile {
  bytes: Buffer;
  contentHash: string;
  relativePath: string;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class InputSnapshotService {
  private readonly root: string;

  constructor(
    private readonly store: AppStore,
    userDataRoot: string,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.root = path.join(userDataRoot, 'input-snapshots');
  }

  resolvePath(snapshot: InputSnapshot): string {
    if (!snapshot.fileKey.startsWith('input-snapshots/') || snapshot.fileKey.includes('..')) {
      throw new InputSnapshotError('snapshot_corrupt', '输入快照的受管路径无效。');
    }
    return path.join(path.dirname(this.root), snapshot.fileKey);
  }

  async create(request: CreateInputSnapshotRequest): Promise<InputSnapshotReceipt> {
    const stable = await this.readStableSource(request);
    const existing = this.store.inputSnapshots.findReadyByHash(
      request.workspaceId,
      stable.contentHash,
    );
    if (existing) {
      const verified = await this.verify(existing);
      if (verified) return { snapshot: existing, reused: true };
    }

    const snapshotId = randomUUID();
    const fileKey = `input-snapshots/${stable.contentHash}/content`;
    const snapshot = this.store.inputSnapshots.createPreparing({
      id: snapshotId,
      workspaceId: request.workspaceId,
      sourcePath: stable.relativePath,
      contentHash: stable.contentHash,
      byteSize: stable.bytes.byteLength,
      format: formatFromPath(request.sourcePath),
      fileKey,
      createdAt: this.clock(),
    });
    const destination = this.resolvePath(snapshot);
    const temporary = `${destination}.${snapshotId}.tmp`;
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await this.writeIfAbsent(destination, temporary, stable.bytes, request.signal);
      this.throwIfAborted(request.signal);
      const ready = this.store.inputSnapshots.markReady(snapshotId, this.clock());
      if (!ready) throw new Error('输入快照未能转换为 ready 状态。');
      return { snapshot: ready, reused: false };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (
        (error instanceof InputSnapshotError && error.code === 'cancelled') ||
        isAbortError(error) ||
        request.signal?.aborted
      ) {
        this.store.inputSnapshots.markCancelled(snapshotId, this.clock());
        throw new InputSnapshotError('cancelled', '快照准备已取消。', { cause: error });
      }
      const failure =
        error instanceof InputSnapshotError
          ? error
          : new InputSnapshotError('write_failed', `写入输入快照失败：${describeError(error)}`, {
              cause: error,
            });
      this.store.inputSnapshots.markFailed(snapshotId, failure.code, failure.message, this.clock());
      throw failure;
    }
  }

  async verify(snapshot: InputSnapshot): Promise<boolean> {
    if (snapshot.status !== 'ready') return false;
    let bytes: Buffer;
    try {
      bytes = await readFile(this.resolvePath(snapshot));
    } catch {
      return false;
    }
    return bytes.byteLength === snapshot.byteSize && hashBytes(bytes) === snapshot.contentHash;
  }

  async recover(): Promise<{ cancelled: number; failed: number; removedFiles: number }> {
    const preparing = this.store.inputSnapshots.list('preparing');
    let cancelled = 0;
    for (const snapshot of preparing) {
      this.store.inputSnapshots.markCancelled(snapshot.id, this.clock());
      cancelled += 1;
    }

    let failed = 0;
    for (const snapshot of this.store.inputSnapshots.list('ready')) {
      if (await this.verify(snapshot)) continue;
      this.store.inputSnapshots.markFailed(
        snapshot.id,
        'snapshot_missing',
        '受管输入快照缺失或哈希不匹配，需重新选择文件。',
        this.clock(),
      );
      failed += 1;
    }

    const knownKeys = new Set(this.store.inputSnapshots.list().map((snapshot) => snapshot.fileKey));
    const removedFiles = await this.removeOrphanFiles(knownKeys);
    return { cancelled, failed, removedFiles };
  }

  private async readStableSource(request: CreateInputSnapshotRequest): Promise<StableFile> {
    const source = await this.resolveSource(request.workspaceRoot, request.sourcePath);
    for (let attempt = 0; attempt < stableReadAttempts; attempt += 1) {
      this.throwIfAborted(request.signal);
      let handle: FileHandle | undefined;
      try {
        handle = await open(source.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = await handle.stat();
        if (!before.isFile()) {
          throw new InputSnapshotError('special_file_rejected', '输入源必须是普通文件。');
        }
        if (before.size > maxBytes) {
          throw new InputSnapshotError('source_too_large', '输入文件超过 100 MB，暂不创建快照。');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          bytes.byteLength !== after.size
        ) {
          if (attempt + 1 < stableReadAttempts) continue;
          throw new InputSnapshotError('source_changed', '复制期间输入文件发生变化，请重新选择。');
        }
        return {
          bytes,
          contentHash: hashBytes(bytes),
          relativePath: source.relativePath,
        };
      } catch (error) {
        if (error instanceof InputSnapshotError) throw error;
        if (isAbortError(error) || request.signal?.aborted) {
          throw new InputSnapshotError('cancelled', '快照准备已取消。', { cause: error });
        }
        throw new InputSnapshotError('read_failed', `读取输入文件失败：${describeError(error)}`, {
          cause: error,
        });
      } finally {
        await handle?.close().catch(() => undefined);
      }
    }
    throw new InputSnapshotError('source_changed', '无法取得稳定的输入文件内容，请重试。');
  }

  private async resolveSource(workspaceRoot: string, sourcePath: string): Promise<SafeSource> {
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(workspaceRoot);
    } catch (error) {
      throw new InputSnapshotError('workspace_missing', `工作空间目录无法访问：${workspaceRoot}`, {
        cause: error,
      });
    }
    const requestedRoot = path.resolve(workspaceRoot);
    const requestedPath = path.isAbsolute(sourcePath)
      ? path.resolve(sourcePath)
      : path.resolve(requestedRoot, sourcePath);
    const relativePath = path.relative(requestedRoot, requestedPath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
      throw new InputSnapshotError('outside_workspace', '输入文件必须位于当前工作空间内。');
    }
    const absolutePath = path.join(canonicalRoot, relativePath);
    const parts = relativePath.split(path.sep);
    let current = canonicalRoot;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        throw new InputSnapshotError('source_missing', `找不到输入文件：${relativePath}`, {
          cause: error,
        });
      }
      if (info.isSymbolicLink()) {
        throw new InputSnapshotError('symlink_rejected', `输入路径包含符号链接：${relativePath}`);
      }
      if (index < parts.length - 1 && !info.isDirectory()) {
        throw new InputSnapshotError('special_file_rejected', '输入文件的父路径不是目录。');
      }
      if (index === parts.length - 1 && !info.isFile()) {
        throw new InputSnapshotError('special_file_rejected', '输入源必须是普通文件。');
      }
    }
    return { absolutePath, relativePath };
  }

  private async writeIfAbsent(
    destination: string,
    temporary: string,
    bytes: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const existing = await readFile(destination);
      if (existing.byteLength !== bytes.byteLength || hashBytes(existing) !== hashBytes(bytes)) {
        throw new InputSnapshotError('snapshot_corrupt', '同名输入快照已存在但内容哈希不一致。');
      }
      return;
    } catch (error) {
      if (error instanceof InputSnapshotError) throw error;
      if (!isMissingFileError(error)) throw error;
    }
    this.throwIfAborted(signal);
    await writeExclusive(temporary, bytes);
    this.throwIfAborted(signal);
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const existing = await readFile(destination);
      if (existing.byteLength !== bytes.byteLength || hashBytes(existing) !== hashBytes(bytes)) {
        throw new InputSnapshotError('snapshot_corrupt', '并发创建的输入快照内容不一致。');
      }
    }
  }

  private async removeOrphanFiles(knownKeys: ReadonlySet<string>): Promise<number> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [] as Dirent[]);
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !hashPattern.test(entry.name)) continue;
      const contentKey = `input-snapshots/${entry.name}/content`;
      if (knownKeys.has(contentKey)) continue;
      const directory = path.join(this.root, entry.name);
      await rm(directory, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new InputSnapshotError('cancelled', '快照准备已取消。');
  }
}

const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const formatFromPath = (sourcePath: string): string => {
  const extension = path.extname(sourcePath).toLowerCase().replace(/^\./u, '');
  return extension || 'unknown';
};

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const isAlreadyExistsError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

const writeExclusive = async (filePath: string, bytes: Buffer): Promise<void> => {
  const handle = await open(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o400,
  );
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
};
