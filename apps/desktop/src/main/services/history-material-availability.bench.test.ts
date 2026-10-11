import type { MaterialReference } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import {
  legacyMaterialAvailability,
  seedHistoryMaterials,
} from './fixtures/history-material-fixtures';
import { seedReplayRun } from './fixtures/history-memory-fixtures';
import { historyMaterialAvailability } from './history-material-availability';

const measure = (read: () => unknown) => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    read();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

describe('History material entity reads', () => {
  it('compares original point decodes with complete batched entities for repeated history materials', () => {
    const store = AppStore.open(':memory:');
    try {
      const workspaceId = store.workspaces.getOrCreate('/tmp/history-material-bench', 'bench').id;
      const task = store.tasks.create(workspaceId, 'bench', 'bench');
      const input = { taskId: task.task.id, sessionId: task.sessionId, workspaceId };
      const runIds: string[] = [];
      store.transaction(() => {
        const materialSets = Array.from({ length: 4 }, (_, index) =>
          seedHistoryMaterials(store, { ...input, index }),
        );
        for (let index = 0; index < 256; index += 1) {
          const materials = materialSets[index % materialSets.length]!;
          runIds.push(
            seedReplayRun(store, {
              ...input,
              index,
              materials,
              inheritedMaterials: materials,
            }),
          );
        }
      });
      const references: MaterialReference[] = runIds.flatMap((runId) => [
        ...store.runContextSnapshots.get(runId)!.materials.map((material) => material.reference),
        ...store.runMemoryContexts.get(runId)!.materialDependencyUnion,
      ]);
      const legacy = () => legacyMaterialAvailability(store, references);
      const batch = () => historyMaterialAvailability(store, references);
      expect(batch()).toEqual(legacy());
      const observe = (read: () => boolean[], batched: boolean) => {
        const db = (store as unknown as { db: Database.Database }).db;
        const prepare = vi.spyOn(db, 'prepare');
        const versions = batched
          ? vi.spyOn(store.artifacts, 'listVersionDetails')
          : vi.spyOn(store.artifacts, 'getVersionDetail');
        const snapshots = batched
          ? vi.spyOn(store.inputSnapshots, 'listByIds')
          : vi.spyOn(store.inputSnapshots, 'get');
        try {
          const result = read();
          const versionRecords = versions.mock.results.flatMap((entry) =>
            entry.type === 'return' && entry.value !== undefined
              ? Array.isArray(entry.value)
                ? entry.value
                : [entry.value]
              : [],
          );
          const snapshotRecords = snapshots.mock.results.flatMap((entry) =>
            entry.type === 'return' && entry.value !== undefined
              ? Array.isArray(entry.value)
                ? entry.value
                : [entry.value]
              : [],
          );
          return {
            queries: prepare.mock.calls.length,
            decodedVersions: versionRecords.length,
            decodedSnapshots: snapshotRecords.length,
            decodedEvidence: versionRecords.reduce(
              (sum, record) => sum + record.evidence.length,
              0,
            ),
            decodedEntityJsonBytes: [...versionRecords, ...snapshotRecords].reduce(
              (sum, record) => sum + Buffer.byteLength(JSON.stringify(record), 'utf8'),
              0,
            ),
            availabilityJsonBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
          };
        } finally {
          prepare.mockRestore();
          versions.mockRestore();
          snapshots.mockRestore();
        }
      };
      const legacyReads = observe(legacy, false);
      const batchReads = observe(batch, true);
      expect(legacyReads.queries).toBe(3_072);
      expect(batchReads.queries).toBe(4);
      expect(legacyReads.decodedVersions).toBe(1_024);
      expect(batchReads.decodedVersions).toBe(8);
      expect(legacyReads.decodedSnapshots).toBe(512);
      expect(batchReads.decodedSnapshots).toBe(4);
      expect(legacyReads.decodedEvidence).toBe(3_072);
      expect(batchReads.decodedEvidence).toBe(24);
      expect(batchReads.availabilityJsonBytes).toBe(legacyReads.availabilityJsonBytes);
      console.warn(
        JSON.stringify({
          benchmark: 'history-material-entity-read-stage',
          actualRuns: runIds.length,
          referenceOccurrences: references.length,
          legacyReads,
          batchReads,
          legacyTiming: measure(legacy),
          batchTiming: measure(batch),
          machine: `${process.platform} ${process.arch} node ${process.version}`,
        }),
      );
    } finally {
      vi.restoreAllMocks();
      store.close();
    }
  });
});
