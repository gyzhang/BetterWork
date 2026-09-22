import { describe, expect, it } from 'vitest';

import {
  auditRunDependencies,
  HISTORY_LIMITS,
  type LiveMemoryRevision,
  planSafeReplay,
  type PriorRunRecord,
  type SafetyContext,
} from './run-history-policy';

const NOW = 1_000_000;

const live = (over: Partial<LiveMemoryRevision> = {}): LiveMemoryRevision => ({
  memoryId: 'm-1',
  contentHash: 'h-1',
  status: 'confirmed',
  latestRevisionOfIdentity: 1,
  revision: 1,
  scopeKind: 'workspace',
  ...over,
});

const context = (over: Partial<SafetyContext> = {}): SafetyContext => ({
  now: NOW,
  liveMemoryRevisions: new Map([['rev-1', live()]]),
  excludedMemoryIds: new Set(),
  allowedMaterialKeys: new Set(['knowledge-revision:kr-1']),
  ...over,
});

const record = (over: Partial<PriorRunRecord> = {}): PriorRunRecord => ({
  runId: 'run-1',
  finalEventId: 'evt-1',
  prompt: '本期收入怎么算？',
  answer: '按回款金额统计。',
  promptHash: 'ph-1',
  directMemoryRevisions: [{ memoryId: 'm-1', revisionId: 'rev-1', contentHash: 'h-1' }],
  inheritedMemoryRevisions: [],
  materialKeys: ['knowledge-revision:kr-1'],
  inheritedMaterialKeys: [],
  dependencyFactsComplete: true,
  ...over,
});

describe('auditRunDependencies', () => {
  it('accepts a turn whose exact dependencies still hold', () => {
    expect(auditRunDependencies(record(), context())).toBeUndefined();
  });

  it('treats a deleted or superseded memory revision as unsafe', () => {
    expect(
      auditRunDependencies(
        record(),
        context({ liveMemoryRevisions: new Map([['rev-1', live({ status: 'deleted' })]]) }),
      ),
    ).toBe('memory-inactive');
    expect(
      auditRunDependencies(
        record(),
        context({ liveMemoryRevisions: new Map([['rev-1', live({ status: 'superseded' })]]) }),
      ),
    ).toBe('memory-inactive');
  });

  it('treats a missing revision as a rewrite, not as an unknown', () => {
    expect(auditRunDependencies(record(), context({ liveMemoryRevisions: new Map() }))).toBe(
      'memory-revised',
    );
  });

  it('detects a content hash change on the same revision id', () => {
    expect(
      auditRunDependencies(
        record(),
        context({ liveMemoryRevisions: new Map([['rev-1', live({ contentHash: 'other' })]]) }),
      ),
    ).toBe('memory-revised');
  });

  it('detects a newer revision of the same identity', () => {
    expect(
      auditRunDependencies(
        record(),
        context({
          liveMemoryRevisions: new Map([['rev-1', live({ latestRevisionOfIdentity: 4 })]]),
        }),
      ),
    ).toBe('memory-revised');
  });

  it('treats a later scope narrowing as a rewrite of the same identity', () => {
    expect(
      auditRunDependencies(
        record(),
        context({
          liveMemoryRevisions: new Map([
            ['rev-1', live({ scopeKind: 'workspace', recordedScopeKind: 'expert-workspace' })],
          ]),
        }),
      ),
    ).toBe('memory-revised');
  });

  it('honours the current task exclusion list', () => {
    expect(auditRunDependencies(record(), context({ excludedMemoryIds: new Set(['m-1']) }))).toBe(
      'memory-excluded',
    );
  });

  it('rejects material replacement but not material addition', () => {
    expect(auditRunDependencies(record(), context({ allowedMaterialKeys: new Set() }))).toBe(
      'material-removed-or-replaced',
    );
    expect(
      auditRunDependencies(
        record(),
        context({
          allowedMaterialKeys: new Set(['knowledge-revision:kr-1', 'knowledge-revision:kr-2']),
        }),
      ),
    ).toBeUndefined();
  });

  it('checks inherited dependencies too, not only the direct ones', () => {
    expect(
      auditRunDependencies(
        record({
          inheritedMemoryRevisions: [{ memoryId: 'm-9', revisionId: 'rev-9', contentHash: 'h-9' }],
        }),
        context(),
      ),
    ).toBe('memory-revised');
  });

  it('refuses to infer safety when legacy dependency facts are missing', () => {
    expect(auditRunDependencies(record({ dependencyFactsComplete: false }), context())).toBe(
      'legacy-provenance-unknown',
    );
    expect(auditRunDependencies(record({ finalEventId: undefined }), context())).toBe(
      'legacy-provenance-unknown',
    );
  });

  it('reports an unavailable source that the turn actually read', () => {
    expect(
      auditRunDependencies(
        record(),
        context({ unavailableSourceKeys: new Set(['knowledge-revision:kr-1']) }),
      ),
    ).toBe('source-unavailable');
  });
});

describe('planSafeReplay', () => {
  const older = record({ runId: 'run-old', finalEventId: 'evt-old', promptHash: 'ph-old' });
  const middle = record({ runId: 'run-mid', finalEventId: 'evt-mid', promptHash: 'ph-mid' });
  const newest = record({ runId: 'run-new', finalEventId: 'evt-new', promptHash: 'ph-new' });

  it('takes the contiguous safe suffix and stops at the first unsafe turn', () => {
    const plan = planSafeReplay([older, middle, newest], context());
    expect(plan.turns.map((turn) => turn.runId)).toEqual(['run-old', 'run-mid', 'run-new']);
    expect(plan.stoppedEarly).toBe(false);

    const broken = planSafeReplay(
      [older, record({ runId: 'run-mid', finalEventId: undefined }), newest],
      context(),
    );
    expect(broken.turns.map((turn) => turn.runId)).toEqual(['run-new']);
    expect(broken.skippedReason).toBe('legacy-provenance-unknown');
    expect(broken.stoppedEarly).toBe(true);
  });

  it('never stitches older turns across an unsafe gap', () => {
    const plan = planSafeReplay(
      [
        record({ runId: 'run-1', finalEventId: 'e1' }),
        record({ runId: 'run-2', finalEventId: undefined }),
        record({ runId: 'run-3', finalEventId: 'e3' }),
      ],
      context(),
    );
    expect(plan.turns.map((turn) => turn.runId)).toEqual(['run-3']);
  });

  it('caps at eight complete pairs', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      record({ runId: `run-${index}`, finalEventId: `evt-${index}` }),
    );
    const plan = planSafeReplay(many, context());
    expect(plan.turns).toHaveLength(HISTORY_LIMITS.maxPairs);
    expect(plan.turns[0]?.runId).toBe('run-4');
    expect(plan.skippedReason).toBe('history-budget');
  });

  it('stops instead of truncating a pair to fit the code point budget', () => {
    const heavy = '经'.repeat(5_000);
    const plan = planSafeReplay(
      [
        record({ runId: 'a', finalEventId: 'ea', answer: heavy }),
        record({ runId: 'b', finalEventId: 'eb', answer: heavy }),
        record({ runId: 'c', finalEventId: 'ec', answer: heavy }),
      ],
      context(),
    );
    expect(plan.turns.map((turn) => turn.runId)).toEqual(['b', 'c']);
    expect(plan.skippedReason).toBe('history-budget');
    expect(plan.stoppedEarly).toBe(true);
  });

  it('records the exact identity of every replayed turn', () => {
    const plan = planSafeReplay([newest], context());
    expect(plan.turns[0]).toMatchObject({
      runId: 'run-new',
      finalEventId: 'evt-new',
      promptHash: 'ph-new',
    });
    expect(plan.turns[0]?.memoryRevisions).toHaveLength(1);
  });

  it('does not invalidate history because a memory simply missed this round', () => {
    const plan = planSafeReplay(
      [newest],
      context({ liveMemoryRevisions: new Map([['rev-1', live()]]) }),
    );
    expect(plan.turns).toHaveLength(1);
  });
});
