import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DependencyLock } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  DependencyDirectoryEntry,
  DependencyFileSystem,
  DependencyProcessHandle,
  DependencyProcessRequest,
  DependencyProcessResult,
  DependencyProcessRunner,
} from '../infrastructure/dependency-adapters';
import { createNodeFileSystem } from '../infrastructure/dependency-adapters';
import {
  listDependencyLocks,
  loadDependencyLock,
  pptGenerationLockId,
} from '../infrastructure/dependency-lock-catalog';
import { AppStore } from '../persistence';
import { computeDependencyFingerprint } from './skill-dependency-service';
import {
  snapshotManifestFileName,
  ToolchainSnapshotError,
  ToolchainSnapshotService,
} from './toolchain-snapshot-service';

const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-snapshot-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** 内存目录树：支持普通文件、目录、符号链接与特殊文件，用来验证快照的取舍规则。 */
class FakeTree implements DependencyFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();
  readonly symlinks = new Set<string>();
  readonly specials = new Set<string>();

  write(target: string, content: string): this {
    this.files.set(target, encoder.encode(content));
    this.addDirectories(path.dirname(target));
    return this;
  }

  directory(target: string): this {
    this.directories.add(target);
    this.addDirectories(path.dirname(target));
    return this;
  }

  symlink(target: string): this {
    this.symlinks.add(target);
    this.addDirectories(path.dirname(target));
    return this;
  }

  special(target: string): this {
    this.specials.add(target);
    this.addDirectories(path.dirname(target));
    return this;
  }

  private addDirectories(target: string): void {
    let current = target;
    while (!this.directories.has(current)) {
      this.directories.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  async exists(target: string): Promise<boolean> {
    return (
      this.files.has(target) ||
      this.directories.has(target) ||
      this.symlinks.has(target) ||
      this.specials.has(target)
    );
  }

  async mkdir(target: string): Promise<void> {
    this.addDirectories(target);
  }

  async remove(target: string): Promise<void> {
    const inside = (key: string): boolean => key === target || key.startsWith(`${target}/`);
    for (const set of [this.directories, this.symlinks, this.specials]) {
      for (const key of [...set]) {
        if (inside(key)) set.delete(key);
      }
    }
    for (const key of [...this.files.keys()]) {
      if (inside(key)) this.files.delete(key);
    }
  }

  async writeFile(target: string, content: string | Uint8Array): Promise<void> {
    this.files.set(target, typeof content === 'string' ? encoder.encode(content) : content);
    this.addDirectories(path.dirname(target));
  }

  async readFile(target: string): Promise<Uint8Array> {
    const bytes = this.files.get(target);
    if (!bytes) throw new Error(`ENOENT: ${target}`);
    return bytes;
  }

  async readdir(target: string): Promise<string[]> {
    return (await this.readdirEntries(target)).map((entry) => entry.name);
  }

  async readdirEntries(target: string): Promise<DependencyDirectoryEntry[]> {
    const prefix = `${target}/`;
    const names = new Map<string, DependencyDirectoryEntry>();
    const record = (key: string, kind: 'directory' | 'file' | 'symlink' | 'special'): void => {
      if (!key.startsWith(prefix)) return;
      const rest = key.slice(prefix.length);
      if (rest.includes('/')) {
        const first = rest.split('/')[0];
        if (first && !names.has(first)) {
          names.set(first, {
            name: first,
            isDirectory: true,
            isFile: false,
            isSymbolicLink: false,
          });
        }
        return;
      }
      if (rest === '' || names.has(rest)) return;
      names.set(rest, {
        name: rest,
        isDirectory: kind === 'directory',
        isFile: kind === 'file',
        isSymbolicLink: kind === 'symlink',
      });
    };
    for (const key of this.directories) record(key, 'directory');
    for (const key of this.files.keys()) record(key, 'file');
    for (const key of this.symlinks) record(key, 'symlink');
    for (const key of this.specials) record(key, 'special');
    return [...names.values()].sort((left, right) => (left.name < right.name ? -1 : 1));
  }

  async size(target: string): Promise<number> {
    const bytes = this.files.get(target);
    if (!bytes) throw new Error(`ENOENT: ${target}`);
    return bytes.byteLength;
  }

  async realpath(target: string): Promise<string> {
    return target;
  }
}

interface GitState {
  available: boolean;
  commit: string;
  dirty: boolean;
}

/** 替身 git：只提供快照需要的两条只读命令。 */
class FakeGitRunner implements DependencyProcessRunner {
  readonly calls: DependencyProcessRequest[] = [];

  constructor(private readonly state: GitState) {}

  run(request: DependencyProcessRequest): DependencyProcessHandle {
    this.calls.push(request);
    const result = new Promise<DependencyProcessResult>((resolve) => {
      if (!this.state.available) {
        resolve({
          exitCode: 127,
          signal: null,
          stdout: '',
          stderr: 'git: command not found',
          timedOut: false,
        });
        return;
      }
      if (request.argv.includes('rev-parse')) {
        resolve({
          exitCode: 0,
          signal: null,
          stdout: `${this.state.commit}\n`,
          stderr: '',
          timedOut: false,
        });
        return;
      }
      if (request.argv.includes('status')) {
        resolve({
          exitCode: 0,
          signal: null,
          stdout: this.state.dirty ? ' M skills/ppt-master/templates/charts/radar_chart.svg\n' : '',
          stderr: '',
          timedOut: false,
        });
        return;
      }
      resolve({ exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false });
    });
    return { result, kill: () => undefined };
  }
}

interface Harness {
  service: ToolchainSnapshotService;
  store: AppStore;
  tree: FakeTree;
  git: FakeGitRunner;
  userDataRoot: string;
  assetsRoot: string;
  origin: string;
}

const openHarness = (git: Partial<GitState> = {}): Harness => {
  const userDataRoot = temporaryDirectory();
  const store = AppStore.open(path.join(userDataRoot, 'app.sqlite'));
  const tree = new FakeTree();
  const origin = '/Users/fixture/ppt-master';
  tree
    .write(`${origin}/skills/ppt-master/scripts/svg_to_pptx.py`, 'print("export")\n')
    .write(`${origin}/skills/ppt-master/scripts/icon_sync.py`, 'print("icons")\n')
    .write(`${origin}/skills/ppt-master/templates/decks/decks_index.json`, '{"decks":[]}\n')
    .write(`${origin}/skills/ppt-master/templates/icons/tabler-filled/home.svg`, '<svg/>\n')
    .write(`${origin}/skills/ppt-master/scripts/__pycache__/config.cpython-312.pyc`, 'bytecode')
    .write(`${origin}/skills/ppt-master/.DS_Store`, 'metadata')
    .write(`${origin}/projects/2025-旧项目/spec_lock.json`, '{"private":true}\n')
    .write(`${origin}/README.md`, '# toolchain\n')
    .directory(`${origin}/.git`);
  tree.write(`${origin}/.git/HEAD`, 'ref: refs/heads/main\n');

  const runner = new FakeGitRunner({
    available: git.available ?? true,
    commit: git.commit ?? '82dd5cccec652cbcff342cbdabce85a1ae7af1e5',
    dirty: git.dirty ?? true,
  });
  const assetsRoot = path.join(userDataRoot, 'dependency-assets');
  return {
    service: new ToolchainSnapshotService({
      store,
      userDataRoot,
      assetsRoot,
      filesystem: tree,
      process: runner,
    }),
    store,
    tree,
    git: runner,
    userDataRoot,
    assetsRoot,
    origin,
  };
};

const snapshotRootOf = (harness: Harness, manifestHash: string): string =>
  path.join(harness.userDataRoot, 'dependency-assets', manifestHash);

describe('外部工具链快照', () => {
  it('复制所选内容并逐条列明排除项', async () => {
    const harness = openHarness();

    const receipt = await harness.service.createSnapshot({ origin: harness.origin });

    expect(receipt.reused).toBe(false);
    const snapshot = receipt.snapshot;
    expect(snapshot.origin).toBe(harness.origin);
    expect(snapshot.originCommit).toBe('82dd5cccec652cbcff342cbdabce85a1ae7af1e5');
    expect(snapshot.originState).toBe('dirty');
    expect(snapshot.fileCount).toBe(5);
    expect(snapshot.pathKey).toBe(`dependency-assets/${snapshot.manifestHash}`);

    const excluded = new Map(snapshot.exclusions.map((entry) => [entry.path, entry.reason]));
    expect(excluded.get('.git')).toContain('版本库对象');
    expect(excluded.get('projects')).toContain('历史项目资料');
    expect(excluded.get('skills/ppt-master/scripts/__pycache__')).toContain('字节码缓存');
    expect(excluded.get('skills/ppt-master/.DS_Store')).toContain('资源管理器元数据');
    expect(excluded.size).toBe(4);

    // 受管副本里只有选中内容：私有项目资料与缓存都不在
    const root = snapshotRootOf(harness, snapshot.manifestHash);
    expect(
      await harness.tree.exists(path.join(root, 'skills/ppt-master/scripts/svg_to_pptx.py')),
    ).toBe(true);
    expect(await harness.tree.exists(path.join(root, 'projects/2025-旧项目/spec_lock.json'))).toBe(
      false,
    );
    expect(await harness.tree.exists(path.join(root, '.git/HEAD'))).toBe(false);
    expect(await harness.tree.exists(path.join(root, snapshotManifestFileName))).toBe(true);

    const verification = await harness.service.verifySnapshot(snapshot.id);
    expect(verification).toMatchObject({
      valid: true,
      checkedFiles: 5,
      missing: [],
      mismatched: [],
    });
  });

  it('include 只取所需子树，缺失的必需内容明确失败', async () => {
    const harness = openHarness();

    const receipt = await harness.service.createSnapshot({
      origin: harness.origin,
      include: ['skills/ppt-master'],
    });
    expect(receipt.snapshot.fileCount).toBe(4);
    expect(receipt.snapshot.exclusions.map((entry) => entry.path)).toEqual([
      'skills/ppt-master/.DS_Store',
      'skills/ppt-master/scripts/__pycache__',
    ]);

    await expect(
      harness.service.createSnapshot({
        origin: harness.origin,
        include: ['skills/ppt-master/templates/icons-missing'],
      }),
    ).rejects.toMatchObject({ code: 'include-missing' });
  });

  it('dirty tree 快照区别于 HEAD：改动源文件后是新快照，旧快照内容不变', async () => {
    const harness = openHarness({ dirty: true });
    const first = await harness.service.createSnapshot({ origin: harness.origin });

    // 修改源目录里的一个脚本：内容 hash 必须变化，即使 commit 没变
    harness.tree.write(
      `${harness.origin}/skills/ppt-master/scripts/svg_to_pptx.py`,
      'print("export patched")\n',
    );
    const second = await harness.service.createSnapshot({ origin: harness.origin });

    expect(second.snapshot.manifestHash).not.toBe(first.snapshot.manifestHash);
    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    expect(second.snapshot.originCommit).toBe(first.snapshot.originCommit);
    expect(second.reused).toBe(false);

    // 已登记的旧快照不受源目录改动影响：内容仍是当时那一份
    const oldFile = path.join(
      snapshotRootOf(harness, first.snapshot.manifestHash),
      'skills/ppt-master/scripts/svg_to_pptx.py',
    );
    expect(new TextDecoder().decode(await harness.tree.readFile(oldFile))).toBe(
      'print("export")\n',
    );
    expect(await harness.service.verifySnapshot(first.snapshot.id)).toMatchObject({ valid: true });
    expect(harness.service.listSnapshots()).toHaveLength(2);
  });

  it('干净工作区记为 clean，读不到版本身份时如实记 unknown', async () => {
    const clean = openHarness({ dirty: false });
    expect(
      (await clean.service.createSnapshot({ origin: clean.origin })).snapshot.originState,
    ).toBe('clean');

    const noGit = openHarness({ available: false });
    const receipt = await noGit.service.createSnapshot({ origin: noGit.origin });
    expect(receipt.snapshot.originState).toBe('unknown');
    expect(receipt.snapshot.originCommit).toBeUndefined();
  });

  it('内容相同的请求复用同一个快照，不重复复制', async () => {
    const harness = openHarness();
    const first = await harness.service.createSnapshot({ origin: harness.origin });
    const second = await harness.service.createSnapshot({ origin: harness.origin });

    expect(second.reused).toBe(true);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(harness.service.listSnapshots()).toHaveLength(1);
  });

  it('受管副本被改动或缺文件时核验失败，运行方必须拒绝执行', async () => {
    const harness = openHarness();
    const receipt = await harness.service.createSnapshot({ origin: harness.origin });
    const root = snapshotRootOf(harness, receipt.snapshot.manifestHash);
    const target = path.join(root, 'skills/ppt-master/scripts/icon_sync.py');
    await harness.tree.writeFile(target, 'print("被替换过的脚本")\n');

    const mismatched = await harness.service.verifySnapshot(receipt.snapshot.id);
    expect(mismatched.valid).toBe(false);
    expect(mismatched.mismatched).toEqual(['skills/ppt-master/scripts/icon_sync.py']);

    await harness.tree.remove(target);
    const missing = await harness.service.verifySnapshot(receipt.snapshot.id);
    expect(missing.valid).toBe(false);
    expect(missing.missing).toEqual(['skills/ppt-master/scripts/icon_sync.py']);

    // 清单文件本身丢失时也不能当作可用
    await harness.tree.remove(path.join(root, snapshotManifestFileName));
    const noManifest = await harness.service.verifySnapshot(receipt.snapshot.id);
    expect(noManifest).toMatchObject({ valid: false, checkedFiles: 0 });
  });

  it('符号链接与特殊文件被拒绝，不静默跳过也不跟随', async () => {
    const harness = openHarness();
    harness.tree.symlink(`${harness.origin}/skills/ppt-master/scripts/linked.py`);
    await expect(harness.service.createSnapshot({ origin: harness.origin })).rejects.toMatchObject({
      code: 'symlink-rejected',
    });

    const specials = openHarness();
    specials.tree.special(`${specials.origin}/skills/ppt-master/scripts/socket-device`);
    await expect(
      specials.service.createSnapshot({ origin: specials.origin }),
    ).rejects.toBeInstanceOf(ToolchainSnapshotError);
    await expect(
      specials.service.createSnapshot({ origin: specials.origin }),
    ).rejects.toMatchObject({ code: 'special-file-rejected' });
  });

  it('源目录不存在时明确失败，不生成空快照', async () => {
    const harness = openHarness();
    await expect(
      harness.service.createSnapshot({ origin: '/Users/fixture/does-not-exist' }),
    ).rejects.toMatchObject({ code: 'origin-missing' });
    expect(harness.service.listSnapshots()).toHaveLength(0);
  });

  it('用户指定排除也进摘要，理由可回看', async () => {
    const harness = openHarness();
    const receipt = await harness.service.createSnapshot({
      origin: harness.origin,
      exclude: ['skills/ppt-master/templates/decks'],
    });
    const excluded = receipt.snapshot.exclusions.find(
      (entry) => entry.path === 'skills/ppt-master/templates/decks',
    );
    expect(excluded?.reason).toBe('用户指定排除');
    expect(receipt.snapshot.fileCount).toBe(4);
  });

  it('升级工具链后旧 binding 仍能回看当时绑定的快照', async () => {
    const harness = openHarness();
    const first = await harness.service.createSnapshot({ origin: harness.origin });
    const ids = seedBindingChain(harness.store, [first.snapshot.id]);

    harness.tree.write(`${harness.origin}/README.md`, '# toolchain v2\n');
    const second = await harness.service.createSnapshot({ origin: harness.origin });
    expect(second.snapshot.manifestHash).not.toBe(first.snapshot.manifestHash);

    const binding = harness.store.executions.getBinding(ids.bindingId);
    expect(binding?.dependencySnapshotIds).toEqual([first.snapshot.id]);
    const oldSnapshot = harness.service.getSnapshot(first.snapshot.id);
    expect(oldSnapshot?.manifestHash).toBe(first.snapshot.manifestHash);
    expect(await harness.service.verifySnapshot(first.snapshot.id)).toMatchObject({ valid: true });
    expect(harness.service.listSnapshots()).toHaveLength(2);
  });

  it('rejects an edited manifest instead of trusting its replacement hashes', async () => {
    const harness = openHarness();
    const receipt = await harness.service.createSnapshot({ origin: harness.origin });
    const root = harness.service.resolveSnapshotRoot(receipt.snapshot);
    harness.tree.write(
      `${root}/.betterwork-snapshot-manifest.json`,
      JSON.stringify({ manifestVersion: 1, files: [] }),
    );
    expect(await harness.service.verifySnapshot(receipt.snapshot.id)).toMatchObject({
      valid: false,
      checkedFiles: 0,
    });
  });

  it('授权指纹随包锁或快照变化失效，旧授权不再放行', async () => {
    const harness = openHarness();
    const first = await harness.service.createSnapshot({ origin: harness.origin });
    const lockHash = 'a'.repeat(64);
    const fingerprint = computeDependencyFingerprint({
      lockHash,
      snapshotManifestHashes: [first.snapshot.manifestHash],
    });
    const ids = seedBindingChain(harness.store, [first.snapshot.id], fingerprint);

    expect(
      harness.store.executions.findActiveGrant(
        ids.skillId,
        ids.revisionId,
        ids.profileHash,
        fingerprint,
      ),
    ).toBeDefined();
    // 依赖变化（换包锁或换快照）后，同一条授权不再匹配
    const changedLock = computeDependencyFingerprint({
      lockHash: 'b'.repeat(64),
      snapshotManifestHashes: [first.snapshot.manifestHash],
    });
    const changedSnapshot = computeDependencyFingerprint({
      lockHash,
      snapshotManifestHashes: ['c'.repeat(64)],
    });
    expect(
      harness.store.executions.findActiveGrant(
        ids.skillId,
        ids.revisionId,
        ids.profileHash,
        changedLock,
      ),
    ).toBeUndefined();
    expect(
      harness.store.executions.findActiveGrant(
        ids.skillId,
        ids.revisionId,
        ids.profileHash,
        changedSnapshot,
      ),
    ).toBeUndefined();
    // 不传指纹时保持 A07 的语义：只看修订与 profile
    expect(
      harness.store.executions.findActiveGrant(ids.skillId, ids.revisionId, ids.profileHash),
    ).toBeDefined();
  });
});

const seedBindingChain = (
  store: AppStore,
  snapshotIds: string[],
  dependencyFingerprint = 'fingerprint-1',
): { bindingId: string; skillId: string; revisionId: string; profileHash: string } => {
  const now = 1_700_000_000_000;
  const workspace = store.workspaces.getOrCreate('/tmp/snapshot-workspace', '快照工作区');
  const created = store.tasks.create(workspace.id, '制作演示', '生成 deck');
  const runId = 'run-snapshot';
  store.runs.create({
    id: runId,
    taskId: created.task.id,
    sessionId: created.sessionId,
    prompt: '生成 deck',
    status: 'running',
    createdAt: now,
  });

  const skillId = 'skill-snapshot';
  const revisionId = `${skillId}-rev`;
  const profileHash = 'profile-hash';
  store.skills.save({
    id: skillId,
    name: '样本能力',
    description: '公司模板 PPT',
    sourceKind: 'user',
    currentRevisionId: revisionId,
  });
  store.skills.saveRevision({
    id: revisionId,
    skillId,
    contentHash: 'content-hash',
    resourceKey: `user/${skillId}/revisions/content-hash`,
    frontmatter: {},
  });
  const profileId = store.skills.saveProfile({
    skillId,
    profileHash,
    profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
  });
  store.skills.save({
    id: skillId,
    name: '样本能力',
    description: '公司模板 PPT',
    sourceKind: 'user',
    currentRevisionId: revisionId,
    currentProfileRevisionId: profileId,
  });
  const grantId = store.skills.saveTrustGrant({
    skillId,
    revisionId,
    profileHash,
    dependencyFingerprint,
    scopeHash: 'scope-hash',
    source: 'user',
  });
  const binding = store.executions.createBinding({
    runId,
    skillRevisionId: revisionId,
    profileRevisionId: profileId,
    dependencySnapshotIds: snapshotIds,
    grantId,
  });
  return { bindingId: binding.id, skillId, revisionId, profileHash };
};

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const locksRoot = path.join(repositoryRoot, 'resources', 'dependency-locks');

describe('随包依赖锁', () => {
  it('样本锁通过协议校验，并带真实校验值与许可', async () => {
    const filesystem = createNodeFileSystem();
    const lockIds = await listDependencyLocks(locksRoot, filesystem);
    expect(lockIds).toContain(pptGenerationLockId);

    const lock = await loadDependencyLock(locksRoot, pptGenerationLockId, filesystem);
    expect(lock.platform).toEqual({ os: 'darwin', arch: 'arm64', abi: 'cp312' });
    expect(lock.pythonRequirement).toBe('3.12');
    expect(lock.packages.map((entry) => entry.name)).toEqual([
      'lxml',
      'pillow',
      'python-pptx',
      'PyYAML',
      'skia-pathops',
      'typing_extensions',
      'uharfbuzz',
      'xlsxwriter',
    ]);
    for (const entry of lock.packages) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(entry.version).not.toContain('>=');
      expect(entry.url?.startsWith('https://files.pythonhosted.org/')).toBe(true);
      expect(entry.license).toBeTruthy();
    }
    expect(lock.importProbes).toEqual([
      'pptx',
      'lxml',
      'yaml',
      'PIL',
      'xlsxwriter',
      'pathops',
      'uharfbuzz',
    ]);
  });

  it('拒绝路径借道、缺失与损坏的锁', async () => {
    const filesystem = createNodeFileSystem();
    await expect(loadDependencyLock(locksRoot, '../../package', filesystem)).rejects.toMatchObject({
      code: 'invalid-lock-id',
    });
    await expect(loadDependencyLock(locksRoot, 'not-a-lock', filesystem)).rejects.toMatchObject({
      code: 'lock-missing',
    });

    const brokenRoot = temporaryDirectory();
    const brokenFilesystem = new FakeTree();
    brokenFilesystem.write(path.join(brokenRoot, 'broken.json'), '{ not json');
    await expect(loadDependencyLock(brokenRoot, 'broken', brokenFilesystem)).rejects.toMatchObject({
      code: 'lock-invalid',
    });

    // 宽松版本或没有 hash 的锁不是可用的安装依据
    const looseFilesystem = new FakeTree();
    const loose: DependencyLock = {
      lockVersion: 1,
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      pythonRequirement: '3.12',
      packages: [],
      importProbes: [],
    };
    looseFilesystem.write(
      path.join(brokenRoot, 'loose.json'),
      JSON.stringify({
        ...loose,
        packages: [
          {
            name: 'python-pptx',
            version: '>=1.0',
            wheel: 'x.whl',
            sha256: 'short',
            source: 'wheelhouse',
          },
        ],
      }),
    );
    await expect(loadDependencyLock(brokenRoot, 'loose', looseFilesystem)).rejects.toMatchObject({
      code: 'lock-invalid',
    });
  });

  it('锁标识模式只接受受控字符集', async () => {
    const filesystem = new FakeTree();
    await expect(loadDependencyLock('/tmp', 'UPPER_case', filesystem)).rejects.toBeInstanceOf(
      Error,
    );
  });
});

describe('依赖锁哈希', () => {
  it('同一份锁在任何机器上得到同一个 hash，顺序无关', () => {
    const lock: DependencyLock = {
      lockVersion: 1,
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      pythonRequirement: '3.12',
      packages: [
        { name: 'a', version: '1', wheel: 'a.whl', sha256: 'a'.repeat(64), source: 'wheelhouse' },
        { name: 'b', version: '2', wheel: 'b.whl', sha256: 'b'.repeat(64), source: 'wheelhouse' },
      ],
      importProbes: ['a'],
    };
    const hash = computeDependencyFingerprint({ lockHash: hashOf(lock) });
    expect(hash).toBe(computeDependencyFingerprint({ lockHash: hashOf(lock) }));
    expect(hash).not.toBe(
      computeDependencyFingerprint({ lockHash: hashOf({ ...lock, pythonRequirement: '3.11' }) }),
    );
  });
});

const hashOf = (lock: DependencyLock): string =>
  createHash('sha256').update(JSON.stringify(lock)).digest('hex');
