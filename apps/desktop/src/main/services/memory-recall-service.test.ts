import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  MemoryProvenance,
  MemoryQueryContext,
  MemoryRecord,
  MemoryScope,
} from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { buildDerivedProvenance, manualMemorySource } from './memory-provenance';
import { recallMemoriesForQuery } from './memory-recall-service';
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
 * 冲突组装配同样按 §6.1 的过滤顺序钉住：同议题、有效期重叠且没有裁决的两条口径都不注入并
 * 置 `conflictReviewRequired`；「两条都保留」之后两条必须作为一组回来，并带上适用条件说明。
 */

const CAPTURED_AT = 1_700_000_000_000;

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
});
