import { abortError, isAbortError } from '@betterwork/agent-core';
import type { EmbeddingModelSnapshot } from '@betterwork/agent-protocol';
import {
  countCodePoints,
  KNOWLEDGE_SEARCH_CANDIDATE_LIMIT,
  KNOWLEDGE_SEARCH_RRF_K,
  KNOWLEDGE_SEARCH_SUMMARY_MAX_CODE_POINTS,
  KNOWLEDGE_VECTOR_MAX_PUBLISHED,
  KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES,
  type KnowledgeLibraryFilter,
  type KnowledgeMaterialReference,
  type KnowledgeSearchDegradedReason,
  type KnowledgeSearchEffectiveMode,
  type KnowledgeSearchHit,
  type KnowledgeSearchMode,
  type KnowledgeSearchResponse,
  type KnowledgeSearchScope,
} from '@betterwork/agent-protocol';

import { type EmbeddingRunner } from './knowledge-index-service';
import type { KnowledgeIndexStore, ScopedRetrievalChunk } from './knowledge-index-store';
import { makeSpanExcerpt, sha256Hex, sliceCodePoints } from './knowledge-text';
import type { KnowledgeVault } from './knowledge-vault';
import type { WorkerScanRequest } from './knowledge-worker-runner';

/**
 * 统一混合检索（知识契约 §9）：管理 IPC 与 `knowledge_search` 工具共用一条管线。
 * scope 先解析、候选在允许集合内过滤后才截断；两路 RRF 融合、按 chunkId 去重，
 * 摘要 span 与哈希回算到 section。语义路任何异常都回到可解释降级，绝不越界补候选。
 */

export interface KnowledgeSearchInput {
  readonly scope: KnowledgeSearchScope;
  readonly query: string;
  readonly mode?: KnowledgeSearchMode;
  readonly signal?: AbortSignal;
  /** 请求入口限额（管理页 50、工具 8）；契约 §9.2 在重叠处理后截取。 */
  readonly limit?: number;
}

export interface KnowledgeSearchServiceDeps {
  readonly vault: KnowledgeVault;
  readonly index: KnowledgeIndexStore;
  /** Run 材料只信宿主快照；undefined＝无快照（旧任务），返回空范围而非全库。 */
  readonly runMaterials: (runId: string) => readonly KnowledgeMaterialReference[] | undefined;
  readonly embedding: EmbeddingRunner;
  readonly scan?:
    | ((request: WorkerScanRequest) => Promise<Array<{ chunkId: string; score: number }>>)
    | undefined;
}

interface ScoredChunk {
  readonly chunk: ScopedRetrievalChunk;
  readonly rank: number;
}

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

/** NFKC＋lowercase＋Unicode 空白/标点分词；去重并保留顺序（契约 §9.1.3）。 */
export function tokenizeQuery(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of normalize(query.trim()).split(/[\s\p{P}\p{S}]+/u)) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

const ftsMatch = (terms: readonly string[]): string =>
  terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');

function identityOrder(left: ScopedRetrievalChunk, right: ScopedRetrievalChunk): number {
  return (
    left.revisionId.localeCompare(right.revisionId) ||
    left.span.sectionOrdinal - right.span.sectionOrdinal ||
    left.span.start - right.span.start
  );
}

function referenceOf(chunk: ScopedRetrievalChunk): KnowledgeMaterialReference {
  return {
    kind: 'knowledge-revision',
    knowledgeDocumentId: chunk.documentId,
    knowledgeRevisionId: chunk.revisionId,
    contentHash: chunk.revisionContentHash,
    sourcePath: chunk.sourcePath,
  };
}

/** 摘要实际 span 回算到 section（契约 §9.2），不能拿整块冒充返回范围。 */
function hitOf(
  chunk: ScopedRetrievalChunk,
  query: string,
  matchedBy: KnowledgeSearchHit['matchedBy'],
): KnowledgeSearchHit {
  const max = KNOWLEDGE_SEARCH_SUMMARY_MAX_CODE_POINTS;
  const windowStart = chunk.span.start;
  if (matchedBy === 'vector') {
    const text = sliceCodePoints(chunk.content, 0, max);
    return {
      chunkId: chunk.id,
      reference: referenceOf(chunk),
      textHash: chunk.textHash,
      title: chunk.title,
      format: chunk.format,
      locator: chunk.locator,
      span: {
        sectionOrdinal: chunk.span.sectionOrdinal,
        start: windowStart,
        end: windowStart + countCodePoints(text),
      },
      excerpt: text,
      excerptHash: sha256Hex(text),
      matchedBy,
    };
  }
  const excerpt = makeSpanExcerpt(chunk.content, query, chunk.span.sectionOrdinal, max);
  return {
    chunkId: chunk.id,
    reference: referenceOf(chunk),
    textHash: chunk.textHash,
    title: chunk.title,
    format: chunk.format,
    locator: chunk.locator,
    span: {
      sectionOrdinal: excerpt.span.sectionOrdinal,
      start: excerpt.span.start + windowStart,
      end: excerpt.span.end + windowStart,
    },
    excerpt: excerpt.text,
    excerptHash: excerpt.excerptHash,
    matchedBy,
  };
}

export class KnowledgeSearchService {
  private readonly vault: KnowledgeVault;
  private readonly index: KnowledgeIndexStore;
  private readonly runMaterials: KnowledgeSearchServiceDeps['runMaterials'];
  private readonly embedding: EmbeddingRunner;
  private readonly scan: KnowledgeSearchServiceDeps['scan'];

  constructor(deps: KnowledgeSearchServiceDeps) {
    this.vault = deps.vault;
    this.index = deps.index;
    this.runMaterials = deps.runMaterials;
    this.embedding = deps.embedding;
    this.scan = deps.scan;
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResponse> {
    const startedAt = Date.now();
    const signal = input.signal ?? new AbortController().signal;
    const requestedMode: KnowledgeSearchMode = input.mode ?? 'hybrid';
    const revisionIds = this.resolveScope(input.scope);
    const emptyCoverage = { eligibleChunks: 0, indexedChunks: 0 };
    if (revisionIds.length === 0) {
      // 空选材＝空结果：零 HTTP、不回退全库（契约 §9.1.1）。
      return {
        results: [],
        requestedMode,
        effectiveMode: 'keyword',
        coverage: emptyCoverage,
        durationMs: Date.now() - startedAt,
      };
    }

    const terms = tokenizeQuery(input.query);
    const keywordCandidates: ScoredChunk[] =
      terms.length === 0
        ? []
        : this.index
            .searchChunks(revisionIds, ftsMatch(terms))
            .map((chunk, index) => ({ chunk, rank: index + 1 }));
    const keywordPath =
      keywordCandidates.length > 0 ? keywordCandidates : this.substringFallback(revisionIds, terms);

    let degraded: KnowledgeSearchDegradedReason | undefined;
    let vectorCandidates: ScoredChunk[] = [];
    let semanticRan = false;
    const scopeChunks = this.index.chunksInScope(revisionIds);
    let coverage = { eligibleChunks: scopeChunks.length, indexedChunks: 0 };

    if (requestedMode === 'hybrid') {
      const semantic = await this.vectorPath(terms, input.query, revisionIds, scopeChunks, signal);
      degraded = semantic.degraded;
      vectorCandidates = semantic.candidates;
      semanticRan = semantic.ran;
      coverage = semantic.coverage;
    }

    const merged = this.fuse(keywordPath, vectorCandidates, input.query);
    const limited = merged.slice(0, input.limit ?? KNOWLEDGE_SEARCH_CANDIDATE_LIMIT);
    if (signal.aborted) throw abortError();

    let effectiveMode: KnowledgeSearchEffectiveMode = 'keyword';
    if (keywordPath.length === 0 && vectorCandidates.length > 0) effectiveMode = 'vector';
    else if (semanticRan) effectiveMode = 'hybrid';

    return {
      results: limited,
      requestedMode,
      effectiveMode,
      ...(degraded ? { degradedReason: degraded } : {}),
      coverage,
      durationMs: Date.now() - startedAt,
    };
  }

  private resolveScope(scope: KnowledgeSearchScope): string[] {
    if (scope.kind === 'run') {
      const materials = this.runMaterials(scope.runId) ?? [];
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const material of materials) {
        if (material.kind !== 'knowledge-revision' || seen.has(material.knowledgeRevisionId))
          continue;
        seen.add(material.knowledgeRevisionId);
        ids.push(material.knowledgeRevisionId);
      }
      return ids;
    }
    const filter: KnowledgeLibraryFilter =
      scope.collectionId !== undefined
        ? { kind: 'collection', collectionId: scope.collectionId }
        : scope.uncategorized === true
          ? { kind: 'uncategorized' }
          : { kind: 'all' };
    const ids: string[] = [];
    // 集合过滤发生在候选收集之前：未选集合的资料不占 top 名额（契约 §10.1）。
    for (const document of this.vault.listDocuments(filter)) {
      const revisionId = this.vault.registeredRevisionId(document.id);
      if (revisionId) ids.push(revisionId);
    }
    return ids;
  }

  /** 零 FTS 命中才回退：所有词都出现在规范化 title 或 chunk content 中（契约 §9.1.4）。 */
  private substringFallback(
    revisionIds: readonly string[],
    terms: readonly string[],
  ): ScoredChunk[] {
    if (terms.length === 0) return [];
    const scored: Array<{ chunk: ScopedRetrievalChunk; titleHits: number; contentHit: number }> =
      [];
    for (const chunk of this.index.chunksInScope(revisionIds)) {
      const title = normalize(chunk.title);
      const content = normalize(chunk.content);
      const titleHits = terms.filter((term) => title.includes(term)).length;
      const hitTerm = terms.find((term) => content.includes(term));
      const contentHit = hitTerm === undefined ? -1 : content.indexOf(hitTerm);
      if (!terms.every((term) => title.includes(term) || content.includes(term))) continue;
      scored.push({ chunk, titleHits, contentHit });
    }
    scored.sort((left, right) => {
      if (right.titleHits !== left.titleHits) return right.titleHits - left.titleHits;
      const leftBody = left.contentHit < 0 ? Number.POSITIVE_INFINITY : left.contentHit;
      const rightBody = right.contentHit < 0 ? Number.POSITIVE_INFINITY : right.contentHit;
      if (leftBody !== rightBody) return leftBody - rightBody;
      return identityOrder(left.chunk, right.chunk);
    });
    return scored.slice(0, KNOWLEDGE_SEARCH_CANDIDATE_LIMIT).map((entry, index) => ({
      chunk: entry.chunk,
      rank: index + 1,
    }));
  }

  private async vectorPath(
    terms: readonly string[],
    query: string,
    revisionIds: readonly string[],
    scopeChunks: readonly ScopedRetrievalChunk[],
    signal: AbortSignal,
  ): Promise<{
    candidates: ScoredChunk[];
    degraded?: KnowledgeSearchDegradedReason;
    ran: boolean;
    coverage: { eligibleChunks: number; indexedChunks: number };
  }> {
    const eligible = { eligibleChunks: scopeChunks.length, indexedChunks: 0 };
    const fail = (reason: KnowledgeSearchDegradedReason) => ({
      candidates: [] as ScoredChunk[],
      degraded: reason,
      ran: false,
      coverage: eligible,
    });
    if (terms.length === 0) return fail('index-missing');
    const settings = this.index.settings();
    if (!settings.semanticEnabled) return fail('semantic-disabled');
    let snapshot: EmbeddingModelSnapshot;
    try {
      snapshot =
        settings.embeddingProfileId === undefined
          ? this.embedding.defaultSnapshot()
          : this.embedding.snapshotOf(settings.embeddingProfileId);
    } catch {
      return fail('model-unavailable');
    }
    const space = this.index.currentSpace(snapshot.modelFingerprint);
    const dimension = space?.dimension;
    if (!space || dimension === undefined) return fail('index-missing');
    const generationIds: string[] = [];
    for (const revisionId of revisionIds) {
      const generation = this.index.activeGeneration(revisionId, space.id);
      if (generation) generationIds.push(generation.id);
    }
    const coverageRows = this.index.scopeCoverage(revisionIds, generationIds);
    if (coverageRows.indexedChunks === 0) {
      // 没有任何覆盖就直接关键词，避免无意义的模型调用（契约 §9.2）。
      return { ...fail('index-missing'), coverage: coverageRows };
    }
    if (coverageRows.indexedChunks > KNOWLEDGE_VECTOR_MAX_PUBLISHED) {
      return { ...fail('capacity-exceeded'), coverage: coverageRows };
    }
    let queryVector: Float32Array | undefined;
    try {
      const result = await this.embedding.embed({ snapshot, inputs: [query], signal });
      queryVector = result.vectors[0];
      if (!queryVector || queryVector.length !== dimension) {
        return { ...fail('index-stale'), coverage: coverageRows };
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { ...fail('embedding-failed'), coverage: coverageRows };
    }
    const rows = this.index
      .vectorsInGenerations(generationIds)
      .filter((row) => row.vector.length === dimension);
    const chunkById = new Map(scopeChunks.map((chunk) => [chunk.id, chunk] as const));
    const scannable = rows.filter((row) => chunkById.has(row.chunkId));
    const scores = await this.scanAll(space.id, dimension, queryVector, scannable, signal);
    if (scores === null) {
      return { ...fail('embedding-failed'), coverage: coverageRows };
    }
    if (signal.aborted) throw abortError();
    // 租约复核：查询开始时固定的 space 必须仍是该指纹的 current（契约 §8.3）。
    const stillValid = this.index.currentSpace(snapshot.modelFingerprint);
    if (!stillValid || stillValid.id !== space.id) {
      return { ...fail('index-stale'), coverage: coverageRows };
    }
    const withChunks = scores.flatMap((entry) => {
      const chunk = chunkById.get(entry.chunkId);
      return chunk ? [{ chunk, score: entry.score, row: entry }] : [];
    });
    withChunks.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return identityOrder(left.chunk, right.chunk);
    });
    const candidates = withChunks
      .slice(0, KNOWLEDGE_SEARCH_CANDIDATE_LIMIT)
      .map((entry, index) => ({ chunk: entry.chunk, rank: index + 1 }));
    const degraded =
      coverageRows.indexedChunks < coverageRows.eligibleChunks ? 'index-partial' : undefined;
    return {
      candidates,
      ran: true,
      coverage: coverageRows,
      ...(degraded ? { degraded } : {}),
    };
  }

  /** 逐批交给扫描通道；返回 null＝语义路失败可降级，抛错＝用户取消。 */
  private async scanAll(
    spaceId: string,
    dimension: number,
    query: Float32Array,
    rows: ReadonlyArray<{ chunkId: string; vector: Float32Array }>,
    signal: AbortSignal,
  ): Promise<Array<{ chunkId: string; score: number }> | null> {
    if (!this.scan) return null;
    const perBatch = Math.max(
      1,
      Math.floor(
        KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES / (dimension * Float32Array.BYTES_PER_ELEMENT),
      ),
    );
    const collected: Array<{ chunkId: string; score: number }> = [];
    try {
      for (let offset = 0; offset < rows.length; offset += perBatch) {
        if (signal.aborted) throw abortError();
        const batch = rows.slice(offset, offset + perBatch);
        collected.push(...(await this.scan({ spaceId, dimension, query, entries: batch })));
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
    return collected;
  }

  /** 两路同权 RRF（k=60）＋ chunkId 去重；同修订同 section 的重叠只留排名最高的一块。 */
  private fuse(
    keywordPath: readonly ScoredChunk[],
    vectorPath: readonly ScoredChunk[],
    query: string,
  ): KnowledgeSearchHit[] {
    const byChunk = new Map<
      string,
      { chunk: ScopedRetrievalChunk; rrf: number; inKeyword: boolean; inVector: boolean }
    >();
    const add = (entry: ScoredChunk, inKeyword: boolean, inVector: boolean): void => {
      const current = byChunk.get(entry.chunk.id);
      const contribution = 1 / (KNOWLEDGE_SEARCH_RRF_K + entry.rank);
      if (!current) {
        byChunk.set(entry.chunk.id, {
          chunk: entry.chunk,
          rrf: contribution,
          inKeyword,
          inVector,
        });
        return;
      }
      current.rrf += contribution;
      byChunk.set(entry.chunk.id, {
        chunk: current.chunk,
        rrf: current.rrf,
        inKeyword: current.inKeyword || inKeyword,
        inVector: current.inVector || inVector,
      });
    };
    for (const entry of keywordPath) add(entry, true, false);
    for (const entry of vectorPath) add(entry, false, true);
    const ordered = [...byChunk.values()].sort((left, right) => {
      if (right.rrf !== left.rrf) return right.rrf - left.rrf;
      return identityOrder(left.chunk, right.chunk);
    });
    const kept: Array<{ revisionId: string; section: number; start: number; end: number }> = [];
    const hits: KnowledgeSearchHit[] = [];
    for (const entry of ordered) {
      const overlaps = kept.some(
        (keptSpan) =>
          keptSpan.revisionId === entry.chunk.revisionId &&
          keptSpan.section === entry.chunk.span.sectionOrdinal &&
          keptSpan.start < entry.chunk.span.end &&
          entry.chunk.span.start < keptSpan.end,
      );
      if (overlaps) continue;
      kept.push({
        revisionId: entry.chunk.revisionId,
        section: entry.chunk.span.sectionOrdinal,
        start: entry.chunk.span.start,
        end: entry.chunk.span.end,
      });
      const matchedBy =
        entry.inKeyword && entry.inVector ? 'both' : entry.inKeyword ? 'keyword' : 'vector';
      hits.push(hitOf(entry.chunk, query, matchedBy));
    }
    return hits;
  }
}
