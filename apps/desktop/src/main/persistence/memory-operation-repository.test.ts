import { createHash, randomUUID } from 'node:crypto';

import {
  type MemoryProvenance,
  type MemoryRecord,
  type MemoryScope,
  stableStringifyJson,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore, MemoryIdempotencyConflictError, type MemoryRepository } from './index';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** §5.1：全仓只有一种请求哈希口径——稳定序列化后取 SHA-256。 */
const requestHashOf = (payload: Record<string, unknown>): string =>
  sha256Hex(stableStringifyJson(payload));

const normalizeMemory = (content: string): string =>
  content.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
const digestOf = (content: string): string => sha256Hex(normalizeMemory(content));

const legacyProvenance = (): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'legacy-unverified',
  sourceType: 'user-explicit',
});

const userScope: MemoryScope = { kind: 'user' };

/** 幂等回执要绑真实修订，所以被裁决的两条记忆都由仓储建出来。 */
const seedMemory = (
  repository: MemoryRepository,
  content: string,
  options: { topicKey?: string; createdAt?: number } = {},
): MemoryRecord =>
  repository.create({
    scope: userScope,
    content,
    facet: 'fact',
    normalizedHash: digestOf(content),
    provenance: legacyProvenance(),
    confidence: 0.9,
    status: 'confirmed',
    ...(options.topicKey === undefined ? {} : { topicKey: options.topicKey }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  }).record;

describe('MemoryOperationRepository', () => {
  const stores: AppStore[] = [];

  const openStore = (): AppStore => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  /** §5.6：一次写命令 = claim → 业务写入 → append 回执，三步同事务。 */
  const commitEdit = (
    store: AppStore,
    id: string,
    content: string,
    operationId: string,
  ): { effect: string; revisionId: string } => {
    const requestHash = requestHashOf({ id, content });
    return store.transaction(() => {
      const claim = store.memoryOperations.claim({
        operationId,
        operationKind: 'update',
        requestHash,
      });
      if (claim.kind === 'replay') {
        return { effect: 'replayed', revisionId: claim.operation.committedRevisionIds[0] ?? '' };
      }
      const outcome = store.memories.update({
        id,
        expectedRevision: 1,
        patch: { content },
        normalizedHash: digestOf(content),
      });
      store.memoryOperations.append({
        operationId,
        operationKind: 'update',
        requestHash,
        effect: outcome.effect,
        committedRevisionIds: [outcome.record.revisionId],
      });
      return { effect: outcome.effect, revisionId: outcome.record.revisionId };
    });
  };

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('replays the original receipt instead of performing the write twice', () => {
    const store = openStore();
    const memory = seedMemory(store.memories, '报价含税，另行说明运费。', { topicKey: '报价口径' });
    const operationId = randomUUID();
    const content = '报价含税，运费单独列示。';

    const first = commitEdit(store, memory.id, content, operationId);
    expect(first.effect).toBe('updated');
    expect(store.memories.get(memory.id)?.revision).toBe(2);

    // 重放：同 operationId ＋ 同 requestHash ⇒ 一份效果，返回第一次的回执。
    const second = commitEdit(store, memory.id, content, operationId);
    expect(second.effect).toBe('replayed');
    expect(store.memories.get(memory.id)?.revision).toBe(2);

    const receipt = store.memoryOperations.get(operationId);
    expect(receipt?.operationKind).toBe('update');
    expect(receipt?.effect).toBe('updated');
    expect(receipt?.committedRevisionIds).toEqual([first.revisionId]);
    expect(receipt?.committedAt).toBeTypeOf('number');
    // 回执只存修订身份，正文一律读回当前视图，不复制快照。
    expect(JSON.stringify(receipt)).not.toContain(content);
  });

  /** §13.3：审计里区分「候选确认」与「候选拒绝」的唯一字段是 governanceAction。 */
  it('round-trips the governance action that separates confirm from reject', () => {
    const store = openStore();
    const memory = seedMemory(store.memories, '周报先写风险，再写进展。');
    const confirmId = randomUUID();
    const rejectId = randomUUID();

    for (const [operationId, action] of [
      [confirmId, 'confirm'],
      [rejectId, 'reject'],
    ] as const) {
      store.memoryOperations.append({
        operationId,
        operationKind: 'set-status',
        requestHash: requestHashOf({ id: memory.id, action }),
        effect: 'updated',
        committedRevisionIds: [memory.revisionId],
        governanceAction: action,
      });
    }

    expect(store.memoryOperations.get(confirmId)?.governanceAction).toBe('confirm');
    expect(store.memoryOperations.get(rejectId)?.governanceAction).toBe('reject');
    // 两条回执都是同一修订上的不同决定，正文不进审计行。
    expect(JSON.stringify(store.memoryOperations.get(confirmId))).not.toContain(memory.content);
  });

  it('refuses a reused operationId that carries different content or a different kind', () => {
    const store = openStore();
    const memory = seedMemory(store.memories, '周会纪要默认只发到项目群。');
    const operationId = randomUUID();
    const originalHash = requestHashOf({ id: memory.id, content: '甲' });

    store.memoryOperations.append({
      operationId,
      operationKind: 'update',
      requestHash: originalHash,
      effect: 'updated',
      committedRevisionIds: [memory.revisionId],
    });
    const beforeRevision = store.memories.get(memory.id)?.revision;

    expect(() =>
      store.memoryOperations.claim({
        operationId,
        operationKind: 'update',
        requestHash: requestHashOf({ id: memory.id, content: '乙' }),
      }),
    ).toThrow(MemoryIdempotencyConflictError);
    // 同内容换了一种操作身份，也是「两次不同写入撞了一个幂等身份」。
    expect(() =>
      store.memoryOperations.claim({
        operationId,
        operationKind: 'set-status',
        requestHash: originalHash,
      }),
    ).toThrow(/重新发起/u);

    expect(store.memories.get(memory.id)?.revision).toBe(beforeRevision);
    expect(store.memoryOperations.get(operationId)?.requestHash).toBe(originalHash);
    // 冲突后仍可用原哈希拿到 replay，说明被拒的是第二次写入，不是回执本身。
    expect(
      store.memoryOperations.claim({
        operationId,
        operationKind: 'update',
        requestHash: originalHash,
      }).kind,
    ).toBe('replay');
  });

  it('rolls the whole conflict resolution back when the decision row cannot be written', () => {
    const store = openStore();
    const left = seedMemory(store.memories, '交付周期以合同签署日起算。', { topicKey: '交付周期' });
    const right = seedMemory(store.memories, '交付周期以收到预付款日起算。', {
      topicKey: '交付周期',
    });
    const operationId = randomUUID();

    store.memoryOperations.append({
      operationId,
      operationKind: 'resolve-conflict',
      requestHash: requestHashOf({ note: '先占住这个幂等身份' }),
      effect: 'unchanged',
      committedRevisionIds: [],
    });

    // 回执已存在但裁决行写不进去 ⇒ 整个事务回滚，不留「有回执没裁决」的半状态。
    expect(() =>
      store.memoryOperations.recordConflictResolution({
        operationId,
        requestHash: requestHashOf({ left: left.revisionId, right: right.revisionId }),
        leftRevisionId: left.revisionId,
        rightRevisionId: right.revisionId,
        decision: 'keep-both',
        applicabilityNote: '预付款到账前按签署日，之后按到账日。',
      }),
    ).toThrow();
    expect(
      store.memoryOperations.findDecisionForPair(left.revisionId, right.revisionId),
    ).toBeUndefined();
    expect(store.memoryOperations.get(operationId)?.committedRevisionIds).toEqual([]);
    expect(store.memories.get(left.id)?.revision).toBe(1);
    expect(store.memories.get(right.id)?.revision).toBe(1);
  });

  it('stores one canonical shape per revision pair and reads it back either way round', () => {
    const store = openStore();
    const first = seedMemory(store.memories, '毛利率按扣除退款后的收入计算。', {
      topicKey: '毛利口径',
    });
    const second = seedMemory(store.memories, '毛利率按签约总额计算。', { topicKey: '毛利口径' });
    // 故意将后建的那条放在左边：落库前必须按修订身份规范排序，与 UUID 大小写顺序无关。
    const result = store.memoryOperations.recordConflictResolution({
      operationId: randomUUID(),
      requestHash: requestHashOf({ winner: second.revisionId }),
      leftRevisionId: second.revisionId,
      rightRevisionId: first.revisionId,
      decision: 'replace',
      winnerRevisionId: second.revisionId,
    });
    expect(result.decision.leftRevisionId < result.decision.rightRevisionId).toBe(true);
    expect([result.decision.leftRevisionId, result.decision.rightRevisionId].sort()).toEqual(
      [first.revisionId, second.revisionId].sort(),
    );
    expect(result.operation.operationKind).toBe('resolve-conflict');
    // replace 的效果是「改写了记录」，keep-both 才是 unchanged。
    expect(result.operation.effect).toBe('updated');
    expect(result.operation.committedRevisionIds).toHaveLength(2);

    expect(
      store.memoryOperations.findDecisionForPair(first.revisionId, second.revisionId)?.id,
    ).toBe(result.decision.id);
    expect(
      store.memoryOperations.findDecisionByOperation(result.operation.operationId)?.decision,
    ).toBe('replace');
    expect(store.memoryOperations.listConflictPairsForRevisionIds([first.revisionId])).toEqual([
      {
        leftRevisionId: result.decision.leftRevisionId,
        rightRevisionId: result.decision.rightRevisionId,
        state: 'replaced',
      },
    ]);
  });

  it('keeps a keep-both decision only with an applicability note written by the user', () => {
    const store = openStore();
    const left = seedMemory(store.memories, '周报每周五提交。', { topicKey: '周报' });
    const right = seedMemory(store.memories, '周报每月最后一个工作日提交。', { topicKey: '周报' });

    expect(() =>
      store.memoryOperations.recordConflictResolution({
        operationId: randomUUID(),
        requestHash: requestHashOf({ pair: 'no-note' }),
        leftRevisionId: left.revisionId,
        rightRevisionId: right.revisionId,
        decision: 'keep-both',
      }),
    ).toThrow(/keep-both 必须写明适用条件/u);
    expect(
      store.memoryOperations.findDecisionForPair(left.revisionId, right.revisionId),
    ).toBeUndefined();

    const { decision, operation } = store.memoryOperations.recordConflictResolution({
      operationId: randomUUID(),
      requestHash: requestHashOf({ pair: 'noted' }),
      leftRevisionId: left.revisionId,
      rightRevisionId: right.revisionId,
      decision: 'keep-both',
      applicabilityNote: '项目内按周五，跨项目汇报按月末。',
    });
    expect(decision.applicabilityNote).toBe('项目内按周五，跨项目汇报按月末。');
    expect(decision.winnerRevisionId).toBeUndefined();
    // keep-both 不改写任何记忆，所以回执是 unchanged。
    expect(operation.effect).toBe('unchanged');
    expect(store.memoryOperations.listConflictPairsForRevisionIds([right.revisionId])).toEqual([
      {
        leftRevisionId: decision.leftRevisionId,
        rightRevisionId: decision.rightRevisionId,
        state: 'keep-both',
      },
    ]);
  });

  it('refuses pairs that are not two existing, distinct exact revisions', () => {
    const store = openStore();
    const memory = seedMemory(store.memories, '验收以演示环境为准。');
    const other = seedMemory(store.memories, '验收以生产环境为准。');

    expect(() =>
      store.memoryOperations.recordConflictResolution({
        operationId: randomUUID(),
        requestHash: requestHashOf({ pair: 'self' }),
        leftRevisionId: memory.revisionId,
        rightRevisionId: memory.revisionId,
        decision: 'keep-both',
        applicabilityNote: '同一条记忆不构成冲突。',
      }),
    ).toThrow(/两个不同的精确修订/u);

    expect(() =>
      store.memoryOperations.recordConflictResolution({
        operationId: randomUUID(),
        requestHash: requestHashOf({ pair: 'ghost' }),
        leftRevisionId: memory.revisionId,
        rightRevisionId: 'ghost-revision',
        decision: 'keep-both',
        applicabilityNote: '幽灵修订不该被裁决引用。',
      }),
    ).toThrow(/已存在的精确修订/u);

    expect(() =>
      store.memoryOperations.recordConflictResolution({
        operationId: randomUUID(),
        requestHash: requestHashOf({ pair: 'outside-winner' }),
        leftRevisionId: memory.revisionId,
        rightRevisionId: other.revisionId,
        decision: 'replace',
        winnerRevisionId: seedMemory(store.memories, '第三方修订').revisionId,
      }),
    ).toThrow(/本次裁决的两个修订之一/u);

    expect(store.memoryOperations.listDecisionsForRevisionIds([])).toEqual([]);
    expect(store.memoryOperations.countDecisionsReferencingRevisions([])).toBe(0);
  });

  it('drops a decision from the current view as soon as either revision moves', () => {
    const store = openStore();
    const left = seedMemory(store.memories, '需求变更走线上表单。', { topicKey: '变更流程' });
    const right = seedMemory(store.memories, '需求变更先群里对齐。', { topicKey: '变更流程' });
    const { decision } = store.memoryOperations.recordConflictResolution({
      operationId: randomUUID(),
      requestHash: requestHashOf({ pair: 'current-only' }),
      leftRevisionId: left.revisionId,
      rightRevisionId: right.revisionId,
      decision: 'keep-both',
      applicabilityNote: '紧急变更先对齐，事后补表单。',
    });
    const ids = [left.revisionId, right.revisionId];
    expect(
      store.memoryOperations.listDecisionsForRevisionIds(ids, { currentOnly: true }),
    ).toHaveLength(1);

    // 任一侧再往前一步，这条裁决绑的就不是「当下」了：历史留档，当前视图撤回。
    store.memories.update({
      id: left.id,
      expectedRevision: 1,
      patch: { content: '需求变更走线上表单，事后补归档。' },
      normalizedHash: digestOf('需求变更走线上表单，事后补归档。'),
    });
    expect(store.memoryOperations.listDecisionsForRevisionIds(ids)).toEqual([decision]);
    expect(store.memoryOperations.listDecisionsForRevisionIds(ids, { currentOnly: true })).toEqual(
      [],
    );
    expect(store.memoryOperations.listConflictPairsForRevisionIds(ids)).toEqual([]);
    expect(
      store.memoryOperations.listDecisionsForRevisionIds(ids, { decision: 'replace' }),
    ).toEqual([]);
    expect(store.memoryOperations.countDecisionsReferencingRevisions(ids)).toBe(1);
  });

  it('rejects receipt shapes that the contract does not allow', () => {
    const store = openStore();
    const memory = seedMemory(store.memories, '月度盘点在月末最后一个工作日。');

    expect(() =>
      store.memoryOperations.append({
        operationId: 'not-a-uuid',
        operationKind: 'update',
        requestHash: sha256Hex('x'),
        effect: 'updated',
        committedRevisionIds: [memory.revisionId],
      }),
    ).toThrow(/operationId 必须是 UUID/u);
    expect(() =>
      store.memoryOperations.append({
        operationId: randomUUID(),
        operationKind: 'update',
        requestHash: '不是十六进制摘要',
        effect: 'updated',
        committedRevisionIds: [memory.revisionId],
      }),
    ).toThrow();
    expect(store.memoryOperations.get('not-a-uuid')).toBeUndefined();
    expect(store.memoryOperations.findDecisionByOperation('missing-operation')).toBeUndefined();
  });
});
