import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { MemoryRecord, MemoryScope } from '@betterwork/agent-protocol';
import { MEMORY_RECALL_VERSION_V2 } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { MemoryRecallService } from './memory-recall-service';
import {
  applyRecallBudgetV2,
  pinnedGroupOrder,
  type RecallGroup,
  type RecallItem,
} from './memory-retrieval';
import { MemoryService } from './memory-service';

/** MI05：memory-recall-v2 的优先池、预算边界与历史 v1 兼容（契约 §11.3–§11.4）。 */

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const digestOf = (content: string): string =>
  sha256Hex(content.normalize('NFC').replace(/\r\n?/gu, '\n').trim());

const item = (
  id: string,
  content: string,
  scope: RecallItem['scope'] = { kind: 'user' },
): RecallItem => ({
  id,
  revisionId: `rev-${id}`,
  contentHash: 'a'.repeat(64),
  content,
  kind: 'procedural',
  scope,
  updatedAt: 1,
});

const group = (reason: RecallGroup['reason'], ...items: RecallItem[]): RecallGroup => ({
  items,
  reason,
});

describe('applyRecallBudgetV2 分配顺序', () => {
  it('零词面命中的优先规则仍然入选，并带 pinned-rule 理由', () => {
    const selection = applyRecallBudgetV2(
      [group('pinned-rule', item('m-pin', '金额按万元保留两位。'))],
      [],
      [],
    );
    expect(selection.items.map((entry) => entry.reason)).toEqual(['pinned-rule']);
    expect(selection.items[0]?.content).toBe('金额按万元保留两位。');
  });

  it('优先池排在偏好池与相关池之前，每条只计一次', () => {
    const selection = applyRecallBudgetV2(
      [group('pinned-rule', item('m-pin', '优先规则。'))],
      [group('relevance', item('m-rel', '相关经验。'))],
      [
        {
          id: 'm-pref',
          revisionId: 'rev-m-pref',
          contentHash: 'b'.repeat(64),
          content: '通用偏好。',
        },
      ],
    );
    expect(selection.items.map((entry) => entry.id)).toEqual(['m-pin', 'm-pref', 'm-rel']);
    expect(selection.items.map((entry) => entry.order)).toEqual([0, 1, 2]);
  });

  it('第 7 条优先记录整条落选并给出预算原因，不截断正文', () => {
    const pinned = Array.from({ length: 7 }, (_unused, index) =>
      group('pinned-rule', item(`m-${index}`, `规则 ${index}。`)),
    );
    const selection = applyRecallBudgetV2(pinned, [], []);
    expect(selection.items).toHaveLength(6);
    expect(selection.skippedForBudget).toBe(1);
  });

  it('优先池正文超过 2,000 码点后停止接收，但更短的规则仍可入选', () => {
    const big = group('pinned-rule', item('m-big', '长'.repeat(2_001)));
    const small = group('pinned-rule', item('m-small', '短规则。'));
    const selection = applyRecallBudgetV2([big, small], [], []);
    expect(selection.items.map((entry) => entry.id)).toEqual(['m-small']);
    expect(selection.skippedForBudget).toBe(1);
  });

  it('并存分量只要有一条优先就整组进优先池，容不下则整组落选', () => {
    const component = group(
      'pinned-rule',
      item('m-a', '甲规则。'),
      item('m-b', '乙规则。'),
      item('m-c', '丙规则。'),
    );
    const included = applyRecallBudgetV2([component], [], []);
    expect(included.items.map((entry) => entry.id)).toEqual(['m-a', 'm-b', 'm-c']);
    expect(included.items.every((entry) => entry.reason === 'pinned-rule')).toBe(true);

    const oversized = group(
      'pinned-rule',
      item('m-d', '丁'.repeat(1_999)),
      item('m-e', '戊'.repeat(1_999)),
    );
    const rejected = applyRecallBudgetV2(
      [oversized, group('pinned-rule', item('m-f', '己。'))],
      [],
      [],
    );
    expect(rejected.items.map((entry) => entry.id)).toEqual(['m-f']);
    expect(rejected.skippedForBudget).toBe(2);
  });

  it('组序按最具体范围与最小 id 决定，不按更新时间偏袒', () => {
    const groups = [
      group('pinned-rule', item('m-late', '晚更新的用户级规则。')),
      group(
        'pinned-rule',
        item('m-workspace', '工作空间规则。', { kind: 'workspace', workspaceId: 'ws-1' }),
      ),
    ];
    const sorted = [...groups].sort((left, right) => pinnedGroupOrder(left.items, right.items));
    expect(sorted[0]?.items[0]?.id).toBe('m-workspace');
  });
});

describe('优先策略写入资格（真实 SQLite）', () => {
  const stores: AppStore[] = [];
  const directories: string[] = [];

  const openWorld = async (): Promise<{
    store: AppStore;
    memories: MemoryService;
    recall: MemoryRecallService;
    scope: MemoryScope;
    directory: string;
  }> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-mi05-'));
    directories.push(directory);
    const store = AppStore.open(path.join(directory, 'app.db'));
    stores.push(store);
    const workspaceId = store.workspaces.getOrCreate('/tmp/mi05/空间', 'MI05 空间').id;
    return {
      store,
      memories: new MemoryService(store, directory),
      recall: new MemoryRecallService({ store }),
      scope: { kind: 'workspace', workspaceId },
      directory,
    };
  };

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const createConfirmed = async (
    memories: MemoryService,
    scope: MemoryScope,
    content: string,
    facet: 'constraint' | 'fact' | 'method' = 'constraint',
  ): Promise<MemoryRecord> => {
    const created = await memories.create({
      operationId: randomUUID(),
      content,
      facet,
      scope,
      asUserInstruction: true,
      ...(scope.kind === 'user' || scope.kind === 'expert' ? { genericDeclaration: true } : {}),
    });
    if (!created.ok) throw new Error(`创建失败：${created.error.code}`);
    const revisionId = created.data.committedRevisionIds[0];
    if (revisionId === undefined) throw new Error('缺少修订。');
    const record = stores[0]?.memories.getRevision(revisionId);
    if (!record) throw new Error('修订未落库。');
    return record;
  };

  it('自主工作要求可设为优先，事实与派生内容被拒绝', async () => {
    const { store, memories, scope } = await openWorld();
    const rule = await createConfirmed(memories, scope, '金额按万元保留两位。');
    const pinned = await memories.update({
      operationId: randomUUID(),
      id: rule.id,
      expectedRevision: rule.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(pinned.ok).toBe(true);
    expect(store.memories.get(rule.id)?.recallPolicy).toBe('pinned');

    const fact = await createConfirmed(memories, scope, '本期收入为一百二十万元。', 'fact');
    const rejected = await memories.update({
      operationId: randomUUID(),
      id: fact.id,
      expectedRevision: fact.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('INVALID_TRANSITION');
    expect(rejected.error.message).toContain('事实与经验');

    // 同值重复提交返回 unchanged，不堆积空修订。
    const same = await memories.update({
      operationId: randomUUID(),
      id: rule.id,
      expectedRevision: (store.memories.get(rule.id) ?? rule).revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.data.effect).toBe('unchanged');
  });

  /**
   * 契约 §11.3 的五条资格各给一条原因，界面才可能把「为什么不能优先」说清楚。
   * legacy 与「用户口径＋带依赖」两种形状只能按仓储直写建立：前者是迁移前的历史记录，
   * 后者当前生产路径写不出来（create 里 sourceSelector 与 asUserInstruction 互斥），
   * 但门禁必须在形状出现时照样拦住，所以留作对抗性 fixture。
   */
  it('剩余三条资格拒绝各有原因，已优先记录改形状要先取消优先', async () => {
    const { store, memories, scope } = await openWorld();

    const legacy = store.memories.create({
      scope,
      content: '旧口径：报表按千元出。',
      facet: 'constraint',
      normalizedHash: digestOf('旧口径：报表按千元出。'),
      provenance: {
        schemaVersion: 1,
        verification: 'legacy-unverified',
        sourceType: 'user-explicit',
      },
      confidence: 1,
      status: 'confirmed',
    }).record;
    const legacyReject = await memories.update({
      operationId: randomUUID(),
      id: legacy.id,
      expectedRevision: legacy.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(legacyReject.ok).toBe(false);
    if (legacyReject.ok) return;
    expect(legacyReject.error.message).toContain('来源尚未复核');

    const scheduled = await memories.create({
      operationId: randomUUID(),
      content: '下季度才启用的口径。',
      facet: 'constraint',
      scope,
      asUserInstruction: true,
      validFrom: Date.now() + 86_400_000,
    });
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;
    const scheduledRevisionId = scheduled.data.committedRevisionIds[0];
    const scheduledRecord =
      scheduledRevisionId === undefined
        ? undefined
        : store.memories.getRevision(scheduledRevisionId);
    if (!scheduledRecord) throw new Error('未到生效期的记录未落库。');
    const scheduledReject = await memories.update({
      operationId: randomUUID(),
      id: scheduledRecord.id,
      expectedRevision: scheduledRecord.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(scheduledReject.ok).toBe(false);
    if (scheduledReject.ok) return;
    expect(scheduledReject.error.message).toContain('当前生效');

    const excerpt = '依赖材料';
    const withDependency = store.memories.create({
      scope,
      content: '引用了资料原文的口径。',
      facet: 'constraint',
      normalizedHash: digestOf('引用了资料原文的口径。'),
      provenance: {
        schemaVersion: 1,
        verification: 'verified',
        authority: 'user-instruction',
        capturedAt: 1_700_000_000_000,
        sources: [
          {
            kind: 'manual',
            operationId: randomUUID(),
            contentHash: sha256Hex(excerpt),
            start: 0,
            end: [...excerpt].length,
            excerpt,
            excerptHash: sha256Hex(excerpt),
          },
        ],
        materialDependencies: [
          {
            kind: 'knowledge-revision',
            knowledgeDocumentId: 'doc-1',
            knowledgeRevisionId: 'rev-1',
            contentHash: sha256Hex('rev-1'),
            sourcePath: 'docs/income-policy.md',
          },
        ],
        memoryDependencies: [],
      },
      confidence: 1,
      status: 'confirmed',
    }).record;
    const dependencyReject = await memories.update({
      operationId: randomUUID(),
      id: withDependency.id,
      expectedRevision: withDependency.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(dependencyReject.ok).toBe(false);
    if (dependencyReject.ok) return;
    expect(dependencyReject.error.message).toContain('仍依赖材料');

    // 已优先的记录不许被悄悄改形成违规形状，必须先显式取消优先。
    const rule = await createConfirmed(memories, scope, '金额按万元保留两位。');
    const pinned = await memories.update({
      operationId: randomUUID(),
      id: rule.id,
      expectedRevision: rule.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(pinned.ok).toBe(true);
    const current = store.memories.get(rule.id);
    const demoteAttempt = await memories.update({
      operationId: randomUUID(),
      id: rule.id,
      expectedRevision: current?.revision ?? 2,
      patch: { facet: 'fact' },
    });
    expect(demoteAttempt.ok).toBe(false);
    if (demoteAttempt.ok) return;
    expect(demoteAttempt.error.message).toContain('先取消优先');
    expect(store.memories.get(rule.id)?.facet).toBe('constraint');
  });

  it('preview 与真实选择都用 v2 快照，零词面命中的优先规则仍入选', async () => {
    const { store, memories, recall, scope } = await openWorld();
    const task = store.tasks.create(
      scope.kind === 'workspace' ? scope.workspaceId : '',
      '经营回顾',
      '做份经营回顾',
    );
    const rule = await createConfirmed(memories, scope, '金额按万元保留两位。');
    const pinned = await memories.update({
      operationId: randomUUID(),
      id: rule.id,
      expectedRevision: rule.revision,
      patch: { recallPolicy: 'pinned' },
    });
    expect(pinned.ok).toBe(true);
    const context = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      excludedMemoryIds: [],
    });
    const preview = recall.preview({
      taskId: task.task.id,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
      prompt: '请汇总近期业务表现',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.policySnapshot.recallVersion).toBe(MEMORY_RECALL_VERSION_V2);
    const selected = preview.data.selectedItems.find((entry) => entry.memoryId === rule.id);
    expect(selected?.reason).toBe('pinned-rule');
    // 词面分数如实为 0，不伪造高分。
    expect(selected?.score).toBe(0);
  });

  it('被排除或失效的优先规则不能穿透门禁', async () => {
    const { store, memories, recall, scope } = await openWorld();
    const task = store.tasks.create(
      scope.kind === 'workspace' ? scope.workspaceId : '',
      '经营回顾',
      '做份经营回顾',
    );
    const rule = await createConfirmed(memories, scope, '金额按万元保留两位。');
    await memories.update({
      operationId: randomUUID(),
      id: rule.id,
      expectedRevision: rule.revision,
      patch: { recallPolicy: 'pinned' },
    });
    const context = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      excludedMemoryIds: [rule.id],
    });
    const preview = recall.preview({
      taskId: task.task.id,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
      prompt: '请汇总近期业务表现',
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.selectedItems.map((entry) => entry.memoryId)).not.toContain(rule.id);
    const excluded = preview.data.decisionSummary.exclusions.find(
      (entry) => entry.reason === 'task-excluded',
    );
    expect(excluded?.identities.map((identity) => identity.memoryId)).toContain(rule.id);
  });
});
