import { createHash } from 'node:crypto';
import path from 'node:path';

import type { DependencySnapshot, DependencySnapshotExclusion } from '@betterwork/agent-protocol';

import type {
  DependencyFileSystem,
  DependencyProcessRunner,
} from '../infrastructure/dependency-adapters';
import type { AppStore } from '../persistence';

/**
 * 外部工具链快照（设计 §4.3、任务 A11）。
 *
 * 样本依赖的 ppt-master 是用户机器上的开发仓库：它会被 `git pull` 改动，带未提交修改，
 * 还混着历史项目与用户私有资料。因此运行前必须把它复制成**受管不可变快照**，
 * `PPTM_HOME` 指向快照而不是开发仓库。
 *
 * 三条纪律：
 * - 快照按内容清单 hash 寻址：源目录之后再怎么改，已登记的快照内容与 hash 都不变；
 * - commit 只是补充身份，真正决定内容的是逐文件 sha256（因此 dirty tree 与 HEAD 必然不同）；
 * - 所有排除项逐条列明理由，符号链接与特殊文件直接拒绝，不静默跳过也不跟随。
 */

export interface ToolchainSnapshotRoots {
  readonly store: AppStore;
  readonly userDataRoot: string;
  /** 受管资产根，对应设计 §5 的 `dependency-assets/`。 */
  readonly assetsRoot: string;
  readonly filesystem: DependencyFileSystem;
  readonly process: DependencyProcessRunner;
  readonly clock?: () => number;
}

export interface SnapshotRequest {
  /** 用户选择的外部目录（绝对路径）。 */
  readonly origin: string;
  /** 相对 origin 的包含根；留空表示整个 origin（仍按排除规则过滤）。 */
  readonly include?: readonly string[];
  /** 额外排除的相对路径前缀，理由记为「用户指定排除」。 */
  readonly exclude?: readonly string[];
}

export interface SnapshotReceipt {
  readonly snapshot: DependencySnapshot;
  /** true 表示同样内容的快照已存在，本次没有重复复制。 */
  readonly reused: boolean;
}

export interface SnapshotVerification {
  readonly valid: boolean;
  readonly checkedFiles: number;
  readonly missing: string[];
  readonly mismatched: string[];
}

export type SnapshotFailureCode =
  | 'origin-missing'
  | 'include-missing'
  | 'symlink-rejected'
  | 'special-file-rejected'
  | 'read-failed'
  | 'copy-failed'
  | 'snapshot-missing';

export class ToolchainSnapshotError extends Error {
  constructor(
    readonly code: SnapshotFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ToolchainSnapshotError';
  }
}

interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** 快照目录内的清单文件名；它由本服务生成，不参与内容 hash。 */
export const snapshotManifestFileName = '.betterwork-snapshot-manifest.json';

interface DirectoryExclusionRule {
  readonly name: string;
  readonly reason: string;
}

/** 目录名排除在任意层级生效：这些目录在任何位置都是可重建或与运行无关的内容。 */
const excludedDirectories: readonly DirectoryExclusionRule[] = [
  { name: '.git', reason: '版本库对象不是运行所需内容' },
  { name: 'projects', reason: '历史项目资料含用户私有内容，不自动纳入快照' },
  { name: '__pycache__', reason: 'Python 字节码缓存可重建' },
  { name: '.mypy_cache', reason: '类型检查缓存可重建' },
  { name: '.pytest_cache', reason: '测试缓存可重建' },
  { name: '.ruff_cache', reason: '静态检查缓存可重建' },
  { name: 'node_modules', reason: '依赖目录可重建' },
  { name: '.venv', reason: '虚拟环境可重建且绑定绝对路径' },
  { name: 'venv', reason: '虚拟环境可重建且绑定绝对路径' },
];

const excludedFileNames = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const fileExclusionReason = (name: string): string | null => {
  if (excludedFileNames.has(name)) return '资源管理器元数据不是工具链内容';
  if (name.startsWith('._')) return 'AppleDouble 元数据不是工具链内容';
  if (name.endsWith('.pyc') || name.endsWith('.pyo')) return 'Python 字节码缓存可重建';
  return null;
};

const gitTimeoutMs = 30_000;

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export class ToolchainSnapshotService {
  constructor(private readonly roots: ToolchainSnapshotRoots) {}

  private get store(): AppStore {
    return this.roots.store;
  }

  private now(): number {
    return this.roots.clock ? this.roots.clock() : Date.now();
  }

  listSnapshots(): DependencySnapshot[] {
    return this.store.snapshots.listSnapshots();
  }

  getSnapshot(id: string): DependencySnapshot | undefined {
    return this.store.snapshots.getSnapshot(id);
  }

  /** 快照在磁盘上的绝对根：PPTM_HOME 用它，绝不指向用户的开发仓库。 */
  resolveSnapshotRoot(snapshot: DependencySnapshot): string {
    return path.join(this.roots.userDataRoot, snapshot.pathKey);
  }

  /**
   * 把用户选择的外部目录复制成受管不可变快照。
   *
   * 内容相同的请求返回同一个快照（内容寻址）；复制失败时清掉半成品目录，
   * 不留下「看起来在但内容不全」的快照，也不登记数据库行。
   */
  async createSnapshot(request: SnapshotRequest): Promise<SnapshotReceipt> {
    const origin = request.origin;
    if (!(await this.roots.filesystem.exists(origin))) {
      throw new ToolchainSnapshotError('origin-missing', `找不到工具链目录 ${origin}`);
    }
    const includeRoots = request.include && request.include.length > 0 ? request.include : ['.'];
    for (const include of includeRoots) {
      if (include === '.') continue;
      if (!(await this.roots.filesystem.exists(path.join(origin, include)))) {
        throw new ToolchainSnapshotError(
          'include-missing',
          `工具链目录 ${origin} 下缺少所需内容 ${include}`,
        );
      }
    }

    const exclusions: DependencySnapshotExclusion[] = [];
    const entries: ManifestEntry[] = [];
    const userExclusions = new Set(request.exclude ?? []);
    for (const include of includeRoots) {
      await this.walk(origin, include, userExclusions, entries, exclusions);
    }
    entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    exclusions.sort((left, right) => (left.path < right.path ? -1 : 1));

    const manifestHash = sha256Of(
      new TextEncoder().encode(JSON.stringify({ version: 1, files: entries })),
    );
    const existing = this.store.snapshots.findByManifestHash(manifestHash);
    const pathKey = path.join('dependency-assets', manifestHash);
    const targetRoot = path.join(this.roots.userDataRoot, pathKey);
    const originState = await this.readOriginState(origin);

    if (
      existing &&
      (await this.roots.filesystem.exists(path.join(targetRoot, snapshotManifestFileName)))
    ) {
      return { snapshot: existing, reused: true };
    }

    try {
      await this.roots.filesystem.mkdir(targetRoot);
      let totalBytes = 0;
      for (const entry of entries) {
        const bytes = await this.roots.filesystem.readFile(path.join(origin, entry.path));
        // 逐文件复核：枚举与复制之间源目录可能被改动，hash 不符就整次失败，不做半份快照。
        const actual = sha256Of(bytes);
        if (actual !== entry.sha256) {
          throw new ToolchainSnapshotError(
            'read-failed',
            `复制期间 ${entry.path} 的内容发生变化，快照已放弃；请重新发起`,
          );
        }
        await this.roots.filesystem.writeFile(path.join(targetRoot, entry.path), bytes);
        totalBytes += entry.bytes;
      }
      const manifest = {
        manifestVersion: 1,
        origin,
        ...(originState.commit ? { originCommit: originState.commit } : {}),
        originState: originState.state,
        manifestHash,
        fileCount: entries.length,
        totalBytes,
        createdAt: this.now(),
        exclusions,
        files: entries,
      };
      await this.roots.filesystem.writeFile(
        path.join(targetRoot, snapshotManifestFileName),
        JSON.stringify(manifest, null, 2),
      );
    } catch (error) {
      await this.roots.filesystem.remove(targetRoot).catch((cleanupError: unknown) => {
        console.error(`[toolchain-snapshot] cleanup failed for ${pathKey}`, cleanupError);
      });
      if (error instanceof ToolchainSnapshotError) throw error;
      throw new ToolchainSnapshotError('copy-failed', `复制工具链快照失败：${messageOf(error)}`, {
        cause: error,
      });
    }

    const snapshot = this.store.snapshots.createSnapshot({
      origin,
      ...(originState.commit ? { originCommit: originState.commit } : {}),
      originState: originState.state,
      manifestHash,
      pathKey,
      fileCount: entries.length,
      totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      exclusions,
    });
    return { snapshot, reused: false };
  }

  /**
   * 运行前核验：逐文件重算 sha256 与清单比对。
   * 失配或缺文件都判为不可用——调用方必须拒绝执行，不能拿残缺工具链硬跑。
   */
  async verifySnapshot(snapshotId: string): Promise<SnapshotVerification> {
    const snapshot = this.store.snapshots.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new ToolchainSnapshotError('snapshot-missing', `快照 ${snapshotId} 不存在`);
    }
    const root = this.resolveSnapshotRoot(snapshot);
    const manifestBytes = await this.roots.filesystem
      .readFile(path.join(root, snapshotManifestFileName))
      .catch(() => null);
    if (!manifestBytes) {
      return {
        valid: false,
        checkedFiles: 0,
        missing: [snapshotManifestFileName],
        mismatched: [],
      };
    }
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      files?: Array<{ path?: string; sha256?: string }>;
    };
    const files = manifest.files ?? [];
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const file of files) {
      const relative = file.path;
      const expected = file.sha256;
      if (!relative || !expected) continue;
      const bytes = await this.roots.filesystem
        .readFile(path.join(root, relative))
        .catch(() => null);
      if (!bytes) {
        missing.push(relative);
        continue;
      }
      if (sha256Of(bytes) !== expected) mismatched.push(relative);
    }
    const valid = missing.length === 0 && mismatched.length === 0;
    if (valid) this.store.snapshots.markVerified(snapshotId, this.now());
    return { valid, checkedFiles: files.length, missing, mismatched };
  }

  private async walk(
    origin: string,
    relative: string,
    userExclusions: ReadonlySet<string>,
    entries: ManifestEntry[],
    exclusions: DependencySnapshotExclusion[],
  ): Promise<void> {
    const directory = relative === '.' ? origin : path.join(origin, relative);
    const children = await this.roots.filesystem
      .readdirEntries(directory)
      .catch((error: unknown) => {
        throw new ToolchainSnapshotError(
          'read-failed',
          `读取 ${directory} 失败：${messageOf(error)}`,
          {
            cause: error,
          },
        );
      });
    const sorted = [...children].sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const child of sorted) {
      const childRelative = relative === '.' ? child.name : `${relative}/${child.name}`;
      if (child.isSymbolicLink) {
        // 符号链接可能指向快照之外，跟随它会把未选中的内容悄悄带进来。
        throw new ToolchainSnapshotError(
          'symlink-rejected',
          `工具链目录含符号链接 ${childRelative}，已拒绝快照；请改为普通文件后重试`,
        );
      }
      const rule = excludedDirectories.find((entry) => entry.name === child.name);
      if (child.isDirectory && rule) {
        exclusions.push({ path: childRelative, reason: rule.reason });
        continue;
      }
      if (userExclusions.has(childRelative) || userExclusions.has(child.name)) {
        exclusions.push({ path: childRelative, reason: '用户指定排除' });
        continue;
      }
      if (child.isDirectory) {
        await this.walk(origin, childRelative, userExclusions, entries, exclusions);
        continue;
      }
      if (!child.isFile) {
        throw new ToolchainSnapshotError(
          'special-file-rejected',
          `工具链目录含非常规文件 ${childRelative}，已拒绝快照`,
        );
      }
      const fileRule = fileExclusionReason(child.name);
      if (fileRule) {
        exclusions.push({ path: childRelative, reason: fileRule });
        continue;
      }
      const absolute = path.join(origin, childRelative);
      const bytes = await this.roots.filesystem.readFile(absolute).catch((error: unknown) => {
        throw new ToolchainSnapshotError(
          'read-failed',
          `读取 ${childRelative} 失败：${messageOf(error)}`,
          {
            cause: error,
          },
        );
      });
      entries.push({ path: childRelative, sha256: sha256Of(bytes), bytes: bytes.byteLength });
    }
  }

  /** 读源目录的 git 身份；读不到就如实记 unknown，不假装干净。 */
  private async readOriginState(origin: string): Promise<{
    state: DependencySnapshot['originState'];
    commit?: string;
  }> {
    const head = await this.roots.process.run({
      executable: 'git',
      argv: ['-C', origin, 'rev-parse', 'HEAD'],
      timeoutMs: gitTimeoutMs,
    }).result;
    if (head.exitCode !== 0) return { state: 'unknown' };
    const commit = head.stdout.trim();
    const status = await this.roots.process.run({
      executable: 'git',
      argv: ['-C', origin, 'status', '--porcelain'],
      timeoutMs: gitTimeoutMs,
    }).result;
    if (status.exitCode !== 0) return { state: 'unknown', commit };
    return { state: status.stdout.trim() === '' ? 'clean' : 'dirty', commit };
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
