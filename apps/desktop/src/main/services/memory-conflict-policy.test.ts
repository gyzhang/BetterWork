import type { MemoryRecord, MemoryScope } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  conflictPairKey,
  duplicateConfirmedMemoryId,
  listPotentialConflictPairs,
  scopesIntersect,
  scopesMatchExactly,
  unresolvedConflictPairs,
  validityIntersects,
} from './memory-conflict-policy';
import { memoryContentHash, normalizedMemoryHash } from './memory-content-policy';
import { buildUserInstructionProvenance } from './memory-provenance';

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

/** 每条记录的 normalizedHash 随正文变化，因此「同文」在测试里就是同一句话。 */
const record = (over: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord => ({
  revisionId: `rev-${over.id}`,
  revision: 1,
  scope: workspaceScope,
  kind: 'semantic',
  sourceType: 'user-explicit',
  confidence: 0.9,
  status: 'confirmed',
  contentHash: memoryContentHash(over.content),
  createdAt: 1_000,
  updatedAt: 2_000,
  facet: 'fact',
  normalizedHash: normalizedMemoryHash(over.content),
  provenance: buildUserInstructionProvenance({
    capturedAt: 1_000,
    operationId: '00000000-0000-4000-8000-000000000000',
    content: over.content,
    genericDeclaration: false,
  }),
  ...over,
});

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
