import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
