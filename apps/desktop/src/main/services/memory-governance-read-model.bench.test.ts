import { randomUUID } from 'node:crypto';

import type { MemoryRecord } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import {
  governanceEntryOf,
  recordGovernanceDecision,
  seedGovernanceMemory,
} from './fixtures/memory-governance-fixtures';
import {
  conflictPairKey,
  createConfirmedMemoryLookup,
  duplicateConfirmedMemoryId,
  unresolvedConflictPairs,
} from './memory-conflict-policy';
import { buildUserInstructionProvenance } from './memory-provenance';

let store: AppStore;
let candidates: MemoryRecord[];

beforeAll(() => {
  store = AppStore.open(':memory:');
  candidates = [];
  store.transaction(() => {
    for (let topic = 0; topic < 500; topic += 1) {
      const records = Array.from({ length: 6 }, (_, position) => {
        const variant = position >= 4 ? position - 3 : position;
        const content = `${topic}/${variant}: ${'\u53E3'.repeat(480)}`;
        const record = seedGovernanceMemory(store.memories, content, {
          status: position >= 4 ? 'candidate' : 'confirmed',
          topicKey: `topic-${topic}`,
          createdAt: 1_000 + topic * 6 + position,
          provenance: buildUserInstructionProvenance({
            capturedAt: 1_000,
            operationId: randomUUID(),
            content,
            genericDeclaration: true,
          }),
        });
        if (position >= 4 && candidates.length < 100) candidates.push(record);
        return record;
      });
      if (topic % 2 === 0)
        recordGovernanceDecision(store, records[0]!, records[1]!, 'separate applicability');
    }
  });
}, 60_000);

afterAll(() => store?.close());

const measure = (read: () => unknown): { medianMs: number; p95Ms: number } => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const startedAt = performance.now();
    read();
    return performance.now() - startedAt;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const legacyRead = () => {
  const current = store.memories.list({
    includeCandidates: true,
    statuses: ['candidate', 'confirmed', 'expired'],
  });
  return {
    current,
    unresolved: unresolvedConflictPairs(
      current,
      (left, right) => store.memoryOperations.findDecisionForPair(left, right) !== undefined,
    ),
    duplicates: candidates.map((candidate) => duplicateConfirmedMemoryId(candidate, current)),
  };
};

const projectedRead = () => {
  const current = store.memories.listGovernanceEntries();
  const decisions = new Set(
    store.memoryOperations
      .listCurrentDecisionPairs()
      .map((pair) => conflictPairKey(pair.leftRevisionId, pair.rightRevisionId)),
  );
  const lookup = createConfirmedMemoryLookup(current);
  return {
    current,
    unresolved: unresolvedConflictPairs(current, (left, right) =>
      decisions.has(conflictPairKey(left, right)),
    ),
    duplicates: candidates.map(lookup),
  };
};

const observeReads = (read: () => unknown) => {
  const full = store.memories.list.bind(store.memories);
  const projected = store.memories.listGovernanceEntries.bind(store.memories);
  const point = vi.spyOn(store.memoryOperations, 'findDecisionForPair');
  const batch = vi.spyOn(store.memoryOperations, 'listCurrentDecisionPairs');
  const counts = { completeRows: 0, projectedRows: 0 };
  vi.spyOn(store.memories, 'list').mockImplementation((input) => {
    const rows = full(input);
    counts.completeRows += rows.length;
    return rows;
  });
  vi.spyOn(store.memories, 'listGovernanceEntries').mockImplementation(() => {
    const rows = projected();
    counts.projectedRows += rows.length;
    return rows;
  });
  try {
    read();
    return {
      ...counts,
      pointDecisionReads: point.mock.calls.length,
      batchDecisionReads: batch.mock.calls.length,
    };
  } finally {
    vi.restoreAllMocks();
  }
};

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('Memory governance read model scale', () => {
  it('keeps every hint while projecting body-free metadata and reading decision pairs once', () => {
    const legacy = legacyRead();
    const projected = projectedRead();
    expect(projected.current).toEqual(legacy.current.map(governanceEntryOf));
    expect(projected.unresolved).toEqual(legacy.unresolved);
    expect(projected.duplicates).toEqual(legacy.duplicates);
    expect(projected.current).toHaveLength(3_000);
    expect(projected.unresolved).toHaveLength(6_250);
    const legacyTiming = measure(legacyRead);
    const projectedTiming = measure(projectedRead);
    const legacyReads = observeReads(legacyRead);
    const projectedReads = observeReads(projectedRead);
    expect(legacyReads).toEqual({
      completeRows: 3_000,
      projectedRows: 0,
      pointDecisionReads: 6_500,
      batchDecisionReads: 0,
    });
    expect(projectedReads).toEqual({
      completeRows: 0,
      projectedRows: 3_000,
      pointDecisionReads: 0,
      batchDecisionReads: 1,
    });
    expect(bytes(projected.current)).toBeLessThan(bytes(legacy.current) / 5);
    console.warn(
      JSON.stringify({
        benchmark: 'memory-governance-read-model',
        latestIdentities: 3_000,
        topics: 500,
        candidateViews: candidates.length,
        unresolvedPairs: projected.unresolved.length,
        legacyReads,
        projectedReads,
        legacyPayloadBytes: bytes(legacy.current),
        projectedPayloadBytes: bytes(projected.current),
        legacyContentBytes: legacy.current.reduce(
          (total, record) => total + Buffer.byteLength(record.content, 'utf8'),
          0,
        ),
        legacyProvenanceBytes: legacy.current.reduce(
          (total, record) => total + bytes(record.provenance),
          0,
        ),
        projectedContentBytes: 0,
        projectedProvenanceBytes: 0,
        legacyTiming,
        projectedTiming,
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });
});
