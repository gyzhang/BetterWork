import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

describe('Input snapshot batches', () => {
  it('maps complete records in first request order across every status', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspaceId = store.workspaces.getOrCreate('/tmp/snapshot-test', 'snapshots').id;
    const snapshots = Array.from({ length: 4 }, (_, index) =>
      store.inputSnapshots.createPreparing({
        id: `snapshot-'${index}-材料`,
        workspaceId,
        sourcePath: `/tmp/source-${index}.txt`,
        contentHash: 'hash',
        byteSize: 512,
        format: 'text',
        fileKey: `source-${index}.txt`,
        createdAt: index,
      }),
    );
    store.inputSnapshots.markReady(snapshots[1]!.id, 10);
    store.inputSnapshots.markFailed(snapshots[2]!.id, 'failed', 'failure message', 11);
    store.inputSnapshots.markCancelled(snapshots[3]!.id, 12);
    const ids = [
      snapshots[3]!.id,
      'missing',
      snapshots[1]!.id,
      snapshots[0]!.id,
      snapshots[2]!.id,
      snapshots[1]!.id,
    ];
    const expected = [...new Set(ids)].flatMap((id) => {
      const snapshot = store.inputSnapshots.get(id);
      return snapshot === undefined ? [] : [snapshot];
    });
    expect(expected.map((snapshot) => snapshot.status)).toEqual([
      'cancelled',
      'ready',
      'preparing',
      'failed',
    ]);
    const db = (store as unknown as { db: Database.Database }).db;
    const prepare = vi.spyOn(db, 'prepare');
    expect(store.inputSnapshots.listByIds(ids)).toEqual(expected);
    expect(prepare).toHaveBeenCalledOnce();
    expect(store.inputSnapshots.listByIds([])).toEqual([]);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('does not cap a collection larger than the binding limit of a point-query expansion', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspaceId = store.workspaces.getOrCreate('/tmp/snapshot-large', 'snapshots').id;
    const ids = Array.from({ length: 1_050 }, (_, index) => `snapshot-${index}`);
    store.transaction(() => {
      for (const id of ids)
        store.inputSnapshots.createPreparing({
          id,
          workspaceId,
          sourcePath: '/tmp/source',
          contentHash: 'hash',
          byteSize: 0,
          format: 'text',
          fileKey: id,
          createdAt: 0,
        });
    });
    ids.reverse();
    expect(store.inputSnapshots.listByIds(ids).map((snapshot) => snapshot.id)).toEqual(ids);
  });
});
