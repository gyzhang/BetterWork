import { randomUUID } from 'node:crypto';

import type { MemoryRecord } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { legacyReplayDependencies } from './fixtures/history-memory-fixtures';
import { seedGovernanceMemory } from './fixtures/memory-governance-fixtures';
import { normalizedMemoryHash } from './memory-content-policy';
import { buildUserInstructionProvenance } from './memory-provenance';

let store: AppStore;
let directRevisionIds: string[][];
let revisionIds: string[];

beforeAll(() => {
  store = AppStore.open(':memory:');
  const records: MemoryRecord[] = [];
  store.transaction(() => {
    for (let index = 0; index < 3_000; index += 1) {
      const content = `${index}: ${'\u53E3'.repeat(480)}`;
      const record = seedGovernanceMemory(store.memories, content, {
        provenance: buildUserInstructionProvenance({
          capturedAt: 1_000,
          operationId: randomUUID(),
          content,
          genericDeclaration: true,
        }),
      });
      if (index < 128) records.push(record);
      if (index < 64)
        store.memories.update({
          id: record.id,
          expectedRevision: record.revision,
          patch: { content: `updated ${content}` },
          normalizedHash: normalizedMemoryHash(`updated ${content}`),
        });
    }
  });
  directRevisionIds = Array.from({ length: 32 }, () =>
    records.slice(0, 16).map((record) => record.revisionId),
  );
  revisionIds = records.map((record) => record.revisionId);
}, 60_000);

afterAll(() => store?.close());

const legacyRead = () => ({
  directScopes: directRevisionIds.map((ids) =>
    ids.map((id) => store.memories.getRevision(id)?.scope.kind),
  ),
  dependencies: legacyReplayDependencies(store.memories, revisionIds),
});

const projectedRead = () => {
  const dependencies = store.memories.listReplayDependencies(revisionIds);
  const byRevision = new Map(dependencies.map((entry) => [entry.revisionId, entry]));
  return {
    directScopes: directRevisionIds.map((ids) => ids.map((id) => byRevision.get(id)?.scope.kind)),
    dependencies,
  };
};

const measure = (read: () => unknown): { medianMs: number; p95Ms: number } => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    read();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const observeReads = (read: () => unknown) => {
  const revision = store.memories.getRevision.bind(store.memories);
  const current = store.memories.get.bind(store.memories);
  const projected = store.memories.listReplayDependencies.bind(store.memories);
  const counts = {
    completeRows: 0,
    projectedRows: 0,
    payloadBytes: 0,
    contentBytes: 0,
    provenanceBytes: 0,
  };
  const observeRecord = (record: MemoryRecord | undefined): MemoryRecord | undefined => {
    if (record !== undefined) {
      counts.completeRows += 1;
      counts.payloadBytes += bytes(record);
      counts.contentBytes += Buffer.byteLength(record.content, 'utf8');
      counts.provenanceBytes += bytes(record.provenance);
    }
    return record;
  };
  vi.spyOn(store.memories, 'getRevision').mockImplementation((id) => observeRecord(revision(id)));
  vi.spyOn(store.memories, 'get').mockImplementation((id) => observeRecord(current(id)));
  const batch = vi.spyOn(store.memories, 'listReplayDependencies').mockImplementation((ids) => {
    const entries = projected(ids);
    counts.projectedRows += entries.length;
    counts.payloadBytes += bytes(entries);
    return entries;
  });
  try {
    read();
    return { ...counts, batchReads: batch.mock.calls.length };
  } finally {
    vi.restoreAllMocks();
  }
};

describe('History memory dependency read model scale', () => {
  it('keeps exact historical metadata and direct scopes while loading only unique projected revisions', () => {
    const legacy = legacyRead();
    const projected = projectedRead();
    expect(projected).toEqual(legacy);
    expect(projected.dependencies).toHaveLength(128);
    expect(
      projected.dependencies.filter((entry) => entry.latestRevisionOfIdentity !== entry.revision),
    ).toHaveLength(64);
    const legacyTiming = measure(legacyRead);
    const projectedTiming = measure(projectedRead);
    const legacyReads = observeReads(legacyRead);
    const projectedReads = observeReads(projectedRead);
    expect(legacyReads.completeRows).toBe(768);
    expect(legacyReads.batchReads).toBe(0);
    expect(projectedReads.completeRows).toBe(0);
    expect(projectedReads.projectedRows).toBe(128);
    expect(projectedReads.batchReads).toBe(1);
    expect(projectedReads.contentBytes).toBe(0);
    expect(projectedReads.provenanceBytes).toBe(0);
    expect(projectedReads.payloadBytes).toBeLessThan(legacyReads.payloadBytes / 10);
    console.warn(
      JSON.stringify({
        benchmark: 'history-memory-dependencies',
        latestIdentities: 3_000,
        storedRows: 3_064,
        simulatedPriorRuns: 32,
        selectedPerRun: 16,
        uniqueRequestedRevisions: 128,
        historicalRevisions: 64,
        legacyReads,
        projectedReads,
        legacyTiming,
        projectedTiming,
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });
});
