import { basename } from 'node:path';

import { abortError, isAbortError } from '@betterwork/agent-core';
import type {
  CheckKnowledgeSourcesRequest,
  EmbeddingModelSnapshot,
  KnowledgeJobAck,
  KnowledgeJobItemSummary,
  KnowledgeJobPage,
  KnowledgeJobPhase,
  KnowledgeJobSummary,
  KnowledgeSearchSettings,
  ListKnowledgeJobsRequest,
  RebuildKnowledgeIndexRequest,
  SaveKnowledgeSettingsRequest,
} from '@betterwork/agent-protocol';
import {
  countCodePoints,
  KNOWLEDGE_EMBEDDING_BATCH_CODE_POINT_BUDGET,
  KNOWLEDGE_EMBEDDING_BATCH_INPUT_MAX,
  knowledgeJobAckSchema,
} from '@betterwork/agent-protocol';

import type { EmbeddingRequest, EmbeddingResult } from './embedding-client';
import { KNOWLEDGE_CHUNKING_VERSION } from './knowledge-chunks';
import { KnowledgeServiceError } from './knowledge-errors';
import type { KnowledgeIndexStore, RetrievalChunkRow } from './knowledge-index-store';
import type { JobTarget, KnowledgeJobStore } from './knowledge-job-store';
import type { KnowledgeVault } from './knowledge-vault';

/**
 * 索引作业调度与生命周期（知识契约 §8.2）。
 *
 * Main 只有一个持久作业在跑，其余排队；取消在排队期立即生效。
 * 每条文件条目按阶段推进（read→extract→chunk→publish→embed），语义失败不回滚
 * 已发布的关键词块，因此条目失败时文档仍然可关键词查找。
 */

/** 作业只需要嵌入能力的三个动作；测试注入替身，不触网也不新造 Provider。 */
export interface EmbeddingRunner {
  defaultSnapshot(): EmbeddingModelSnapshot;
  snapshotOf(profileId: string): EmbeddingModelSnapshot;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

export interface KnowledgeIndexServiceDeps {
  readonly vault: KnowledgeVault;
  readonly embedding: EmbeddingRunner;
  readonly onEvent?: ((job: KnowledgeJobSummary) => void) | undefined;
  /** 两个索引批次之间让查询优先；测试与生产都注入同一实现，不额外放宽预算。 */
  readonly yieldBetweenBatches?: (() => Promise<void> | void) | undefined;
  /** 取消作业时通知提取 Worker（KM07b）：由 Worker 运行器收口本作业登记的子进程。 */
  readonly onJobCancel?: ((jobId: string) => void) | undefined;
}

export interface ImportJobRequest {
  sourcePaths: string[];
}

export interface RefreshJobRequest {
  documentId: string;
}

export interface KeywordRebuildRequest {
  documentIds: string[];
  revisionIds: string[];
}

export interface SemanticRebuildRequest {
  resetSemanticSpace: boolean;
}

export interface CheckSourceJobRequest {
  documentIds: string[];
}

type JobRequest =
  | ImportJobRequest
  | RefreshJobRequest
  | KeywordRebuildRequest
  | SemanticRebuildRequest
  | CheckSourceJobRequest;

const jobError = (code: KnowledgeServiceError['code'], message: string): KnowledgeServiceError =>
  new KnowledgeServiceError(code, message);

const failureOf = (error: unknown): { code: string; message: string } => {
  if (error instanceof KnowledgeServiceError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: 'INDEX_ITEM_FAILED', message: error.message };
  return { code: 'INDEX_ITEM_FAILED', message: '索引步骤失败。' };
};

const chunkBatches = (chunks: readonly RetrievalChunkRow[]): RetrievalChunkRow[][] => {
  const batches: RetrievalChunkRow[][] = [];
  let current: RetrievalChunkRow[] = [];
  let codePoints = 0;
  for (const chunk of chunks) {
    const size = countCodePoints(chunk.content);
    if (
      current.length >= KNOWLEDGE_EMBEDDING_BATCH_INPUT_MAX ||
      (codePoints + size > KNOWLEDGE_EMBEDDING_BATCH_CODE_POINT_BUDGET && current.length > 0)
    ) {
      batches.push(current);
      current = [];
      codePoints = 0;
    }
    current.push(chunk);
    codePoints += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

export class KnowledgeIndexService {
  private readonly vault: KnowledgeVault;
  private readonly embedding: EmbeddingRunner;
  private readonly jobs: KnowledgeJobStore;
  private readonly index: KnowledgeIndexStore;
  private readonly onEvent: ((job: KnowledgeJobSummary) => void) | undefined;
  private readonly yieldBetweenBatches: (() => Promise<void> | void) | undefined;
  private readonly onJobCancel: ((jobId: string) => void) | undefined;
  private readonly controllers = new Map<string, AbortController>();
  private draining: Promise<void> = Promise.resolve();

  constructor(deps: KnowledgeIndexServiceDeps) {
    this.vault = deps.vault;
    this.embedding = deps.embedding;
    this.jobs = deps.vault.jobs;
    this.index = deps.vault.index;
    this.onEvent = deps.onEvent;
    this.yieldBetweenBatches = deps.yieldBetweenBatches;
    this.onJobCancel = deps.onJobCancel;
  }

  getSettings(): KnowledgeSearchSettings {
    const settings = this.index.settings();
    const availability = this.probeEmbedding(settings.embeddingProfileId);
    return {
      semanticEnabled: settings.semanticEnabled && availability.ok,
      ...(settings.embeddingProfileId ? { embeddingProfileId: settings.embeddingProfileId } : {}),
      revision: settings.revision,
      embeddingAvailable: availability.ok,
      ...(!availability.ok && availability.reason
        ? { unavailableReason: availability.reason }
        : {}),
    };
  }

  /**
   * 启用语义必须解析出具体 profileId 并保存（契约 §7.1）：不跟随应用默认悄悄漂移。
   * 关闭语义时取消仍在排队或运行的语义作业，但保留用户设置与已发布向量。
   */
  saveSettings(input: SaveKnowledgeSettingsRequest): KnowledgeSearchSettings {
    let profileId = this.index.settings().embeddingProfileId;
    if (input.embeddingProfileId) {
      profileId = this.probeEmbedding(input.embeddingProfileId).profileId ?? profileId;
    } else if (input.semanticEnabled) {
      profileId = this.probeEmbedding(undefined).profileId;
    }
    if (input.semanticEnabled && !profileId) {
      throw jobError('EMBEDDING_MODEL_UNAVAILABLE', '没有合格的嵌入模型，无法启用语义检索。');
    }
    this.index.saveSettings({
      expectedRevision: input.expectedRevision,
      semanticEnabled: input.semanticEnabled,
      ...(profileId ? { embeddingProfileId: profileId } : {}),
    });
    if (!input.semanticEnabled) this.cancelSemanticJobs();
    return this.getSettings();
  }

  startImport(sourcePaths: readonly string[]): KnowledgeJobAck {
    const targets: JobTarget[] = sourcePaths.map((sourcePath) => ({
      kind: 'import-file' as const,
      sourcePath,
      fileName: basename(sourcePath),
    }));
    return this.enqueue({
      kind: 'import',
      request: { sourcePaths: [...sourcePaths] } satisfies ImportJobRequest,
      targets,
      firstPhase: 'read',
    });
  }

  startRefresh(documentId: string): KnowledgeJobAck {
    return this.enqueue({
      kind: 'refresh',
      request: { documentId } satisfies RefreshJobRequest,
      targets: [{ kind: 'document', documentId }],
      firstPhase: 'read',
    });
  }

  startRebuildKeyword(
    input: Extract<RebuildKnowledgeIndexRequest, { kind: 'keyword' }>,
  ): KnowledgeJobAck {
    if ((input.documentIds?.length ?? 0) === 0 && (input.revisions?.length ?? 0) === 0) {
      throw jobError('INDEX_CONFIGURATION_CHANGED', '普通重建需要至少一个目标资料或精确修订。');
    }
    const targets: JobTarget[] = [];
    for (const documentId of input.documentIds ?? []) {
      targets.push({ kind: 'document', documentId });
    }
    for (const reference of input.revisions ?? []) {
      targets.push({
        kind: 'revision',
        documentId: reference.knowledgeDocumentId,
        revisionId: reference.knowledgeRevisionId,
        sourcePath: reference.sourcePath,
      });
    }
    return this.enqueue({
      kind: 'rebuild-keyword',
      request: {
        documentIds: input.documentIds ?? [],
        revisionIds: (input.revisions ?? []).map((reference) => reference.knowledgeRevisionId),
      } satisfies KeywordRebuildRequest,
      targets,
      firstPhase: 'chunk',
    });
  }

  /**
   * 语义重建。`resetSemanticSpace` 即「强制重建」：同一事务退役旧空间、开新 epoch、
   * 递增设置修订，并把目标固定为全部当前登记修订；旧空间的作业先收口 cancelled。
   */
  startRebuildSemantic(
    input: Extract<RebuildKnowledgeIndexRequest, { kind: 'semantic' }>,
  ): KnowledgeJobAck {
    const settings = this.index.settings();
    if (!settings.semanticEnabled) {
      throw jobError('EMBEDDING_MODEL_UNAVAILABLE', '语义检索未启用，无法建立向量索引。');
    }
    const snapshot = this.snapshotFor(settings.embeddingProfileId);
    if (input.resetSemanticSpace) {
      this.cancelSemanticJobs();
      const { space } = this.index.resetCurrentSpace(snapshot.modelFingerprint);
      this.index.saveSettings({
        expectedRevision: settings.revision,
        semanticEnabled: true,
        ...(settings.embeddingProfileId ? { embeddingProfileId: settings.embeddingProfileId } : {}),
      });
      return this.enqueue({
        kind: 'rebuild-semantic',
        request: { resetSemanticSpace: true } satisfies SemanticRebuildRequest,
        targets: this.registeredRevisionTargets(),
        firstPhase: 'embed',
        spaceId: space.id,
        attempt: 1,
      });
    }
    const space = this.index.ensureCurrentSpace(snapshot.modelFingerprint);
    return this.enqueue({
      kind: 'rebuild-semantic',
      request: { resetSemanticSpace: false } satisfies SemanticRebuildRequest,
      targets: this.registeredRevisionTargets(),
      firstPhase: 'embed',
      spaceId: space.id,
      attempt: 1,
    });
  }

  startCheckSources(input: CheckKnowledgeSourcesRequest): KnowledgeJobAck {
    return this.enqueue({
      kind: 'check-source',
      request: { documentIds: [...input.documentIds] } satisfies CheckSourceJobRequest,
      targets: input.documentIds.map((documentId) => ({
        kind: 'check-document' as const,
        documentId,
      })),
      firstPhase: 'check',
    });
  }

  listJobs(input: ListKnowledgeJobsRequest): KnowledgeJobPage {
    return this.jobs.listPage({
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
  }

  getJob(jobId: string): KnowledgeJobSummary | undefined {
    return this.jobs.job(jobId);
  }

  jobDetail(jobId: string): ReturnType<KnowledgeJobStore['detail']> {
    return this.jobs.detail(jobId);
  }

  cancelJob(jobId: string): KnowledgeJobSummary | undefined {
    const job = this.jobs.job(jobId);
    if (!job || isTerminalJob(job.status)) return undefined;
    this.controllers.get(jobId)?.abort();
    this.controllers.delete(jobId);
    this.onJobCancel?.(jobId);
    this.jobs.cancelUnfinishedItems(jobId);
    const cancelled = this.jobs.finish(jobId, { status: 'cancelled' });
    this.emit(cancelled);
    return cancelled;
  }

  /** 重试是新作业：引用原 job、attempt 递增，只带走用户选定的未完成条目。 */
  retryJob(jobId: string, itemIds: readonly string[]): KnowledgeJobAck {
    const original = this.jobs.job(jobId);
    if (!original) throw jobError('INDEX_CONFIGURATION_CHANGED', '原作业已不存在。');
    if (!isTerminalJob(original.status)) {
      throw jobError(
        'INDEX_ITEM_NOT_RETRYABLE',
        '作业仍在排队或执行中，完成或取消后再重试指定条目。',
      );
    }
    const selected = new Set(itemIds);
    const targets = this.jobs.targetsOf(jobId);
    const chosen = targets.filter((entry) => selected.has(entry.itemId));
    if (chosen.length !== selected.size) {
      throw jobError('INDEX_ITEM_NOT_RETRYABLE', '所选条目不属于该作业。');
    }
    for (const entry of chosen) {
      if (
        entry.status !== 'failed' &&
        entry.status !== 'interrupted' &&
        entry.status !== 'cancelled'
      ) {
        throw jobError(
          'INDEX_ITEM_NOT_RETRYABLE',
          '只有失败、中断或已取消的条目可以重试，成功条目保持已完成。',
        );
      }
    }
    const spaceId = original.spaceId;
    if (spaceId) {
      const space = this.index.spaceById(spaceId);
      if (!space || space.status !== 'current') {
        throw jobError(
          'INDEX_CONFIGURATION_CHANGED',
          '原向量空间已退役，需要显式创建当前空间的新重建作业。',
        );
      }
    }
    const created = this.jobs.createJob({
      kind: original.kind,
      request: { retryOfJobId: original.id, itemIds: [...selected] },
      targets: chosen.map((entry) => entry.target),
      firstPhase: firstPhaseOf(original.kind),
      attempt: original.attempt + 1,
      retryOfJobId: original.id,
      ...(spaceId ? { spaceId } : {}),
    });
    this.schedule();
    return knowledgeJobAckSchema.parse({ jobId: created.id });
  }

  /** 启动收口：把上次进程留下的 queued/running 作业标为 interrupted。 */
  recoverInterrupted(): KnowledgeJobSummary[] {
    const recovered = this.jobs.recoverInterrupted();
    for (const job of recovered) this.emit(job);
    return recovered;
  }

  /** 等待队列排空；测试与调用方用它确认作业已经完成。 */
  settled(): Promise<void> {
    return this.draining;
  }

  private enqueue(input: {
    kind: KnowledgeJobSummary['kind'];
    request: JobRequest;
    targets: JobTarget[];
    firstPhase: KnowledgeJobPhase;
    spaceId?: string;
    attempt?: number;
  }): KnowledgeJobAck {
    const job = this.jobs.createJob({
      kind: input.kind,
      request: input.request,
      targets: input.targets,
      firstPhase: input.firstPhase,
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      ...(input.attempt ? { attempt: input.attempt } : {}),
    });
    this.emit(job);
    this.schedule();
    return knowledgeJobAckSchema.parse({ jobId: job.id });
  }

  private schedule(): void {
    this.draining = this.draining.then(() => this.drain());
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = this.jobs.nextQueued();
      if (!next) return;
      await this.runJob(next);
    }
  }

  private async runJob(job: KnowledgeJobSummary): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const running = this.jobs.markRunning(job.id);
    this.emit(running);
    let aborted = false;
    for (;;) {
      const item = this.jobs.claimItem(job.id);
      if (!item) break;
      if (controller.signal.aborted) {
        this.jobs.updateItem(item.id, { status: 'cancelled' });
        aborted = true;
        continue;
      }
      try {
        await this.runItem(job, item, controller.signal);
        const done = this.jobs.item(item.id);
        if (!done || done.status === 'running') {
          this.jobs.updateItem(item.id, { status: 'succeeded' });
        }
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          this.jobs.updateItem(item.id, { status: 'cancelled' });
          aborted = true;
        } else {
          this.jobs.updateItem(item.id, { status: 'failed', failure: failureOf(error) });
        }
      }
    }
    this.controllers.delete(job.id);
    const current = this.jobs.job(job.id);
    if (!current || isTerminalJob(current.status)) return;
    const finished = aborted
      ? this.jobs.finish(job.id, { status: 'cancelled' })
      : this.jobs.finish(job.id);
    this.emit(finished);
  }

  private async runItem(
    job: KnowledgeJobSummary,
    item: KnowledgeJobItemSummary,
    signal: AbortSignal,
  ): Promise<void> {
    const target = this.targetOfItem(job.id, item.id);
    switch (job.kind) {
      case 'import': {
        if (target.kind !== 'import-file') {
          throw jobError('INDEX_CONFIGURATION_CHANGED', '导入作业条目类型不符。');
        }
        this.jobs.updateItem(item.id, { phase: 'extract' });
        const published = await this.vault.importSource(target.sourcePath, {
          jobId: job.id,
          attempt: item.attempt,
        });
        this.jobs.updateItem(item.id, {
          phase: 'publish',
          resultRevisionId: published.revisionId,
        });
        await this.maybeVectorize(item.id, published.revisionId, published.textHash, signal);
        return;
      }
      case 'refresh': {
        if (target.kind !== 'document') {
          throw jobError('INDEX_CONFIGURATION_CHANGED', '刷新作业条目类型不符。');
        }
        this.jobs.updateItem(item.id, { phase: 'extract' });
        const document = this.vault.listDocuments().find((entry) => entry.id === target.documentId);
        if (!document) {
          throw jobError('KNOWLEDGE_DOCUMENT_REMOVED', '资料已不在当前资料库中。');
        }
        const published = await this.vault.importSource(document.sourcePath, {
          jobId: job.id,
          attempt: item.attempt,
        });
        this.jobs.updateItem(item.id, {
          phase: 'publish',
          resultRevisionId: published.revisionId,
        });
        await this.maybeVectorize(item.id, published.revisionId, published.textHash, signal);
        return;
      }
      case 'rebuild-keyword': {
        const revisionId =
          target.kind === 'revision'
            ? target.revisionId
            : target.kind === 'document'
              ? this.vault.registeredRevisionId(target.documentId)
              : undefined;
        if (!revisionId) {
          throw jobError('KNOWLEDGE_REVISION_MISMATCH', '该资料没有可重建的登记修订。');
        }
        this.jobs.updateItem(item.id, { phase: 'chunk' });
        const chunkCount = this.vault.reindexKeywordRevision(revisionId);
        this.jobs.updateItem(item.id, {
          phase: 'publish',
          resultRevisionId: revisionId,
          completedUnits: chunkCount,
          ...(chunkCount === 0 ? {} : { totalUnits: chunkCount }),
        });
        return;
      }
      case 'rebuild-semantic': {
        const revisionId =
          target.kind === 'revision'
            ? target.revisionId
            : target.kind === 'document'
              ? this.vault.registeredRevisionId(target.documentId)
              : undefined;
        if (!revisionId) {
          throw jobError('KNOWLEDGE_REVISION_MISMATCH', '该资料没有可向量化的登记修订。');
        }
        const revision = this.vault.getRevision(revisionId);
        if (!revision) {
          throw jobError('KNOWLEDGE_REVISION_MISMATCH', '修订已不在资料库中。');
        }
        if (this.index.retrievalChunks(revisionId).length === 0) {
          this.vault.reindexKeywordRevision(revisionId);
        }
        await this.vectorize(item.id, revisionId, revision.textHash, revision.documentId, signal, {
          requireSpace: true,
        });
        return;
      }
      case 'check-source': {
        if (target.kind !== 'check-document') {
          throw jobError('INDEX_CONFIGURATION_CHANGED', '来源检查条目类型不符。');
        }
        this.jobs.updateItem(item.id, { phase: 'check' });
        const result = await this.vault.sourceMatchesRegistration(target.documentId);
        if (!result.ok) {
          throw jobError('KNOWLEDGE_DOCUMENT_REMOVED', result.reason);
        }
      }
    }
  }

  private targetOfItem(jobId: string, itemId: string): JobTarget {
    const entry = this.jobs.targetsOf(jobId).find((candidate) => candidate.itemId === itemId);
    if (!entry) throw jobError('INDEX_CONFIGURATION_CHANGED', '作业条目已不存在。');
    return entry.target;
  }

  /** 只在语义已启用时追加向量阶段；失败时关键词块仍然可见。 */
  private async maybeVectorize(
    itemId: string,
    revisionId: string,
    textHash: string,
    signal: AbortSignal,
  ): Promise<void> {
    const settings = this.index.settings();
    if (!settings.semanticEnabled) return;
    const revision = this.vault.getRevision(revisionId);
    if (!revision) return;
    await this.vectorize(itemId, revisionId, textHash, revision.documentId, signal, {
      requireSpace: false,
    });
  }

  private async vectorize(
    itemId: string,
    revisionId: string,
    textHash: string,
    documentId: string,
    signal: AbortSignal,
    options: { requireSpace: boolean },
  ): Promise<void> {
    const settings = this.index.settings();
    const snapshot = this.snapshotFor(settings.embeddingProfileId);
    const space = options.requireSpace
      ? this.expectedSpace(itemId, snapshot)
      : this.index.ensureCurrentSpace(snapshot.modelFingerprint);
    const chunks = this.index.retrievalChunks(revisionId);
    if (chunks.length === 0) {
      this.jobs.updateItem(itemId, { phase: 'publish', resultRevisionId: revisionId });
      return;
    }
    this.jobs.updateItem(itemId, { phase: 'embed', totalUnits: chunks.length });
    const generation = this.index.createStagingGeneration({
      revisionId,
      textHash,
      spaceId: space.id,
      modelSnapshot: snapshot,
      chunkingVersion: KNOWLEDGE_CHUNKING_VERSION,
      chunkCount: chunks.length,
    });
    let dimension = space.dimension ?? 0;
    try {
      const vectors: { chunkId: string; chunkHash: string; vector: Float32Array }[] = [];
      for (const batch of chunkBatches(chunks)) {
        if (signal.aborted) throw abortError();
        const result = await this.embedding.embed({
          snapshot: {
            ...snapshot,
            ...(space.dimension === undefined ? {} : { dimension: space.dimension }),
          },
          inputs: batch.map((chunk) => chunk.content),
          signal,
        });
        dimension = space.dimension ?? result.dimension;
        const lock = this.index.lockDimension(space.id, result.dimension);
        if (lock === 'conflict') {
          throw jobError(
            'EMBEDDING_RESPONSE_INVALID',
            '批次维度与共享向量空间不一致，已拒绝该批次。',
          );
        }
        batch.forEach((chunk, index) => {
          const vector = result.vectors[index];
          if (vector) vectors.push({ chunkId: chunk.id, chunkHash: chunk.contentHash, vector });
        });
        this.index.addStagingVectors(generation.id, vectors.splice(0, vectors.length));
        const locked = this.index.spaceById(space.id);
        dimension = locked?.dimension ?? dimension;
        this.jobs.updateItem(itemId, {
          phase: 'embed',
          completedUnits: this.index.stagedVectorCount(generation.id),
        });
        await this.yieldBetweenBatches?.();
      }
      this.jobs.updateItem(itemId, { phase: 'publish' });
      this.index.publishGeneration({
        generationId: generation.id,
        expect: {
          revisionId,
          textHash,
          spaceId: space.id,
          modelFingerprint: this.snapshotFor(settings.embeddingProfileId).modelFingerprint,
          dimension,
          chunkingVersion: KNOWLEDGE_CHUNKING_VERSION,
          registeredRevisionId: this.vault.registeredRevisionId(documentId) ?? '',
        },
      });
      this.jobs.updateItem(itemId, {
        phase: 'publish',
        resultRevisionId: revisionId,
        completedUnits: this.index.stagedVectorCount(generation.id),
      });
    } catch (error) {
      this.index.discardStagingGeneration(generation.id);
      throw error;
    }
  }

  private expectedSpace(itemId: string, snapshot: EmbeddingModelSnapshot) {
    const item = this.jobs.item(itemId);
    const spaceId = item ? this.jobs.job(item.jobId)?.spaceId : undefined;
    const space = spaceId ? this.index.spaceById(spaceId) : undefined;
    if (!space || space.status !== 'current') {
      throw jobError('INDEX_CONFIGURATION_CHANGED', '作业固定的向量空间已退役或不存在。');
    }
    if (space.modelFingerprint !== snapshot.modelFingerprint) {
      throw jobError('INDEX_CONFIGURATION_CHANGED', '嵌入模型配置已变化，旧 attempt 不再发布。');
    }
    return space;
  }

  private snapshotFor(profileId: string | undefined): EmbeddingModelSnapshot {
    return profileId ? this.embedding.snapshotOf(profileId) : this.embedding.defaultSnapshot();
  }

  private probeEmbedding(profileId: string | undefined): {
    ok: boolean;
    profileId?: string;
    reason?: string;
  } {
    try {
      const snapshot = this.snapshotFor(profileId);
      return { ok: true, profileId: snapshot.profileId };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '嵌入模型不可用。',
      };
    }
  }

  private registeredRevisionTargets(): JobTarget[] {
    const targets: JobTarget[] = [];
    for (const document of this.vault.listDocuments()) {
      const revisionId = this.vault.registeredRevisionId(document.id);
      if (!revisionId) continue;
      targets.push({
        kind: 'revision',
        documentId: document.id,
        revisionId,
        sourcePath: document.sourcePath,
      });
    }
    return targets;
  }

  /** 关闭语义或强制重建前，先把仍绑定旧空间的作业收口，避免旧 attempt 继续发布。 */
  private cancelSemanticJobs(): void {
    for (const job of this.jobs.listPage({ limit: 100 }).jobs) {
      if (job.kind === 'rebuild-semantic' && !isTerminalJob(job.status)) this.cancelJob(job.id);
    }
  }

  private emit(job: KnowledgeJobSummary): void {
    this.onEvent?.(job);
  }
}

const isTerminalJob = (status: KnowledgeJobSummary['status']): boolean =>
  status === 'succeeded' ||
  status === 'partial' ||
  status === 'failed' ||
  status === 'cancelled' ||
  status === 'interrupted';

function firstPhaseOf(kind: KnowledgeJobSummary['kind']): KnowledgeJobPhase {
  switch (kind) {
    case 'rebuild-semantic':
      return 'embed';
    case 'rebuild-keyword':
      return 'chunk';
    case 'check-source':
      return 'check';
    default:
      return 'read';
  }
}
