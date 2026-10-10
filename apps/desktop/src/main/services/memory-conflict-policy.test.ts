import type { MemoryRecord, MemoryScope } from '@betterwork/agent-protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  conflictRecord as record,
  legacyConflictPairs,
  mixedConflictRecords,
} from './fixtures/memory-conflict-fixtures';
import { governanceEntryOf } from './fixtures/memory-governance-fixtures';
import {
  conflictPairKey,
  createConfirmedMemoryLookup,
  duplicateConfirmedMemoryId,
  listPotentialConflictPairs,
  scopesIntersect,
  scopesMatchExactly,
  unresolvedConflictPairs,
  validityIntersects,
} from './memory-conflict-policy';

const workspaceScope: MemoryScope = { kind: 'workspace', workspaceId: 'ws-1' };
const otherWorkspaceScope: MemoryScope = { kind: 'workspace', workspaceId: 'ws-2' };
const userScope: MemoryScope = { kind: 'user' };
const expertScope: MemoryScope = { kind: 'expert', expertId: 'ex-1' };
const expertWorkspaceScope: MemoryScope = {
  kind: 'expert-workspace',
  expertId: 'ex-1',
  workspaceId: 'ws-1',
};
const otherExpertScope: MemoryScope = { kind: 'expert', expertId: 'ex-2' };

const pair = (
  left: Partial<MemoryRecord> & { id: string; content: string },
  right: Partial<MemoryRecord> & { id: string; content: string },
): MemoryRecord[] => [record(left), record(right)];

describe('scope rules', () => {
  it('treats scopes as intersecting unless they name a different expert or workspace', () => {
    expect(scopesIntersect(userScope, workspaceScope)).toBe(true);
    expect(scopesIntersect(workspaceScope, expertWorkspaceScope)).toBe(true);
    expect(scopesIntersect(expertScope, workspaceScope)).toBe(true);
    expect(scopesIntersect(expertScope, expertWorkspaceScope)).toBe(true);
    expect(scopesIntersect(workspaceScope, otherWorkspaceScope)).toBe(false);
    expect(scopesIntersect(expertScope, otherExpertScope)).toBe(false);
    expect(
      scopesIntersect(expertWorkspaceScope, {
        kind: 'expert-workspace',
        expertId: 'ex-1',
        workspaceId: 'ws-2',
      }),
    ).toBe(false);
  });

  it('keeps dedupe narrower than conflict: only the identical canonical scope matches', () => {
    expect(scopesMatchExactly(workspaceScope, workspaceScope)).toBe(true);
    expect(scopesMatchExactly(workspaceScope, expertWorkspaceScope)).toBe(false);
    expect(scopesMatchExactly(userScope, userScope)).toBe(true);
    expect(scopesMatchExactly(userScope, workspaceScope)).toBe(false);
  });
});

describe('potential conflict identification（契约 §5.5）', () => {
  it('requires a shared non-empty topicKey, differing content and overlapping validity', () => {
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径' },
          { id: 'b', content: '收入按开票确认', topicKey: '收入口径' },
        ),
      ),
    ).toHaveLength(1);
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径' },
          { id: 'b', content: '收入按回款确认', topicKey: '收入口径' },
        ),
      ),
    ).toEqual([]);
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径' },
          { id: 'b', content: '成本按付款确认', topicKey: '成本口径' },
        ),
      ),
    ).toEqual([]);
    expect(
      listPotentialConflictPairs(
        pair({ id: 'a', content: '收入按回款确认' }, { id: 'b', content: '收入按开票确认' }),
      ),
    ).toEqual([]);
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径' },
          { id: 'b', content: '收入按开票确认', topicKey: '收入口径', validFrom: 9_000 },
        ),
      ),
    ).toHaveLength(1);
    // 先后生效的口径是替代关系：有效期不相交就不算冲突。
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径', validUntil: 5_000 },
          { id: 'b', content: '收入按开票确认', topicKey: '收入口径', validFrom: 9_000 },
        ),
      ),
    ).toEqual([]);
  });

  it('pairs across intersecting scopes but never across disjoint workspaces or experts', () => {
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径', scope: userScope },
          { id: 'b', content: '收入按开票确认', topicKey: '收入口径', scope: workspaceScope },
        ),
      ),
    ).toHaveLength(1);
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径', scope: workspaceScope },
          {
            id: 'b',
            content: '收入按开票确认',
            topicKey: '收入口径',
            scope: otherWorkspaceScope,
          },
        ),
      ),
    ).toEqual([]);
    expect(
      listPotentialConflictPairs(
        pair(
          { id: 'a', content: '收入按回款确认', topicKey: '收入口径', scope: expertScope },
          { id: 'b', content: '收入按开票确认', topicKey: '收入口径', scope: otherExpertScope },
        ),
      ),
    ).toEqual([]);
  });

  it('lists each pair once and keeps a stable pair key', () => {
    const records = [
      record({ id: 'a', content: '收入按回款确认', topicKey: '收入口径' }),
      record({ id: 'b', content: '收入按开票确认', topicKey: '收入口径' }),
      record({ id: 'c', content: '收入按签约额确认', topicKey: '收入口径' }),
    ];
    const pairs = listPotentialConflictPairs(records);
    expect(pairs.map(({ left, right }) => `${left.id}-${right.id}`)).toEqual(['a-b', 'a-c', 'b-c']);
    expect(conflictPairKey('rev-b', 'rev-a')).toBe(conflictPairKey('rev-a', 'rev-b'));
  });

  it('reports validity overlap against open-ended windows', () => {
    const open = record({ id: 'a', content: '甲' });
    const past = record({ id: 'b', content: '乙', validFrom: 0, validUntil: 1_500 });
    const future = record({ id: 'c', content: '丙', validFrom: 5_000 });
    expect(validityIntersects(open, past)).toBe(true);
    expect(validityIntersects(open, future)).toBe(true);
    expect(validityIntersects(past, future)).toBe(false);
  });
});

describe('pending counts（契约 §10 管理提示）', () => {
  it('drops pairs the user already decided on the exact revisions', () => {
    const records = pair(
      { id: 'a', content: '收入按回款确认', topicKey: '收入口径' },
      { id: 'b', content: '收入按开票确认', topicKey: '收入口径' },
    );
    expect(unresolvedConflictPairs(records, () => false)).toEqual([
      {
        leftRevisionId: 'rev-a',
        rightRevisionId: 'rev-b',
        state: 'unresolved',
      },
    ]);
    expect(
      unresolvedConflictPairs(records, (left, right) => left === 'rev-a' && right === 'rev-b'),
    ).toEqual([]);
    // 同一对不论记录列表顺序都必须是同一个方向：按精确修订标识升序。
    expect(unresolvedConflictPairs([...records].reverse(), () => false)).toEqual([
      { leftRevisionId: 'rev-a', rightRevisionId: 'rev-b', state: 'unresolved' },
    ]);
  });

  it('marks a candidate that repeats a confirmed memory in the same canonical scope', () => {
    const confirmed = record({ id: 'c1', content: '报告用中文写' });
    const candidate = record({
      id: 'c2',
      content: '报告用中文写',
      status: 'candidate',
      scope: workspaceScope,
    });
    const rejected = record({
      id: 'c3',
      content: '报告用中文写',
      status: 'candidate',
      candidateDisposition: 'rejected',
    });
    const expertCopy = record({
      id: 'c4',
      content: '报告用中文写',
      status: 'candidate',
      scope: expertWorkspaceScope,
    });
    const records = [confirmed, candidate, rejected, expertCopy];
    expect(duplicateConfirmedMemoryId(candidate, records)).toBe('c1');
    expect(duplicateConfirmedMemoryId(rejected, records)).toBeUndefined();
    expect(duplicateConfirmedMemoryId(expertCopy, records)).toBeUndefined();
    expect(duplicateConfirmedMemoryId(confirmed, records)).toBeUndefined();
  });
});

describe('governance metadata policies', () => {
  it('uses minimal projections with identical conflict order and preserved input references', () => {
    const records = mixedConflictRecords();
    const entries = records.map(governanceEntryOf);
    const pairs = listPotentialConflictPairs(entries);
    expect(pairs.map(({ left, right }) => [left.revisionId, right.revisionId])).toEqual(
      listPotentialConflictPairs(records).map(({ left, right }) => [
        left.revisionId,
        right.revisionId,
      ]),
    );
    expect(unresolvedConflictPairs(entries, () => false)).toEqual(
      unresolvedConflictPairs(records, () => false),
    );
    for (const { left, right } of pairs) {
      expect(entries).toContain(left);
      expect(entries).toContain(right);
    }
  });

  it('matches the original first-confirmed lookup across scopes, statuses and permutations', () => {
    const records = [
      record({ id: 'confirmed-old', content: 'shared', scope: workspaceScope }),
      record({ id: 'confirmed-new', content: 'shared', scope: workspaceScope, validUntil: 1 }),
      record({ id: 'global', content: 'shared', scope: userScope }),
      record({ id: 'expert', content: 'shared', scope: expertWorkspaceScope }),
      record({ id: 'expired', content: 'shared', scope: workspaceScope, status: 'expired' }),
      record({ id: 'pending', content: 'shared', scope: workspaceScope, status: 'candidate' }),
      record({
        id: 'rejected',
        content: 'shared',
        scope: workspaceScope,
        status: 'candidate',
        candidateDisposition: 'rejected',
      }),
      record({ id: 'missing', content: 'absent', status: 'candidate' }),
    ];
    for (const input of [
      records,
      [...records].reverse(),
      records.slice(2).concat(records.slice(0, 2)),
    ]) {
      const lookup = createConfirmedMemoryLookup(input.map(governanceEntryOf));
      for (const candidate of records)
        expect(lookup(governanceEntryOf(candidate))).toBe(
          duplicateConfirmedMemoryId(candidate, input),
        );
      const self = record({
        id: input[0]!.id,
        content: input[0]!.content,
        scope: input[0]!.scope,
        status: 'candidate',
      });
      expect(lookup(self)).toBe(duplicateConfirmedMemoryId(self, input));
    }
  });

  it('does not revisit unrelated confirmed hashes for each candidate lookup', () => {
    let reads = 0;
    const unrelated = Array.from({ length: 160 }, (_, index) => {
      const entry = governanceEntryOf(
        record({ id: `unrelated-${index}`, content: `other ${index}` }),
      );
      const hash = entry.normalizedHash;
      Object.defineProperty(entry, 'normalizedHash', {
        get: () => {
          reads += 1;
          return hash;
        },
      });
      return entry;
    });
    const target = record({ id: 'target', content: 'shared' });
    const candidate = record({ id: 'pending', content: 'shared', status: 'candidate' });
    const lookup = createConfirmedMemoryLookup([...unrelated, governanceEntryOf(target)]);
    reads = 0;
    expect(lookup(candidate)).toBe(target.id);
    expect(lookup(candidate)).toBe(target.id);
    expect(reads).toBe(0);
  });
});

describe('topic-grouped conflict enumeration', () => {
  it('preserves interleaved pair direction, result order and exact decision callback order', () => {
    const records = ['z', 'x', 'y', 'w', 'v', 'u'].map((id, index) =>
      record({ id, content: id, topicKey: index % 2 === 0 ? 'income' : 'cost' }),
    );
    const pairs = listPotentialConflictPairs(records);
    expect(pairs.map(({ left, right }) => `${left.id}-${right.id}`)).toEqual([
      'z-y',
      'z-v',
      'x-w',
      'x-u',
      'y-v',
      'w-u',
    ]);
    const decided = vi.fn((left: string, right: string) => left === 'rev-y' && right === 'rev-v');
    const unresolved = unresolvedConflictPairs(records, decided);
    expect(decided.mock.calls).toEqual(
      pairs.map(({ left, right }) => [left.revisionId, right.revisionId]),
    );
    expect(unresolved).toEqual([
      { leftRevisionId: 'rev-y', rightRevisionId: 'rev-z', state: 'unresolved' },
      { leftRevisionId: 'rev-v', rightRevisionId: 'rev-z', state: 'unresolved' },
      { leftRevisionId: 'rev-w', rightRevisionId: 'rev-x', state: 'unresolved' },
      { leftRevisionId: 'rev-u', rightRevisionId: 'rev-x', state: 'unresolved' },
      { leftRevisionId: 'rev-u', rightRevisionId: 'rev-w', state: 'unresolved' },
    ]);
  });

  it('matches legacy enumeration across permutations, scopes, windows, hashes and repeated identities', () => {
    const records = mixedConflictRecords();
    records.push(records[0]!, records[0]!);
    const permutations = [
      records,
      [...records].reverse(),
      ...Array.from({ length: 7 }, (_, offset) =>
        records.slice(offset + 1).concat(records.slice(0, offset + 1)),
      ),
    ];
    for (const input of permutations) {
      Object.freeze(input);
      for (const item of input) Object.freeze(item);
      const expected = legacyConflictPairs(input);
      const actual = listPotentialConflictPairs(input);
      expect(actual).toEqual(expected);
      for (const [index, pair] of actual.entries()) {
        expect(pair.left).toBe(expected[index]!.left);
        expect(pair.right).toBe(expected[index]!.right);
      }
    }
  });

  it('keeps raw topic equality without trimming, case folding, Unicode normalization or special keys', () => {
    const topics = ['income', 'Income', ' income', 'é', 'e\u0301', '__proto__', 'constructor', ''];
    const records = topics.flatMap((topicKey, index) => [
      record({ id: `a-${index}`, content: 'a', topicKey }),
      record({ id: `b-${index}`, content: 'b', topicKey }),
    ]);
    records.push(
      record({ id: 'no-topic-a', content: 'a' }),
      record({ id: 'no-topic-b', content: 'b' }),
    );
    expect(listPotentialConflictPairs(records)).toEqual(legacyConflictPairs(records));
    expect(listPotentialConflictPairs(records)).toHaveLength(topics.length);
  });

  it('probes only same-topic pairs and leaves missing-topic records out of the candidate scan', () => {
    let idReads = 0;
    let missingTopicReads = 0;
    const records = Array.from({ length: 400 }, (_, index) => {
      const entry = record({
        id: `memory-${index}`,
        content: `${index}`,
        topicKey: `topic-${index % 80}`,
      });
      Object.defineProperty(entry, 'id', {
        get: () => {
          idReads += 1;
          return `memory-${index}`;
        },
      });
      return entry;
    });
    const missingTopic = record({ id: 'missing-topic', content: 'content' });
    Object.defineProperty(missingTopic, 'id', {
      get: () => {
        missingTopicReads += 1;
        return 'missing-topic';
      },
    });
    records.push(missingTopic);
    expect(listPotentialConflictPairs(records)).toHaveLength(80 * 10);
    expect(idReads).toBe(2 * 80 * 10);
    expect(missingTopicReads).toBe(0);
  });

  it('keeps the complete dense-topic result and handles empty or sparse input', () => {
    const records = Array.from({ length: 130 }, (_, index) =>
      record({
        id: `dense-${index}`,
        content: `${index}`,
        topicKey: 'income',
      }),
    );
    expect(listPotentialConflictPairs(records)).toEqual(legacyConflictPairs(records));
    expect(listPotentialConflictPairs(records)).toHaveLength((130 * 129) / 2);
    const sparse: MemoryRecord[] = new Array<MemoryRecord>(4);
    sparse[0] = records[0]!;
    sparse[3] = records[1]!;
    expect(listPotentialConflictPairs(sparse)).toEqual(legacyConflictPairs(sparse));
    expect(listPotentialConflictPairs([])).toEqual([]);
  });
});
