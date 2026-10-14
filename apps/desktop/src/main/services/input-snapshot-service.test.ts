import {
  chmodSync,
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { InputSnapshotService } from './input-snapshot-service';

const stores: AppStore[] = [];
const directories: string[] = [];

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

const createHarness = (): {
  root: string;
  userData: string;
  workspaceId: string;
  store: AppStore;
  service: InputSnapshotService;
} => {
  const root = temporaryDirectory('betterwork-input-workspace-');
  const userData = temporaryDirectory('betterwork-input-user-data-');
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.getOrCreate(root, '输入测试');
  return {
    root,
    userData,
    workspaceId: workspace.id,
    store,
    service: new InputSnapshotService(store, userData, () => 123),
  };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('InputSnapshotService', () => {
  it('copies a workspace file into an immutable, content-addressed snapshot and reuses it', async () => {
    const harness = createHarness();
    const source = path.join(harness.root, '本月数据.csv');
    writeFileSync(source, 'month,revenue\n2026-09,100\n');

    const first = await harness.service.create({
      workspaceId: harness.workspaceId,
      workspaceRoot: harness.root,
      sourcePath: source,
    });
    expect(first).toMatchObject({
      reused: false,
      snapshot: {
        workspaceId: harness.workspaceId,
        sourcePath: '本月数据.csv',
        format: 'csv',
        status: 'ready',
      },
    });
    expect(existsSync(harness.service.resolvePath(first.snapshot))).toBe(true);

    const second = await harness.service.create({
      workspaceId: harness.workspaceId,
      workspaceRoot: harness.root,
      sourcePath: source,
    });
    expect(second).toMatchObject({ reused: true, snapshot: { id: first.snapshot.id } });
    expect(harness.store.inputSnapshots.list()).toHaveLength(1);
  });

  it('rejects outside paths and symlinks before creating a database row', async () => {
    const harness = createHarness();
    const outside = path.join(temporaryDirectory('betterwork-input-outside-'), 'secret.txt');
    writeFileSync(outside, 'private');
    await expect(
      harness.service.create({
        workspaceId: harness.workspaceId,
        workspaceRoot: harness.root,
        sourcePath: outside,
      }),
    ).rejects.toMatchObject({ code: 'outside_workspace' });

    const real = path.join(harness.root, '真实.txt');
    const link = path.join(harness.root, '链接.txt');
    writeFileSync(real, 'real');
    symlinkSync(real, link);
    await expect(
      harness.service.create({
        workspaceId: harness.workspaceId,
        workspaceRoot: harness.root,
        sourcePath: link,
      }),
    ).rejects.toMatchObject({ code: 'symlink_rejected' });
    expect(harness.store.inputSnapshots.list()).toEqual([]);
  });

  it('cancels before copying and recovers preparing rows and orphan files', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();
    const source = path.join(harness.root, '取消.txt');
    writeFileSync(source, 'will not copy');
    await expect(
      harness.service.create({
        workspaceId: harness.workspaceId,
        workspaceRoot: harness.root,
        sourcePath: source,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(harness.store.inputSnapshots.list()).toEqual([]);

    const hash = 'a'.repeat(64);
    const preparing = harness.store.inputSnapshots.createPreparing({
      workspaceId: harness.workspaceId,
      sourcePath: 'preparing.txt',
      contentHash: hash,
      byteSize: 1,
      format: 'txt',
      fileKey: `input-snapshots/${hash}/content`,
      createdAt: 123,
    });
    const orphanDirectory = path.join(harness.userData, 'input-snapshots', 'b'.repeat(64));
    mkdirSync(orphanDirectory, { recursive: true });
    writeFileSync(path.join(orphanDirectory, 'content'), 'orphan');
    const recovered = await harness.service.recover();
    expect(recovered.cancelled).toBe(1);
    expect(recovered.removedFiles).toBe(1);
    expect(harness.store.inputSnapshots.get(preparing.id)?.status).toBe('cancelled');
    expect(existsSync(orphanDirectory)).toBe(false);
  });

  it('marks a missing ready file as failed during recovery', async () => {
    const harness = createHarness();
    const hash = 'c'.repeat(64);
    const snapshot = harness.store.inputSnapshots.createPreparing({
      workspaceId: harness.workspaceId,
      sourcePath: 'missing.txt',
      contentHash: hash,
      byteSize: 1,
      format: 'txt',
      fileKey: `input-snapshots/${hash}/content`,
      createdAt: 123,
    });
    harness.store.inputSnapshots.markReady(snapshot.id, 124);
    const recovered = await harness.service.recover();
    expect(recovered.failed).toBe(1);
    expect(harness.store.inputSnapshots.get(snapshot.id)).toMatchObject({
      status: 'failed',
      failureCode: 'snapshot_missing',
    });
  });
});

describe('input snapshot integrity and failure boundaries', () => {
  it.each([
    ['missing workspace', 'workspace_missing'],
    ['missing source', 'source_missing'],
    ['workspace root', 'outside_workspace'],
    ['directory source', 'special_file_rejected'],
    ['file parent', 'special_file_rejected'],
    ['linked parent', 'symlink_rejected'],
    ['oversized source', 'source_too_large'],
  ])('rejects %s without persisting a partial snapshot', async (scenario, code) => {
    const h = createHarness();
    const source = path.join(h.root, 'input.txt');
    writeFileSync(source, 'original');
    let sourcePath = source;
    let workspaceRoot = h.root;
    if (scenario === 'missing workspace') workspaceRoot = path.join(h.root, 'missing');
    if (scenario === 'missing source') sourcePath = path.join(h.root, 'missing.txt');
    if (scenario === 'workspace root') sourcePath = h.root;
    if (scenario === 'directory source') {
      sourcePath = path.join(h.root, 'folder');
      mkdirSync(sourcePath);
    }
    if (scenario === 'file parent') sourcePath = path.join(source, 'child.txt');
    if (scenario === 'linked parent') {
      const directory = path.join(h.root, 'real');
      mkdirSync(directory);
      writeFileSync(path.join(directory, 'child.txt'), 'child');
      symlinkSync(directory, path.join(h.root, 'linked'));
      sourcePath = path.join(h.root, 'linked', 'child.txt');
    }
    if (scenario === 'oversized source') {
      const fd = openSync(source, 'w');
      ftruncateSync(fd, 100 * 1024 * 1024 + 1);
      closeSync(fd);
    }
    await expect(
      h.service.create({ workspaceId: h.workspaceId, workspaceRoot, sourcePath }),
    ).rejects.toMatchObject({ code });
    expect(h.store.inputSnapshots.list()).toEqual([]);
    expect(existsSync(path.join(h.userData, 'input-snapshots'))).toBe(false);
  });

  it.each(['DATA.CSV', 'no-extension', 'nested/中文.txt'])(
    'copies %s with normalized format and read-only permissions',
    async (relativePath) => {
      const h = createHarness();
      const source = path.join(h.root, relativePath);
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, 'content');
      const result = await h.service.create({
        workspaceId: h.workspaceId,
        workspaceRoot: h.root,
        sourcePath: relativePath,
      });
      const destination = h.service.resolvePath(result.snapshot);
      expect(result.snapshot.format).toBe(
        relativePath === 'DATA.CSV' ? 'csv' : relativePath === 'no-extension' ? 'unknown' : 'txt',
      );
      expect(result.snapshot.sourcePath).toBe(relativePath);
      expect(statSync(destination).mode & 0o777).toBe(0o400);
      expect(readFileSync(source, 'utf8')).toBe('content');
      expect(await h.service.verify(result.snapshot)).toBe(true);
      expect(await h.service.verify({ ...result.snapshot, status: 'preparing' })).toBe(false);
    },
  );

  it('keeps the old version immutable when the source changes', async () => {
    const h = createHarness();
    const source = path.join(h.root, 'input.txt');
    const request = { workspaceId: h.workspaceId, workspaceRoot: h.root, sourcePath: source };
    writeFileSync(source, 'first');
    const first = await h.service.create(request);
    writeFileSync(source, 'second');
    const second = await h.service.create(request);
    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    expect(readFileSync(h.service.resolvePath(first.snapshot), 'utf8')).toBe('first');
    expect(readFileSync(h.service.resolvePath(second.snapshot), 'utf8')).toBe('second');
    expect(h.store.inputSnapshots.list('ready')).toHaveLength(2);
  });

  it('rejects a corrupt existing blob without replacing it and records the failed attempt', async () => {
    const h = createHarness();
    const source = path.join(h.root, 'input.txt');
    writeFileSync(source, 'original');
    const request = { workspaceId: h.workspaceId, workspaceRoot: h.root, sourcePath: source };
    const first = await h.service.create(request);
    const destination = h.service.resolvePath(first.snapshot);
    chmodSync(destination, 0o600);
    writeFileSync(destination, 'corruption');
    expect(await h.service.verify(first.snapshot)).toBe(false);
    await expect(h.service.create(request)).rejects.toMatchObject({ code: 'snapshot_corrupt' });
    expect(readFileSync(destination, 'utf8')).toBe('corruption');
    expect(h.store.inputSnapshots.list('failed')).toHaveLength(1);
    expect(h.store.inputSnapshots.list('failed')[0]?.failureCode).toBe('snapshot_corrupt');
    expect(readdirSync(path.dirname(destination))).toEqual(['content']);
    expect(await h.service.recover()).toEqual({ cancelled: 0, failed: 1, removedFiles: 0 });
    expect(await h.service.recover()).toEqual({ cancelled: 0, failed: 0, removedFiles: 0 });
  });

  it('records write failure when managed storage is obstructed and leaves the source untouched', async () => {
    const h = createHarness();
    const source = path.join(h.root, 'input.txt');
    writeFileSync(source, 'original');
    writeFileSync(path.join(h.userData, 'input-snapshots'), 'obstruction');
    await expect(
      h.service.create({ workspaceId: h.workspaceId, workspaceRoot: h.root, sourcePath: source }),
    ).rejects.toMatchObject({ code: 'write_failed' });
    expect(h.store.inputSnapshots.list('failed')[0]?.failureCode).toBe('write_failed');
    expect(readFileSync(source, 'utf8')).toBe('original');
  });

  it('retains referenced blobs and ignores unrelated entries during idempotent recovery', async () => {
    const h = createHarness();
    writeFileSync(path.join(h.root, 'input.txt'), 'known');
    const ready = await h.service.create({
      workspaceId: h.workspaceId,
      workspaceRoot: h.root,
      sourcePath: 'input.txt',
    });
    const root = path.join(h.userData, 'input-snapshots');
    mkdirSync(path.join(root, 'unrelated'));
    writeFileSync(path.join(root, 'readme'), 'keep');
    expect(await h.service.recover()).toEqual({ cancelled: 0, failed: 0, removedFiles: 0 });
    expect(await h.service.verify(ready.snapshot)).toBe(true);
    expect(existsSync(path.join(root, 'unrelated'))).toBe(true);
    expect(existsSync(path.join(root, 'readme'))).toBe(true);
  });

  it.each(['../outside', 'input-snapshots/../outside', 'other/content'])(
    'rejects an invalid managed key %s',
    async (fileKey) => {
      const h = createHarness();
      writeFileSync(path.join(h.root, 'input.txt'), 'known');
      const { snapshot } = await h.service.create({
        workspaceId: h.workspaceId,
        workspaceRoot: h.root,
        sourcePath: 'input.txt',
      });
      expect(() => h.service.resolvePath({ ...snapshot, fileKey })).toThrowError(
        expect.objectContaining({ code: 'snapshot_corrupt' }),
      );
      expect(await h.service.verify({ ...snapshot, fileKey })).toBe(false);
    },
  );
});
