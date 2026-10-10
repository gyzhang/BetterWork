import type { MemoryRecord } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { conflictRecord, legacyConflictPairs } from './fixtures/memory-conflict-fixtures';
import { listPotentialConflictPairs, type PotentialConflictPair } from './memory-conflict-policy';

type PairReader = (records: readonly MemoryRecord[]) => PotentialConflictPair[];

const measure = (read: () => unknown): { medianMs: number; p95Ms: number } => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    read();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const countPairProbes = (records: readonly MemoryRecord[], read: PairReader): number => {
  let idReads = 0;
  const probed = records.map((record) => ({
    ...record,
    get id() {
      idReads += 1;
      return record.id;
    },
  }));
  read(probed);
  return idReads / 2;
};

const pairIdentities = (pairs: readonly PotentialConflictPair[]): string[] =>
  pairs.map(({ left, right }) => `${left.revisionId}\u0000${right.revisionId}`);

describe('Memory conflict topic enumeration scale', () => {
  it.each([
    { scenario: 'distributed', recordCount: 5_000, topicCount: 1_000 },
    { scenario: 'concentrated', recordCount: 400, topicCount: 1 },
  ])(
    'compares complete results and probes for $scenario topics',
    ({ scenario, recordCount, topicCount }) => {
      const records = Array.from({ length: recordCount }, (_, index) =>
        conflictRecord({
          id: `memory-${index}`,
          content: `content-${index}`,
          topicKey: `topic-${index % topicCount}`,
        }),
      );
      const legacy = legacyConflictPairs(records);
      const grouped = listPotentialConflictPairs(records);
      expect(pairIdentities(grouped)).toEqual(pairIdentities(legacy));
      const legacyTiming = measure(() => legacyConflictPairs(records));
      const groupedTiming = measure(() => listPotentialConflictPairs(records));
      const legacyProbes = countPairProbes(records, legacyConflictPairs);
      const groupedProbes = countPairProbes(records, listPotentialConflictPairs);
      const perTopic = recordCount / topicCount;
      expect(legacyProbes).toBe((recordCount * (recordCount - 1)) / 2);
      expect(groupedProbes).toBe((topicCount * perTopic * (perTopic - 1)) / 2);
      expect(grouped).toHaveLength(groupedProbes);
      console.warn(
        JSON.stringify({
          benchmark: 'memory-conflict-topic-enumeration',
          scenario,
          recordCount,
          topicCount,
          legacyProbes,
          groupedProbes,
          resultPairs: grouped.length,
          legacyTiming,
          groupedTiming,
          machine: `${process.platform} ${process.arch} node ${process.version}`,
        }),
      );
    },
    15_000,
  );
});
