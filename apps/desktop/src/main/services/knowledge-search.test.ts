import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { abortError, isAbortError } from '@betterwork/agent-core';
import type {
  EmbeddingModelSnapshot,
  KnowledgeMaterialReference,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import type { EmbeddingRequest, EmbeddingResult } from './embedding-client';
import { type EmbeddingRunner } from './knowledge-index-service';
import {
  KnowledgeSearchService,
  type KnowledgeSearchServiceDeps,
  tokenizeQuery,
} from './knowledge-search';
import { sha256Hex } from './knowledge-text';
import { KnowledgeVault } from './knowledge-vault';
import type { WorkerScanRequest } from './knowledge-worker-runner';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

const fingerprint = (seed: string): string => seed.repeat(2).slice(0, 64);
const modelFingerprint = fingerprint('f1');

const snapshotOf = (profileId: string): EmbeddingModelSnapshot => ({
  profileId,
  provider: 'openai-compatible',
  endpointFingerprint: fingerprint('e1'),
  model: 'embed-v1',
  modelFingerprint,
});

interface StubOptions {
  queryVector?: ((query: string) => number[]) | undefined;
  embedError?: Error | undefined;
  beforeEmbed?: (() => Promise<void> | void) | undefined;
  snapshotThrows?: boolean | undefined;
}

/** 查询嵌入替身：只服务查询向量化；测试绝不触网。 */
const createStub = (options: StubOptions = {}) => {
  const calls: string[][] = [];
  const runner: EmbeddingRunner = {
    defaultSnapshot: () => {
      if (options.snapshotThrows) throw new Error('没有配置的嵌入模型');
      return snapshotOf('profile-1');
    },
    snapshotOf: (profileId) => {
      if (options.snapshotThrows) throw new Error('嵌入模型配置不可用');
      return snapshotOf(profileId);
    },
    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (request.signal.aborted) throw abortError();
      if (options.beforeEmbed) await options.beforeEmbed();
      if (request.signal.aborted) throw abortError();
      if (options.embedError) throw options.embedError;
      calls.push([...request.inputs]);
      const vectors = request.inputs.map((input) =>
        Float32Array.from(options.queryVector?.(input) ?? [0, 0, 1]),
      );
      return { vectors, dimension: vectors[0]?.length ?? 0 };
    },
  };
  return { runner, calls };
};

/** 与 Worker 语义一致的内存点积扫描（单位向量即余弦）。 */
const dotScan = async (
  request: WorkerScanRequest,
): Promise<Array<{ chunkId: string; score: number }>> =>
  request.entries.map((entry) => {
    let score = 0;
    for (let index = 0; index < request.dimension; index += 1) {
      score += (request.query[index] ?? 0) * (entry.vector[index] ?? 0);
    }
    return { chunkId: entry.chunkId, score };
  });

const makeHarness = async (
  documents: Record<string, string>,
  overrides: {
    runMaterials?: KnowledgeSearchServiceDeps['runMaterials'];
    scan?: KnowledgeSearchServiceDeps['scan'];
  } & StubOptions = {},
) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'betterwork-search-'));
  const vault = new KnowledgeVault(':memory:');
  const stub = createStub(overrides);
  const documentIds = new Map<string, string>();
  const revisionIds = new Map<string, string>();
  const references = new Map<string, KnowledgeMaterialReference>();
  for (const [name, body] of Object.entries(documents)) {
    const sourcePath = path.join(directory, `${name}.md`);
    await writeFile(sourcePath, body);
    await vault.importPaths([sourcePath]);
    const document = vault.listDocuments().find((entry) => entry.sourcePath === sourcePath);
    if (!document) throw new Error(`fixture document missing: ${name}`);
    const revision = vault.listRevisions(document.id)[0];
    if (!revision) throw new Error(`fixture revision missing: ${name}`);
    documentIds.set(name, document.id);
    revisionIds.set(name, revision.id);
    references.set(name, {
      kind: 'knowledge-revision',
      knowledgeDocumentId: document.id,
      knowledgeRevisionId: revision.id,
      contentHash: revision.contentHash,
      sourcePath: revision.sourcePath,
    });
  }
  cleanup.push(async () => {
    vault.close();
    await rm(directory, { recursive: true, force: true });
  });
  const service = new KnowledgeSearchService({
    vault,
    index: vault.index,
    runMaterials: overrides.runMaterials ?? (() => []),
    embedding: stub.runner,
    scan: 'scan' in overrides ? overrides.scan : dotScan,
  });
  const enableSemantic = (): void => {
    vault.index.saveSettings({
      expectedRevision: vault.index.settings().revision,
      semanticEnabled: true,
      embeddingProfileId: 'profile-1',
    });
  };
  /** 走正式的租约 API 直发一个修订的向量代次（与索引服务发布路径同一约束）。 */
  const publishVectors = (name: string, vectors: readonly number[][]): void => {
    const documentId = documentIds.get(name);
    const revisionId = revisionIds.get(name);
    if (!documentId || !revisionId) throw new Error('fixture revision missing');
    const index = vault.index;
    const chunks = index.retrievalChunks(revisionId);
    if (chunks.length === 0 || chunks.length !== vectors.length) {
      throw new Error('向量数量必须与派生块一致');
    }
    const dimension = vectors[0]?.length ?? 0;
    const space = index.ensureCurrentSpace(modelFingerprint);
    if (index.lockDimension(space.id, dimension) === 'conflict') {
      throw new Error('fixture 维度冲突');
    }
    const generation = index.createStagingGeneration({
      revisionId,
      textHash: chunks[0]?.textHash ?? '',
      spaceId: space.id,
      modelSnapshot: snapshotOf('profile-1'),
      chunkingVersion: chunks[0]?.chunkingVersion ?? '',
      chunkCount: chunks.length,
    });
    index.addStagingVectors(
      generation.id,
      chunks.map((chunk, ordinal) => ({
        chunkId: chunk.id,
        chunkHash: chunk.contentHash,
        vector: Float32Array.from(vectors[ordinal] ?? []),
      })),
    );
    index.publishGeneration({
      generationId: generation.id,
      expect: {
        revisionId,
        textHash: chunks[0]?.textHash ?? '',
        spaceId: space.id,
        modelFingerprint,
        dimension,
        chunkingVersion: chunks[0]?.chunkingVersion ?? '',
        registeredRevisionId: vault.registeredRevisionId(documentId) ?? revisionId,
      },
    });
  };
  return { vault, service, stub, references, enableSemantic, publishVectors, directory };
};

const libraryScope = { kind: 'library' } as const;

describe('tokenizeQuery（契约 §9.1.3）', () => {
  it('NFKC＋大小写＋标点空白切分并去重保序', () => {
    expect(tokenizeQuery('  Ｒｅｖｅｎue, revenue！增长?  ')).toEqual(['revenue', '增长']);
  });
});

describe('KnowledgeSearchService 范围与模式（契约 §9.1.1/§9.2）', () => {
  it('空选材与无快照 Run 都是空结果：零模型调用、不回退全库', async () => {
    const harness = await makeHarness(
      { 材料: 'revenue 增长复盘' },
      { runMaterials: (runId) => (runId === 'run-none' ? undefined : []) },
    );
    harness.enableSemantic();
    const empty = await harness.service.search({
      scope: { kind: 'run', runId: 'run-empty' },
      query: 'revenue',
    });
    expect(empty.results).toEqual([]);
    expect(empty.coverage).toEqual({ eligibleChunks: 0, indexedChunks: 0 });
    const noSnapshot = await harness.service.search({
      scope: { kind: 'run', runId: 'run-none' },
      query: 'revenue',
    });
    expect(noSnapshot.results).toEqual([]);
    expect(harness.stub.calls).toEqual([]);
  });

  it('Run 范围只命中所选修订，未选资料不占结果名额', async () => {
    const harness = await makeHarness({ 甲: 'revenue alpha report', 乙: 'revenue beta memo' });
    const reference = harness.references.get('甲');
    if (!reference) throw new Error('fixture reference missing');
    // 宿主快照只登记了甲：乙即使内容同样命中也不得出现
    const scoped = new KnowledgeSearchService({
      vault: harness.vault,
      index: harness.vault.index,
      runMaterials: () => [reference],
      embedding: harness.stub.runner,
      scan: dotScan,
    });
    const response = await scoped.search({
      scope: { kind: 'run', runId: 'run-x' },
      query: 'revenue',
    });
    expect(response.results.length).toBeGreaterThan(0);
    for (const hit of response.results) {
      expect(hit.reference.knowledgeRevisionId).toBe(reference.knowledgeRevisionId);
    }
    expect(harness.stub.calls).toEqual([]);
  });

  it('语义关闭时 hybrid 降级纯关键词：semantic-disabled 且不调用模型', async () => {
    const harness = await makeHarness({ 材料: 'revenue alpha report' });
    const response = await harness.service.search({ scope: libraryScope, query: 'revenue' });
    expect(response.requestedMode).toBe('hybrid');
    expect(response.effectiveMode).toBe('keyword');
    expect(response.degradedReason).toBe('semantic-disabled');
    expect(response.results[0]?.matchedBy).toBe('keyword');
    expect(response.coverage).toEqual({ eligibleChunks: 1, indexedChunks: 0 });
    expect(harness.stub.calls).toEqual([]);
  });

  it('显式 keyword 模式不产生降级理由，也不触碰嵌入', async () => {
    const harness = await makeHarness({ 材料: 'revenue alpha report' });
    harness.enableSemantic();
    const response = await harness.service.search({
      scope: libraryScope,
      query: 'revenue',
      mode: 'keyword',
    });
    expect(response.requestedMode).toBe('keyword');
    expect(response.effectiveMode).toBe('keyword');
    expect(response.degradedReason).toBeUndefined();
    expect(response.results).toHaveLength(1);
    expect(harness.stub.calls).toEqual([]);
  });
});

describe('KnowledgeSearchService 关键词与中文回退（契约 §9.1.4）', () => {
  it('FTS 分不出中文词时按子串回退，标题命中更多者排前', async () => {
    const harness = await makeHarness({
      季度报告: '客户续约风险与回款跟进安排。',
      续约跟进清单: '本文件说明续约与跟进的口径。',
    });
    const response = await harness.service.search({
      scope: libraryScope,
      query: '续约 跟进',
      mode: 'keyword',
    });
    expect(response.results.map((hit) => hit.title)).toEqual(['续约跟进清单', '季度报告']);
  });

  it('摘要 span 回算到整篇 section 坐标，excerpt 与 excerptHash 严格一致', async () => {
    const harness = await makeHarness({ 季度报告: '客户续约风险与回款跟进安排。' });
    const response = await harness.service.search({
      scope: libraryScope,
      query: '续约',
      mode: 'keyword',
    });
    const hit = response.results[0];
    if (!hit) throw new Error('expected one keyword hit');
    const revisionId = harness.references.get('季度报告')?.knowledgeRevisionId;
    const section = harness.vault.getRevision(revisionId ?? '')?.chunks[hit.span.sectionOrdinal];
    if (!section) throw new Error('fixture section missing');
    const text = Array.from(section.content).slice(hit.span.start, hit.span.end).join('');
    expect(text).toBe(hit.excerpt);
    expect(hit.excerptHash).toBe(sha256Hex(hit.excerpt));
  });
});

describe('KnowledgeSearchService 语义路与融合（契约 §9.2/§9.3）', () => {
  it('向量单独命中：effectiveMode 为 vector，摘要取块首且不谎报降级', async () => {
    const harness = await makeHarness(
      { 甲: 'alpha report about growth', 乙: 'beta memo about payment' },
      { queryVector: (query) => (query === '违约风险' ? [0, 1, 0] : [0, 0, 1]) },
    );
    harness.enableSemantic();
    harness.publishVectors('甲', [[1, 0, 0]]);
    harness.publishVectors('乙', [[0, 1, 0]]);
    const response = await harness.service.search({ scope: libraryScope, query: '违约风险' });
    expect(response.effectiveMode).toBe('vector');
    expect(response.degradedReason).toBeUndefined();
    expect(response.coverage).toEqual({ eligibleChunks: 2, indexedChunks: 2 });
    // 扫描在租约内不剪零分候选：得分降序，命中块在前
    expect(response.results.map((hit) => hit.title)).toEqual(['乙', '甲']);
    const hit = response.results[0];
    expect(hit?.matchedBy).toBe('vector');
    expect(hit?.excerpt).toBe('beta memo about payment');
    expect(hit?.excerptHash).toBe(sha256Hex(hit?.excerpt ?? ''));
  });

  it('两路融合：同块合并为 both，RRF 总分压过单路关键词排名', async () => {
    const harness = await makeHarness(
      { 甲: 'revenue alpha report', 乙: 'revenue beta memo' },
      { queryVector: (query) => (query === 'revenue' ? [0, 1, 0] : [0, 0, 1]) },
    );
    harness.enableSemantic();
    harness.publishVectors('乙', [[0, 1, 0]]);
    const response = await harness.service.search({ scope: libraryScope, query: 'revenue' });
    expect(response.effectiveMode).toBe('hybrid');
    expect(response.results.map((hit) => hit.title)).toEqual(['乙', '甲']);
    expect(response.results[0]?.matchedBy).toBe('both');
    expect(response.results[1]?.matchedBy).toBe('keyword');
    const ids = response.results.map((hit) => hit.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('部分覆盖：只有一个修订发布了代次时报 index-partial', async () => {
    const harness = await makeHarness({ 甲: 'revenue alpha', 乙: 'revenue beta' });
    harness.enableSemantic();
    harness.publishVectors('甲', [[1, 0, 0]]);
    const response = await harness.service.search({ scope: libraryScope, query: 'revenue' });
    expect(response.degradedReason).toBe('index-partial');
    expect(response.coverage).toEqual({ eligibleChunks: 2, indexedChunks: 1 });
    expect(response.effectiveMode).toBe('hybrid');
  });

  it('语义开启但没有任何已发布向量：index-missing 且不发起模型调用', async () => {
    const harness = await makeHarness({ 甲: 'revenue alpha' });
    harness.enableSemantic();
    const response = await harness.service.search({ scope: libraryScope, query: 'revenue' });
    expect(response.degradedReason).toBe('index-missing');
    expect(response.results[0]?.matchedBy).toBe('keyword');
    expect(harness.stub.calls).toEqual([]);
  });

  it('降级矩阵：模型不可用/嵌入失败/维度不符/无扫描通道都回到可解释关键词结果', async () => {
    const snapshotFailure = await makeHarness({ 甲: 'revenue alpha' }, { snapshotThrows: true });
    snapshotFailure.enableSemantic();
    snapshotFailure.publishVectors('甲', [[1, 0, 0]]);
    const unavailable = await snapshotFailure.service.search({
      scope: libraryScope,
      query: 'revenue',
    });
    expect(unavailable.degradedReason).toBe('model-unavailable');

    const embedFailure = await makeHarness(
      { 甲: 'revenue alpha' },
      { embedError: new Error('HTTP 500') },
    );
    embedFailure.enableSemantic();
    embedFailure.publishVectors('甲', [[1, 0, 0]]);
    const failed = await embedFailure.service.search({ scope: libraryScope, query: 'revenue' });
    expect(failed.degradedReason).toBe('embedding-failed');
    expect(failed.results).toHaveLength(1);

    const dimMismatch = await makeHarness({ 甲: 'revenue alpha' }, { queryVector: () => [1, 0] });
    dimMismatch.enableSemantic();
    dimMismatch.publishVectors('甲', [[1, 0, 0]]);
    const stale = await dimMismatch.service.search({ scope: libraryScope, query: 'revenue' });
    expect(stale.degradedReason).toBe('index-stale');

    const noScan = await makeHarness({ 甲: 'revenue alpha' }, { scan: undefined });
    noScan.enableSemantic();
    noScan.publishVectors('甲', [[1, 0, 0]]);
    const scanless = await noScan.service.search({ scope: libraryScope, query: 'revenue' });
    expect(scanless.degradedReason).toBe('embedding-failed');
  });
});

describe('KnowledgeSearchService 租约与取消（契约 §8.3/§9.2）', () => {
  it('强制重建退役旧空间后旧代次候选不再返回：新空间无向量报 index-missing', async () => {
    const harness = await makeHarness({ 甲: 'alpha report about growth' });
    harness.enableSemantic();
    harness.publishVectors('甲', [[1, 0, 0]]);
    harness.vault.index.resetCurrentSpace(modelFingerprint);
    const response = await harness.service.search({ scope: libraryScope, query: '违约风险' });
    expect(response.results).toEqual([]);
    expect(response.degradedReason).toBe('index-missing');
    expect(response.effectiveMode).toBe('keyword');
  });

  it('查询途中空间被替换：租约复核失败按 index-stale 降级，不返回旧向量候选', async () => {
    const harness = await makeHarness(
      { 甲: 'alpha report about growth' },
      {
        beforeEmbed: () => {
          harness.vault.index.resetCurrentSpace(modelFingerprint);
        },
      },
    );
    harness.enableSemantic();
    harness.publishVectors('甲', [[1, 0, 0]]);
    const response = await harness.service.search({ scope: libraryScope, query: '违约风险' });
    expect(response.degradedReason).toBe('index-stale');
    expect(response.results).toEqual([]);
  });

  it('用户取消必须是 abortError，而不是降级的关键词成功', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = await makeHarness({ 甲: 'revenue alpha' });
    harness.enableSemantic();
    harness.publishVectors('甲', [[1, 0, 0]]);
    try {
      await harness.service.search({
        scope: libraryScope,
        query: 'revenue',
        signal: controller.signal,
      });
      throw new Error('expected cancellation');
    } catch (error) {
      expect(isAbortError(error)).toBe(true);
    }
  });

  it('limit 在融合与重叠处理之后截断', async () => {
    const harness = await makeHarness({
      甲: 'revenue alpha report',
      乙: 'revenue beta memo',
      丙: 'revenue gamma note',
    });
    const response = await harness.service.search({
      scope: libraryScope,
      query: 'revenue',
      mode: 'keyword',
      limit: 2,
    });
    expect(response.results).toHaveLength(2);
  });
});

describe('集合筛选先于检索截取（KM11，契约 §10.1）', () => {
  it('集合与未分类筛选在候选收集阶段生效：范围外资料不占名额', async () => {
    const harness = await makeHarness({
      甲: 'revenue alpha report',
      乙: 'revenue beta memo',
      丙: 'revenue gamma note',
    });
    const collection = harness.vault.saveCollection({ mode: 'create', name: '研究' })[0];
    const docA = harness.references.get('甲');
    if (!collection || !docA) throw new Error('fixture collection/reference missing');
    harness.vault.setCollectionMembers({
      documentId: docA.knowledgeDocumentId,
      expectedMembershipRevision: 1,
      collectionIds: [collection.id],
    });
    const inCollection = await harness.service.search({
      scope: { kind: 'library', collectionId: collection.id },
      query: 'revenue',
      mode: 'keyword',
      limit: 1,
    });
    // 未选集合的乙丙即使在排序上更靠前也不得占掉这个名额
    expect(inCollection.results.map((hit) => hit.title)).toEqual(['甲']);
    expect(inCollection.coverage).toEqual({ eligibleChunks: 1, indexedChunks: 0 });

    const uncategorized = await harness.service.search({
      scope: { kind: 'library', uncategorized: true },
      query: 'revenue',
      mode: 'keyword',
    });
    expect(uncategorized.results.map((hit) => hit.title).sort()).toEqual(['丙', '乙'].sort());
  });

  it('集合已删除后按空范围收口：不回退全库也不报错', async () => {
    const harness = await makeHarness({ 甲: 'revenue alpha report' });
    const collection = harness.vault.saveCollection({ mode: 'create', name: '研究' })[0];
    if (!collection) throw new Error('fixture collection missing');
    harness.vault.deleteCollection({ id: collection.id, expectedRevision: 1 });
    const response = await harness.service.search({
      scope: { kind: 'library', collectionId: collection.id },
      query: 'revenue',
      mode: 'keyword',
    });
    expect(response.results).toEqual([]);
    expect(response.coverage).toEqual({ eligibleChunks: 0, indexedChunks: 0 });
  });
});
