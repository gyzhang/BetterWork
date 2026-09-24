import { randomUUID } from 'node:crypto';

import { KNOWLEDGE_VECTOR_MAX_PUBLISHED } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { KnowledgeServiceError } from './knowledge-errors';

/**
 * Vault 侧索引存储（知识契约 §7.1、§8.1、§8.2）：检索派生块、共享向量空间、
 * 修订代次与语义设置。这里只有数据规则，没有调度；调度在 KnowledgeIndexService。
 *
 * 一切向量都先落 staging，只有 `publishGeneration` 让修订可见；共享空间的维度由
 * 首个合法批次以 CAS 锁定，之后任何修订都不能另立一套维度。
 */

export interface VaultSearchSettings {
  semanticEnabled: boolean;
  embeddingProfileId?: string | undefined;
  revision: number;
}

export interface EmbeddingSpace {
  id: string;
  modelFingerprint: string;
  epoch: number;
  dimension: number | undefined;
  status: 'current' | 'retired';
  createdAt: number;
}

export interface GenerationRecord {
  id: string;
  revisionId: string;
  textHash: string;
  spaceId: string;
  chunkingVersion: string;
  status: 'staging' | 'active' | 'superseded';
  chunkCount: number;
  createdAt: number;
  publishedAt?: number | undefined;
}

export interface RetrievalChunkRow {
  id: string;
  revisionId: string;
  textHash: string;
  chunkingVersion: string;
  span: { sectionOrdinal: number; start: number; end: number };
  locator: string;
  content: string;
  contentHash: string;
}

export interface StagingVector {
  chunkId: string;
  chunkHash: string;
  vector: Float32Array;
}

export type DimensionLock = 'locked' | 'matched' | 'conflict';

interface SettingsRow {
  semantic_enabled: number;
  embedding_profile_id: string | null;
  revision: number;
}

interface SpaceRow {
  id: string;
  model_fingerprint: string;
  epoch: number;
  dimension: number | null;
  status: 'current' | 'retired';
  created_at: number;
}

interface GenerationRow {
  id: string;
  revision_id: string;
  text_hash: string;
  space_id: string;
  chunking_version: string;
  status: 'staging' | 'active' | 'superseded';
  chunk_count: number;
  created_at: number;
  published_at: number | null;
}

interface RetrievalChunkDbRow {
  id: string;
  revision_id: string;
  text_hash: string;
  chunking_version: string;
  section_ordinal: number;
  start: number;
  end: number;
  locator: string;
  content: string;
  chunk_hash: string;
}

const conflict = (message: string): KnowledgeServiceError =>
  new KnowledgeServiceError('REVISION_CONFLICT', message);

const configChanged = (message: string): KnowledgeServiceError =>
  new KnowledgeServiceError('INDEX_CONFIGURATION_CHANGED', message);

const capacityExceeded = (message: string): KnowledgeServiceError =>
  new KnowledgeServiceError('INDEX_CAPACITY_EXCEEDED', message);

const invalidBatch = (message: string): KnowledgeServiceError =>
  new KnowledgeServiceError('EMBEDDING_RESPONSE_INVALID', message);

const toSpace = (row: SpaceRow): EmbeddingSpace => ({
  id: row.id,
  modelFingerprint: row.model_fingerprint,
  epoch: row.epoch,
  dimension: row.dimension ?? undefined,
  status: row.status,
  createdAt: row.created_at,
});

const toGeneration = (row: GenerationRow): GenerationRecord => ({
  id: row.id,
  revisionId: row.revision_id,
  textHash: row.text_hash,
  spaceId: row.space_id,
  chunkingVersion: row.chunking_version,
  status: row.status,
  chunkCount: row.chunk_count,
  createdAt: row.created_at,
  ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
});

const toChunk = (row: RetrievalChunkDbRow): RetrievalChunkRow => ({
  id: row.id,
  revisionId: row.revision_id,
  textHash: row.text_hash,
  chunkingVersion: row.chunking_version,
  span: { sectionOrdinal: row.section_ordinal, start: row.start, end: row.end },
  locator: row.locator,
  content: row.content,
  contentHash: row.chunk_hash,
});

/** Float32 小端序列化；打包与跨平台一致，不依赖TypedArray 内存序。 */
const vectorBlob = (vector: Float32Array): Buffer => {
  const buffer = Buffer.alloc(vector.length * 4);
  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index] ?? 0, index * 4);
  }
  return buffer;
};

export class KnowledgeIndexStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  settings(): VaultSearchSettings {
    const row = this.db
      .prepare(
        'SELECT semantic_enabled, embedding_profile_id, revision FROM knowledge_search_settings WHERE id = ?',
      )
      .get('singleton') as SettingsRow | undefined;
    if (!row) return { semanticEnabled: false, revision: 1 };
    return {
      semanticEnabled: row.semantic_enabled === 1,
      ...(row.embedding_profile_id ? { embeddingProfileId: row.embedding_profile_id } : {}),
      revision: row.revision,
    };
  }

  /** 设置走 CAS：expectedRevision 不符即拒绝，不静默覆盖另一个入口的改动。 */
  saveSettings(input: {
    expectedRevision: number;
    semanticEnabled: boolean;
    embeddingProfileId?: string | undefined;
  }): VaultSearchSettings {
    const write = this.db.transaction((): VaultSearchSettings => {
      const current = this.settings();
      if (current.revision !== input.expectedRevision) {
        throw conflict('语义设置已被其他操作更新，请重新确认后再保存。');
      }
      this.db
        .prepare(
          `UPDATE knowledge_search_settings
              SET semantic_enabled = ?, embedding_profile_id = ?, revision = revision + 1, updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(
          input.semanticEnabled ? 1 : 0,
          input.embeddingProfileId ?? null,
          Date.now(),
          'singleton',
          input.expectedRevision,
        );
      return this.settings();
    });
    return write();
  }

  currentSpace(modelFingerprint: string): EmbeddingSpace | undefined {
    const row = this.db
      .prepare(
        `SELECT id, model_fingerprint, epoch, dimension, status, created_at
           FROM knowledge_embedding_spaces WHERE model_fingerprint = ? AND status = 'current'`,
      )
      .get(modelFingerprint) as SpaceRow | undefined;
    return row ? toSpace(row) : undefined;
  }

  spaceById(id: string): EmbeddingSpace | undefined {
    const row = this.db
      .prepare(
        `SELECT id, model_fingerprint, epoch, dimension, status, created_at
           FROM knowledge_embedding_spaces WHERE id = ?`,
      )
      .get(id) as SpaceRow | undefined;
    return row ? toSpace(row) : undefined;
  }

  ensureCurrentSpace(modelFingerprint: string): EmbeddingSpace {
    const existing = this.currentSpace(modelFingerprint);
    if (existing) return existing;
    const create = this.db.transaction((): EmbeddingSpace => {
      const concurrent = this.currentSpace(modelFingerprint);
      if (concurrent) return concurrent;
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO knowledge_embedding_spaces (id, model_fingerprint, epoch, status, created_at)
           VALUES (?, ?, 1, 'current', ?)`,
        )
        .run(id, modelFingerprint, Date.now());
      const created = this.spaceById(id);
      if (!created) throw configChanged('向量空间创建后不可见，索引配置已变化。');
      return created;
    });
    return create();
  }

  /**
   * 强制重建：同一事务退役旧 current、按 epoch+1 建新空间。
   * 旧空间立刻从查询与覆盖率排除，不等新空间产出任何向量。
   */
  resetCurrentSpace(modelFingerprint: string): { retiredIds: string[]; space: EmbeddingSpace } {
    const write = this.db.transaction((): { retiredIds: string[]; space: EmbeddingSpace } => {
      const retiredRows = this.db
        .prepare(
          `SELECT id FROM knowledge_embedding_spaces
            WHERE model_fingerprint = ? AND status = 'current'`,
        )
        .all(modelFingerprint) as Array<{ id: string }>;
      const retiredIds = retiredRows.map((row) => row.id);
      this.db
        .prepare(
          `UPDATE knowledge_embedding_spaces SET status = 'retired'
            WHERE model_fingerprint = ? AND status = 'current'`,
        )
        .run(modelFingerprint);
      const maxEpoch = this.db
        .prepare(
          'SELECT COALESCE(MAX(epoch), 0) AS epoch FROM knowledge_embedding_spaces WHERE model_fingerprint = ?',
        )
        .get(modelFingerprint) as { epoch: number };
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO knowledge_embedding_spaces (id, model_fingerprint, epoch, status, created_at)
           VALUES (?, ?, ?, 'current', ?)`,
        )
        .run(id, modelFingerprint, maxEpoch.epoch + 1, Date.now());
      const space = this.spaceById(id);
      if (!space) throw configChanged('重建后的向量空间不可见，索引配置已变化。');
      return { retiredIds, space };
    });
    return write();
  }

  /** 共享维度 CAS：首个合法批次锁定；已锁定时只接受相同维度。 */
  lockDimension(spaceId: string, dimension: number): DimensionLock {
    const claim = this.db
      .prepare(
        'UPDATE knowledge_embedding_spaces SET dimension = ? WHERE id = ? AND dimension IS NULL',
      )
      .run(dimension, spaceId);
    if (claim.changes > 0) return 'locked';
    const space = this.spaceById(spaceId);
    if (!space) throw configChanged('向量空间已不存在。');
    if (space.dimension === undefined) throw configChanged('向量空间状态异常，无法锁定维度。');
    return space.dimension === dimension ? 'matched' : 'conflict';
  }

  replaceRetrievalChunks(
    revisionId: string,
    textHash: string,
    title: string,
    chunks: readonly {
      id: string;
      chunkingVersion: string;
      span: { sectionOrdinal: number; start: number; end: number };
      locator: string;
      content: string;
      contentHash: string;
    }[],
  ): void {
    this.db
      .prepare(
        'DELETE FROM knowledge_retrieval_fts WHERE chunk_id IN (SELECT id FROM knowledge_retrieval_chunks WHERE revision_id = ?)',
      )
      .run(revisionId);
    this.db.prepare('DELETE FROM knowledge_retrieval_chunks WHERE revision_id = ?').run(revisionId);
    const insertChunk = this.db.prepare(
      `INSERT INTO knowledge_retrieval_chunks
        (id, revision_id, text_hash, chunking_version, section_ordinal, start, end, locator, content, chunk_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = this.db.prepare(
      'INSERT INTO knowledge_retrieval_fts (chunk_id, title, content) VALUES (?, ?, ?)',
    );
    for (const chunk of chunks) {
      insertChunk.run(
        chunk.id,
        revisionId,
        textHash,
        chunk.chunkingVersion,
        chunk.span.sectionOrdinal,
        chunk.span.start,
        chunk.span.end,
        chunk.locator,
        chunk.content,
        chunk.contentHash,
      );
      insertFts.run(chunk.id, title, chunk.content);
    }
  }

  retrievalChunks(revisionId: string): RetrievalChunkRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, revision_id, text_hash, chunking_version, section_ordinal, start, end,
                locator, content, chunk_hash
           FROM knowledge_retrieval_chunks WHERE revision_id = ?
          ORDER BY section_ordinal, start`,
      )
      .all(revisionId) as RetrievalChunkDbRow[];
    return rows.map(toChunk);
  }

  createStagingGeneration(input: {
    revisionId: string;
    textHash: string;
    spaceId: string;
    modelSnapshot: unknown;
    chunkingVersion: string;
    chunkCount: number;
  }): GenerationRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO knowledge_index_generations
          (id, revision_id, text_hash, space_id, model_snapshot_json, chunking_version, status,
           chunk_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'staging', ?, ?)`,
      )
      .run(
        id,
        input.revisionId,
        input.textHash,
        input.spaceId,
        JSON.stringify(input.modelSnapshot),
        input.chunkingVersion,
        input.chunkCount,
        Date.now(),
      );
    const created = this.generation(id);
    if (!created) throw configChanged('代次创建后不可见。');
    return created;
  }

  generation(id: string): GenerationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, revision_id, text_hash, space_id, chunking_version, status, chunk_count,
                created_at, published_at
           FROM knowledge_index_generations WHERE id = ?`,
      )
      .get(id) as GenerationRow | undefined;
    return row ? toGeneration(row) : undefined;
  }

  activeGeneration(revisionId: string, spaceId: string): GenerationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, revision_id, text_hash, space_id, chunking_version, status, chunk_count,
                created_at, published_at
           FROM knowledge_index_generations
          WHERE revision_id = ? AND space_id = ? AND status = 'active'`,
      )
      .get(revisionId, spaceId) as GenerationRow | undefined;
    return row ? toGeneration(row) : undefined;
  }

  /** staging 批次只在全部校验通过后写入，逐批追加不产生半成品可见性。 */
  addStagingVectors(generationId: string, vectors: readonly StagingVector[]): void {
    const generation = this.generation(generationId);
    if (!generation) throw configChanged('代次已不存在，旧批次结果不再写入。');
    if (generation.status !== 'staging') {
      throw configChanged('代次已发布，不能继续写入向量。');
    }
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO knowledge_chunk_vectors (generation_id, chunk_id, vector, chunk_hash)
       VALUES (?, ?, ?, ?)`,
    );
    const write = this.db.transaction((): void => {
      for (const item of vectors) {
        insert.run(generationId, item.chunkId, vectorBlob(item.vector), item.chunkHash);
      }
    });
    write();
  }

  stagedVectorCount(generationId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM knowledge_chunk_vectors WHERE generation_id = ?')
      .get(generationId) as { count: number };
    return row.count;
  }

  /**
   * 单修订原子发布（契约 §8.1/§8.2）：发布前复核登记、文本哈希、空间状态与维度、
   * 模型指纹和向量完整性；同空间同算法的旧 active 先 superseded 再激活新代次。
   */
  publishGeneration(input: {
    generationId: string;
    expect: {
      revisionId: string;
      textHash: string;
      spaceId: string;
      modelFingerprint: string;
      dimension: number;
      chunkingVersion: string;
      registeredRevisionId: string;
    };
  }): GenerationRecord {
    const write = this.db.transaction((): GenerationRecord => {
      const generation = this.generation(input.generationId);
      if (!generation || generation.status !== 'staging') {
        throw configChanged('代次不存在或已不可发布。');
      }
      const expected = input.expect;
      if (
        generation.revisionId !== expected.revisionId ||
        generation.textHash !== expected.textHash ||
        generation.spaceId !== expected.spaceId ||
        generation.chunkingVersion !== expected.chunkingVersion
      ) {
        throw configChanged('发布前复核发现修订或空间身份变化。');
      }
      if (expected.registeredRevisionId !== expected.revisionId) {
        throw configChanged('修订已不再是该文档的当前登记版本，旧 attempt 不发布。');
      }
      const space = this.spaceById(expected.spaceId);
      if (!space || space.status !== 'current') {
        throw configChanged('向量空间已退役，本次结果不再发布。');
      }
      if (space.modelFingerprint !== expected.modelFingerprint) {
        throw configChanged('模型指纹已变化，旧向量空间不再可用。');
      }
      if (space.dimension !== expected.dimension) {
        throw configChanged('共享空间维度与本批次不一致。');
      }
      const staged = this.db
        .prepare(`SELECT COUNT(*) AS count FROM knowledge_chunk_vectors WHERE generation_id = ?`)
        .get(generation.id) as { count: number };
      if (staged.count !== generation.chunkCount) {
        throw invalidBatch('向量批次数量与派生块不一致，保持关键词可用而不发布。');
      }
      const total = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM knowledge_chunk_vectors vectors
             JOIN knowledge_index_generations generations ON generations.id = vectors.generation_id
            WHERE generations.space_id = ? AND generations.status = 'active'`,
        )
        .get(expected.spaceId) as { count: number };
      if (total.count + staged.count > KNOWLEDGE_VECTOR_MAX_PUBLISHED) {
        throw capacityExceeded(
          `当前空间向量规模已达上限 ${KNOWLEDGE_VECTOR_MAX_PUBLISHED}，关键词检索保持可用。`,
        );
      }
      this.db
        .prepare(
          `UPDATE knowledge_index_generations SET status = 'superseded'
            WHERE revision_id = ? AND space_id = ? AND chunking_version = ? AND status = 'active'`,
        )
        .run(generation.revisionId, generation.spaceId, generation.chunkingVersion);
      this.db
        .prepare(
          "UPDATE knowledge_index_generations SET status = 'active', published_at = ? WHERE id = ?",
        )
        .run(Date.now(), generation.id);
      const published = this.generation(generation.id);
      if (!published) throw configChanged('发布后代次不可见。');
      return published;
    });
    return write();
  }

  /** 清理只动未发布代次；已发布或已被取代的代次保留为可回溯历史。 */
  discardStagingGeneration(generationId: string): void {
    const remove = this.db.transaction((): void => {
      this.db
        .prepare('DELETE FROM knowledge_chunk_vectors WHERE generation_id = ?')
        .run(generationId);
      this.db
        .prepare("DELETE FROM knowledge_index_generations WHERE id = ? AND status = 'staging'")
        .run(generationId);
    });
    remove();
  }

  coverage(spaceId: string): { revisions: number; vectors: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT generations.revision_id) AS revisions,
                COUNT(vectors.generation_id) AS vectors
           FROM knowledge_index_generations generations
           LEFT JOIN knowledge_chunk_vectors vectors ON vectors.generation_id = generations.id
          WHERE generations.space_id = ? AND generations.status = 'active'`,
      )
      .get(spaceId) as { revisions: number; vectors: number };
    return { revisions: row.revisions, vectors: row.vectors };
  }
}
