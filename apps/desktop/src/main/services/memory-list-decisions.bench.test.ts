import type { MemoryConflictPair, MemoryRecord } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import {
  recordGovernanceDecision,
  seedGovernanceMemory,
} from './fixtures/memory-governance-fixtures';

let store: AppStore;
let records: MemoryRecord[];
let revisionIds: string[];

beforeAll(() => {
  store = AppStore.open(':memory:');
  store.transaction(() => {
    records = Array.from({ length: 3_000 }, (_, index) =>
      seedGovernanceMemory(store.memories, `rule-${index}`, {
        topicKey: `topic-${Math.floor(index / 2)}`,
      }),
    );
    revisionIds = records.slice(0, 100).map((record) => record.revisionId);
    for (let index = 0; index < records.length; index += 2)
      recordGovernanceDecision(store, records[index]!, records[index + 1]!, `condition-${index}`);
    for (let index = 0; index < 20; index += 1)
      for (let offset = 0; offset < 4; offset += 1)
        recordGovernanceDecision(
          store,
          records[index]!,
          records[100 + index * 4 + offset]!,
          `outside-${index}-${offset}`,
        );
  });
}, 60_000);

afterAll(() => store?.close());

const legacyRead = (): MemoryConflictPair[][] =>
  revisionIds.map((revisionId) =>
    store.memoryOperations.listConflictPairsForRevisionIds([revisionId]),
  );

const batchRead = (): MemoryConflictPair[][] => {
  const pairs = store.memoryOperations.listConflictPairsForRevisionIds(revisionIds);
  // The simple filter is an independent allocation oracle; the service uses a revision map.
  return revisionIds.map((revisionId) =>
    pairs.filter(
      (pair) => pair.leftRevisionId === revisionId || pair.rightRevisionId === revisionId,
    ),
  );
};

const measure = (read: () => unknown) => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const startedAt = performance.now();
    read();
    return performance.now() - startedAt;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const observe = (read: () => unknown) => {
  const original = store.memoryOperations.listConflictPairsForRevisionIds.bind(
    store.memoryOperations,
  );
  const counts = { queries: 0, decodedRows: 0, repositoryJsonBytes: 0 };
  vi.spyOn(store.memoryOperations, 'listConflictPairsForRevisionIds').mockImplementation((ids) => {
    const pairs = original(ids);
    counts.queries += 1;
    counts.decodedRows += pairs.length;
    counts.repositoryJsonBytes += Buffer.byteLength(JSON.stringify(pairs), 'utf8');
    return pairs;
  });
  try {
    read();
    return counts;
  } finally {
    vi.restoreAllMocks();
  }
};

describe('Memory list decision reads', () => {
  it('keeps every ordered page relationship while reading shared decisions once', () => {
    const legacy = legacyRead();
    const batched = batchRead();
    expect(batched).toEqual(legacy);
    expect(batched.flat()).toHaveLength(180);
    const legacyTiming = measure(legacyRead);
    const batchTiming = measure(batchRead);
    const legacyReads = observe(legacyRead);
    const batchReads = observe(batchRead);
    expect(legacyReads).toMatchObject({ queries: 100, decodedRows: 180 });
    expect(batchReads).toMatchObject({ queries: 1, decodedRows: 130 });
    console.warn(
      JSON.stringify({
        benchmark: 'memory-list-decision-read-stage',
        identities: records.length,
        persistedDecisions: 1_580,
        pageRevisions: revisionIds.length,
        outputRelationships: batched.flat().length,
        outsideRelationships: 80,
        legacyReads,
        batchReads,
        legacyTiming,
        batchTiming,
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });
});
