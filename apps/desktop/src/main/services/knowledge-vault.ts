import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  countCodePoints,
  type DeleteKnowledgeCollectionRequest,
  KNOWLEDGE_REVISION_MAX_TEXT_CODE_POINTS,
  KNOWLEDGE_SEARCH_CANDIDATE_LIMIT,
  KNOWLEDGE_SEARCH_SUMMARY_MAX_CODE_POINTS,
  type KnowledgeCollection,
  type KnowledgeCollectionMembersResult,
  type KnowledgeCursor,
  type KnowledgeDocumentSummary,
  type KnowledgeFormat,
  type KnowledgeImportResult,
  type KnowledgeLibraryFilter,
  type KnowledgeMaterialReference,
  type KnowledgeRefreshResult,
  type KnowledgeRevisionSummary,
  type KnowledgeSearchResult,
  type KnowledgeSemanticState,
  type KnowledgeSourceStatus,
  type KnowledgeTextPage,
  type KnowledgeWarningCode,
  knowledgeWarningCodeSchema,
  type KnowledgeWorkerJobContext,
  type SaveKnowledgeCollectionRequest,
  type SetKnowledgeCollectionMembersRequest,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { z } from 'zod';

import { openKnowledgeDatabase } from '../db';
import { buildRetrievalChunks } from './knowledge-chunks';
import { KnowledgeServiceError } from './knowledge-errors';
import {
  type DocumentExtractor,
  extractDocument,
  type ExtractedDocument,
} from './knowledge-extract';
import { KnowledgeIndexStore } from './knowledge-index-store';
import { KnowledgeJobStore } from './knowledge-job-store';
import { makeSpanExcerpt, readKnowledgeTextPage, revisionTextHash } from './knowledge-text';

const parserVersion = 'text-extract-v1';
const chunkingVersion = 'format-locator-v1';

const revisionColumns = `id, document_id, revision, title, source_path, format, byte_size, content_hash,
                content, page_count, parser_version, chunking_version, text_hash, section_count,
                warnings_json, imported_at, created_at`;

interface KnowledgeRow {
  id: string;
  title: string;
  source_path: string;
  format: KnowledgeFormat;
  byte_size: number;
  content_hash: string;
  page_count: number | null;
  imported_at: number;
  updated_at: number;
  source_status: KnowledgeSourceStatus;
  source_checked_at: number | null;
  membership_revision: number;
}

interface CollectionRow {
  id: string;
  name: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

interface KnowledgeRevisionRow {
  id: string;
  document_id: string;
  revision: number;
  title: string;
  source_path: string;
  format: KnowledgeFormat;
  byte_size: number;
  content_hash: string;
  content: string;
  page_count: number | null;
  parser_version: string;
  chunking_version: string;
  text_hash: string;
  section_count: number;
  warnings_json: string;
  imported_at: number;
  created_at: number;
}

export type { KnowledgeRevisionSummary } from '@betterwork/agent-protocol';

export interface KnowledgeRevisionDetail extends KnowledgeRevisionSummary {
  content: string;
  chunks: Array<{ locator: string; ordinal: number; content: string }>;
}

const supportedFormats: Record<string, KnowledgeFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.csv': 'csv',
  '.pptx': 'pptx',
};
const maxBytes = 20 * 1024 * 1024;

export class KnowledgeVault {
  private readonly db: Database.Database;
  /** 派生块、向量空间与作业都由同一连接读写，避免两个连接在同一库上互相看不见。 */
  readonly index: KnowledgeIndexStore;
  readonly jobs: KnowledgeJobStore;

  private readonly extractor: DocumentExtractor;

  /** schema 与历史库对账由 db/knowledge-schema.ts 的版本化迁移负责，服务层不碰 DDL。 */
  constructor(filePath: string, deps?: { readonly extractor?: DocumentExtractor }) {
    this.db = openKnowledgeDatabase(filePath);
    this.index = new KnowledgeIndexStore(this.db);
    this.jobs = new KnowledgeJobStore(this.db);
    this.extractor = deps?.extractor ?? extractDocument;
  }

  listDocuments(filter?: KnowledgeLibraryFilter): KnowledgeDocumentSummary[] {
    let membership = '';
    const filterParams: string[] = [];
    if (filter && filter.kind === 'uncategorized') {
      membership = `WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_collection_members m
         WHERE m.document_id = knowledge_documents.id
      )`;
    } else if (filter && filter.kind === 'collection') {
      membership = `WHERE EXISTS (
        SELECT 1 FROM knowledge_collection_members m
         WHERE m.document_id = knowledge_documents.id AND m.collection_id = ?
      )`;
      filterParams.push(filter.collectionId);
    }
    const rows = this.db
      .prepare(
        `SELECT id, title, source_path, format, byte_size, content_hash, page_count, imported_at, updated_at,
                source_status, source_checked_at, membership_revision,
                (SELECT r.id FROM knowledge_revisions r
                  WHERE r.document_id = knowledge_documents.id
                  ORDER BY r.revision DESC LIMIT 1) AS current_revision_id
           FROM knowledge_documents ${membership}
          ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(...filterParams) as Array<KnowledgeRow & { current_revision_id: string | null }>;
    return rows.map((row) => ({
      ...this.toSummary(row, row.current_revision_id ?? undefined),
      ...(row.current_revision_id ? { currentRevisionId: row.current_revision_id } : {}),
    }));
  }

  /** 单层集合管理（契约 §10.1）：名称规范化唯一，成员/改名/删除都不触碰原件与修订。 */
  listCollections(): KnowledgeCollection[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, revision, created_at, updated_at FROM knowledge_collections ORDER BY created_at, id',
      )
      .all() as CollectionRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  saveCollection(input: SaveKnowledgeCollectionRequest): KnowledgeCollection[] {
    const nameKey = input.name.normalize('NFKC').trim().toLocaleLowerCase();
    const write = this.db.transaction((): void => {
      const clash = this.db
        .prepare('SELECT id FROM knowledge_collections WHERE name_key = ?')
        .get(nameKey) as { id: string } | undefined;
      if (input.mode === 'create') {
        if (clash) {
          throw new KnowledgeServiceError(
            'COLLECTION_NAME_TAKEN',
            '已有同名集合（忽略大小写与全角差异），请换个名字。',
          );
        }
        const now = Date.now();
        this.db
          .prepare(
            `INSERT INTO knowledge_collections (id, name, name_key, revision, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(randomUUID(), input.name.trim(), nameKey, now, now);
        return;
      }
      if (clash && clash.id !== input.id) {
        throw new KnowledgeServiceError(
          'COLLECTION_NAME_TAKEN',
          '已有同名集合（忽略大小写与全角差异），请换个名字。',
        );
      }
      const updated = this.db
        .prepare(
          `UPDATE knowledge_collections
              SET name = ?, name_key = ?, revision = revision + 1, updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(input.name.trim(), nameKey, Date.now(), input.id, input.expectedRevision);
      if (updated.changes === 0) {
        throw new KnowledgeServiceError(
          'COLLECTION_NOT_FOUND',
          '集合不存在或已被其他操作更新，请刷新后重试。',
        );
      }
    });
    write();
    return this.listCollections();
  }

  deleteCollection(input: DeleteKnowledgeCollectionRequest): KnowledgeCollection[] {
    const removed = this.db
      .prepare('DELETE FROM knowledge_collections WHERE id = ? AND revision = ?')
      .run(input.id, input.expectedRevision);
    if (removed.changes === 0) {
      throw new KnowledgeServiceError(
        'COLLECTION_NOT_FOUND',
        '集合不存在或已被其他操作更新，请刷新后重试。',
      );
    }
    return this.listCollections();
  }

  /** replace-set ＋成员 CAS：两个窗口互相覆盖不可能静默发生。 */
  setCollectionMembers(
    input: SetKnowledgeCollectionMembersRequest,
  ): KnowledgeCollectionMembersResult {
    const write = this.db.transaction((): KnowledgeCollectionMembersResult => {
      const document = this.db
        .prepare('SELECT membership_revision FROM knowledge_documents WHERE id = ?')
        .get(input.documentId) as { membership_revision: number } | undefined;
      if (!document) {
        throw new KnowledgeServiceError('KNOWLEDGE_DOCUMENT_REMOVED', '资料已不在当前资料库中。');
      }
      if (document.membership_revision !== input.expectedMembershipRevision) {
        throw new KnowledgeServiceError(
          'OPERATION_CONFLICT',
          '分类刚被其他操作更新，请刷新后重新保存。',
        );
      }
      for (const collectionId of input.collectionIds) {
        const known = this.db
          .prepare('SELECT 1 AS present FROM knowledge_collections WHERE id = ?')
          .get(collectionId) as { present: number } | undefined;
        if (!known) {
          throw new KnowledgeServiceError('COLLECTION_NOT_FOUND', '引用了不存在或已删除的集合。');
        }
      }
      this.db
        .prepare('DELETE FROM knowledge_collection_members WHERE document_id = ?')
        .run(input.documentId);
      const insert = this.db.prepare(
        'INSERT INTO knowledge_collection_members (collection_id, document_id) VALUES (?, ?)',
      );
      for (const collectionId of input.collectionIds) {
        insert.run(collectionId, input.documentId);
      }
      this.db
        .prepare(
          'UPDATE knowledge_documents SET membership_revision = membership_revision + 1 WHERE id = ?',
        )
        .run(input.documentId);
      const next = this.db
        .prepare('SELECT membership_revision FROM knowledge_documents WHERE id = ?')
        .get(input.documentId) as { membership_revision: number };
      return {
        membershipRevision: next.membership_revision,
        collectionIds: [...input.collectionIds].sort(),
      };
    });
    return write();
  }

  private collectionIdsOf(documentId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT collection_id FROM knowledge_collection_members WHERE document_id = ? ORDER BY collection_id',
      )
      .all(documentId) as Array<{ collection_id: string }>;
    return rows.map((row) => row.collection_id);
  }

  async importPaths(sourcePaths: string[]): Promise<KnowledgeImportResult> {
    const imported: KnowledgeDocumentSummary[] = [];
    const skipped: KnowledgeImportResult['skipped'] = [];
    for (const sourcePath of sourcePaths) {
      try {
        imported.push((await this.importSource(sourcePath)).document);
      } catch (error) {
        skipped.push({
          sourcePath,
          reason:
            error instanceof KnowledgeServiceError
              ? error.message
              : error instanceof Error
                ? `导入失败：${error.message}`
                : '无法读取此文件。',
        });
      }
    }
    return { imported, skipped };
  }

  /**
   * 单个来源的读→提取→发布。作业服务按条目逐个调用它，
   * 因此每个文件都能有自己的状态、阶段与可解释失败原因。
   */
  async importSource(
    sourcePath: string,
    context?: KnowledgeWorkerJobContext,
  ): Promise<{ document: KnowledgeDocumentSummary; revisionId: string; textHash: string }> {
    const extension = path.extname(sourcePath).toLowerCase();
    const format = supportedFormats[extension];
    if (!format) {
      throw new KnowledgeServiceError(
        'EXTRACTION_LIMIT_EXCEEDED',
        '暂仅支持 Markdown、文本、PDF 和 Word，以及工作簿（XLSX）、CSV、演示文稿（PPTX）文件。',
      );
    }
    const file = await stat(sourcePath);
    if (file.size > maxBytes) {
      throw new KnowledgeServiceError('EXTRACTION_LIMIT_EXCEEDED', '文件超过 20 MB，暂不导入。');
    }
    const bytes = await readFile(sourcePath);
    const extracted = await this.extractor(format, bytes, context);
    if (!extracted.content.trim()) {
      throw new KnowledgeServiceError('EXTRACTION_LIMIT_EXCEEDED', '未能从文件中提取可检索文本。');
    }
    return this.storeDocument(sourcePath, file.size, bytes, extracted);
  }

  /** 关键词重建：从已保存的修订文本重建派生块，不重解析原件。 */
  reindexKeywordRevision(revisionId: string): number {
    const revision = this.getRevision(revisionId);
    if (!revision) {
      throw new KnowledgeServiceError('KNOWLEDGE_REVISION_MISMATCH', '该修订已不在资料库中。');
    }
    const write = this.db.transaction((): number => {
      const chunks = buildRetrievalChunks({
        revisionId: revision.id,
        textHash: revision.textHash,
        sections: revision.chunks.map((chunk) => ({
          ordinal: chunk.ordinal,
          locator: chunk.locator,
          content: chunk.content,
        })),
      });
      this.index.replaceRetrievalChunks(revision.id, revision.textHash, revision.title, chunks);
      return chunks.length;
    });
    return write();
  }

  /** 当前登记修订 id；用于发布前复核旧 attempt 是否已经过期。 */
  registeredRevisionId(documentId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT id FROM knowledge_revisions WHERE document_id = ?
          ORDER BY revision DESC LIMIT 1`,
      )
      .get(documentId) as { id: string } | undefined;
    return row?.id;
  }

  revisionReference(revisionId: string): KnowledgeMaterialReference | undefined {
    const row = this.db
      .prepare(`SELECT ${revisionColumns} FROM knowledge_revisions WHERE id = ?`)
      .get(revisionId) as KnowledgeRevisionRow | undefined;
    return row ? this.toReference(row) : undefined;
  }

  currentRevisionOf(documentId: string): KnowledgeRevisionDetail | undefined {
    const revisionId = this.registeredRevisionId(documentId);
    return revisionId ? this.getRevision(revisionId) : undefined;
  }

  private documentRowOf(documentId: string): KnowledgeRow | undefined {
    return this.db
      .prepare(
        `SELECT id, title, source_path, format, byte_size, content_hash, page_count,
                imported_at, updated_at, source_status, source_checked_at, membership_revision
           FROM knowledge_documents WHERE id = ?`,
      )
      .get(documentId) as KnowledgeRow | undefined;
  }

  documentExists(documentId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS present FROM knowledge_documents WHERE id = ?')
      .get(documentId) as { present: number } | undefined;
    return row !== undefined;
  }

  /**
   * 来源检查（契约 §10.2）：比较当前原件字节与登记内容哈希，并把结论持久到文档。
   * changed/missing/unreadable 都是确定结论而非作业失败；只读原件，不刷新索引。
   */
  async checkSource(
    documentId: string,
  ): Promise<{ status: KnowledgeSourceStatus; checkedAt: number; reason: string }> {
    const row = this.db
      .prepare('SELECT source_path, content_hash FROM knowledge_documents WHERE id = ?')
      .get(documentId) as { source_path: string; content_hash: string } | undefined;
    if (!row) {
      return { status: 'missing', checkedAt: Date.now(), reason: '资料已不在当前资料库中。' };
    }
    const checkedAt = Date.now();
    let status: KnowledgeSourceStatus;
    let reason: string;
    try {
      const info = await stat(row.source_path);
      if (info.size > maxBytes) {
        status = 'changed';
        reason = '原始文件超过导入大小上限，无法按登记内容视为一致。';
      } else {
        const hash = createHash('sha256')
          .update(await readFile(row.source_path))
          .digest('hex');
        status = hash === row.content_hash ? 'unchanged' : 'changed';
        reason =
          hash === row.content_hash
            ? '原始文件与登记内容一致。'
            : '原始文件内容已变化，本地索引仍是历史版本。';
      }
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code === 'ENOENT') {
        status = 'missing';
        reason = '原始文件已不存在于登记路径。';
      } else if (code === 'EACCES' || code === 'EPERM') {
        status = 'unreadable';
        reason = '没有权限读取原始文件。';
      } else {
        status = 'unreadable';
        reason = '原始文件暂时无法访问。';
      }
    }
    this.db
      .prepare(
        'UPDATE knowledge_documents SET source_status = ?, source_checked_at = ? WHERE id = ?',
      )
      .run(status, checkedAt, documentId);
    return { status, checkedAt, reason };
  }

  /** 语义索引状态派生（契约 §10.1）：只读设置与代次，不复制作业状态。 */
  private semanticStateOf(revisionId: string | undefined): KnowledgeSemanticState {
    if (!this.index.settings().semanticEnabled) return 'disabled';
    if (!revisionId) return 'pending';
    const row = this.db
      .prepare(
        `SELECT g.text_hash AS generation_text_hash,
                r.text_hash AS current_text_hash,
                s.status AS space_status
           FROM knowledge_revisions r
           JOIN knowledge_index_generations g ON g.revision_id = r.id AND g.status = 'active'
           JOIN knowledge_embedding_spaces s ON s.id = g.space_id
          WHERE r.id = ?
          ORDER BY s.status = 'current' DESC, g.published_at DESC
          LIMIT 1`,
      )
      .get(revisionId) as
      { generation_text_hash: string; current_text_hash: string; space_status: string } | undefined;
    if (!row) return 'pending';
    if (row.space_status !== 'current') return 'stale';
    return row.generation_text_hash === row.current_text_hash ? 'ready' : 'stale';
  }

  /** 搜索命中与修订引用必须来自同一读快照（契约 §2.4），不能先取摘要再按 latest 补引用。 */
  search(query: string, options?: { revisionIds?: readonly string[] }): KnowledgeSearchResult[] {
    return this.db.transaction(() => {
      if (options?.revisionIds) return this.searchRevisions(query, options.revisionIds);
      return this.searchLibrary(query);
    })();
  }

  private searchLibrary(query: string): KnowledgeSearchResult[] {
    const terms = query
      .trim()
      .split(/[\s\p{P}]+/u)
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"`);
    const hitColumns =
      'd.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash, d.page_count, d.imported_at, d.updated_at, d.source_status, d.source_checked_at, c.locator, c.content';
    const rows =
      terms.length > 0
        ? (this.db
            .prepare(
              `SELECT ${hitColumns} FROM knowledge_fts f JOIN knowledge_chunks c ON c.id = f.chunk_id JOIN knowledge_documents d ON d.id = f.document_id WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?`,
            )
            .all(terms.join(' AND '), KNOWLEDGE_SEARCH_CANDIDATE_LIMIT) as Array<
            KnowledgeRow & { locator: string; content: string }
          >)
        : [];
    const fallback =
      rows.length > 0
        ? rows
        : (this.db
            .prepare(
              `SELECT ${hitColumns} FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.title LIKE ? OR c.content LIKE ? ORDER BY d.updated_at DESC, c.ordinal ASC LIMIT ?`,
            )
            .all(`%${query}%`, `%${query}%`, KNOWLEDGE_SEARCH_CANDIDATE_LIMIT) as Array<
            KnowledgeRow & { locator: string; content: string }
          >);
    const results: KnowledgeSearchResult[] = [];
    for (const row of fallback) {
      const hit = this.toLibraryHit(row, query);
      if (hit) results.push(hit);
    }
    return results;
  }

  /** 当前投影命中映射到该文档的当前修订；没有修订行（异常数据）时宁可丢弃命中也不伪造身份。 */
  private toLibraryHit(
    row: KnowledgeRow & { locator: string; content: string },
    query: string,
  ): KnowledgeSearchResult | undefined {
    const revision = this.db
      .prepare(
        `SELECT id, document_id, revision, title, source_path, format, byte_size, content_hash,
                content, page_count, parser_version, chunking_version, text_hash, section_count,
                warnings_json, imported_at, created_at
           FROM knowledge_revisions
          WHERE document_id = ?
          ORDER BY revision DESC LIMIT 1`,
      )
      .get(row.id) as KnowledgeRevisionRow | undefined;
    if (!revision) return undefined;
    return {
      document: {
        ...this.toSummary(row, revision.id),
        currentRevisionId: revision.id,
      },
      locator: row.locator,
      excerpt: makeExcerpt(row.content, query),
      reference: this.toReference(revision),
      textHash: revision.text_hash,
    };
  }

  /**
   * 运行时材料范围内的检索。修订 ID 为空时明确返回空结果，避免把“没有选材料”
   * 意外降级成整个知识库搜索。
   */
  private searchRevisions(query: string, revisionIds: readonly string[]): KnowledgeSearchResult[] {
    const terms = query
      .trim()
      .toLocaleLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter(Boolean);
    if (terms.length === 0 || revisionIds.length === 0) return [];

    const results: KnowledgeSearchResult[] = [];
    const seen = new Set<string>();
    const summaryCache = new Map<string, KnowledgeDocumentSummary>();
    for (const revisionId of revisionIds) {
      if (seen.has(revisionId)) continue;
      seen.add(revisionId);
      const revision = this.getRevision(revisionId);
      if (!revision) continue;
      let document = summaryCache.get(revision.documentId);
      if (!document) {
        const documentRow = this.documentRowOf(revision.documentId);
        if (!documentRow) continue;
        document = this.toSummary(documentRow, revision.id);
        summaryCache.set(revision.documentId, document);
      }
      for (const chunk of revision.chunks) {
        const haystack = `${revision.title}\n${chunk.content}`.toLocaleLowerCase();
        if (!terms.every((term) => haystack.includes(term))) continue;
        const excerpt = makeSpanExcerpt(
          chunk.content,
          query,
          chunk.ordinal,
          KNOWLEDGE_SEARCH_SUMMARY_MAX_CODE_POINTS,
        );
        results.push({
          document,
          locator: chunk.locator,
          excerpt: excerpt.text,
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: revision.documentId,
            knowledgeRevisionId: revision.id,
            contentHash: revision.contentHash,
            sourcePath: revision.sourcePath,
          },
          textHash: revision.textHash,
          span: excerpt.span,
          excerptHash: excerpt.excerptHash,
        });
        if (results.length >= KNOWLEDGE_SEARCH_CANDIDATE_LIMIT) return results;
      }
    }
    return results;
  }

  listRevisions(documentId: string): KnowledgeRevisionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${revisionColumns}
           FROM knowledge_revisions
          WHERE document_id = ?
          ORDER BY revision DESC`,
      )
      .all(documentId) as KnowledgeRevisionRow[];
    return rows.map((row) => this.toRevisionSummary(row));
  }

  getRevision(revisionId: string): KnowledgeRevisionDetail | undefined {
    const row = this.db
      .prepare(`SELECT ${revisionColumns} FROM knowledge_revisions WHERE id = ?`)
      .get(revisionId) as KnowledgeRevisionRow | undefined;
    if (!row) return undefined;
    const chunks = this.db
      .prepare(
        `SELECT locator, ordinal, content
           FROM knowledge_revision_chunks
          WHERE revision_id = ?
          ORDER BY ordinal`,
      )
      .all(revisionId) as Array<{ locator: string; ordinal: number; content: string }>;
    return { ...this.toRevisionSummary(row), content: row.content, chunks };
  }

  findRevisionBySource(
    sourcePath: string,
    contentHash: string,
  ): KnowledgeRevisionSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT ${revisionColumns}
           FROM knowledge_revisions
          WHERE source_path = ? AND content_hash = ?
          ORDER BY revision DESC LIMIT 1`,
      )
      .get(sourcePath, contentHash) as KnowledgeRevisionRow | undefined;
    return row ? this.toRevisionSummary(row) : undefined;
  }

  /**
   * 管理预览（契约 §3.1）：复用同一分页纯逻辑，但不占 Run 预算、
   * 不生成 RunMaterialRead/Evidence、不调用模型。documentId 与 revisionId 必须关联。
   */
  previewRevision(
    documentId: string,
    revisionId: string,
    cursor?: KnowledgeCursor,
    maxCodePoints?: number,
  ): KnowledgeTextPage {
    const revision = this.requireRevisionForDocument(documentId, revisionId);
    return readKnowledgeTextPage({
      reference: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: revision.documentId,
        knowledgeRevisionId: revision.id,
        contentHash: revision.contentHash,
        sourcePath: revision.sourcePath,
      },
      textHash: revision.textHash,
      title: revision.title,
      parserVersion: revision.parserVersion,
      chunkingVersion: revision.chunkingVersion,
      warnings: revision.warnings,
      sections: revision.chunks,
      ...(cursor ? { cursor } : {}),
      ...(maxCodePoints === undefined ? {} : { maxCodePoints }),
    });
  }

  requireRevisionForDocument(documentId: string, revisionId: string): KnowledgeRevisionDetail {
    const revision = this.getRevision(revisionId);
    if (!revision || revision.documentId !== documentId) {
      throw new KnowledgeServiceError('KNOWLEDGE_REVISION_MISMATCH', '修订不存在或不属于该资料。');
    }
    return revision;
  }

  private toReference(revision: KnowledgeRevisionRow): KnowledgeMaterialReference {
    return {
      kind: 'knowledge-revision',
      knowledgeDocumentId: revision.document_id,
      knowledgeRevisionId: revision.id,
      contentHash: revision.content_hash,
      sourcePath: revision.source_path,
    };
  }

  getRegisteredSourcePath(sourcePath: string): string | undefined {
    const row = this.db
      .prepare('SELECT source_path FROM knowledge_documents WHERE source_path = ?')
      .get(sourcePath) as { source_path: string } | undefined;
    return row?.source_path;
  }

  removeDocument(id: string): boolean {
    const remove = this.db.transaction(() => {
      this.db.prepare('DELETE FROM knowledge_fts WHERE document_id = ?').run(id);
      this.db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(id);
      return this.db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(id).changes > 0;
    });
    return remove();
  }

  async refreshDocument(id: string): Promise<KnowledgeRefreshResult> {
    const row = this.db
      .prepare('SELECT source_path FROM knowledge_documents WHERE id = ?')
      .get(id) as { source_path: string } | undefined;
    if (!row) return { error: '资料已不在当前资料库中。' };
    try {
      await stat(row.source_path);
    } catch {
      return {
        error: '原始文件无法访问（可能已被移动或删除）；本地索引保持不变，可移出资料库后重新导入。',
      };
    }
    const result = await this.importPaths([row.source_path]);
    return result.imported[0]
      ? { refreshed: result.imported[0] }
      : { error: result.skipped[0]?.reason ?? '刷新索引失败。' };
  }

  close(): void {
    this.db.close();
  }

  private storeDocument(
    sourcePath: string,
    byteSize: number,
    bytes: Buffer,
    extracted: ExtractedDocument,
  ): { document: KnowledgeDocumentSummary; revisionId: string; textHash: string } {
    // 超限整文件失败，不暗截断为完整导入（契约 §2.2）。
    if (countCodePoints(extracted.content) > KNOWLEDGE_REVISION_MAX_TEXT_CODE_POINTS) {
      throw new KnowledgeServiceError(
        'EXTRACTION_LIMIT_EXCEEDED',
        '提取正文超过单修订 2,000,000 码点上限，文件未导入。',
      );
    }
    const now = Date.now();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.db
      .prepare('SELECT id, imported_at FROM knowledge_documents WHERE source_path = ?')
      .get(sourcePath) as { id: string; imported_at: number } | undefined;
    const id = existing?.id ?? `knowledge-${randomUUID()}`;
    const title = path.basename(sourcePath, path.extname(sourcePath));
    const write = this.db.transaction((): { revisionId: string; textHash: string } => {
      if (existing) {
        this.db
          .prepare(
            'UPDATE knowledge_documents SET title=?, format=?, byte_size=?, content_hash=?, content=?, page_count=?, updated_at=?, source_status=?, source_checked_at=? WHERE id=?',
          )
          .run(
            title,
            extracted.format,
            byteSize,
            hash,
            extracted.content,
            extracted.pageCount ?? null,
            now,
            'unchanged',
            now,
            id,
          );
      } else {
        this.db
          .prepare(
            'INSERT INTO knowledge_documents (id, title, source_path, format, byte_size, content_hash, content, page_count, imported_at, updated_at, source_status, source_checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            title,
            sourcePath,
            extracted.format,
            byteSize,
            hash,
            extracted.content,
            extracted.pageCount ?? null,
            now,
            now,
            'unchanged',
            now,
          );
      }
      this.db.prepare('DELETE FROM knowledge_fts WHERE document_id = ?').run(id);
      this.db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(id);
      const insertChunk = this.db.prepare(
        'INSERT INTO knowledge_chunks (id, document_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)',
      );
      const insertFts = this.db.prepare(
        'INSERT INTO knowledge_fts (document_id, chunk_id, title, content) VALUES (?, ?, ?, ?)',
      );
      for (const chunk of extracted.sections) {
        const chunkId = randomUUID();
        insertChunk.run(chunkId, id, chunk.locator, chunk.ordinal, chunk.content);
        insertFts.run(id, chunkId, title, chunk.content);
      }
      const warningsJson = JSON.stringify(extracted.warnings ?? []);
      const existingRevision = this.db
        .prepare(
          `SELECT id, text_hash FROM knowledge_revisions
            WHERE document_id = ? AND content_hash = ? AND parser_version = ? AND chunking_version = ?`,
        )
        .get(id, hash, parserVersion, chunkingVersion) as
        { id: string; text_hash: string } | undefined;
      const revisionTextHashValue = revisionTextHash(extracted.sections);
      let publishedRevisionId = existingRevision?.id ?? '';
      if (existingRevision) {
        // 同解析身份必须得到同一提取文本；不一致说明解析被改坏，绝不覆盖旧修订。
        if (existingRevision.text_hash !== revisionTextHashValue) {
          throw new KnowledgeServiceError(
            'PARSER_NONDETERMINISTIC',
            '相同解析身份得到不同提取文本，已保留旧修订。',
          );
        }
      } else {
        const nextRevision = this.db
          .prepare(
            'SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM knowledge_revisions WHERE document_id = ?',
          )
          .get(id) as { next: number };
        const revisionId = randomUUID();
        publishedRevisionId = revisionId;
        this.db
          .prepare(
            `INSERT INTO knowledge_revisions
              (id, document_id, revision, title, source_path, format, byte_size, content_hash,
               content, page_count, parser_version, chunking_version, text_hash, section_count,
               warnings_json, imported_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            revisionId,
            id,
            nextRevision.next,
            title,
            sourcePath,
            extracted.format,
            byteSize,
            hash,
            extracted.content,
            extracted.pageCount ?? null,
            parserVersion,
            chunkingVersion,
            revisionTextHashValue,
            extracted.sections.length,
            warningsJson,
            existing?.imported_at ?? now,
            now,
          );
        const insertRevisionChunk = this.db.prepare(
          `INSERT INTO knowledge_revision_chunks
            (id, revision_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)`,
        );
        for (const chunk of extracted.sections) {
          insertRevisionChunk.run(
            randomUUID(),
            revisionId,
            chunk.locator,
            chunk.ordinal,
            chunk.content,
          );
        }
      }
      // 派生检索块与当前投影在同一次事务里发布：语义失败不会让关键词查找缺块（契约 §8.2）。
      this.index.replaceRetrievalChunks(
        publishedRevisionId,
        revisionTextHashValue,
        title,
        buildRetrievalChunks({
          revisionId: publishedRevisionId,
          textHash: revisionTextHashValue,
          sections: extracted.sections.map((chunk) => ({
            ordinal: chunk.ordinal,
            locator: chunk.locator,
            content: chunk.content,
          })),
        }),
      );
      return { revisionId: publishedRevisionId, textHash: revisionTextHashValue };
    });
    const published = write();
    const row = this.db
      .prepare(
        'SELECT id, title, source_path, format, byte_size, content_hash, page_count, imported_at, updated_at, source_status, source_checked_at, membership_revision FROM knowledge_documents WHERE id = ?',
      )
      .get(id) as KnowledgeRow;
    return { document: this.toSummary(row, published.revisionId), ...published };
  }

  private toSummary(row: KnowledgeRow, revisionId?: string): KnowledgeDocumentSummary {
    return {
      id: row.id,
      title: row.title,
      sourcePath: row.source_path,
      format: row.format,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
      sourceStatus: row.source_status,
      ...(row.source_checked_at === null ? {} : { sourceCheckedAt: row.source_checked_at }),
      lexicalState: 'ready',
      semanticState: this.semanticStateOf(revisionId),
      collectionIds: this.collectionIdsOf(row.id),
      membershipRevision: row.membership_revision,
      ...(row.page_count === null ? {} : { pageCount: row.page_count }),
      importedAt: row.imported_at,
      updatedAt: row.updated_at,
    };
  }

  private toRevisionSummary(row: KnowledgeRevisionRow): KnowledgeRevisionSummary {
    return {
      id: row.id,
      documentId: row.document_id,
      revision: row.revision,
      title: row.title,
      sourcePath: row.source_path,
      format: row.format,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
      ...(row.page_count === null ? {} : { pageCount: row.page_count }),
      parserVersion: row.parser_version,
      chunkingVersion: row.chunking_version,
      textHash: row.text_hash,
      sectionCount: row.section_count,
      warnings: parseWarningCodes(row.warnings_json),
      importedAt: row.imported_at,
      createdAt: row.created_at,
    };
  }
}

function parseWarningCodes(raw: string): KnowledgeWarningCode[] {
  try {
    const parsed = z.array(knowledgeWarningCodeSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function makeExcerpt(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, 180) + (normalized.length > 180 ? '…' : '');
  const start = Math.max(0, index - 60);
  const end = Math.min(normalized.length, index + query.length + 120);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}
