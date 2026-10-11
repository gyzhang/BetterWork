import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  MaterialReference,
  MemoryProvenance,
  MemoryQueryContext,
  MemoryRecord,
  MemoryScope,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { materialListIdentity, memoryRecallPolicyV1 } from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { legacyReplayDependencies, seedReplayRun } from './fixtures/history-memory-fixtures';
import { seedGovernanceMemory } from './fixtures/memory-governance-fixtures';
import { normalizedMemoryHash } from './memory-content-policy';
import { buildDerivedProvenance, manualMemorySource } from './memory-provenance';
import {
  planRunHistoryReplay,
  prepareRunMemoryDecision,
  recallMemoriesForQuery,
} from './memory-recall-service';
import { MemoryService } from './memory-service';

/**
 * 召回期的记忆依赖闭包与冲突组装配（契约 §5.3、§6.1 过滤顺序，WM04）。
 *
 * 记忆依赖按**精确修订＋哈希**检查并沿链递归展开，因此两处容易走样的地方必须钉住：
 * - 传递失效：链路末端被删除后，直接依赖它的记录和更上游的记录都要落 `dependency-unavailable`，
 *   不能只看一层依赖就把已经站不住的结论注入进 Run；
 * - 环必须终止：库里出现相互依赖时按不可用处理，而不是无限递归。
 *   正常写入路径产不出环（新修订只能引用已存在的修订），所以这里用同目录的 SQLite 文件
 *   改写 `provenance_json` 造出对抗状态，不为此在生产代码开后门。
 *
 * - 来源证明消失：人工来源操作被移除后，修订虽然残留，也必须落 `source-unavailable`，
 *   且账本只带身份不带正文（契约 §6.1、§8.2）。
 *
 * 冲突组装配同样按 §6.1 的过滤顺序钉住：同议题、有效期重叠且没有裁决的两条口径都不注入并
 * 置 `conflictReviewRequired`；「两条都保留」之后两条必须作为一组回来，并带上适用条件说明。
 */

const CAPTURED_AT = 1_700_000_000_000;
const CONTENT_HASH = 'a'.repeat(64);

const knowledgeReference = (revisionId: string): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'schedule-document',
  knowledgeRevisionId: revisionId,
  contentHash: CONTENT_HASH,
  sourcePath: `资料/${revisionId}.md`,
});

const materialSelection = (reference: MaterialReference): TaskMaterialSelection => ({
  reference,
  purpose: 'background',
  addedFrom: 'user-input',
});

/** 记忆依赖只带精确修订与哈希；生产写入层按同一形状构造。 */
interface MemoryDependency {
  memoryId: string;
  revisionId: string;
  contentHash: string;
}

interface Seeded {
  readonly record: MemoryRecord;
  readonly operationId: string;
}

const queryFor = (workspaceId: string): MemoryQueryContext => ({
  workspaceId,
  taskId: 'task-1',
  taskContextRevisionId: 'tcr-1',
  evaluatedAt: CAPTURED_AT,
  prompt: '请按收入按回款金额统计的口径出月报。',
  taskTitle: '经营分析月报',
  materialTitles: [],
  excludedMemoryIds: [],
});

/** 把某条修订的记忆依赖换成给定内容：只用于制造生产路径到不了的对抗状态。 */
const forgeDependencies = (
  databasePath: string,
  revisionId: string,
  dependencies: readonly MemoryDependency[],
): void => {
  const db = new Database(databasePath);
  try {
    const row = db
      .prepare('SELECT provenance_json FROM memory_records WHERE revision_id = ?')
      .get(revisionId) as { provenance_json: string } | undefined;
    if (!row) throw new Error(`缺少修订 ${revisionId}`);
    const provenance = JSON.parse(row.provenance_json) as MemoryProvenance;
    db.prepare('UPDATE memory_records SET provenance_json = ? WHERE revision_id = ?').run(
      JSON.stringify({ ...provenance, memoryDependencies: [...dependencies] }),
      revisionId,
    );
  } finally {
    db.close();
  }
};

describe('召回期的依赖闭包与冲突组装配', () => {
  const stores: AppStore[] = [];
  const directories: string[] = [];

  const setup = async (): Promise<{
    store: AppStore;
    service: MemoryService;
    databasePath: string;
    workspaceId: string;
    scope: MemoryScope;
  }> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-recall-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'app.db');
    const store = AppStore.open(databasePath);
    stores.push(store);
    const workspaceId = store.workspaces.getOrCreate('/tmp/recall/依赖闭包', '依赖闭包').id;
    return {
      store,
      service: new MemoryService(store, directory),
      databasePath,
      workspaceId,
      scope: { kind: 'workspace', workspaceId },
    };
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  /** 走真实写入路径：产出 verified＋manual 来源（操作已登记，来源可定位）的已确认记忆。 */
  const confirm = async (
    service: MemoryService,
    store: AppStore,
    scope: MemoryScope,
    content: string,
    topicKey?: string,
  ): Promise<Seeded> => {
    const operationId = randomUUID();
    const result = await service.create({
      operationId,
      content,
      facet: 'fact',
      scope,
      asUserInstruction: true,
      ...(topicKey === undefined ? {} : { topicKey }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    const revisionId = result.data.committedRevisionIds[0] ?? '';
    const record = store.memories.getRevision(revisionId);
    if (!record) throw new Error(`记忆未落库：${revisionId}`);
    return { record, operationId };
  };

  /** 依赖声明由 Main 的生产构建器挂到已有修订上，来源沿用创建时已登记的人工操作。 */
  const dependOn = (
    store: AppStore,
    seeded: Seeded,
    dependencies: readonly MemoryDependency[],
  ): Seeded => ({
    operationId: seeded.operationId,
    record: store.memories.update({
      id: seeded.record.id,
      expectedRevision: seeded.record.revision,
      patch: {},
      provenance: buildDerivedProvenance({
        capturedAt: CAPTURED_AT,
        sources: [manualMemorySource(seeded.operationId, seeded.record.content)],
        materialDependencies: [],
        memoryDependencies: [...dependencies],
      }),
    }).record,
  });

  const dependOnMaterials = (
    store: AppStore,
    seeded: Seeded,
    dependencies: readonly MaterialReference[],
  ): Seeded => ({
    operationId: seeded.operationId,
    record: store.memories.update({
      id: seeded.record.id,
      expectedRevision: seeded.record.revision,
      patch: {},
      provenance: buildDerivedProvenance({
        capturedAt: CAPTURED_AT,
        sources: [manualMemorySource(seeded.operationId, seeded.record.content)],
        materialDependencies: [...dependencies],
        memoryDependencies: [],
      }),
    }).record,
  });

  const dependencyOf = (seeded: Seeded): MemoryDependency => ({
    memoryId: seeded.record.id,
    revisionId: seeded.record.revisionId,
    contentHash: seeded.record.contentHash,
  });

  const outcomeOf = (store: AppStore, workspaceId: string) =>
    recallMemoriesForQuery(store, queryFor(workspaceId));

  const selectedRevisionIds = (store: AppStore, workspaceId: string): string[] =>
    outcomeOf(store, workspaceId).selectedItems.map((item) => item.revisionId);

  const dependencyFailures = (store: AppStore, workspaceId: string): string[] =>
    (
      outcomeOf(store, workspaceId).decisionSummary.exclusions.find(
        (entry) => entry.reason === 'dependency-unavailable',
      )?.identities ?? []
    ).map((identity) => identity.revisionId);

  /** 抹掉一条已登记的人工来源操作：制造「来源消失、修订残留」的对抗状态。 */
  const forgeDeleteOperation = (databasePath: string, operationId: string): void => {
    const db = new Database(databasePath);
    try {
      db.prepare('DELETE FROM memory_operations WHERE operation_id = ?').run(operationId);
    } finally {
      db.close();
    }
  };

  it('preserves full exclusion counts, latest samples and Task precedence with audit projections', async () => {
    const { store, service, scope, workspaceId } = await setup();
    const otherWorkspaceId = store.workspaces.getOrCreate('/tmp/recall/other-audit', 'other').id;
    const seed = (targetScope: MemoryScope, index: number, status: 'confirmed' | 'candidate') =>
      store.memories.create({
        scope: targetScope,
        status,
        content: `audit ${index}`,
        facet: 'fact',
        normalizedHash: createHash('sha256').update(`audit ${index}`).digest('hex'),
        confidence: 0.9,
        createdAt: CAPTURED_AT,
        provenance: {
          schemaVersion: 1,
          verification: 'legacy-unverified',
          sourceType: 'user-explicit',
        },
      }).record;
    const outside = Array.from({ length: 61 }, (_, index) =>
      seed({ kind: 'workspace', workspaceId: otherWorkspaceId }, index, 'confirmed'),
    );
    const inactive = Array.from({ length: 56 }, (_, index) =>
      seed(scope, 100 + index, 'candidate'),
    );
    const revised = store.memories.update({
      id: outside[1]!.id,
      expectedRevision: 1,
      patch: { content: 'latest audit body' },
      normalizedHash: createHash('sha256').update('latest audit body').digest('hex'),
      updatedAt: CAPTURED_AT + 1,
    }).record;
    const selected = await confirm(service, store, scope, '收入按回款金额统计的经营分析月报口径。');
    const excludedSelected = await confirm(service, store, scope, '收入按回款金额统计的排除口径。');
    const query = {
      ...queryFor(workspaceId),
      excludedMemoryIds: [
        outside[0]!.id,
        inactive[0]!.id,
        outside[0]!.id,
        'unknown-id',
        excludedSelected.record.id,
      ],
    };
    const fullList = store.memories.list();
    const identity = (record: MemoryRecord) => ({
      memoryId: record.id,
      revisionId: record.revisionId,
    });
    const referenceProjection = vi
      .spyOn(store.memories, 'listRecallAuditEntries')
      .mockImplementation(() =>
        fullList.map(({ id, revisionId, scope: entryScope }) => ({
          id,
          revisionId,
          scope: entryScope,
        })),
      );
    const expectedOutcome = recallMemoriesForQuery(store, query);
    referenceProjection.mockRestore();
    const fullRead = vi.spyOn(store.memories, 'list').mockImplementation(() => {
      throw new Error('full audit read');
    });
    const outcome = recallMemoriesForQuery(store, query);
    expect(fullRead).not.toHaveBeenCalled();
    expect(outcome).toEqual(expectedOutcome);
    expect(outcome.selectedItems.map((item) => item.revisionId)).toEqual([
      selected.record.revisionId,
    ]);
    expect(outcome.decisionSummary.exclusions).toEqual([
      {
        reason: 'inactive',
        count: 55,
        identities: fullList
          .filter((record) => inactive.slice(1).some((item) => item.id === record.id))
          .slice(0, 50)
          .map(identity),
      },
      {
        reason: 'scope',
        count: 60,
        identities: fullList
          .filter((record) => outside.slice(1).some((item) => item.id === record.id))
          .slice(0, 50)
          .map(identity),
      },
      {
        reason: 'task-excluded',
        count: 3,
        identities: [outside[0]!, inactive[0]!, excludedSelected.record].map(identity),
      },
    ]);
    expect(outcome.decisionSummary.exclusions[1]?.identities[0]?.revisionId).toBe(
      revised.revisionId,
    );
  });

  it('never parses out-of-scope provenance and never treats audit identities as candidates', async () => {
    const { store, service, scope, workspaceId, databasePath } = await setup();
    const otherWorkspaceId = store.workspaces.getOrCreate('/tmp/recall/opaque-audit', 'other').id;
    const outside = await confirm(
      service,
      store,
      { kind: 'workspace', workspaceId: otherWorkspaceId },
      '收入按回款金额统计。',
    );
    const eligible = await confirm(service, store, scope, '收入按回款金额统计。');
    const db = new Database(databasePath);
    try {
      const corrupt = db.prepare(
        'UPDATE memory_records SET provenance_json = ? WHERE revision_id = ?',
      );
      corrupt.run('{}', outside.record.revisionId);
      const outcome = outcomeOf(store, workspaceId);
      expect(outcome.selectedItems.map((item) => item.revisionId)).toEqual([
        eligible.record.revisionId,
      ]);
      expect(outcome.decisionSummary.exclusions).toEqual([
        {
          reason: 'scope',
          count: 1,
          identities: [{ memoryId: outside.record.id, revisionId: outside.record.revisionId }],
        },
      ]);
      expect(JSON.stringify(outcome.decisionSummary)).not.toContain(outside.record.content);
      corrupt.run('{}', eligible.record.revisionId);
      expect(() => outcomeOf(store, workspaceId)).toThrow();
    } finally {
      db.close();
    }
  });

  it('uses the complete effective reference set for recall and audit beyond the title summary', async () => {
    const { store, service, scope, workspaceId } = await setup();
    const target = knowledgeReference('zzzz-scheduled-tail');
    const seeded = dependOnMaterials(
      store,
      await confirm(service, store, scope, '收入按回款金额统计的经营分析口径。'),
      [target],
    );
    const task = store.tasks.create(workspaceId, '定时月报', '范围权限回归');
    const materials = [
      ...Array.from({ length: 200 }, (_, index) =>
        materialSelection(knowledgeReference(`revision-${String(index).padStart(3, '0')}`)),
      ),
      materialSelection(target),
    ];
    const preparation = {
      workspaceId,
      taskId: task.task.id,
      runId: randomUUID(),
      taskContextRevisionId: 'schedule-context-revision',
      evaluatedAt: CAPTURED_AT,
      prompt: '请按收入按回款金额统计的口径出月报。',
      materials,
      excludedMemoryIds: [],
      taskTitle: task.task.title,
    };

    const complete = prepareRunMemoryDecision(store, preparation);
    const withoutTail = prepareRunMemoryDecision(store, {
      ...preparation,
      materials: materials.slice(0, -1),
      runId: randomUUID(),
    });

    expect(complete.queryContext.materialTitles).toHaveLength(50);
    expect(complete.queryContext.materialTitles).not.toContainEqual(
      expect.objectContaining({ reference: target }),
    );
    expect(complete.selectedRecords.map((record) => record.revisionId)).toContain(
      seeded.record.revisionId,
    );
    expect(complete.materialDependencyUnion).toHaveLength(201);
    expect(complete.materialDependencyUnion).toContainEqual(target);
    expect(withoutTail.selectedRecords.map((record) => record.revisionId)).not.toContain(
      seeded.record.revisionId,
    );
    expect(withoutTail.authorizationHash).not.toBe(complete.authorizationHash);
  });

  it('keeps all inherited dependencies and the nearest unsafe boundary with targeted answers', async () => {
    const { store, service, scope, workspaceId } = await setup();
    const task = store.tasks.create(workspaceId, 'history', 'history');
    const dependencies = [];
    for (let index = 0; index < 80; index += 1) {
      dependencies.push(dependencyOf(await confirm(service, store, scope, `dependency ${index}`)));
    }
    for (let index = 0; index < 14; index += 1) {
      const runId = `history-${index}`;
      store.runs.create({
        id: runId,
        taskId: task.task.id,
        sessionId: task.sessionId,
        prompt: `prompt ${index}`,
        status: 'completed',
        createdAt: index,
        completedAt: 20,
      });
      store.runs.appendEvent({
        id: `${runId}-answer`,
        runId,
        sequence: 1,
        createdAt: 1,
        type: 'message.completed',
        messageId: runId,
        content: `answer ${index}`,
      });
      store.runs.appendEvent({
        id: `${runId}-empty`,
        runId,
        sequence: 2,
        createdAt: 2,
        type: 'message.completed',
        messageId: runId,
        content: '',
      });
      store.runs.appendEvent({
        id: `${runId}-tool`,
        runId,
        sequence: 3,
        createdAt: 3,
        type: 'tool.progress',
        toolCallId: runId,
        message: 'later tool',
      });
      store.runContextSnapshots.create({
        runId,
        taskId: task.task.id,
        workspaceId,
        contextSegmentId: runId,
        materials: [],
        createdAt: 0,
      });
      store.runMemoryContexts.recordSelection({
        runId,
        evaluatedAt: 0,
        selectedAt: 0,
        queryHash: CONTENT_HASH,
        authorizationHash: CONTENT_HASH,
        policySnapshot: memoryRecallPolicyV1,
        selectedItems: [],
        decisionSummary: {
          budget: {
            totalItems: 0,
            preferenceItems: 0,
            contentCodePoints: 0,
            wrapperCodePoints: 0,
            blockCodePoints: 0,
          },
          exclusions: [],
          queryTruncated: false,
          conflictReviewRequired: false,
        },
        memoryDependencyUnion: index === 12 ? dependencies : [],
      });
    }
    const input = {
      taskId: task.task.id,
      currentRunId: 'missing-current',
      evaluatedAt: CAPTURED_AT,
      excludedMemoryIds: [],
      allowedMaterialKeys: [],
    };
    const full = vi.spyOn(store.runs, 'listEvents').mockImplementation(() => {
      throw new Error('full journal');
    });
    const allRuns = vi.spyOn(store.runs, 'listByTask').mockImplementation(() => {
      throw new Error('unfiltered task history');
    });
    const plan = planRunHistoryReplay(store, input);
    expect(plan.messages).toEqual(
      Array.from({ length: 8 }, (_, index) => [
        { role: 'user', content: `prompt ${index + 6}` },
        { role: 'assistant', content: `answer ${index + 6}` },
      ]).flat(),
    );
    expect(plan.inheritedMemoryDependencies).toEqual(dependencies);
    expect(plan.replay.at(-1)).toEqual({
      replayed: false,
      runId: 'history-5',
      reason: 'history-budget',
    });
    const blocked = planRunHistoryReplay(store, {
      ...input,
      excludedMemoryIds: [dependencies.at(-1)!.memoryId],
    });
    expect(blocked.messages).toEqual([
      { role: 'user', content: 'prompt 13' },
      { role: 'assistant', content: 'answer 13' },
    ]);
    expect(blocked.replay.at(-1)).toEqual({
      replayed: false,
      runId: 'history-12',
      reason: 'memory-excluded',
    });
    expect(full).not.toHaveBeenCalled();
    expect(allRuns).not.toHaveBeenCalled();
  });

  it('reads repeated direct and inherited history dependencies once without full memory records', async () => {
    const { store, scope, workspaceId } = await setup();
    const task = store.tasks.create(workspaceId, 'batch history', 'batch history');
    const records = Array.from({ length: 80 }, (_, index) =>
      seedGovernanceMemory(store.memories, `batch dependency ${index}`, { scope }),
    );
    const dependencies = records.map((record) => ({
      memoryId: record.id,
      revisionId: record.revisionId,
      contentHash: record.contentHash,
    }));
    const runIds = Array.from({ length: 14 }, (_, index) =>
      seedReplayRun(store, {
        taskId: task.task.id,
        sessionId: task.sessionId,
        workspaceId,
        index,
        selected: records.slice(0, 16),
        dependencies,
      }),
    );
    const input = {
      taskId: task.task.id,
      currentRunId: 'missing-current',
      evaluatedAt: CAPTURED_AT,
      excludedMemoryIds: [],
      allowedMaterialKeys: [],
    };
    const legacy = vi
      .spyOn(store.memories, 'listReplayDependencies')
      .mockImplementation((ids) => legacyReplayDependencies(store.memories, ids));
    const expected = planRunHistoryReplay(store, input);
    legacy.mockRestore();
    const projected = vi.spyOn(store.memories, 'listReplayDependencies');
    const fullRevision = vi.spyOn(store.memories, 'getRevision').mockImplementation(() => {
      throw new Error('history must not hydrate memory revisions');
    });
    const fullCurrent = vi.spyOn(store.memories, 'get').mockImplementation(() => {
      throw new Error('history must not hydrate current memories');
    });
    const actual = planRunHistoryReplay(store, input);
    expect(actual).toEqual(expected);
    expect(actual.messages).toHaveLength(16);
    expect(actual.inheritedMemoryDependencies).toEqual(dependencies);
    expect(actual.replay.at(-1)).toEqual({
      replayed: false,
      runId: runIds[5],
      reason: 'history-budget',
    });
    expect(projected).toHaveBeenCalledTimes(1);
    expect(new Set(projected.mock.calls[0]![0])).toEqual(
      new Set(dependencies.map((ref) => ref.revisionId)),
    );
    fullRevision.mockRestore();
    fullCurrent.mockRestore();
    const changed = records.at(-1)!;
    store.memories.update({
      id: changed.id,
      expectedRevision: 1,
      patch: { content: 'changed inherited dependency' },
      normalizedHash: normalizedMemoryHash('changed inherited dependency'),
    });
    const blocked = planRunHistoryReplay(store, input);
    expect(blocked.messages).toEqual([]);
    expect(blocked.replay.at(-1)).toEqual({
      replayed: false,
      runId: runIds[13],
      reason: 'memory-revised',
    });
    expect(projected).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['revised', 'memory-revised'],
    ['narrowed', 'memory-revised'],
    ['deleted', 'memory-inactive'],
    ['expired', 'memory-inactive'],
    ['superseded', 'memory-inactive'],
    ['candidate', 'memory-inactive'],
    ['future', 'memory-inactive'],
    ['natural-expired', 'memory-inactive'],
    ['hash-mismatch', 'memory-revised'],
    ['missing', 'memory-revised'],
    ['excluded', 'memory-excluded'],
  ] as const)(
    'preserves %s rejection and the nearest boundary for direct and inherited dependencies',
    async (scenario, reason) => {
      const { store, workspaceId, scope } = await setup();
      const task = store.tasks.create(workspaceId, 'unsafe history', 'unsafe history');
      let record = seedGovernanceMemory(store.memories, 'historical rule', {
        scope: scenario === 'narrowed' ? { kind: 'user' } : scope,
        ...(scenario === 'candidate' ? { status: 'candidate' as const } : {}),
        ...(scenario === 'future' ? { validFrom: CAPTURED_AT + 1 } : {}),
        ...(scenario === 'natural-expired' ? { validUntil: CAPTURED_AT } : {}),
      });
      if (scenario === 'revised' || scenario === 'narrowed')
        store.memories.update({
          id: record.id,
          expectedRevision: 1,
          patch: scenario === 'revised' ? { content: 'new historical rule' } : { scope },
          normalizedHash: normalizedMemoryHash(
            scenario === 'revised' ? 'new historical rule' : record.content,
          ),
        });
      if (scenario === 'deleted' || scenario === 'expired')
        record = store.memories.applyGovernance({
          id: record.id,
          expectedRevision: 1,
          action: scenario === 'deleted' ? 'delete' : 'expire',
        }).record;
      if (scenario === 'superseded') {
        const winner = seedGovernanceMemory(store.memories, 'winning rule', { scope });
        record = store.memories.replace({
          winnerId: winner.id,
          winnerExpectedRevision: 1,
          loserId: record.id,
          loserExpectedRevision: 1,
        }).loser;
      }
      if (scenario === 'missing') record = { ...record, revisionId: 'missing-revision' };
      if (scenario === 'hash-mismatch' || scenario === 'excluded')
        record = { ...record, contentHash: 'b'.repeat(64) };
      const dependency = {
        memoryId: record.id,
        revisionId: record.revisionId,
        contentHash: record.contentHash,
      };
      for (const inherited of [false, true]) {
        const offset = inherited ? 3 : 0;
        seedReplayRun(store, {
          taskId: task.task.id,
          sessionId: task.sessionId,
          workspaceId,
          index: offset,
        });
        const unsafeId = seedReplayRun(store, {
          taskId: task.task.id,
          sessionId: task.sessionId,
          workspaceId,
          index: offset + 1,
          ...(inherited ? { dependencies: [dependency] } : { selected: [record] }),
        });
        seedReplayRun(store, {
          taskId: task.task.id,
          sessionId: task.sessionId,
          workspaceId,
          index: offset + 2,
        });
        const input = {
          taskId: task.task.id,
          currentRunId: 'missing-current',
          evaluatedAt: CAPTURED_AT,
          excludedMemoryIds: scenario === 'excluded' ? [record.id] : [],
          allowedMaterialKeys: [],
        };
        const actual = planRunHistoryReplay(store, input);
        expect(actual.messages).toEqual([
          { role: 'user', content: `prompt ${offset + 2}` },
          { role: 'assistant', content: `answer ${offset + 2}` },
        ]);
        expect(actual.skippedReason).toBe(reason);
        expect(actual.replay.at(-1)).toEqual({ replayed: false, runId: unsafeId, reason });
        const legacy = vi
          .spyOn(store.memories, 'listReplayDependencies')
          .mockImplementation((ids) => legacyReplayDependencies(store.memories, ids));
        expect(planRunHistoryReplay(store, input)).toEqual(actual);
        legacy.mockRestore();
      }
    },
  );

  it.each(['missing-context', 'missing-snapshot', 'unavailable-material'] as const)(
    'keeps %s unsafe even when memory metadata is complete',
    async (scenario) => {
      const { store, workspaceId, scope } = await setup();
      const task = store.tasks.create(workspaceId, 'source history', 'source history');
      const record = seedGovernanceMemory(store.memories, 'safe memory', { scope });
      const material: MaterialReference = {
        kind: 'workspace-input-snapshot',
        workspaceId,
        snapshotId: 'unavailable',
        contentHash: CONTENT_HASH,
        format: 'text',
        fileKey: 'missing.txt',
      };
      const unsafe = seedReplayRun(store, {
        taskId: task.task.id,
        sessionId: task.sessionId,
        workspaceId,
        index: 0,
        selected: [record],
        omitContext: scenario === 'missing-context',
        omitSnapshot: scenario === 'missing-snapshot',
        ...(scenario === 'unavailable-material' ? { materials: [material] } : {}),
      });
      const plan = planRunHistoryReplay(store, {
        taskId: task.task.id,
        currentRunId: 'missing-current',
        evaluatedAt: CAPTURED_AT,
        excludedMemoryIds: [],
        allowedMaterialKeys: [materialListIdentity(material)],
      });
      expect(plan.messages).toEqual([]);
      expect(plan.replay).toEqual([
        {
          replayed: false,
          runId: unsafe,
          reason:
            scenario === 'unavailable-material'
              ? 'source-unavailable'
              : 'legacy-provenance-unknown',
        },
      ]);
    },
  );

  it('checks a saved assistant source by exact Run/event presence without rejudging the answer', async () => {
    const { store, service, scope, workspaceId } = await setup();
    const seeded = await confirm(service, store, scope, '收入按回款金额统计。');
    const task = store.tasks.create(workspaceId, 'source', 'source');
    store.runs.create({
      id: 'source-run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'source',
      status: 'failed',
      createdAt: 0,
    });
    store.runs.appendEvent({
      id: 'saved-event',
      runId: 'source-run',
      sequence: 1,
      createdAt: 1,
      type: 'message.completed',
      messageId: 'message',
      content: 'answer',
    });
    store.runs.appendEvent({
      id: 'newer-event',
      runId: 'source-run',
      sequence: 2,
      createdAt: 2,
      type: 'message.completed',
      messageId: 'newer',
      content: 'newer answer',
    });
    const source = {
      kind: 'run-assistant' as const,
      runId: 'source-run',
      eventId: 'saved-event',
      contentHash: createHash('sha256').update('answer').digest('hex'),
      excerpt: 'answer',
      excerptHash: createHash('sha256').update('answer').digest('hex'),
      start: 0,
      end: 6,
    };
    const reviseSource = (runId: string) => {
      const current = store.memories.get(seeded.record.id)!;
      return store.memories.update({
        id: current.id,
        expectedRevision: current.revision,
        patch: {},
        provenance: buildDerivedProvenance({
          capturedAt: CAPTURED_AT,
          sources: [{ ...source, runId }],
          materialDependencies: [],
          memoryDependencies: [],
        }),
      }).record;
    };
    const valid = reviseSource('source-run');
    const full = vi.spyOn(store.runs, 'listEvents').mockImplementation(() => {
      throw new Error('full journal');
    });
    expect(selectedRevisionIds(store, workspaceId)).toContain(valid.revisionId);
    const missing = reviseSource('wrong-run');
    const unavailable = outcomeOf(store, workspaceId);
    expect(unavailable.selectedItems).toEqual([]);
    expect(unavailable.decisionSummary.exclusions).toContainEqual({
      reason: 'source-unavailable',
      count: 1,
      identities: [{ memoryId: missing.id, revisionId: missing.revisionId }],
    });
    expect(full).not.toHaveBeenCalled();
  });

  it('末端依赖被删除时，整条链都不再注入', async () => {
    const { store, service, scope, workspaceId } = await setup();

    const base = await confirm(service, store, scope, '收入按回款金额统计。');
    const middle = dependOn(
      store,
      await confirm(service, store, scope, '毛利按收入减直接成本计算。'),
      [dependencyOf(base)],
    );
    const leaf = dependOn(
      store,
      await confirm(service, store, scope, '续约率按客户数而非金额统计。'),
      [dependencyOf(middle)],
    );
    expect(selectedRevisionIds(store, workspaceId)).toEqual(
      expect.arrayContaining([
        base.record.revisionId,
        middle.record.revisionId,
        leaf.record.revisionId,
      ]),
    );

    const deleted = await service.setStatus({
      operationId: randomUUID(),
      id: base.record.id,
      expectedRevision: base.record.revision,
      action: 'delete',
    });
    expect(deleted.ok).toBe(true);

    const selected = selectedRevisionIds(store, workspaceId);
    expect(selected).not.toContain(middle.record.revisionId);
    expect(selected).not.toContain(leaf.record.revisionId);
    // 传递失效：只看一层依赖会把末端口径放回来。
    expect(dependencyFailures(store, workspaceId)).toEqual(
      expect.arrayContaining([middle.record.revisionId, leaf.record.revisionId]),
    );
  });

  it('依赖成环时召回照常终止并把环内记录判为不可用', async () => {
    const { store, service, scope, workspaceId, databasePath } = await setup();

    const left = await confirm(service, store, scope, '收入按回款金额统计。');
    const right = await confirm(service, store, scope, '毛利按收入减直接成本计算。');
    // 让两条**当前**修订互相引用：只有一侧引用旧修订是失效而不是环，测不到递归保护。
    const leftRevised = dependOn(store, left, [dependencyOf(right)]);
    expect(selectedRevisionIds(store, workspaceId)).toEqual(
      expect.arrayContaining([leftRevised.record.revisionId, right.record.revisionId]),
    );
    forgeDependencies(databasePath, right.record.revisionId, [dependencyOf(leftRevised)]);

    const selected = selectedRevisionIds(store, workspaceId);
    expect(selected).not.toContain(leftRevised.record.revisionId);
    expect(selected).not.toContain(right.record.revisionId);
    expect(dependencyFailures(store, workspaceId)).toEqual(
      expect.arrayContaining([leftRevised.record.revisionId, right.record.revisionId]),
    );
  });

  it('同议题两条未裁决的口径互相顶住，谁都不注入', async () => {
    const { store, service, scope, workspaceId } = await setup();

    const payment = await confirm(
      service,
      store,
      scope,
      '收入按回款金额统计，不含签约金额。',
      '收入口径',
    );
    const contract = await confirm(service, store, scope, '收入按签约金额统计。', '收入口径');

    const blocked = outcomeOf(store, workspaceId);
    const selected = blocked.selectedItems.map((item) => item.revisionId);
    expect(selected).not.toContain(payment.record.revisionId);
    expect(selected).not.toContain(contract.record.revisionId);
    expect(
      blocked.decisionSummary.exclusions
        .find((entry) => entry.reason === 'conflict-unresolved')
        ?.identities.map((identity) => identity.revisionId),
    ).toEqual(expect.arrayContaining([payment.record.revisionId, contract.record.revisionId]));
    expect(blocked.decisionSummary.conflictReviewRequired).toBe(true);
  });

  it('两条都保留后按一个冲突组注入，并带上适用条件', async () => {
    const { store, service, scope, workspaceId } = await setup();

    const payment = await confirm(
      service,
      store,
      scope,
      '收入按回款金额统计，不含签约金额。',
      '收入口径',
    );
    const contract = await confirm(service, store, scope, '收入按签约金额统计。', '收入口径');
    const resolved = await service.resolveConflict({
      operationId: randomUUID(),
      left: { id: payment.record.id, expectedRevision: payment.record.revision },
      right: { id: contract.record.id, expectedRevision: contract.record.revision },
      decision: 'keep-both',
      applicabilityNote: '回款口径用于对外披露，签约口径用于内部销售复盘。',
    });
    expect(resolved.ok).toBe(true);

    const kept = outcomeOf(store, workspaceId);
    const byRevision = new Map(
      kept.selectedItems.map((item) => [item.revisionId, item.reason] as const),
    );
    expect([...byRevision.keys()]).toEqual(
      expect.arrayContaining([payment.record.revisionId, contract.record.revisionId]),
    );
    expect(byRevision.get(payment.record.revisionId)).toBe('conflict-pair');
    expect(byRevision.get(contract.record.revisionId)).toBe('conflict-pair');
    expect(kept.memoryBlock).toContain('回款口径用于对外披露，签约口径用于内部销售复盘。');
    expect(kept.decisionSummary.conflictReviewRequired).toBe(false);
  });

  /** 造一对同议题口径并按「两条都保留」裁决，适用条件用满 300 码点上限。 */
  const keepBothPair = async (
    service: MemoryService,
    store: AppStore,
    scope: MemoryScope,
    index: number,
  ): Promise<void> => {
    const left = await confirm(
      service,
      store,
      scope,
      `口径${index}按回款金额统计。`,
      `收入口径${index}`,
    );
    const right = await confirm(
      service,
      store,
      scope,
      `口径${index}按签约金额统计。`,
      `收入口径${index}`,
    );
    const resolved = await service.resolveConflict({
      operationId: randomUUID(),
      left: { id: left.record.id, expectedRevision: left.record.revision },
      right: { id: right.record.id, expectedRevision: right.record.revision },
      decision: 'keep-both',
      applicabilityNote: `适用条件${index}`.padEnd(300, '说'),
    });
    expect(resolved.ok).toBe(true);
  };

  it('包装预算超限时整组让位，不留半条冲突口径', async () => {
    const { store, service, scope, workspaceId } = await setup();
    // 8 组 keep-both 正好占满 16 条上限；正文极短，撑破的只可能是条目级之外的块级预算。
    for (const index of Array.from({ length: 8 }, (_, i) => i)) {
      await keepBothPair(service, store, scope, index);
    }

    const outcome = outcomeOf(store, workspaceId);
    const kept = outcome.selectedItems.map((item) => item.memoryId);
    expect(kept.length).toBeLessThan(16);
    expect(kept.length % 2).toBe(0);
    expect([...outcome.memoryBlock].length).toBeLessThanOrEqual(8_000);

    const dropped: number[] = [];
    for (const index of Array.from({ length: 8 }, (_, i) => i)) {
      const payment = outcome.memoryBlock.includes(`口径${index}按回款金额统计。`);
      const contract = outcome.memoryBlock.includes(`口径${index}按签约金额统计。`);
      // 组是原子单位：只带一条等于把「两条都保留」的裁决改成单方面采信。
      expect(payment).toBe(contract);
      if (!payment) dropped.push(index);
    }
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('人工来源被移除后，残留修订不再注入且排除账本只记身份', async () => {
    const { store, service, scope, workspaceId, databasePath } = await setup();

    const memory = await confirm(service, store, scope, '收入按回款金额统计，不使用签约金额。');
    expect(selectedRevisionIds(store, workspaceId)).toContain(memory.record.revisionId);

    forgeDeleteOperation(databasePath, memory.operationId);

    // 修订仍在库里：落选必须是因为来源证明站不住，而不是记录被连带删掉。
    expect(store.memories.getRevision(memory.record.revisionId)).toBeDefined();

    const outcome = outcomeOf(store, workspaceId);
    expect(outcome.selectedItems.map((item) => item.revisionId)).not.toContain(
      memory.record.revisionId,
    );
    const sourceFailures =
      outcome.decisionSummary.exclusions
        .find((entry) => entry.reason === 'source-unavailable')
        ?.identities.map((identity) => identity.revisionId) ?? [];
    expect(sourceFailures).toContain(memory.record.revisionId);
    // 排除账本只带身份：正文既不进注入块，也不进账本。
    expect(outcome.memoryBlock).not.toContain('不使用签约金额');
    expect(JSON.stringify(outcome.decisionSummary)).not.toContain('不使用签约金额');
  });
});
