import { createHash, randomUUID } from 'node:crypto';

import {
  type ExpertRevisionDraft,
  type MaterialReference,
  type MemoryFacet,
  type MemoryProvenance,
  type MemoryScope,
  type MemorySourceRef,
  type MemorySourceSelector,
  type WorkspaceBrief,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { AppStore } from '../persistence';
import { normalizedMemoryHash } from './memory-content-policy';
import { buildLegacyProvenance, resolveMemorySourceSelector } from './memory-provenance';
import { createStoreProvenanceReader } from './memory-provenance-reader';
import { createStoreBriefReader } from './workspace-brief-reader';
import type { BriefReader, BriefSourceAvailability } from './workspace-brief-service';
import { WorkspaceBriefService } from './workspace-memory-brief-service';

const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const codePoints = (value: string): number => [...value].length;

const T0 = 1_700_000_000_000;
const NOW = T0 + 60_000;
const PROMPT = '请按回款口径核对上季度收入。';
const SECTION_LIMIT = 10;
const REFERENCE_LIMIT = 5;

const workspaceScope = (workspaceId: string): MemoryScope => ({ kind: 'workspace', workspaceId });

/** verified 分支的正文/摘录哈希必须自证，因此夹具一律经真实解析器构造，不手写哈希。 */
const verifiedProvenance = (
  source: MemorySourceRef,
  materials: readonly MaterialReference[] = [],
): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'verified',
  authority: materials.length > 0 ? 'derived' : 'user-instruction',
  capturedAt: T0,
  sources: [source],
  materialDependencies: [...materials],
  memoryDependencies: [],
});

const selectorSource = (store: AppStore, selector: MemorySourceSelector): MemorySourceRef => {
  const reader = createStoreProvenanceReader(store);
  // 夹具与被测记录同属一个真实工作空间：范围核对用来源实体自己所属的空间。
  const workspaceId =
    selector.kind === 'run-user' || selector.kind === 'run-assistant'
      ? reader.runWorkspace(selector.runId)
      : undefined;
  const resolved = resolveMemorySourceSelector(selector, reader, { workspaceId });
  if (!resolved.ok) throw new Error(`夹具来源解析失败：${resolved.message}`);
  return resolved.value.source;
};

/** 事件已不在该 Run 的登记序列里：等价于「源失效」，简报必须据此降级。 */
const lostEventProvenance = (runId: string, excerpt: string): MemoryProvenance =>
  verifiedProvenance({
    kind: 'run-assistant',
    runId,
    eventId: 'event-pruned',
    contentHash: sha(excerpt),
    excerpt,
    excerptHash: sha(excerpt),
    start: 0,
    end: codePoints(excerpt),
  });

const expertDraft = (name: string): ExpertRevisionDraft => ({
  name,
  summary: '按公司规则完成经营分析',
  identity: '你负责经营分析和报告交付。',
  principles: ['先核对口径，再分析数据'],
  inputRequirements: ['本期经营数据'],
  deliveryRequirements: ['交付带来源的报告'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

interface Fixture {
  store: AppStore;
  service: WorkspaceBriefService;
  reader: BriefReader;
  workspaceId: string;
  taskId: string;
  runId: string;
  /** 本空间内仍可定位到已登记 Run 提问的来源。 */
  provenance: MemoryProvenance;
}

const openFixture = (label: string): Fixture => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspaceId = store.workspaces.getOrCreate(
    `/tmp/workspace-memory-brief/${label}`,
    label,
  ).id;
  const task = store.tasks.create(workspaceId, label, '验证简报口径');
  const runId = randomUUID();
  store.runs.create({
    id: runId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: PROMPT,
    status: 'completed',
    createdAt: T0,
  });
  return {
    store,
    service: new WorkspaceBriefService({ store, now: () => NOW }),
    reader: createStoreBriefReader(store),
    workspaceId,
    taskId: task.task.id,
    runId,
    provenance: verifiedProvenance(
      selectorSource(store, { kind: 'run-user', runId, start: 0, end: codePoints(PROMPT) }),
    ),
  };
};

interface SeedOptions {
  facet?: MemoryFacet;
  provenance?: MemoryProvenance;
  status?: 'confirmed' | 'candidate';
  validFrom?: number;
  validUntil?: number;
  createdAt?: number;
}

/** 直接经仓储写入：服务层写入会附带投影文件，简报夹具只需要记忆事实本身。 */
const seedMemory = (
  store: AppStore,
  scope: MemoryScope,
  content: string,
  options: SeedOptions = {},
): string =>
  store.memories.create({
    scope,
    content,
    facet: options.facet ?? 'constraint',
    normalizedHash: normalizedMemoryHash(content),
    provenance: options.provenance ?? buildLegacyProvenance({ sourceType: 'user-explicit' }),
    confidence: 1,
    status: options.status ?? 'confirmed',
    ...(options.validFrom === undefined ? {} : { validFrom: options.validFrom }),
    ...(options.validUntil === undefined ? {} : { validUntil: options.validUntil }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  }).record.id;

interface PinnedVersion {
  artifactId: string;
  versionId: string;
  contentHash: string;
}

const saveArtifactVersion = (store: AppStore, taskId: string, seed: string): PinnedVersion => {
  const content = `第 ${seed} 版收入确认口径说明。`;
  const artifact = store.artifacts.saveMarkdown({
    taskId,
    origin: 'user-edit',
    title: `成果 ${seed}`,
    content,
  });
  return {
    artifactId: artifact.id,
    versionId: artifact.currentVersionId,
    contentHash: sha(content),
  };
};

const pinReference = (
  store: AppStore,
  workspaceId: string,
  version: PinnedVersion,
  selectedAt: number,
): string =>
  store.workspaceReferences.set({
    workspaceId,
    artifactVersionId: version.versionId,
    expectedRevision: 0,
    at: selectedAt,
  }).reference.id;

const briefOf = async (fixture: Fixture, expertId?: string): Promise<WorkspaceBrief> => {
  const result = await fixture.service.get({
    workspaceId: fixture.workspaceId,
    ...(expertId === undefined ? {} : { expertId }),
  });
  if (!result.ok) {
    throw new Error(`简报查询失败：${result.error.code} ${result.error.message}`);
  }
  return result.data;
};

describe('工作空间简报（仓储读取器＋服务）', () => {
  it('确认区只收本空间当前有效、verified 且来源仍可用的 confirmed 记录', async () => {
    const fixture = openFixture('确认区口径');
    const { store, workspaceId, provenance } = fixture;
    const foreign = store.workspaces.getOrCreate(
      '/tmp/workspace-memory-brief/外来空间',
      '外来空间',
    );
    const included = seedMemory(store, workspaceScope(workspaceId), '收入按回款金额统计。', {
      provenance,
    });

    seedMemory(store, workspaceScope(foreign.id), '外来空间的口径不该出现。', { provenance });
    seedMemory(store, { kind: 'user' }, '用户偏好中文交付，不是本空间事实。', {
      provenance,
      facet: 'preference',
    });
    seedMemory(store, workspaceScope(workspaceId), '候选结论尚未确认。', {
      provenance,
      status: 'candidate',
    });
    seedMemory(store, workspaceScope(workspaceId), '已过期的口径不再成立。', {
      provenance,
      validUntil: NOW,
    });
    seedMemory(store, workspaceScope(workspaceId), '下季度才生效的口径。', {
      provenance,
      validFrom: NOW + 1,
    });
    seedMemory(store, workspaceScope(workspaceId), 'legacy 记录来源尚未复核。');

    const brief = await briefOf(fixture);
    expect(brief.workspaceId).toBe(workspaceId);
    expect(brief.generatedAt).toBe(NOW);
    expect(brief.constraints.items.map((item) => item.memoryId)).toEqual([included]);
    expect(brief.constraints.total).toBe(1);
    expect(brief.goals.items).toEqual([]);
    expect(brief.decisions.total).toBe(0);
    expect(brief.openIssues.total).toBe(0);
    expect(brief.referenceVersions.total).toBe(0);
  });

  it('把待复核与源失效分别判定成各自身份，不折叠成可用', () => {
    const { store, workspaceId, runId, provenance, reader } = openFixture('来源可用性判定');
    seedMemory(store, workspaceScope(workspaceId), 'legacy 待复核。', { facet: 'goal' });
    seedMemory(store, workspaceScope(workspaceId), '来源事件已被清理。', {
      provenance: lostEventProvenance(runId, '上季度按回款确认收入。'),
      facet: 'fact',
    });
    seedMemory(store, workspaceScope(workspaceId), '来源仍在。', { provenance, facet: 'decision' });

    const availability = new Map<string, BriefSourceAvailability>(
      reader.confirmedMemories(workspaceId).map((row) => [row.content, row.sourceAvailability]),
    );
    expect(availability.get('legacy 待复核。')).toBe('review-required');
    expect(availability.get('来源事件已被清理。')).toBe('unavailable');
    expect(availability.get('来源仍在。')).toBe('available');
  });

  it('资料派生条目仍进入简报，但标明使用时仍需材料且不因此获得授权', async () => {
    const fixture = openFixture('材料派生条目');
    const { store, workspaceId, runId, taskId } = fixture;
    const version = saveArtifactVersion(store, taskId, '甲');
    const material: MaterialReference = {
      kind: 'artifact-version',
      artifactId: version.artifactId,
      artifactVersionId: version.versionId,
      contentHash: version.contentHash,
      originWorkspaceId: workspaceId,
    };
    const derived = seedMemory(store, workspaceScope(workspaceId), '毛利率同比提升两个百分点。', {
      provenance: verifiedProvenance(
        selectorSource(store, { kind: 'run-user', runId, start: 0, end: codePoints(PROMPT) }),
        [material],
      ),
      facet: 'fact',
    });

    const brief = await briefOf(fixture);
    expect(brief.decisions.items.map((item) => item.memoryId)).toEqual([derived]);
    expect(brief.decisions.items[0]).toMatchObject({
      requiresMaterialSelection: true,
      sourceAvailability: 'available',
    });
  });

  it('只有为该专家装配简报时才叠加 expert-workspace 记录', async () => {
    const fixture = openFixture('专家叠加范围');
    const { store, workspaceId, provenance } = fixture;
    const expertId = store.experts.create({
      sourceKind: 'user',
      revision: expertDraft('经营分析专家'),
    }).id;
    const workspaceRow = seedMemory(store, workspaceScope(workspaceId), '本空间通用口径。', {
      provenance,
      createdAt: T0 + 1,
    });
    const pairedRow = seedMemory(
      store,
      { kind: 'expert-workspace', expertId, workspaceId },
      '这位专家在本空间的约定。',
      { provenance, createdAt: T0 + 2 },
    );
    seedMemory(store, { kind: 'expert', expertId }, '专家的通用方法不进项目事实。', {
      provenance,
      facet: 'method',
    });

    const plain = await briefOf(fixture);
    expect(plain.expertId).toBeUndefined();
    expect(plain.constraints.items.map((item) => item.memoryId)).toEqual([workspaceRow]);

    const selected = await briefOf(fixture, expertId);
    expect(selected.expertId).toBe(expertId);
    expect(selected.constraints.items.map((item) => item.memoryId)).toEqual([
      pairedRow,
      workspaceRow,
    ]);
    expect(selected.methods.items).toEqual([]);
  });

  it('开放节点只取本空间未决项，被替代与外来空间的节点都不出现', async () => {
    const fixture = openFixture('开放讨论节点');
    const { store, taskId, runId } = fixture;
    const superseded = store.discussionCheckpoints.create(taskId, {
      id: randomUUID(),
      taskId,
      runId,
      stage: 'report-outline',
      title: '续约口径待确认',
      summary: '续约收入是否按期间分摊仍未决。',
      feedback: '先按回款口径。',
      nextAction: '补去年数据',
      artifactVersionIds: [],
    });
    const latest = store.discussionCheckpoints.create(taskId, {
      id: randomUUID(),
      taskId,
      stage: 'report',
      title: '后续节点',
      summary: '已按期间分摊达成一致。',
      artifactVersionIds: [],
      supersedesId: superseded.id,
    });
    const foreignTask = store.tasks.create(
      store.workspaces.getOrCreate('/tmp/workspace-memory-brief/另一空间', '另一空间').id,
      '外来任务',
      '不属于本空间',
    ).task;
    store.discussionCheckpoints.create(foreignTask.id, {
      id: randomUUID(),
      taskId: foreignTask.id,
      stage: 'understanding',
      title: '外来开放节点',
      summary: '外来空间的未决问题。',
      artifactVersionIds: [],
    });

    const brief = await briefOf(fixture);
    expect(brief.openIssues.total).toBe(1);
    expect(brief.openIssues.items.map((item) => item.checkpointId)).toEqual([latest.id]);
    expect(brief.openIssues.items[0]).toMatchObject({ taskId });
    expect(brief.openIssues.items.some((item) => item.checkpointId === superseded.id)).toBe(false);
  });

  it('未决节点保留 feedback 与 nextAction 原标识，不推断成已确认结论', async () => {
    const fixture = openFixture('开放节点字段');
    const { store, taskId, runId } = fixture;
    const checkpoint = store.discussionCheckpoints.create(taskId, {
      id: randomUUID(),
      taskId,
      runId,
      stage: 'research-complete',
      title: '成本分摊待确认',
      summary: '分摊规则仍有两种口径。',
      feedback: '不含一次性费用。',
      nextAction: '找财务确认',
      artifactVersionIds: [],
    });

    const brief = await briefOf(fixture);
    expect(brief.openIssues.items).toHaveLength(1);
    expect(brief.openIssues.items[0]).toMatchObject({
      checkpointId: checkpoint.id,
      feedback: '不含一次性费用。',
      nextAction: '找财务确认',
    });
    expect(brief.openIssues.items[0]).not.toHaveProperty('resolved');
    expect(brief.decisions.total).toBe(0);
  });

  it('参考区按 selectedAt 倒序取用 active 标记，取消后的标记不再出现', async () => {
    const fixture = openFixture('参考区');
    const { store, workspaceId, taskId } = fixture;
    const older = saveArtifactVersion(store, taskId, '甲');
    const newer = saveArtifactVersion(store, taskId, '乙');
    const olderId = pinReference(store, workspaceId, older, T0 + 1);
    const newerId = pinReference(store, workspaceId, newer, T0 + 2);

    const brief = await briefOf(fixture);
    expect(brief.referenceVersions.items.map((item) => item.reference.id)).toEqual([
      newerId,
      olderId,
    ]);
    expect(brief.referenceVersions.items[1]).toMatchObject({
      artifactId: older.artifactId,
      status: 'ready',
    });

    store.workspaceReferences.remove({ id: olderId, expectedRevision: 1 });
    const after = await briefOf(fixture);
    expect(after.referenceVersions.items.map((item) => item.reference.id)).toEqual([newerId]);
    expect(after.referenceVersions.total).toBe(1);
    expect(after.referenceVersions.truncated).toBe(false);
  });

  it('各区按上限截断并如实报告 total，不假装完整', async () => {
    const fixture = openFixture('截断口径');
    const { store, workspaceId, provenance, taskId } = fixture;
    for (let index = 0; index < SECTION_LIMIT + 2; index += 1) {
      seedMemory(store, workspaceScope(workspaceId), `第 ${index} 条约束口径。`, {
        provenance,
        createdAt: T0 + index,
      });
    }
    for (let index = 0; index < REFERENCE_LIMIT + 2; index += 1) {
      pinReference(
        store,
        workspaceId,
        saveArtifactVersion(store, taskId, `参考${index}`),
        T0 + index,
      );
    }

    const brief = await briefOf(fixture);
    expect(brief.constraints.items).toHaveLength(SECTION_LIMIT);
    expect(brief.constraints.total).toBe(SECTION_LIMIT + 2);
    expect(brief.constraints.truncated).toBe(true);
    // updatedAt 倒序：最新一条在最前，被截断的是最旧的两条。
    expect(brief.constraints.items[0]?.content).toBe(`第 ${SECTION_LIMIT + 1} 条约束口径。`);
    expect(brief.constraints.items.at(-1)?.content).toBe(`第 2 条约束口径。`);
    expect(brief.referenceVersions.items).toHaveLength(REFERENCE_LIMIT);
    expect(brief.referenceVersions.total).toBe(REFERENCE_LIMIT + 2);
    expect(brief.referenceVersions.truncated).toBe(true);
  });

  it('是可重建视图：新事实当场生效，读取本身不落任何库', async () => {
    const fixture = openFixture('可重建视图');
    const { store, workspaceId, provenance, taskId } = fixture;
    const countActive = (): number => store.workspaceReferences.countActive(workspaceId);
    const listMemories = (): number => store.memories.list({ includeCandidates: true }).length;

    const before = await briefOf(fixture);
    expect(before.constraints.total).toBe(0);
    const memoriesBefore = listMemories();
    const referencesBefore = countActive();

    seedMemory(store, workspaceScope(workspaceId), '新增的确认口径。', { provenance });
    pinReference(store, workspaceId, saveArtifactVersion(store, taskId, '丙'), T0 + 5);

    const after = await briefOf(fixture);
    expect(after.constraints.items.map((item) => item.content)).toEqual(['新增的确认口径。']);
    expect(after.referenceVersions.total).toBe(1);

    // 读取简报既新增记忆行，也不改动参考标记数量。
    expect(listMemories()).toBe(memoriesBefore + 1);
    expect(countActive()).toBe(referencesBefore + 1);
    expect(await briefOf(fixture)).toEqual(after);
  });

  it('未知工作空间回答 NOT_FOUND，而不是给出一份空简报', async () => {
    const fixture = openFixture('未知空间');
    const result = await fixture.service.get({ workspaceId: 'workspace-does-not-exist' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('底层读取失败返回可重试的 STORAGE_ERROR，不伪造旧简报', async () => {
    const fixture = openFixture('读取失败');
    const failing: BriefReader = {
      confirmedMemories: () => {
        throw new Error('模拟数据库读取失败');
      },
      openCheckpoints: () => [],
      activeReferences: () => [],
    };
    const service = new WorkspaceBriefService({ store: fixture.store, reader: failing });

    const result = await service.get({ workspaceId: fixture.workspaceId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'STORAGE_ERROR', retryable: true });
    // 失败摘要不得回显内部异常文本。
    expect(result.error.message).not.toContain('模拟数据库读取失败');
  });

  it('数据不符合契约时映射为 INTERNAL_ERROR，不当成可重试的存储故障', async () => {
    const fixture = openFixture('契约不符');
    const broken: BriefReader = {
      confirmedMemories: () => [
        {
          memoryId: 'm-1',
          revisionId: 'r-1',
          contentHash: 'not-a-sha256',
          content: '正文完好但哈希不合契约。',
          facet: 'constraint',
          scope: workspaceScope(fixture.workspaceId),
          updatedAt: T0,
          sourceAvailability: 'available',
          requiresMaterialSelection: false,
        },
      ],
      openCheckpoints: () => [],
      activeReferences: () => [],
    };
    const service = new WorkspaceBriefService({ store: fixture.store, reader: broken });

    const result = await service.get({ workspaceId: fixture.workspaceId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
  });

  it('入参不合协议时由协议错误拒绝，不降级成空简报', async () => {
    const fixture = openFixture('非法入参');
    await expect(fixture.service.get({ workspaceId: '' })).rejects.toBeInstanceOf(ZodError);
  });

  it('已确认记录的来源消失后简报当场收缩，不留残余条目', async () => {
    const fixture = openFixture('源失效后重建');
    const { store, workspaceId, provenance, runId } = fixture;
    const kept = seedMemory(store, workspaceScope(workspaceId), '来源仍在的口径。', { provenance });
    expect((await briefOf(fixture)).constraints.total).toBe(1);

    const lost = seedMemory(store, workspaceScope(workspaceId), '来源已不存在的口径。', {
      provenance: lostEventProvenance('run-pruned', '已经不存在的回答。'),
    });
    const rebuilt = await briefOf(fixture);
    expect(rebuilt.constraints.total).toBe(1);
    expect(rebuilt.constraints.items.map((item) => item.memoryId)).toEqual([kept]);
    expect(rebuilt.constraints.items.map((item) => item.memoryId)).not.toContain(lost);
    // 判定只看来源实体本身：换一个仍在的 Run 作为来源即可恢复可见。
    const revived = seedMemory(store, workspaceScope(workspaceId), '重新登记来源的口径。', {
      provenance: verifiedProvenance(
        selectorSource(store, { kind: 'run-user', runId, start: 0, end: codePoints(PROMPT) }),
      ),
    });
    expect((await briefOf(fixture)).constraints.total).toBe(2);
    expect((await briefOf(fixture)).constraints.items.map((item) => item.memoryId)).toContain(
      revived,
    );
  });
});
