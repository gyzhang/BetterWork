import type { MemoryConflictPair } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { seedGovernanceMemory } from './fixtures/memory-governance-fixtures';
import { indexMemoryConflictPairs, unresolvedConflictPairs } from './memory-conflict-policy';

let store: AppStore;
let revisionIds: string[];
let pairs: MemoryConflictPair[];

beforeAll(() => {
  store = AppStore.open(':memory:');
  store.transaction(() => {
    for (let index = 0; index < 3_000; index += 1)
      seedGovernanceMemory(store.memories, `rule-${index}`, {
        topicKey: `topic-${index % 500}`,
        createdAt: 1_000 + index,
      });
  });
  revisionIds = store.memories
    .listPage({ includeCandidates: true, limit: 100 })
    .items.map((record) => record.revisionId);
  pairs = unresolvedConflictPairs(store.memories.listGovernanceEntries(), () => false);
}, 60_000);

afterAll(() => store?.close());

const legacyAssociate = (input: readonly MemoryConflictPair[]): readonly MemoryConflictPair[][] =>
  revisionIds.map((id) =>
    input.filter((pair) => pair.leftRevisionId === id || pair.rightRevisionId === id),
  );

const indexedAssociate = (
  input: readonly MemoryConflictPair[],
): readonly (readonly MemoryConflictPair[])[] => {
  const indexed = indexMemoryConflictPairs(revisionIds, [input]);
  return revisionIds.map((id) => indexed.get(id) ?? []);
};

const measure = (associate: () => unknown) => {
  associate();
  const samples = Array.from({ length: 9 }, () => {
    const startedAt = performance.now();
    associate();
    return performance.now() - startedAt;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const observe = (associate: (input: readonly MemoryConflictPair[]) => unknown): number => {
  let revisionReads = 0;
  associate(
    pairs.map((pair) => ({
      ...pair,
      get leftRevisionId() {
        revisionReads += 1;
        return pair.leftRevisionId;
      },
      get rightRevisionId() {
        revisionReads += 1;
        return pair.rightRevisionId;
      },
    })),
  );
  return revisionReads;
};

describe('Memory conflict associations', () => {
  it('retains every ordered off-page relationship while scanning the complete collection once', () => {
    const legacy = legacyAssociate(pairs);
    const indexed = indexedAssociate(pairs);
    expect(indexed).toEqual(legacy);
    expect(pairs).toHaveLength(7_500);
    expect(indexed.flat()).toHaveLength(500);
    const page = new Set(revisionIds);
    expect(
      indexed
        .flat()
        .every((pair) => !page.has(pair.leftRevisionId) || !page.has(pair.rightRevisionId)),
    ).toBe(true);
    const legacyRevisionReads = observe(legacyAssociate);
    const indexedRevisionReads = observe(indexedAssociate);
    expect(legacyRevisionReads).toBeGreaterThan(100 * pairs.length);
    expect(indexedRevisionReads).toBe(2 * pairs.length);
    console.warn(
      JSON.stringify({
        benchmark: 'memory-conflict-association-stage',
        identities: 3_000,
        topics: 500,
        unresolvedPairs: pairs.length,
        pageRevisions: revisionIds.length,
        outputRelationships: indexed.flat().length,
        legacyRevisionReads,
        indexedRevisionReads,
        legacyTiming: measure(() => legacyAssociate(pairs)),
        indexedTiming: measure(() => indexedAssociate(pairs)),
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });
});
