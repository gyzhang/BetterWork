import { createHash, randomUUID } from 'node:crypto';

import {
  type MaterialReference,
  type MemoryDependency,
  type MemoryProvenance,
  memoryRecallPolicyV1,
  type MemoryScope,
  type MemorySelectedMemory,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore, RunMemoryPhaseError, type RunMemorySelectionInput } from './index';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const digestOf = (content: string): string =>
  sha256Hex(content.normalize('NFC').replace(/\r\n?/gu, '\n').trim());

const legacyProvenance = (): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'legacy-unverified',
  sourceType: 'user-explicit',
});

const userScope: MemoryScope = { kind: 'user' };

/** 顺序号是快照的一部分，所以故意按打乱后的顺序提交。 */
const selectedItem = (
  memoryId: string,
  revisionId: string,
  order: number,
  reason: MemorySelectedMemory['reason'] = 'task-relevant',
): MemorySelectedMemory => ({
  memoryId,
  revisionId,
  contentHash: digestOf(revisionId),
  order,
  score: 60,
  reason,
});

const knowledgeRef = (revisionId: string): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'doc-1',
  knowledgeRevisionId: revisionId,
  contentHash: sha256Hex(revisionId),
  sourcePath: 'docs/income-policy.md',
});

const memoryDep = (memoryId: string, revisionId: string): MemoryDependency => ({
  memoryId,
  revisionId,
  contentHash: sha256Hex(`dep:${revisionId}`),
});

const budget = {
  totalItems: 2,
  preferenceItems: 0,
  contentCodePoints: 120,
  wrapperCodePoints: 40,
  blockCodePoints: 160,
};

describe('RunMemoryContextRepository', () => {
  const stores: AppStore[] = [];

  const openStore = (): AppStore => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  const seedWorkspace = (store: AppStore, name: string): string =>
    store.workspaces.getOrCreate(`/tmp/run-memory/${name}`, name).id;

  const seedRun = (store: AppStore, label: string): string => {
    const task = store.tasks.create(seedWorkspace(store, label), label, '记录本次召回');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: 1_700_000_000_000,
    });
    return runId;
  };

  const seedMemory = (store: AppStore, content: string): string => {
    const record = store.memories.create({
      scope: userScope,
      content,
      facet: 'fact',
      normalizedHash: digestOf(content),
      provenance: legacyProvenance(),
      confidence: 0.9,
      status: 'confirmed',
    }).record;
    return record.revisionId;
  };

  const selectionOf = (
    runId: string,
    revisionIds: readonly string[],
    overrides: Partial<RunMemorySelectionInput> = {},
  ): RunMemorySelectionInput => ({
    runId,
    evaluatedAt: 1_700_000_001_000,
    queryHash: sha256Hex(`query:${runId}`),
    policySnapshot: memoryRecallPolicyV1,
    selectedItems: revisionIds.map((revisionId, index) =>
      selectedItem(`mem-${index}`, revisionId, index + 9),
    ),
    decisionSummary: {
      budget,
      exclusions: [{ reason: 'budget', count: 1, identities: [] }],
      queryTruncated: false,
      conflictReviewRequired: false,
    },
    authorizationHash: sha256Hex(`auth:${runId}`),
    selectedAt: 1_700_000_001_000,
    ...overrides,
  });

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('records one snapshot per run and renumbers the injection order from 1', () => {
    const store = openStore();
    const runId = seedRun(store, '快照运行');
    const first = seedMemory(store, '汇报材料先给结论。');
    const second = seedMemory(store, '表格不放脚注。');

    const context = store.runMemoryContexts.recordSelection(selectionOf(runId, [first, second]));
    expect(context.phase).toBe('selected');
    expect(context.recallVersion).toBe(memoryRecallPolicyV1.recallVersion);
    expect(context.requestHash).toBeUndefined();
    expect(context.requestPreparedAt).toBeUndefined();
    // 提交顺序只作参考，落库一律重排为 1..n，注入顺序才有唯一口径。
    expect(context.selectedItems.map((item) => item.order)).toEqual([1, 2]);
    expect(context.selectedItems.map((item) => item.revisionId)).toEqual([first, second]);
    expect(store.runMemoryContexts.phaseOf(runId)).toBe('selected');
    expect(store.runMemoryContexts.listSelectedRevisionIds(runId)).toEqual([first, second]);

    expect(() => store.runMemoryContexts.recordSelection(selectionOf(runId, [second]))).toThrow(
      RunMemoryPhaseError,
    );
    expect(store.runMemoryContexts.listSelectedRevisionIds(runId)).toEqual([first, second]);
  });

  it('reports legacy_unknown for runs without a snapshot instead of inventing one', () => {
    const store = openStore();
    const runId = seedRun(store, '旧运行');
    expect(store.runMemoryContexts.get(runId)).toBeUndefined();
    expect(store.runMemoryContexts.phaseOf(runId)).toBe('legacy_unknown');
    expect(store.runMemoryContexts.listSelectedItems(runId)).toEqual([]);
    expect(store.runMemoryContexts.listDependencyUnion(runId)).toEqual({
      materials: [],
      memories: [],
    });
    expect(store.runMemoryContexts.countReferencingRevision('any-revision')).toBe(0);
  });

  it('walks selected to request-prepared to dispatch-attempted with the real request hash', () => {
    const store = openStore();
    const runId = seedRun(store, '三阶段运行');
    store.runMemoryContexts.recordSelection(
      selectionOf(runId, [seedMemory(store, '默认使用中文回复。')]),
    );

    const prepared = store.runMemoryContexts.markRequestPrepared({
      runId,
      requestHash: sha256Hex('actual-model-request'),
      at: 1_700_000_002_000,
      modelSnapshot: { modelId: 'm-1', provider: 'openai-compatible' },
    });
    expect(prepared.phase).toBe('request-prepared');
    expect(prepared.requestHash).toBe(sha256Hex('actual-model-request'));
    expect(prepared.requestPreparedAt).toBe(1_700_000_002_000);
    expect(prepared.modelSnapshot).toEqual({ modelId: 'm-1', provider: 'openai-compatible' });
    expect(prepared.dispatchAttemptedAt).toBeUndefined();

    const dispatched = store.runMemoryContexts.markDispatchAttempted({
      runId,
      at: 1_700_000_003_000,
    });
    expect(dispatched.phase).toBe('dispatch-attempted');
    expect(dispatched.dispatchAttemptedAt).toBe(1_700_000_003_000);
    // 阶段推进不许改写已定的选择快照。
    expect(dispatched.selectedItems).toEqual(prepared.selectedItems);
    expect(store.runMemoryContexts.get(runId)?.requestHash).toBe(sha256Hex('actual-model-request'));
  });

  it('refuses to skip a phase, to repeat it, or to move time backwards', () => {
    const store = openStore();
    const runId = seedRun(store, '越序运行');
    const otherRunId = seedRun(store, '无快照运行');
    store.runMemoryContexts.recordSelection(
      selectionOf(runId, [seedMemory(store, '预算超支要先预警。')]),
    );

    expect(() => store.runMemoryContexts.markDispatchAttempted({ runId })).toThrow(
      /未准备完成的请求不得标记/u,
    );
    expect(store.runMemoryContexts.phaseOf(runId)).toBe('selected');

    expect(() =>
      store.runMemoryContexts.markRequestPrepared({
        runId: otherRunId,
        requestHash: sha256Hex('no-snapshot'),
      }),
    ).toThrow(/还没有记忆快照/u);

    expect(() =>
      store.runMemoryContexts.markRequestPrepared({
        runId,
        requestHash: sha256Hex('too-early'),
        at: 1_700_000_000_999,
      }),
    ).toThrow(/必须不早于前序阶段/u);

    store.runMemoryContexts.markRequestPrepared({
      runId,
      requestHash: sha256Hex('first-request'),
      at: 1_700_000_002_000,
    });
    expect(() =>
      store.runMemoryContexts.markRequestPrepared({
        runId,
        requestHash: sha256Hex('second-request'),
        at: 1_700_000_004_000,
      }),
    ).toThrow(/不能再次准备请求/u);
    expect(store.runMemoryContexts.get(runId)?.requestHash).toBe(sha256Hex('first-request'));

    expect(() =>
      store.runMemoryContexts.markDispatchAttempted({ runId, at: 1_700_000_001_500 }),
    ).toThrow(/必须不早于前序阶段/u);
    expect(store.runMemoryContexts.phaseOf(runId)).toBe('request-prepared');
  });

  it('keeps dependency unions as exact references', () => {
    const store = openStore();
    const runId = seedRun(store, '依赖运行');
    const memoryRevisionId = seedMemory(store, '成本口径以财务系统月结数为准。');
    const dependencyMemoryRevisionId = seedMemory(store, '月结在每月 3 日完成。');
    store.runMemoryContexts.recordSelection(
      selectionOf(runId, [memoryRevisionId], {
        replay: [
          {
            replayed: true,
            runId: 'run-earlier',
            finalEventId: 'evt-1',
            promptHash: sha256Hex('earlier-prompt'),
            contentCodePoints: 42,
          },
        ],
        materialDependencyUnion: [knowledgeRef('krev-1'), knowledgeRef('krev-2')],
        memoryDependencyUnion: [memoryDep('mem-base', dependencyMemoryRevisionId)],
      }),
    );

    const union = store.runMemoryContexts.listDependencyUnion(runId);
    expect(union.materials).toEqual([knowledgeRef('krev-1'), knowledgeRef('krev-2')]);
    expect(union.memories).toEqual([memoryDep('mem-base', dependencyMemoryRevisionId)]);
    const context = store.runMemoryContexts.get(runId);
    expect(context?.replay).toHaveLength(1);
    // 传递依赖也存精确修订，重放判定不必回头猜正文。
    expect(context?.memoryDependencyUnion[0]?.revisionId).toBe(dependencyMemoryRevisionId);
  });

  it('lists the runs that pinned an exact revision, oldest snapshot first', () => {
    const store = openStore();
    const revisionId = seedMemory(store, '验收以演示环境为准。');
    const otherRevision = seedMemory(store, '验收以生产环境为准。');
    const later = seedRun(store, '后发起的运行');
    const earlier = seedRun(store, '先发起的运行');
    const unrelated = seedRun(store, '无关运行');

    store.runMemoryContexts.recordSelection(
      selectionOf(later, [revisionId], { selectedAt: 1_700_000_005_000 }),
    );
    store.runMemoryContexts.recordSelection(
      selectionOf(earlier, [revisionId, otherRevision], { selectedAt: 1_700_000_004_000 }),
    );
    store.runMemoryContexts.recordSelection(
      selectionOf(unrelated, [otherRevision], { selectedAt: 1_700_000_006_000 }),
    );

    expect(store.runMemoryContexts.listRunIdsReferencingRevision(revisionId)).toEqual([
      earlier,
      later,
    ]);
    expect(store.runMemoryContexts.listRunIdsReferencingRevision(revisionId, 1)).toEqual([earlier]);
    expect(store.runMemoryContexts.countReferencingRevision(revisionId)).toBe(2);
    expect(store.runMemoryContexts.countReferencingRevision(otherRevision)).toBe(2);
    expect(store.runMemoryContexts.listRunIdsReferencingRevision('ghost-revision')).toEqual([]);
  });
});
