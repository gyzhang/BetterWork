import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  KnowledgeDocumentSummary,
  KnowledgeFormat,
  KnowledgeImportResult,
  KnowledgeRefreshResult,
  KnowledgeSearchResult,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { openKnowledgeDatabase } from '../db';

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
}

export interface KnowledgeRevisionSummary {
  id: string;
  documentId: string;
  revision: number;
  title: string;
  sourcePath: string;
  format: KnowledgeFormat;
  byteSize: number;
  contentHash: string;
  pageCount?: number;
  parserVersion: string;
  chunkingVersion: string;
  importedAt: number;
  createdAt: number;
}

export interface KnowledgeRevisionDetail extends KnowledgeRevisionSummary {
  content: string;
  chunks: Array<{ locator: string; ordinal: number; content: string }>;
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
  imported_at: number;
  created_at: number;
}
interface KnowledgeChunk {
  id: string;
  locator: string;
  content: string;
  ordinal: number;
}
interface ExtractedDocument {
  format: KnowledgeFormat;
  content: string;
  pageCount?: number;
  chunks: Array<Omit<KnowledgeChunk, 'id'>>;
}

const supportedFormats: Record<string, KnowledgeFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.pdf': 'pdf',
  '.docx': 'docx',
};
const maxBytes = 20 * 1024 * 1024;

export class KnowledgeVault {
  private readonly db: Database.Database;

  /** schema 与历史库对账由 db/knowledge-schema.ts 的版本化迁移负责，服务层不碰 DDL。 */
  constructor(filePath: string) {
    this.db = openKnowledgeDatabase(filePath);
  }

  listDocuments(): KnowledgeDocumentSummary[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, source_path, format, byte_size, content_hash, page_count, imported_at, updated_at FROM knowledge_documents ORDER BY updated_at DESC, rowid DESC',
      )
      .all() as KnowledgeRow[];
    return rows.map((row) => this.toSummary(row));
  }

  async importPaths(sourcePaths: string[]): Promise<KnowledgeImportResult> {
    const imported: KnowledgeDocumentSummary[] = [];
    const skipped: KnowledgeImportResult['skipped'] = [];
    for (const sourcePath of sourcePaths) {
      const extension = path.extname(sourcePath).toLowerCase();
      const format = supportedFormats[extension];
      if (!format) {
        skipped.push({ sourcePath, reason: '暂仅支持 Markdown、文本、PDF 和 Word 文件。' });
        continue;
      }
      try {
        const file = await stat(sourcePath);
        if (file.size > maxBytes) {
          skipped.push({ sourcePath, reason: '文件超过 20 MB，暂不导入。' });
          continue;
        }
        const bytes = await readFile(sourcePath);
        const extracted = await extractDocument(format, bytes);
        if (!extracted.content.trim()) {
          skipped.push({ sourcePath, reason: '未能从文件中提取可检索文本。' });
          continue;
        }
        imported.push(this.storeDocument(sourcePath, file.size, bytes, extracted));
      } catch (error) {
        skipped.push({
          sourcePath,
          reason: error instanceof Error ? `导入失败：${error.message}` : '无法读取此文件。',
        });
      }
    }
    return { imported, skipped };
  }

  search(query: string, options?: { revisionIds?: readonly string[] }): KnowledgeSearchResult[] {
    if (options?.revisionIds) return this.searchRevisions(query, options.revisionIds);
    const terms = query
      .trim()
      .split(/[\s\p{P}]+/u)
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"`);
    const rows =
      terms.length > 0
        ? (this.db
            .prepare(
              `SELECT d.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash, d.page_count, d.imported_at, d.updated_at, c.locator, c.content FROM knowledge_fts f JOIN knowledge_chunks c ON c.id = f.chunk_id JOIN knowledge_documents d ON d.id = f.document_id WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT 50`,
            )
            .all(terms.join(' AND ')) as Array<KnowledgeRow & { locator: string; content: string }>)
        : [];
    const fallback =
      rows.length > 0
        ? rows
        : (this.db
            .prepare(
              `SELECT d.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash, d.page_count, d.imported_at, d.updated_at, c.locator, c.content FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.title LIKE ? OR c.content LIKE ? ORDER BY d.updated_at DESC, c.ordinal ASC LIMIT 50`,
            )
            .all(`%${query}%`, `%${query}%`) as Array<
            KnowledgeRow & { locator: string; content: string }
          >);
    return fallback.map((row) => ({
      document: this.toSummary(row),
      locator: row.locator,
      excerpt: makeExcerpt(row.content, query),
    }));
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
    for (const revisionId of revisionIds) {
      if (seen.has(revisionId)) continue;
      seen.add(revisionId);
      const revision = this.getRevision(revisionId);
      if (!revision) continue;
      for (const chunk of revision.chunks) {
        const haystack = `${revision.title}\n${chunk.content}`.toLocaleLowerCase();
        if (!terms.every((term) => haystack.includes(term))) continue;
        results.push({
          document: {
            id: revision.documentId,
            title: revision.title,
            sourcePath: revision.sourcePath,
            format: revision.format,
            byteSize: revision.byteSize,
            contentHash: revision.contentHash,
            ...(revision.pageCount === undefined ? {} : { pageCount: revision.pageCount }),
            importedAt: revision.importedAt,
            updatedAt: revision.createdAt,
          },
          locator: chunk.locator,
          excerpt: makeExcerpt(chunk.content, query),
        });
        if (results.length >= 50) return results;
      }
    }
    return results;
  }

  listRevisions(documentId: string): KnowledgeRevisionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, document_id, revision, title, source_path, format, byte_size, content_hash,
                content, page_count, parser_version, chunking_version, imported_at, created_at
           FROM knowledge_revisions
          WHERE document_id = ?
          ORDER BY revision DESC`,
      )
      .all(documentId) as KnowledgeRevisionRow[];
    return rows.map((row) => this.toRevisionSummary(row));
  }

  getRevision(revisionId: string): KnowledgeRevisionDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT id, document_id, revision, title, source_path, format, byte_size, content_hash,
                content, page_count, parser_version, chunking_version, imported_at, created_at
           FROM knowledge_revisions
          WHERE id = ?`,
      )
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
        `SELECT id, document_id, revision, title, source_path, format, byte_size, content_hash,
                content, page_count, parser_version, chunking_version, imported_at, created_at
           FROM knowledge_revisions
          WHERE source_path = ? AND content_hash = ?
          ORDER BY revision DESC LIMIT 1`,
      )
      .get(sourcePath, contentHash) as KnowledgeRevisionRow | undefined;
    return row ? this.toRevisionSummary(row) : undefined;
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
  ): KnowledgeDocumentSummary {
    const now = Date.now();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.db
      .prepare('SELECT id, imported_at FROM knowledge_documents WHERE source_path = ?')
      .get(sourcePath) as { id: string; imported_at: number } | undefined;
    const id = existing?.id ?? `knowledge-${randomUUID()}`;
    const title = path.basename(sourcePath, path.extname(sourcePath));
    const write = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            'UPDATE knowledge_documents SET title=?, format=?, byte_size=?, content_hash=?, content=?, page_count=?, updated_at=? WHERE id=?',
          )
          .run(
            title,
            extracted.format,
            byteSize,
            hash,
            extracted.content,
            extracted.pageCount ?? null,
            now,
            id,
          );
      } else {
        this.db
          .prepare(
            'INSERT INTO knowledge_documents (id, title, source_path, format, byte_size, content_hash, content, page_count, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      for (const chunk of extracted.chunks) {
        const chunkId = randomUUID();
        insertChunk.run(chunkId, id, chunk.locator, chunk.ordinal, chunk.content);
        insertFts.run(id, chunkId, title, chunk.content);
      }
      const revisionExists = this.db
        .prepare('SELECT id FROM knowledge_revisions WHERE document_id = ? AND content_hash = ?')
        .get(id, hash) as { id: string } | undefined;
      if (!revisionExists) {
        const nextRevision = this.db
          .prepare(
            'SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM knowledge_revisions WHERE document_id = ?',
          )
          .get(id) as { next: number };
        const revisionId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO knowledge_revisions
              (id, document_id, revision, title, source_path, format, byte_size, content_hash,
               content, page_count, parser_version, chunking_version, imported_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            'text-extract-v1',
            'format-locator-v1',
            existing?.imported_at ?? now,
            now,
          );
        const insertRevisionChunk = this.db.prepare(
          `INSERT INTO knowledge_revision_chunks
            (id, revision_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)`,
        );
        for (const chunk of extracted.chunks) {
          insertRevisionChunk.run(
            randomUUID(),
            revisionId,
            chunk.locator,
            chunk.ordinal,
            chunk.content,
          );
        }
      }
    });
    write();
    const row = this.db
      .prepare(
        'SELECT id, title, source_path, format, byte_size, content_hash, page_count, imported_at, updated_at FROM knowledge_documents WHERE id = ?',
      )
      .get(id) as KnowledgeRow;
    return this.toSummary(row);
  }

  private toSummary(row: KnowledgeRow): KnowledgeDocumentSummary {
    return {
      id: row.id,
      title: row.title,
      sourcePath: row.source_path,
      format: row.format,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
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
      importedAt: row.imported_at,
      createdAt: row.created_at,
    };
  }
}

async function extractDocument(format: KnowledgeFormat, bytes: Buffer): Promise<ExtractedDocument> {
  if (format === 'markdown' || format === 'text') {
    const content = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return { format, content, chunks: [{ locator: '全文', ordinal: 0, content }] };
  }
  if (format === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: bytes });
    const paragraphs = result.value
      .split(/\n{2,}/u)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const chunks = paragraphs.map((content, index) => ({
      locator: `段落 ${index + 1}`,
      ordinal: index,
      content,
    }));
    return { format, content: chunks.map((chunk) => chunk.content).join('\n\n'), chunks };
  }
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: bytes });
  try {
    const text = await parser.getText({ pageJoiner: '' });
    const chunks = text.pages
      .map((page) => ({
        locator: `第 ${page.num} 页`,
        ordinal: page.num - 1,
        content: page.text.trim(),
      }))
      .filter((page) => Boolean(page.content));
    return {
      format,
      content: chunks.map((page) => page.content).join('\n\n'),
      pageCount: text.total,
      chunks,
    };
  } finally {
    await parser.destroy();
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
