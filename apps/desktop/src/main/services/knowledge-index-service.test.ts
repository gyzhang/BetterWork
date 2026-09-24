import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { abortError } from '@betterwork/agent-core';
import type { EmbeddingModelSnapshot, KnowledgeJobSummary } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import type { EmbeddingRequest, EmbeddingResult } from './embedding-client';
import { KnowledgeServiceError } from './knowledge-errors';
import { type EmbeddingRunner, KnowledgeIndexService } from './knowledge-index-service';
import { KnowledgeVault } from './knowledge-vault';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-knowledge-job-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const fingerprint = (seed: string): string => seed.repeat(2).slice(0, 64);

const stubSnapshot = (profileId = 'profile-1'): EmbeddingModelSnapshot => ({
  profileId,
  provider: 'openai-compatible',
  endpointFingerprint: fingerprint('e1'),
  model: 'embed-v1',
  modelFingerprint: fingerprint('f1'),
});

const unitVector = (dimension: number): Float32Array => {
  const vector = new Float32Array(dimension);
  vector.fill(1 / Math.sqrt(dimension));
  return vector;
};

interface EmbeddingStubOptions {
  dimension?: number;
  failWith?: Error;
  gate?: () => Promise<void>;
}

const createEmbeddingStub = (
  options: EmbeddingStubOptions = {},
): EmbeddingRunner & {
  requests: { inputs: readonly string[] }[];
  fingerprints: string[];
} => {
  const requests: { inputs: readonly string[] }[] = [];
  const fingerprints: string[] = [];
  return {
    requests,
    fingerprints,
    defaultSnapshot: () => stubSnapshot(),
    snapshotOf: (profileId: string) => stubSnapshot(profileId),
    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (options.gate) await options.gate();
      if (request.signal.aborted) {
        throw abortError();
      }
      if (options.failWith) throw options.failWith;
      requests.push({ inputs: [...request.inputs] });
      const dimension = options.dimension ?? 3;
      return {
        vectors: request.inputs.map(() => unitVector(dimension)),
        dimension,
      };
    },
  };
};

const writeSource = (directory: string, name: string, body: string): string => {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, body, 'utf8');
  return filePath;
};

interface Harness {
  vault: KnowledgeVault;
  service: KnowledgeIndexService;
  events: KnowledgeJobSummary[];
  embedding: ReturnType<typeof createEmbeddingStub>;
  directory: string;
}

const cancelCalls: string[] = [];

const createHarness = (options: EmbeddingStubOptions = {}): Harness => {
  const directory = temporaryDirectory();
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  const embedding = createEmbeddingStub(options);
  const events: KnowledgeJobSummary[] = [];
  const service = new KnowledgeIndexService({
    vault,
    embedding,
    onEvent: (job) => {
      events.push(job);
    },
    onJobCancel: (jobId) => {
      cancelCalls.push(jobId);
    },
  });
  return { vault, service, events, embedding, directory };
};

const enableSemantic = (harness: Harness): void => {
  harness.service.saveSettings({
    expectedRevision: harness.vault.index.settings().revision,
    semanticEnabled: true,
    embeddingProfileId: 'profile-1',
  });
};

const failureCode = (summary: KnowledgeJobSummary): string | undefined => summary.failure?.code;

describe('KnowledgeIndexService 导入与刷新作业', () => {
  it('混合成功与失败时聚合为 partial，成功资料仍有关键词块，失败条目带可解释原因', async () => {
    const harness = createHarness();
    const good = writeSource(harness.directory, '收入.md', '三季度收入 120 万元。');
    const bad = writeSource(harness.directory, 'image.png', 'not-text');

    const ack = harness.service.startImport([good, bad]);
    await harness.service.settled();

    const detail = harness.service.jobDetail(ack.jobId);
    expect(detail?.job.status).toBe('partial');
    expect(detail?.job.completedCount).toBe(1);
    expect(detail?.job.failedCount).toBe(1);
    const failed = detail?.items.find((item) => item.status === 'failed');
    expect(failed?.failure?.message).toContain('Markdown、文本、PDF 和 Word');
    const succeeded = detail?.items.find((item) => item.status === 'succeeded');
    expect(succeeded?.resultRevisionId).toBeDefined();
    expect(
      harness.vault.index.retrievalChunks(succeeded?.resultRevisionId ?? '').length,
    ).toBeGreaterThan(0);
    harness.vault.close();
  });

  it('每个批次事件按作业内单调 sequence 递增，摘要不回内部请求体', async () => {
    const harness = createHarness();
    const file = writeSource(harness.directory, '纪要.md', '纪要：回款口径确认。');
    harness.service.startImport([file]);
    await harness.service.settled();

    const sequences = harness.events.map((event) => event.sequence);
    expect(sequences.length).toBeGreaterThan(2);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(JSON.stringify(harness.events)).not.toContain('sourcePaths');
    harness.vault.close();
  });

  it('语义启用后导入追加向量阶段并按修订原子发布', async () => {
    const harness = createHarness();
    enableSemantic(harness);
    const file = writeSource(harness.directory, '口径.md', '收入按回款口径统计。');

    const ack = harness.service.startImport([file]);
    await harness.service.settled();

    expect(harness.embedding.requests).toHaveLength(1);
    const detail = harness.service.jobDetail(ack.jobId);
    const revisionId = detail?.items[0]?.resultRevisionId ?? '';
    const space = harness.vault.index.currentSpace(fingerprint('f1'));
    expect(space?.dimension).toBe(3);
    expect(harness.vault.index.coverage(space?.id ?? '')).toEqual({ revisions: 1, vectors: 1 });
    expect(harness.vault.index.activeGeneration(revisionId, space?.id ?? '')?.status).toBe(
      'active',
    );
    harness.vault.close();
  });

  it('嵌入失败时条目失败但关键词块保留，且不留下 staging 代次', async () => {
    const harness = createHarness({ failWith: new Error('service down') });
    enableSemantic(harness);
    const file = writeSource(harness.directory, '半成品.md', '内容仍然可关键词查找。');

    const ack = harness.service.startImport([file]);
    await harness.service.settled();

    const detail = harness.service.jobDetail(ack.jobId);
    expect(detail?.job.status).toBe('failed');
    const revisionId = detail?.items[0]?.resultRevisionId ?? '';
    expect(harness.vault.index.retrievalChunks(revisionId).length).toBeGreaterThan(0);
    const space = harness.vault.index.currentSpace(fingerprint('f1'));
    expect(harness.vault.index.coverage(space?.id ?? '')).toEqual({ revisions: 0, vectors: 0 });
    harness.vault.close();
  });

  it('排队中的作业可立即取消，取消不发布半份向量', async () => {
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const harness = createHarness({ gate: () => gate });
    enableSemantic(harness);
    const first = writeSource(harness.directory, '第一批.md', '第一批内容。');
    const second = writeSource(harness.directory, '第二批.md', '第二批内容。');

    const runningAck = harness.service.startImport([first]);
    const queuedAck = harness.service.startImport([second]);
    const cancelled = harness.service.cancelJob(queuedAck.jobId);
    expect(cancelled?.status).toBe('cancelled');
    expect(
      harness.service
        .jobDetail(queuedAck.jobId)
        ?.items.every((item) => item.status === 'cancelled'),
    ).toBe(true);

    releaseGate?.();
    await harness.service.settled();
    expect(harness.service.jobDetail(runningAck.jobId)?.job.status).toBe('succeeded');
    harness.vault.close();
  });
});

describe('KnowledgeIndexService 空间、代次与重试', () => {
  it('共享空间维度由首批锁定，第二批不同维度被拒绝且不各自建立', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const good = writeSource(directory, '甲.md', '甲的内容。');
    await vault.importSource(good);
    const second = writeSource(directory, '乙.md', '乙的内容。');
    await vault.importSource(second);

    const space = vault.index.ensureCurrentSpace(fingerprint('f1'));
    const [firstRevision, secondRevision] = vault.listDocuments();
    if (!firstRevision || !secondRevision) throw new Error('测试前置：需要两份资料');
    const firstId = vault.registeredRevisionId(firstRevision.id) ?? '';
    const secondId = vault.registeredRevisionId(secondRevision.id) ?? '';
    vault.reindexKeywordRevision(firstId);
    vault.reindexKeywordRevision(secondId);

    const embedding3 = createEmbeddingStub({ dimension: 3 });
    const service3 = new KnowledgeIndexService({ vault, embedding: embedding3 });
    service3.saveSettings({
      expectedRevision: vault.index.settings().revision,
      semanticEnabled: true,
      embeddingProfileId: 'profile-1',
    });
    const ack = service3.startRebuildSemantic({ kind: 'semantic', resetSemanticSpace: false });
    await service3.settled();
    expect(service3.jobDetail(ack.jobId)?.job.status).toBe('succeeded');
    expect(vault.index.spaceById(space.id)?.dimension).toBe(3);

    const embedding5 = createEmbeddingStub({ dimension: 5 });
    const service5 = new KnowledgeIndexService({ vault, embedding: embedding5 });
    const again = service5.startRebuildSemantic({ kind: 'semantic', resetSemanticSpace: false });
    await service5.settled();
    const detail = service5.jobDetail(again.jobId);
    expect(detail?.job.status).toBe('failed');
    expect(detail?.items.at(0)?.failure?.code).toBe('EMBEDDING_RESPONSE_INVALID');
    expect(vault.index.spaceById(space.id)?.dimension).toBe(3);
    vault.close();
  });

  it('强制重建退役旧空间并开新 epoch，旧作业先取消且旧向量不再计入覆盖', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const file = writeSource(directory, '旧版.md', '旧版内容。');
    const embedding = createEmbeddingStub();
    const service = new KnowledgeIndexService({ vault, embedding });
    service.saveSettings({
      expectedRevision: vault.index.settings().revision,
      semanticEnabled: true,
      embeddingProfileId: 'profile-1',
    });
    const seeded = service.startImport([file]);
    await service.settled();
    expect(service.jobDetail(seeded.jobId)?.job.status).toBe('succeeded');
    const oldSpace = vault.index.currentSpace(fingerprint('f1'));
    if (!oldSpace) throw new Error('测试前置：需要先建立 current 空间');
    expect(vault.index.coverage(oldSpace.id).vectors).toBeGreaterThan(0);

    const reset = service.startRebuildSemantic({ kind: 'semantic', resetSemanticSpace: true });
    await service.settled();

    expect(vault.index.spaceById(oldSpace.id)?.status).toBe('retired');
    const fresh = vault.index.currentSpace(fingerprint('f1'));
    expect(fresh?.id).not.toBe(oldSpace.id);
    expect(fresh?.epoch).toBe(oldSpace.epoch + 1);
    // 新空间由本次重建的首批合法向量重新锁定维度
    expect(fresh?.dimension).toBe(3);
    expect(service.getJob(reset.jobId)?.spaceId).toBe(fresh?.id);
    expect(vault.index.coverage(fresh?.id ?? '')).toEqual({ revisions: 1, vectors: 1 });
    vault.close();
  });

  it('发布前复核登记修订：旧 attempt 的历史修订不能覆盖当前版本', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const file = writeSource(directory, '版本一.md', '第一版内容。');
    const first = await vault.importSource(file);
    vault.reindexKeywordRevision(first.revisionId);
    const space = vault.index.ensureCurrentSpace(fingerprint('f1'));
    const generation = vault.index.createStagingGeneration({
      revisionId: first.revisionId,
      textHash: first.textHash,
      spaceId: space.id,
      modelSnapshot: stubSnapshot(),
      chunkingVersion: 'knowledge-chunks-v1',
      chunkCount: vault.index.retrievalChunks(first.revisionId).length,
    });
    // 同一文件更新后，旧修订不再是当前登记版本
    writeFileSync(file, '第二版内容完全不同。', 'utf8');
    const second = await vault.importSource(file);

    const published = (() => {
      try {
        vault.index.publishGeneration({
          generationId: generation.id,
          expect: {
            revisionId: first.revisionId,
            textHash: first.textHash,
            spaceId: space.id,
            modelFingerprint: fingerprint('f1'),
            dimension: 3,
            chunkingVersion: 'knowledge-chunks-v1',
            registeredRevisionId: vault.registeredRevisionId(second.document.id) ?? '',
          },
        });
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(published).toBeInstanceOf(KnowledgeServiceError);
    if (published instanceof KnowledgeServiceError) {
      expect(published.code).toBe('INDEX_CONFIGURATION_CHANGED');
    }
    expect(vault.index.generation(generation.id)?.status).toBe('staging');
    vault.close();
  });

  it('重试只带走失败条目并复用同一空间，成功条目拒绝重跑', async () => {
    const harness = createHarness();
    enableSemantic(harness);
    const good = writeSource(harness.directory, '可用.md', '可用内容。');
    const bad = writeSource(harness.directory, '坏图.png', 'x');
    const ack = harness.service.startImport([good, bad]);
    await harness.service.settled();

    const items = harness.service.jobDetail(ack.jobId)?.items ?? [];
    const failedId = items.find((item) => item.status === 'failed')?.id ?? '';
    const succeededId = items.find((item) => item.status === 'succeeded')?.id ?? '';

    expect(() => harness.service.retryJob(ack.jobId, [succeededId])).toThrow(KnowledgeServiceError);
    const retry = harness.service.retryJob(ack.jobId, [failedId]);
    await harness.service.settled();
    const retried = harness.service.getJob(retry.jobId);
    expect(retried?.attempt).toBe(2);
    expect(retried?.retryOfJobId).toBe(ack.jobId);
    expect(retried?.totalCount).toBe(1);
    harness.vault.close();
  });

  it('未终态作业不允许重试，空间已退役后语义重试要求显式新建', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const file = writeSource(directory, '仍在跑.md', '内容。');
    const embedding = createEmbeddingStub();
    const service = new KnowledgeIndexService({ vault, embedding });
    service.saveSettings({
      expectedRevision: vault.index.settings().revision,
      semanticEnabled: true,
      embeddingProfileId: 'profile-1',
    });
    const job = vault.jobs.createJob({
      kind: 'rebuild-semantic',
      request: { resetSemanticSpace: false },
      targets: [],
      firstPhase: 'embed',
    });
    expect(() => service.retryJob(job.id, [])).toThrow(KnowledgeServiceError);

    vault.jobs.cancelUnfinishedItems(job.id);
    vault.jobs.finish(job.id, { status: 'cancelled' });
    const retired = vault.index.ensureCurrentSpace(fingerprint('f1'));
    const withSpace = vault.jobs.createJob({
      kind: 'rebuild-semantic',
      request: { resetSemanticSpace: false },
      targets: [{ kind: 'revision', documentId: 'doc-1', revisionId: 'rev-1', sourcePath: file }],
      firstPhase: 'embed',
      spaceId: retired.id,
    });
    vault.jobs.cancelUnfinishedItems(withSpace.id);
    vault.jobs.finish(withSpace.id, { status: 'cancelled' });
    vault.index.resetCurrentSpace(fingerprint('f1'));
    let error: unknown;
    try {
      service.retryJob(
        withSpace.id,
        vault.jobs.targetsOf(withSpace.id).map((entry) => entry.itemId),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(KnowledgeServiceError);
    if (error instanceof KnowledgeServiceError) {
      expect(error.code).toBe('INDEX_CONFIGURATION_CHANGED');
    }
    vault.close();
  });

  it('启动收口把遗留 queued/running 作业与未完成条目记为 interrupted', async () => {
    const directory = temporaryDirectory();
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const running = vault.jobs.createJob({
      kind: 'import',
      request: { sourcePaths: ['/tmp/missing.md'] },
      targets: [{ kind: 'import-file', sourcePath: '/tmp/missing.md', fileName: 'missing.md' }],
      firstPhase: 'read',
    });
    vault.jobs.markRunning(running.id);
    const reopened = new KnowledgeIndexService({
      vault,
      embedding: createEmbeddingStub(),
    });
    const recovered = reopened.recoverInterrupted();
    expect(recovered.map((job) => job.id)).toContain(running.id);
    const detail = reopened.jobDetail(running.id);
    expect(detail?.job.status).toBe('interrupted');
    expect(detail?.items.every((item) => item.status === 'interrupted')).toBe(true);
    expect(failureCode(detail?.job ?? ({} as KnowledgeJobSummary))).toBe('INTERRUPTED');
    vault.close();
  });
});

describe('KnowledgeIndexService 设置与来源检查', () => {
  it('没有合格嵌入模型时拒绝启用语义，且不改写已存设置', () => {
    const harness = createHarness();
    const unavailable: EmbeddingRunner = {
      defaultSnapshot: () => {
        throw new KnowledgeServiceError(
          'EMBEDDING_MODEL_UNAVAILABLE',
          '尚未启用可用的嵌入模型，语义检索不会回落到其他模型。',
        );
      },
      snapshotOf: () => {
        throw new KnowledgeServiceError('EMBEDDING_MODEL_UNAVAILABLE', '嵌入模型不可用。');
      },
      embed: async () => {
        throw new KnowledgeServiceError('EMBEDDING_MODEL_UNAVAILABLE', '嵌入模型不可用。');
      },
    };
    const service = new KnowledgeIndexService({ vault: harness.vault, embedding: unavailable });
    expect(() =>
      service.saveSettings({
        expectedRevision: harness.vault.index.settings().revision,
        semanticEnabled: true,
      }),
    ).toThrow(KnowledgeServiceError);
    expect(harness.vault.index.settings().semanticEnabled).toBe(false);
    expect(service.getSettings().embeddingAvailable).toBe(false);
    harness.vault.close();
  });

  it('设置走 CAS：过期 revision 被拒绝', () => {
    const harness = createHarness();
    expect(() =>
      harness.service.saveSettings({ expectedRevision: 99, semanticEnabled: false }),
    ).toThrow(KnowledgeServiceError);
    harness.vault.close();
  });

  it('来源检查区分未变化与已改动的原件', async () => {
    const harness = createHarness();
    const file = writeSource(harness.directory, '原件.md', '原件内容。');
    const imported = await harness.vault.importSource(file);
    const ack = harness.service.startCheckSources({
      documentIds: [imported.document.id, 'missing-document'],
    });
    await harness.service.settled();
    const detail = harness.service.jobDetail(ack.jobId);
    expect(detail?.items.at(0)?.status).toBe('succeeded');
    expect(detail?.items.at(1)?.status).toBe('failed');

    writeFileSync(file, '原件已被改写。', 'utf8');
    const changed = harness.service.startCheckSources({ documentIds: [imported.document.id] });
    await harness.service.settled();
    expect(harness.service.jobDetail(changed.jobId)?.items.at(0)?.status).toBe('failed');
    expect(harness.service.jobDetail(changed.jobId)?.items.at(0)?.failure?.code).toBe(
      'KNOWLEDGE_DOCUMENT_REMOVED',
    );
    harness.vault.close();
  });

  it('关键词重建按精确历史修订补块，不要求它仍是当前版本', async () => {
    const harness = createHarness();
    const file = writeSource(harness.directory, '历史.md', '第一版历史内容。');
    const first = await harness.vault.importSource(file);
    writeFileSync(file, '第二版历史内容完全不同。', 'utf8');
    await harness.vault.importSource(file);
    harness.vault.index.replaceRetrievalChunks(first.revisionId, first.textHash, '历史', []);
    expect(harness.vault.index.retrievalChunks(first.revisionId)).toHaveLength(0);

    const ack = harness.service.startRebuildKeyword({
      kind: 'keyword',
      revisions: [
        {
          kind: 'knowledge-revision',
          knowledgeDocumentId: first.document.id,
          knowledgeRevisionId: first.revisionId,
          contentHash: first.document.contentHash,
          sourcePath: file,
        },
      ],
    });
    await harness.service.settled();

    expect(harness.service.jobDetail(ack.jobId)?.job.status).toBe('succeeded');
    expect(harness.vault.index.retrievalChunks(first.revisionId).length).toBeGreaterThan(0);
    harness.vault.close();
  });

  it('一次只运行一个持久作业，后来的作业排队', async () => {
    const harness = createHarness();
    const firstFile = writeSource(harness.directory, '第一份.md', '第一份内容。');
    const secondFile = writeSource(harness.directory, '第二份.md', '第二份内容。');

    const first = harness.service.startImport([firstFile]);
    const second = harness.service.startImport([secondFile]);
    expect(harness.service.getJob(second.jobId)?.status).toBe('queued');
    await harness.service.settled();

    expect(harness.service.getJob(first.jobId)?.status).toBe('succeeded');
    expect(harness.service.getJob(second.jobId)?.status).toBe('succeeded');
    const page = harness.service.listJobs({ limit: 10 });
    // 契约排序固定 (createdAt,id) 倒序：同毫秒创建的先后只能以 id 决胜，不承诺插入序。
    expect(page.jobs.map((job) => job.id).sort()).toEqual([first.jobId, second.jobId].sort());
    harness.vault.close();
  });

  it('取消作业同步通知提取 Worker 收口登记进程（KM07b）', async () => {
    const harness = createHarness();
    const file = writeSource(harness.directory, '取消通知.md', '取消也要能解释。');
    const ack = harness.service.startImport([file]);
    const callsBefore = cancelCalls.length;
    harness.service.cancelJob(ack.jobId);
    expect(cancelCalls.slice(callsBefore)).toEqual([ack.jobId]);
    await harness.service.settled();
    expect(harness.service.getJob(ack.jobId)?.status).toBe('cancelled');
    harness.vault.close();
  });
  it('空目标的普通重建被拒绝，不产生看似成功的作业', () => {
    const harness = createHarness();
    expect(() => harness.service.startRebuildKeyword({ kind: 'keyword' })).toThrow(
      KnowledgeServiceError,
    );
    expect(harness.vault.jobs.listPage({ limit: 10 }).jobs).toHaveLength(0);
    harness.vault.close();
  });
});
