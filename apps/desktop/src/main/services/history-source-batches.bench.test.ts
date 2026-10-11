import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { legacyHistorySources, seedReplayRun } from './fixtures/history-memory-fixtures';

let store: AppStore;
let runIds: string[];

beforeAll(() => {
  store = AppStore.open(':memory:');
  const workspaceId = store.workspaces.getOrCreate('/tmp/history-source-bench', 'source').id;
  const task = store.tasks.create(workspaceId, 'source', 'source');
  const materials = Array.from({ length: 4 }, (_, index) => ({
    kind: 'knowledge-revision' as const,
    knowledgeDocumentId: `doc-${index}`,
    knowledgeRevisionId: `rev-${index}`,
    contentHash: 'a'.repeat(64),
    sourcePath: `/tmp/material-${index}.md`,
  }));
  store.transaction(() => {
    runIds = Array.from({ length: 256 }, (_, index) => {
      const runId = seedReplayRun(store, {
        taskId: task.task.id,
        sessionId: task.sessionId,
        workspaceId,
        index,
        materials,
        inheritedMaterials: materials,
      });
      for (const [offset, material] of materials.entries())
        store.materialReads.save({
          id: `${runId}-${offset}`,
          runId,
          material,
          operation: 'read',
          contentHash: material.contentHash,
          capturedAt: index,
        });
      return runId;
    }).reverse();
  });
}, 60_000);

afterAll(() => store?.close());

const legacyRead = () => legacyHistorySources(store, runIds);
const batchRead = () => ({
  contexts: store.runMemoryContexts.listByRunIds(runIds),
  snapshots: store.runContextSnapshots.listByRunIds(runIds),
  reads: store.materialReads.listByRunIds(runIds),
});

const measure = (read: () => unknown) => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const startedAt = performance.now();
    read();
    return performance.now() - startedAt;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const observe = (read: () => ReturnType<typeof batchRead>) => {
  const db = (store as unknown as { db: Database.Database }).db;
  const prepare = vi.spyOn(db, 'prepare');
  try {
    const result = read();
    return {
      queries: prepare.mock.calls.length,
      decodedRows: result.contexts.length + result.snapshots.length + result.reads.length,
      returnedJsonBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
    };
  } finally {
    prepare.mockRestore();
  }
};

describe('History source fact reads', () => {
  it('keeps complete source records and per-run order while replacing point queries with three batches', () => {
    expect(batchRead()).toEqual(legacyRead());
    const legacyReads = observe(legacyRead);
    const batchReads = observe(batchRead);
    expect(legacyReads.queries).toBe(768);
    expect(batchReads.queries).toBe(3);
    expect(batchReads.decodedRows).toBe(1_536);
    expect(batchReads.decodedRows).toBe(legacyReads.decodedRows);
    expect(batchReads.returnedJsonBytes).toBe(legacyReads.returnedJsonBytes);
    console.warn(
      JSON.stringify({
        benchmark: 'history-source-fact-read-stage',
        actualRuns: runIds.length,
        footprints: 1_024,
        legacyReads,
        batchReads,
        legacyTiming: measure(legacyRead),
        batchTiming: measure(batchRead),
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });
});
