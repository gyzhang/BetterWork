import { createHash, randomUUID } from 'node:crypto';

import {
  LIST_PAGE_DEFAULT_LIMIT,
  type MemoryFacet,
  type MemoryProvenance,
  type MemoryScope,
  type MemorySourceType,
  stableStringifyJson,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AppStore,
  deriveEffectiveStatus,
  isMemoryEffectiveAt,
  MemoryConflictError,
  type MemoryRepository,
  MemoryScopeMismatchError,
  MemoryTerminalError,
  MemoryValidationError,
} from './index';

/** 契约 §5.1：normalizedHash 只做 NFC＋换行统一＋首尾空白去除，然后取 UTF-8 摘要。 */
const normalizeMemory = (content: string): string =>
  content.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const digestOf = (content: string): string => sha256Hex(normalizeMemory(content));
const codePoints = (value: string): number => [...value].length;

/** §5.3：legacy 分支不补造捕获时间与来源清单，因此它是本文件最常用的默认来源。 */
const legacyProvenance = (sourceType: MemorySourceType = 'user-explicit'): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'legacy-unverified',
  sourceType,
});

/** §5.3：verified 分支只能由 Main 侧构造，摘录区间与字符数必须自证。 */
const manualProvenance = (excerpt: string): MemoryProvenance => ({
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
      end: codePoints(excerpt),
      excerpt,
      excerptHash: sha256Hex(excerpt),
    },
  ],
  materialDependencies: [],
  memoryDependencies: [],
  genericDeclaration: true,
});

interface CreateOptions {
  facet?: MemoryFacet;
  status?: 'confirmed' | 'candidate';
  topicKey?: string;
  validFrom?: number;
  validUntil?: number;
  confidence?: number;
  createdAt?: number;
  provenance?: MemoryProvenance;
  candidateDisposition?: 'pending' | 'rejected';
}

/** WM02 之后 create 必填四项，测试里不重复整段形状。 */
const seedMemory = (
  repository: MemoryRepository,
  scope: MemoryScope,
  content: string,
  options: CreateOptions = {},
) =>
  repository.create({
    scope,
    content,
    facet: options.facet ?? 'fact',
    normalizedHash: digestOf(content),
    provenance: options.provenance ?? legacyProvenance(),
    confidence: options.confidence ?? 0.9,
    status: options.status ?? 'confirmed',
    ...(options.topicKey === undefined ? {} : { topicKey: options.topicKey }),
    ...(options.validFrom === undefined ? {} : { validFrom: options.validFrom }),
    ...(options.validUntil === undefined ? {} : { validUntil: options.validUntil }),
    ...(options.candidateDisposition === undefined
      ? {}
      : { candidateDisposition: options.candidateDisposition }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  }).record;

describe('MemoryRepository', () => {
  const stores: AppStore[] = [];

  const openStore = (): AppStore => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  const seedWorkspace = (store: AppStore, name: string): string =>
    store.workspaces.getOrCreate(`/tmp/memory-repo/${name}`, name).id;

  const seedExpert = (store: AppStore): string =>
    store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '测试专家',
        summary: '测试',
        identity: '测试',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    }).id;

  /** 读取足迹只登记真实 Run，因此链上每一环都由仓储建出来。 */
  const seedRun = (store: AppStore, workspaceId: string): string => {
    const task = store.tasks.create(workspaceId, '读记忆', '记录本次读取');
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

  /** UNIQUE(id, revision)＋修订只增不减，因此最新修订号就是该身份的行数。 */
  const rowCount = (repository: MemoryRepository, id: string): number =>
    repository.get(id)?.revision ?? 0;

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('appends a revision per change and refuses to pile up empty ones', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = { kind: 'workspace', workspaceId: seedWorkspace(store, '主空间') };

    const first = seedMemory(repository, scope, '收入按回款金额统计。', {
      facet: 'decision',
      topicKey: '收入口径',
    });
    expect(first.revision).toBe(1);
    expect(first.kind).toBe('semantic');
    expect(first.contentHash).toBe(sha256Hex('收入按回款金额统计。'));

    const updated = repository.update({
      id: first.id,
      expectedRevision: 1,
      patch: { content: '收入按回款金额统计，不使用签约金额。' },
      normalizedHash: digestOf('收入按回款金额统计，不使用签约金额。'),
      updatedAt: 1_700_000_000_100,
    });
    expect(updated.effect).toBe('updated');
    expect(updated.record.revision).toBe(2);
    expect(updated.record.id).toBe(first.id);
    expect(updated.record.supersedesId).toBe(first.revisionId);
    // 精确修订读取：旧修订永远还在，历史才解释得了当时用的是哪一版。
    expect(repository.getRevision(first.revisionId)?.revision).toBe(1);
    expect(repository.getRevision(first.revisionId)?.content).toBe('收入按回款金额统计。');

    const unchanged = repository.update({
      id: first.id,
      expectedRevision: 2,
      patch: { content: '收入按回款金额统计，不使用签约金额。' },
      normalizedHash: digestOf('收入按回款金额统计，不使用签约金额。'),
    });
    expect(unchanged.effect).toBe('unchanged');
    expect(unchanged.record.revision).toBe(2);
    expect(rowCount(repository, first.id)).toBe(2);

    // 换来源声明不是「无变化」：同一正文也要留下新的精确修订。
    const reSourced = repository.update({
      id: first.id,
      expectedRevision: 2,
      patch: { content: '收入按回款金额统计，不使用签约金额。' },
      normalizedHash: digestOf('收入按回款金额统计，不使用签约金额。'),
      provenance: manualProvenance('收入按回款金额统计，不使用签约金额。'),
      updatedAt: 1_700_000_000_200,
    });
    expect(reSourced.effect).toBe('updated');
    expect(reSourced.record.provenance.verification).toBe('verified');

    expect(() =>
      repository.update({
        id: first.id,
        expectedRevision: 1,
        patch: { content: '过期写入' },
        normalizedHash: digestOf('过期写入'),
      }),
    ).toThrow(MemoryConflictError);
    // 改正文却不交归一化摘要＝无法做确定性重复检测，存储层直接拒。
    expect(() =>
      repository.update({ id: first.id, expectedRevision: 3, patch: { content: '缺摘要' } }),
    ).toThrow(/归一化摘要/u);
    expect(rowCount(repository, first.id)).toBe(3);
  });

  it('pages the latest revision per identity and honours the natural-expiry view', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = { kind: 'workspace', workspaceId: seedWorkspace(store, '分页空间') };

    const oldest = seedMemory(repository, scope, '第一条口径', { createdAt: 1_700_000_000_000 });
    const expiring = seedMemory(repository, scope, '只在窗口内有效', {
      createdAt: 1_700_000_000_100,
      validFrom: 1_700_000_000_100,
      validUntil: 1_700_000_000_200,
    });
    const newest = seedMemory(repository, scope, '第三条口径', { createdAt: 1_700_000_000_200 });
    repository.update({
      id: oldest.id,
      expectedRevision: 1,
      patch: { content: '第一条口径（已修订）' },
      normalizedHash: digestOf('第一条口径（已修订）'),
      updatedAt: 1_700_000_000_300,
    });

    expect(repository.list().map((record) => record.id)).toEqual([
      oldest.id,
      newest.id,
      expiring.id,
    ]);

    const page = repository.listPage({ limit: 2 });
    expect(page.items.map((record) => record.id)).toEqual([oldest.id, newest.id]);
    const cursor = page.nextCursor;
    expect(cursor).toEqual({ version: 1, updatedAt: 1_700_000_000_200, id: newest.id });
    if (!cursor) throw new Error('第一页必须给出游标');
    const second = repository.listPage({ limit: 2, cursor });
    expect(second.items.map((record) => record.id)).toEqual([expiring.id]);
    expect(second.nextCursor).toBeUndefined();

    // 自然到期是查询派生的：同一行在窗口内出现、窗口外消失，状态列不变。
    const inWindow = repository.listPage({ effectiveAt: 1_700_000_000_150 });
    expect(inWindow.items.map((record) => record.id)).toContain(expiring.id);
    const afterWindow = repository.listPage({ effectiveAt: 1_700_000_000_250 });
    expect(afterWindow.items.map((record) => record.id)).not.toContain(expiring.id);
    expect(afterWindow.items).toHaveLength(2);
    expect(repository.get(expiring.id)?.status).toBe('confirmed');
  });

  it('uses the protocol page-size constant as the default limit', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '默认页大小空间'),
    };
    for (let index = 0; index <= LIST_PAGE_DEFAULT_LIMIT; index += 1) {
      seedMemory(repository, scope, `第 ${index + 1} 条口径`, {
        createdAt: 1_700_000_000_000 + index * 1_000,
      });
    }

    // 默认页大小只认协议常量：常量改动时这里必须跟着动，存储层不允许再写死一个数字。
    const first = repository.listPage({});
    expect(first.items).toHaveLength(LIST_PAGE_DEFAULT_LIMIT);
    const cursor = first.nextCursor;
    if (!cursor) throw new Error('超出默认页大小时必须给出游标');
    const second = repository.listPage({ cursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const ids = new Set([...first.items, ...second.items].map((record) => record.id));
    expect(ids.size).toBe(LIST_PAGE_DEFAULT_LIMIT + 1);
  });

  it('keeps a cleared validity date distinct from one that was never set', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '有效期空间'),
    };

    const bounded = seedMemory(repository, scope, '本季度对外口径', {
      validFrom: 1_700_000_000_000,
      validUntil: 1_700_000_000_500,
      topicKey: '对外口径',
    });
    expect(bounded.validFrom).toBe(1_700_000_000_000);
    expect(bounded.validUntil).toBe(1_700_000_000_500);

    const cleared = repository.update({
      id: bounded.id,
      expectedRevision: 1,
      patch: { validUntil: { action: 'clear' }, topicKey: { action: 'clear' } },
      updatedAt: 1_700_000_000_600,
    });
    expect(cleared.effect).toBe('updated');
    // 「无界」与「没有这个字段」是两件事：clear 之后字段整个消失，而不是变成 0。
    expect('validUntil' in cleared.record).toBe(false);
    expect('topicKey' in cleared.record).toBe(false);
    expect(cleared.record.validFrom).toBe(1_700_000_000_000);
    // 往返一致：从库里读回来的仍是「无界」。
    expect(repository.get(bounded.id)).toEqual(cleared.record);
    expect(
      repository.listPage({ effectiveAt: 1_900_000_000_000 }).items.map((r) => r.id),
    ).toContain(bounded.id);

    const reset = repository.update({
      id: bounded.id,
      expectedRevision: 2,
      patch: {
        validFrom: { action: 'set', value: 1_700_000_000_700 },
        validUntil: { action: 'set', value: 1_700_000_000_800 },
      },
      updatedAt: 1_700_000_000_700,
    });
    expect(reset.record.validFrom).toBe(1_700_000_000_700);
    expect(reset.record.validUntil).toBe(1_700_000_000_800);

    expect(() =>
      repository.update({
        id: bounded.id,
        expectedRevision: 3,
        patch: { validUntil: { action: 'set', value: 1_700_000_000_700 } },
      }),
    ).toThrow(MemoryValidationError);
    expect(repository.get(bounded.id)?.validUntil).toBe(1_700_000_000_800);
  });

  it('derives validity and expiry at read time instead of storing a second status', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = { kind: 'workspace', workspaceId: seedWorkspace(store, '生效空间') };

    const windowed = seedMemory(repository, scope, '只在窗口内成立的口径', {
      validFrom: 1_000,
      validUntil: 2_000,
    });
    // §5.1 有效区间左闭右开：validFrom ≤ now < validUntil。
    expect(isMemoryEffectiveAt(windowed, 999)).toBe(false);
    expect(isMemoryEffectiveAt(windowed, 1_000)).toBe(true);
    expect(isMemoryEffectiveAt(windowed, 1_999)).toBe(true);
    expect(isMemoryEffectiveAt(windowed, 2_000)).toBe(false);
    expect(deriveEffectiveStatus(windowed, 1_500)).toBe('confirmed');
    expect(deriveEffectiveStatus(windowed, 2_000)).toBe('expired');
    // 派生不回写：到期后行状态仍是 confirmed，历史才解释得了当时它是不是事实。
    expect(repository.get(windowed.id)?.status).toBe('confirmed');
    expect(rowCount(repository, windowed.id)).toBe(1);

    // 缺省端点无界，不会被任何时点判成过期。
    const unbounded = seedMemory(repository, scope, '长期口径');
    expect(isMemoryEffectiveAt(unbounded, 0)).toBe(true);
    expect(isMemoryEffectiveAt(unbounded, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(deriveEffectiveStatus(unbounded, Number.MAX_SAFE_INTEGER)).toBe('confirmed');

    // 候选的「已拒绝」只是展示态；没有处置事实的历史候选按待审展示，不回填（§8.4）。
    const pending = seedMemory(repository, scope, '待审候选', { status: 'candidate' });
    expect(deriveEffectiveStatus(pending, 1_500)).toBe('candidate');
    const rejected = repository.applyGovernance({
      id: pending.id,
      expectedRevision: 1,
      action: 'reject',
    }).record;
    expect(deriveEffectiveStatus(rejected, 1_500)).toBe('rejected');
    const restored = repository.applyGovernance({
      id: pending.id,
      expectedRevision: 2,
      action: 'restore-candidate',
    }).record;
    expect(deriveEffectiveStatus(restored, 1_500)).toBe('candidate');

    // 终态不会被派生成别的状态；expire 是唯一把到期写成状态列的动作，且它自己就是终态。
    const supersededLoser = seedMemory(repository, scope, '被替代的旧口径', { validUntil: 1_500 });
    const winner = seedMemory(repository, scope, '现行口径');
    const replacement = repository.replace({
      winnerId: winner.id,
      winnerExpectedRevision: 1,
      loserId: supersededLoser.id,
      loserExpectedRevision: 1,
    });
    expect(deriveEffectiveStatus(replacement.loser, 5_000)).toBe('superseded');
    expect(deriveEffectiveStatus(replacement.winner, 5_000)).toBe('confirmed');
    const deleted = repository.applyGovernance({
      id: unbounded.id,
      expectedRevision: 1,
      action: 'delete',
    }).record;
    expect(deriveEffectiveStatus(deleted, 5_000)).toBe('deleted');
    const expired = repository.applyGovernance({
      id: winner.id,
      expectedRevision: 1,
      action: 'expire',
    }).record;
    expect(deriveEffectiveStatus(expired, 0)).toBe('expired');
  });

  it('keeps terminal records closed to edits, confirmations, renewals and restores', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '终态空间');
    const scope: MemoryScope = { kind: 'workspace', workspaceId };

    const deleted = seedMemory(repository, scope, '已经删除的口径');
    expect(
      repository.applyGovernance({
        id: deleted.id,
        expectedRevision: 1,
        action: 'delete',
        updatedAt: 1_700_000_000_100,
      }).record.status,
    ).toBe('deleted');

    const superseded = seedMemory(repository, scope, '被替代的口径');
    const winner = seedMemory(repository, scope, '现行口径');
    repository.replace({
      winnerId: winner.id,
      winnerExpectedRevision: 1,
      loserId: superseded.id,
      loserExpectedRevision: 1,
    });
    expect(repository.get(superseded.id)?.status).toBe('superseded');

    for (const identity of [deleted.id, superseded.id]) {
      const current = repository.get(identity);
      if (!current) throw new Error('终态记录仍应查得到');
      expect(() =>
        repository.update({
          id: current.id,
          expectedRevision: current.revision,
          patch: { content: '想要改回正文' },
          normalizedHash: digestOf('想要改回正文'),
        }),
      ).toThrow(MemoryTerminalError);
      for (const action of [
        'confirm',
        'reject',
        'restore-candidate',
        'expire',
        'delete',
        'reconfirm',
      ] as const) {
        expect(() =>
          repository.applyGovernance({
            id: current.id,
            expectedRevision: current.revision,
            action,
            ...(action === 'reconfirm'
              ? { confirmPatch: { validUntil: { action: 'set', value: 1_800_000_000_000 } } }
              : {}),
          }),
        ).toThrow(MemoryTerminalError);
      }
      // 终态不进召回，也不因为「查得到」就重新变成事实。
      expect(
        repository
          .listRecallCandidates({ workspaceId, evaluatedAt: 1_700_000_000_200 })
          .map((record) => record.id),
      ).not.toContain(current.id);
      expect(rowCount(repository, current.id)).toBe(current.revision);
    }
  });

  it('walks candidates through reject and restore exactly as the transition table allows', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '候选空间'),
    };

    const candidate = seedMemory(repository, scope, '模型建议的排版偏好', {
      facet: 'preference',
      status: 'candidate',
    });
    expect(candidate.candidateDisposition).toBeUndefined();

    const rejected = repository.applyGovernance({
      id: candidate.id,
      expectedRevision: 1,
      action: 'reject',
      updatedAt: 1_700_000_000_100,
    });
    expect(rejected.record.status).toBe('candidate');
    expect(rejected.record.candidateDisposition).toBe('rejected');
    // 被拒绝的候选不能绕过待审列表直接被确认。
    expect(() =>
      repository.applyGovernance({ id: candidate.id, expectedRevision: 2, action: 'confirm' }),
    ).toThrow(/不允许执行/u);

    const restored = repository.applyGovernance({
      id: candidate.id,
      expectedRevision: 2,
      action: 'restore-candidate',
      updatedAt: 1_700_000_000_200,
    });
    expect(restored.record.candidateDisposition).toBe('pending');
    // 候选没被确认过，谈不上 expire。
    expect(() =>
      repository.applyGovernance({ id: candidate.id, expectedRevision: 3, action: 'expire' }),
    ).toThrow(/不允许执行/u);

    const confirmed = repository.applyGovernance({
      id: candidate.id,
      expectedRevision: 3,
      action: 'confirm',
      confirmPatch: { topicKey: { action: 'set', value: '排版偏好' } },
      updatedAt: 1_700_000_000_300,
    });
    expect(confirmed.record.status).toBe('confirmed');
    expect(confirmed.record.topicKey).toBe('排版偏好');
    // confirmPatch 与状态转移落在同一个修订里，不留「确认了但没带编辑」的中间态。
    expect(confirmed.record.revision).toBe(4);

    const expired = repository.applyGovernance({
      id: candidate.id,
      expectedRevision: 4,
      action: 'expire',
      updatedAt: 1_700_000_000_400,
    });
    expect(expired.record.status).toBe('expired');
    expect(() =>
      repository.applyGovernance({ id: candidate.id, expectedRevision: 5, action: 'reconfirm' }),
    ).toThrow(/必须明确修改有效期/u);
    expect(() =>
      repository.applyGovernance({
        id: candidate.id,
        expectedRevision: 5,
        action: 'delete',
        confirmPatch: { topicKey: { action: 'clear' } },
      }),
    ).toThrow(/confirmPatch 只随/u);

    const renewed = repository.applyGovernance({
      id: candidate.id,
      expectedRevision: 5,
      action: 'reconfirm',
      confirmPatch: { validUntil: { action: 'set', value: 1_800_000_000_000 } },
      updatedAt: 1_700_000_000_500,
    });
    expect(renewed.record.status).toBe('confirmed');
    expect(renewed.record.validUntil).toBe(1_800_000_000_000);
  });

  it('rolls back a replace whose second revision no longer matches, leaving neither record moved', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '替代空间'),
    };

    const winner = seedMemory(repository, scope, '现行口径：按回款统计');
    const loser = seedMemory(repository, scope, '旧口径：按签约统计');
    const operationId = randomUUID();

    repository.update({
      id: loser.id,
      expectedRevision: 1,
      patch: { content: '旧口径：按签约统计（他人已改）' },
      normalizedHash: digestOf('旧口径：按签约统计（他人已改）'),
      updatedAt: 1_700_000_000_100,
    });
    expect(() =>
      repository.replace({
        winnerId: winner.id,
        winnerExpectedRevision: 1,
        loserId: loser.id,
        loserExpectedRevision: 1,
      }),
    ).toThrow(MemoryConflictError);
    expect(repository.get(winner.id)?.revision).toBe(1);
    expect(repository.get(loser.id)?.status).toBe('confirmed');
    expect(store.memoryOperations.get(operationId)).toBeUndefined();

    const applied = store.transaction(() => {
      const replacement = repository.replace({
        winnerId: winner.id,
        winnerExpectedRevision: 1,
        loserId: loser.id,
        loserExpectedRevision: 2,
        updatedAt: 1_700_000_000_200,
      });
      store.memoryOperations.append({
        operationId,
        operationKind: 'resolve-conflict',
        requestHash: sha256Hex(stableStringifyJson({ winnerId: winner.id, loserId: loser.id })),
        effect: 'updated',
        committedRevisionIds: [replacement.winnerRevisionId, replacement.loser.revisionId],
      });
      return replacement;
    });
    expect(applied.loser.status).toBe('superseded');
    // 精确修订外键：替代只指向胜出的那一版修订，不是稳定 id。
    expect(applied.loser.replacesRevisionId).toBe(applied.winnerRevisionId);
    expect(repository.get(winner.id)?.revision).toBe(1);
    expect(repository.get(loser.id)?.revision).toBe(3);

    // 回执写不进去＝替代整体作废，两条都不许留下半个修订。
    const freshWinner = seedMemory(repository, scope, '第二条现行口径');
    const freshLoser = seedMemory(repository, scope, '第二条旧口径');
    expect(() =>
      store.transaction(() => {
        repository.replace({
          winnerId: freshWinner.id,
          winnerExpectedRevision: 1,
          loserId: freshLoser.id,
          loserExpectedRevision: 1,
          updatedAt: 1_700_000_000_300,
        });
        store.memoryOperations.append({
          operationId,
          operationKind: 'resolve-conflict',
          requestHash: sha256Hex('同一 operationId 的不同内容'),
          effect: 'updated',
          committedRevisionIds: [freshWinner.revisionId],
        });
      }),
    ).toThrow();
    expect(repository.get(freshWinner.id)?.revision).toBe(1);
    expect(repository.get(freshLoser.id)?.revision).toBe(1);
    expect(repository.get(freshLoser.id)?.status).toBe('confirmed');
    expect(store.memoryOperations.get(operationId)?.committedRevisionIds).toEqual([
      applied.winnerRevisionId,
      applied.loser.revisionId,
    ]);
  });

  it('refuses a replace across scopes, against itself and over unconfirmed records', () => {
    const store = openStore();
    const repository = store.memories;
    const firstScope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '空间一'),
    };
    const secondScope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '空间二'),
    };

    const local = seedMemory(repository, firstScope, '本空间口径');
    const other = seedMemory(repository, secondScope, '另一空间口径');
    expect(() =>
      repository.replace({
        winnerId: local.id,
        winnerExpectedRevision: 1,
        loserId: other.id,
        loserExpectedRevision: 1,
      }),
    ).toThrow(MemoryScopeMismatchError);
    expect(() =>
      repository.replace({
        winnerId: local.id,
        winnerExpectedRevision: 1,
        loserId: local.id,
        loserExpectedRevision: 1,
      }),
    ).toThrow(/两条不同的记忆/u);

    const candidate = seedMemory(repository, firstScope, '待审候选', { status: 'candidate' });
    expect(() =>
      repository.replace({
        winnerId: local.id,
        winnerExpectedRevision: 1,
        loserId: candidate.id,
        loserExpectedRevision: 1,
      }),
    ).toThrow(/已确认/u);
    expect(repository.get(candidate.id)?.status).toBe('candidate');
    expect(repository.get(other.id)?.revision).toBe(1);
  });

  it('writes no revision and no receipt when a stale expectedRevision aborts the command', () => {
    const store = openStore();
    const repository = store.memories;
    const scope: MemoryScope = {
      kind: 'workspace',
      workspaceId: seedWorkspace(store, '并发空间'),
    };
    const record = seedMemory(repository, scope, '并发下的现行口径');
    const operationId = randomUUID();
    const requestHash = sha256Hex(
      stableStringifyJson({ id: record.id, patch: { content: '并发写入' } }),
    );

    const claimed = store.transaction(() => {
      const claim = store.memoryOperations.claim({
        operationId,
        operationKind: 'update',
        requestHash,
      });
      if (claim.kind === 'replay') throw new Error('首次提交不应命中回放');
      const outcome = repository.update({
        id: record.id,
        expectedRevision: 1,
        patch: { content: '并发写入' },
        normalizedHash: digestOf('并发写入'),
        updatedAt: 1_700_000_000_100,
      });
      store.memoryOperations.append({
        operationId,
        operationKind: 'update',
        requestHash,
        effect: outcome.effect,
        committedRevisionIds: [outcome.record.revisionId],
      });
      return outcome.record;
    });
    expect(claimed.revision).toBe(2);

    // 迟到的并发者：CAS 挡下后修订与回执都不许留下痕迹。
    const rivalOperationId = randomUUID();
    expect(() =>
      store.transaction(() => {
        repository.update({
          id: record.id,
          expectedRevision: 1,
          patch: { content: '迟到的并发写入' },
          normalizedHash: digestOf('迟到的并发写入'),
        });
        store.memoryOperations.append({
          operationId: rivalOperationId,
          operationKind: 'update',
          requestHash: sha256Hex('rival'),
          effect: 'updated',
          committedRevisionIds: [randomUUID()],
        });
      }),
    ).toThrow(MemoryConflictError);
    expect(rowCount(repository, record.id)).toBe(2);
    expect(store.memoryOperations.get(rivalOperationId)).toBeUndefined();
    expect(store.memoryOperations.get(operationId)?.committedRevisionIds).toEqual([
      claimed.revisionId,
    ]);
  });

  it('suppresses duplicate candidates by scope and normalized hash', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '去重空间');
    const scope: MemoryScope = { kind: 'workspace', workspaceId };
    const content = '汇报先给结论再给依据';

    const first = seedMemory(repository, scope, content, { status: 'candidate' });
    const duplicate = repository.create({
      scope,
      content,
      facet: 'experience',
      normalizedHash: digestOf(content),
      provenance: legacyProvenance('conversation'),
      confidence: 0.6,
      status: 'candidate',
    });
    expect(duplicate.effect).toBe('deduplicated');
    expect(duplicate.record.id).toBe(first.id);
    expect(repository.findCandidateByDedupeKey(scope, digestOf(content))?.id).toBe(first.id);

    repository.applyGovernance({ id: first.id, expectedRevision: 1, action: 'reject' });
    const suppressed = repository.create({
      scope,
      content,
      facet: 'experience',
      normalizedHash: digestOf(content),
      provenance: legacyProvenance('conversation'),
      confidence: 0.6,
      status: 'candidate',
    });
    expect(suppressed.effect).toBe('suppressed');
    expect(rowCount(repository, first.id)).toBe(2);

    // 恢复待审后才重新进入列表；同内容不同空间也不是重复。
    repository.applyGovernance({ id: first.id, expectedRevision: 2, action: 'restore-candidate' });
    expect(repository.findCandidateByDedupeKey(scope, digestOf(content))?.id).toBe(first.id);
    const elsewhere = repository.create({
      scope: { kind: 'workspace', workspaceId: seedWorkspace(store, '另一个空间') },
      content,
      facet: 'experience',
      normalizedHash: digestOf(content),
      provenance: legacyProvenance('conversation'),
      confidence: 0.6,
      status: 'candidate',
    });
    expect(elsewhere.effect).toBe('created');
    expect(elsewhere.record.id).not.toBe(first.id);
  });

  it('filters recall candidates by scope, validity and task exclusions without the WM03 gate', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '召回空间');
    const otherWorkspaceId = seedWorkspace(store, '旁观空间');
    const expertId = seedExpert(store);

    const userPreference = seedMemory(repository, { kind: 'user' }, '回复用中文', {
      facet: 'preference',
      provenance: manualProvenance('回复用中文'),
      createdAt: 1_700_000_000_100,
    });
    const legacyWorkspace = seedMemory(
      repository,
      { kind: 'workspace', workspaceId },
      '收入按回款统计',
      {
        createdAt: 1_700_000_000_200,
      },
    );
    const pair = seedMemory(
      repository,
      { kind: 'expert-workspace', expertId, workspaceId },
      '该专家在本空间的口径',
      { createdAt: 1_700_000_000_300 },
    );
    const expertOnly = seedMemory(repository, { kind: 'expert', expertId }, '专家通用口径', {
      createdAt: 1_700_000_000_400,
    });
    const outOfScope = seedMemory(
      repository,
      { kind: 'workspace', workspaceId: otherWorkspaceId },
      '别的空间的口径',
      { createdAt: 1_700_000_000_500 },
    );
    const expired = seedMemory(repository, { kind: 'workspace', workspaceId }, '已经过期的口径', {
      validFrom: 1_000,
      validUntil: 2_000,
      createdAt: 1_700_000_000_600,
    });
    const candidate = seedMemory(repository, { kind: 'workspace', workspaceId }, '还没确认的候选', {
      status: 'candidate',
      createdAt: 1_700_000_000_700,
    });

    const recalled = repository
      .listRecallCandidates({ workspaceId, expertId, evaluatedAt: 1_700_000_000_800 })
      .map((record) => record.id);
    // §8.4：来源门禁到 WM03 才启用，legacy 记录仍被召回，只是不补造确认事实。
    expect(recalled).toEqual([expertOnly.id, pair.id, legacyWorkspace.id, userPreference.id]);
    expect(recalled).not.toContain(expired.id);
    expect(recalled).not.toContain(candidate.id);
    expect(recalled).not.toContain(outOfScope.id);

    const withoutExpert = repository
      .listRecallCandidates({ workspaceId, evaluatedAt: 1_700_000_000_800 })
      .map((record) => record.id);
    expect(withoutExpert).toEqual([legacyWorkspace.id, userPreference.id]);

    const excluded = repository
      .listRecallCandidates({
        workspaceId,
        expertId,
        evaluatedAt: 1_700_000_000_800,
        excludedMemoryIds: [legacyWorkspace.id],
      })
      .map((record) => record.id);
    expect(excluded).not.toContain(legacyWorkspace.id);
    expect(excluded).toContain(pair.id);

    const verifiedOnly = repository
      .listRecallCandidates({
        workspaceId,
        evaluatedAt: 1_700_000_000_800,
        onlyVerifiedProvenance: true,
      })
      .map((record) => record.id);
    expect(verifiedOnly).toEqual([userPreference.id]);
  });

  it('records run reads with the honest provenance state and merged injection flags', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '足迹空间');
    const runId = seedRun(store, workspaceId);
    const replayedRunId = seedRun(store, workspaceId);

    const legacy = seedMemory(repository, { kind: 'workspace', workspaceId }, '可追溯记忆');
    const verified = seedMemory(repository, { kind: 'workspace', workspaceId }, '已核实记忆', {
      provenance: manualProvenance('已核实记忆'),
    });
    repository.recordReads([
      { runId, memory: legacy, capturedAt: 1_700_000_000_000 },
      { runId, memory: verified, capturedAt: 1_700_000_000_000 },
    ]);
    const reads = repository.listMemoryReads(runId);
    expect(reads).toHaveLength(2);
    expect(reads.find((read) => read.memoryId === legacy.id)?.provenanceState).toBe(
      'legacy_unknown',
    );
    expect(reads.find((read) => read.memoryId === verified.id)?.provenanceState).toBe('known');
    expect(reads.at(0)?.selectedForInjection).toBe(true);
    expect(reads.at(0)?.replayedViaRunIds).toEqual([]);
    expect(repository.listReads(runId).map((record) => record.id)).toContain(legacy.id);

    // 直接注入与历史继承同时成立：合并标记而不是再写一行，也不覆盖已成立的注入事实。
    repository.recordReads([
      {
        runId,
        memory: verified,
        capturedAt: 1_700_000_000_500,
        selectedForInjection: false,
        replayedViaRunIds: [replayedRunId],
      },
    ]);
    const merged = repository.listMemoryReads(runId);
    expect(merged).toHaveLength(2);
    const mergedVerified = merged.find((read) => read.memoryId === verified.id);
    expect(mergedVerified?.selectedForInjection).toBe(true);
    expect(mergedVerified?.replayedViaRunIds).toEqual([replayedRunId]);

    expect(() =>
      repository.recordReads([
        { runId, memory: { ...legacy, contentHash: sha256Hex('伪造正文') }, capturedAt: 3 },
      ]),
    ).toThrow(/记忆内容哈希不一致/u);

    const foreign = seedMemory(
      repository,
      { kind: 'workspace', workspaceId: seedWorkspace(store, '外部空间') },
      '别的空间的记忆',
    );
    expect(() => repository.recordReads([{ runId, memory: foreign, capturedAt: 9 }])).toThrow(
      /记忆范围不适用于该 Run/u,
    );

    const lapsed = seedMemory(repository, { kind: 'workspace', workspaceId }, '失效记忆', {
      validUntil: 1_700_000_000_000,
    });
    expect(() =>
      repository.recordReads([{ runId, memory: lapsed, capturedAt: 1_700_000_000_100 }]),
    ).toThrow(/只能记录运行实际注入的有效记忆/u);
    expect(repository.listMemoryReads(runId)).toHaveLength(2);
  });

  it('pre-checks parent deletion impact instead of letting history cascade away', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '被引用空间');
    const expertId = seedExpert(store);
    const runId = seedRun(store, workspaceId);
    const scope: MemoryScope = { kind: 'workspace', workspaceId };

    const referenced = seedMemory(repository, scope, '被历史引用过的口径');
    repository.recordReads([{ runId, memory: referenced, capturedAt: 1_700_000_000_000 }]);

    const impact = repository.assessWorkspaceDeletionImpact(workspaceId);
    expect(impact).toMatchObject({
      parentKind: 'workspace',
      parentId: workspaceId,
      blocking: true,
    });
    expect(impact.cascadedRevisionCount).toBe(1);
    expect(impact.historyReferencedRevisionCount).toBe(1);
    expect(impact.sampleRevisionIds).toEqual([referenced.revisionId]);

    // 替代留下的精确引用同样算历史引用：被指向的修订也删不掉。
    const winner = seedMemory(repository, scope, '现行口径');
    const loser = seedMemory(repository, scope, '旧口径');
    const replacement = repository.replace({
      winnerId: winner.id,
      winnerExpectedRevision: 1,
      loserId: loser.id,
      loserExpectedRevision: 1,
    });
    expect(replacement.loser.replacesRevisionId).toBe(winner.revisionId);
    const afterReplace = repository.assessWorkspaceDeletionImpact(workspaceId);
    expect(afterReplace.blocking).toBe(true);
    expect(afterReplace.cascadedRevisionCount).toBe(4);
    expect(afterReplace.historyReferencedRevisionCount).toBe(2);

    const quietWorkspaceId = seedWorkspace(store, '无引用空间');
    seedMemory(
      repository,
      { kind: 'workspace', workspaceId: quietWorkspaceId },
      '只有本空间的记忆',
    );
    const quiet = repository.assessWorkspaceDeletionImpact(quietWorkspaceId);
    expect(quiet.blocking).toBe(false);
    expect(quiet.cascadedRevisionCount).toBe(1);
    expect(quiet.historyReferencedRevisionCount).toBe(0);
    expect(quiet.sampleRevisionIds).toEqual([]);
    expect(repository.assessWorkspaceDeletionImpact('ws-ghost').blocking).toBe(false);

    const expertMemory = seedMemory(repository, { kind: 'expert', expertId }, '专家现行口径');
    const expertLoser = seedMemory(repository, { kind: 'expert', expertId }, '专家旧口径');
    repository.replace({
      winnerId: expertMemory.id,
      winnerExpectedRevision: 1,
      loserId: expertLoser.id,
      loserExpectedRevision: 1,
    });
    const expertImpact = repository.assessExpertDeletionImpact(expertId);
    expect(expertImpact.parentKind).toBe('expert');
    expect(expertImpact.blocking).toBe(true);
    expect(expertImpact.cascadedRevisionCount).toBe(3);
    expect(expertImpact.historyReferencedRevisionCount).toBe(1);
  });

  it('exposes memory dependencies only where provenance can prove them', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '依赖空间');
    const scope: MemoryScope = { kind: 'workspace', workspaceId };

    const base = seedMemory(repository, scope, '基础口径');
    const derived: MemoryProvenance = {
      schemaVersion: 1,
      verification: 'verified',
      authority: 'derived',
      capturedAt: 1_700_000_000_000,
      sources: [
        {
          kind: 'run-assistant',
          runId: randomUUID(),
          eventId: randomUUID(),
          contentHash: sha256Hex('助手回答'),
          start: 0,
          end: codePoints('助手回答'),
          excerpt: '助手回答',
          excerptHash: sha256Hex('助手回答'),
        },
      ],
      materialDependencies: [],
      memoryDependencies: [
        { memoryId: base.id, revisionId: base.revisionId, contentHash: base.contentHash },
      ],
      originWorkspaceId: workspaceId,
    };
    const child = seedMemory(repository, scope, '由基础口径推出的结论', { provenance: derived });
    expect(repository.listMemoryDependencies(child.revisionId)).toEqual([
      { memoryId: base.id, revisionId: base.revisionId, contentHash: base.contentHash },
    ]);
    // legacy 没有可证的依赖事实：返回空而不是猜一个。
    expect(repository.listMemoryDependencies(base.revisionId)).toEqual([]);
    expect(repository.listMemoryDependencies('revision-ghost')).toEqual([]);

    // 摘要形状由协议把住：伪造的依赖哈希进不了库。
    expect(() =>
      seedMemory(repository, scope, '伪造依赖的结论', {
        provenance: {
          ...derived,
          memoryDependencies: [
            { memoryId: base.id, revisionId: base.revisionId, contentHash: 'not-a-digest' },
          ],
        },
      }),
    ).toThrow();
    expect(repository.get(base.id)?.revision).toBe(1);
  });

  it('rejects writes that would break the scope or validity invariants', () => {
    const store = openStore();
    const repository = store.memories;
    const workspaceId = seedWorkspace(store, '校验空间');

    expect(() =>
      seedMemory(repository, { kind: 'workspace', workspaceId: 'ws-ghost' }, '悬空空间'),
    ).toThrow(/工作空间不存在/u);
    expect(() =>
      seedMemory(repository, { kind: 'expert', expertId: 'expert-ghost' }, '悬空专家'),
    ).toThrow(/专家不存在/u);
    expect(() =>
      seedMemory(repository, { kind: 'workspace', workspaceId }, '倒置有效期', {
        validFrom: 2_000,
        validUntil: 1_000,
      }),
    ).toThrow(/有效期结束时间/u);
    expect(repository.getRevision('missing-revision')).toBeUndefined();
    expect(repository.get('missing-memory')).toBeUndefined();
    expect(() =>
      repository.update({
        id: 'missing-memory',
        expectedRevision: 1,
        patch: { content: '幽灵写入' },
        normalizedHash: digestOf('幽灵写入'),
      }),
    ).toThrow(MemoryValidationError);
    // 空 patch 在协议边界就被 memoryEditPatchSchema 拒掉；仓储层按 §5.2 只回 unchanged，不落空修订。
    const untouched = seedMemory(repository, { kind: 'workspace', workspaceId }, '待改记录');
    expect(repository.update({ id: untouched.id, expectedRevision: 1, patch: {} }).effect).toBe(
      'unchanged',
    );
    expect(repository.get(untouched.id)?.revision).toBe(1);
    // 只改一侧端点也要满足有效区间：投影后的窗口同样受校验。
    expect(() =>
      repository.update({
        id: seedMemory(repository, { kind: 'workspace', workspaceId }, '带窗口记录', {
          validUntil: 1_000,
        }).id,
        expectedRevision: 1,
        patch: { validFrom: { action: 'set', value: 5_000 } },
      }),
    ).toThrow(/有效期结束时间/u);
  });
});
