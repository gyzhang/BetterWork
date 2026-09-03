import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { KnowledgeDocumentSummary, KnowledgeFormat, KnowledgeImportResult, KnowledgeSearchResult } from '@betterwork/agent-protocol';

interface KnowledgeRow { id: string; title: string; source_path: string; format: KnowledgeFormat; byte_size: number; content_hash: string; page_count: number | null; imported_at: number; updated_at: number; }
interface KnowledgeChunk { id: string; locator: string; content: string; ordinal: number; }
interface ExtractedDocument { format: KnowledgeFormat; content: string; pageCount?: number; chunks: Array<Omit<KnowledgeChunk, 'id'>>; }

const supportedFormats: Record<string, KnowledgeFormat> = { '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.text': 'text', '.pdf': 'pdf', '.docx': 'docx' };
const maxBytes = 20 * 1024 * 1024;

export class KnowledgeVault {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL, byte_size INTEGER NOT NULL, content_hash TEXT NOT NULL,
        content TEXT NOT NULL, imported_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, locator TEXT NOT NULL,
        ordinal INTEGER NOT NULL, content TEXT NOT NULL, UNIQUE(document_id, ordinal)
      );
    `);
    const documentColumns = this.db.prepare('PRAGMA table_info(knowledge_documents)').all() as Array<{ name: string }>;
    if (!documentColumns.some((column) => column.name === 'page_count')) this.db.exec('ALTER TABLE knowledge_documents ADD COLUMN page_count INTEGER');
    const ftsColumns = this.db.prepare('PRAGMA table_info(knowledge_fts)').all() as Array<{ name: string }>;
    if (!ftsColumns.some((column) => column.name === 'chunk_id')) {
      this.db.exec('DROP TABLE IF EXISTS knowledge_fts; CREATE VIRTUAL TABLE knowledge_fts USING fts5(document_id UNINDEXED, chunk_id UNINDEXED, title, content);');
      this.rebuildFtsIndex();
    }
  }

  listDocuments(): KnowledgeDocumentSummary[] {
    const rows = this.db.prepare('SELECT id, title, source_path, format, byte_size, content_hash, page_count, imported_at, updated_at FROM knowledge_documents ORDER BY updated_at DESC, rowid DESC').all() as KnowledgeRow[];
    return rows.map((row) => this.toSummary(row));
  }

  async importPaths(sourcePaths: string[]): Promise<KnowledgeImportResult> {
    const imported: KnowledgeDocumentSummary[] = [];
    const skipped: KnowledgeImportResult['skipped'] = [];
    for (const sourcePath of sourcePaths) {
      const extension = path.extname(sourcePath).toLowerCase();
      const format = supportedFormats[extension];
      if (!format) { skipped.push({ sourcePath, reason: '暂仅支持 Markdown、文本、PDF 和 Word 文件。' }); continue; }
      try {
        const file = await stat(sourcePath);
        if (file.size > maxBytes) { skipped.push({ sourcePath, reason: '文件超过 20 MB，暂不导入。' }); continue; }
        const bytes = await readFile(sourcePath);
        const extracted = await extractDocument(format, bytes);
        if (!extracted.content.trim()) { skipped.push({ sourcePath, reason: '未能从文件中提取可检索文本。' }); continue; }
        imported.push(this.storeDocument(sourcePath, file.size, bytes, extracted));
      } catch (error) {
        skipped.push({ sourcePath, reason: error instanceof Error ? `导入失败：${error.message}` : '无法读取此文件。' });
      }
    }
    return { imported, skipped };
  }

  search(query: string): KnowledgeSearchResult[] {
    const terms = query.trim().split(/[\s\p{P}]+/u).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"`);
    const rows = terms.length > 0
      ? this.db.prepare(`SELECT d.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash, d.page_count, d.imported_at, d.updated_at, c.locator, c.content FROM knowledge_fts f JOIN knowledge_chunks c ON c.id = f.chunk_id JOIN knowledge_documents d ON d.id = f.document_id WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT 50`).all(terms.join(' AND ')) as Array<KnowledgeRow & { locator: string; content: string }>
      : [];
    const fallback = rows.length > 0 ? rows : this.db.prepare(`SELECT d.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash, d.page_count, d.imported_at, d.updated_at, c.locator, c.content FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.title LIKE ? OR c.content LIKE ? ORDER BY d.updated_at DESC, c.ordinal ASC LIMIT 50`).all(`%${query}%`, `%${query}%`) as Array<KnowledgeRow & { locator: string; content: string }>;
    return fallback.map((row) => ({ document: this.toSummary(row), locator: row.locator, excerpt: makeExcerpt(row.content, query) }));
  }

  getRegisteredSourcePath(sourcePath: string): string | undefined {
    const row = this.db.prepare('SELECT source_path FROM knowledge_documents WHERE source_path = ?').get(sourcePath) as { source_path: string } | undefined;
    return row?.source_path;
  }

  close(): void { this.db.close(); }

  private storeDocument(sourcePath: string, byteSize: number, bytes: Buffer, extracted: ExtractedDocument): KnowledgeDocumentSummary {
    const now = Date.now();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.db.prepare('SELECT id, imported_at FROM knowledge_documents WHERE source_path = ?').get(sourcePath) as { id: string; imported_at: number } | undefined;
    const id = existing?.id ?? `knowledge-${randomUUID()}`;
    const title = path.basename(sourcePath, path.extname(sourcePath));
    const write = this.db.transaction(() => {
      if (existing) {
        this.db.prepare('UPDATE knowledge_documents SET title=?, format=?, byte_size=?, content_hash=?, content=?, page_count=?, updated_at=? WHERE id=?').run(title, extracted.format, byteSize, hash, extracted.content, extracted.pageCount ?? null, now, id);
      } else {
        this.db.prepare('INSERT INTO knowledge_documents (id, title, source_path, format, byte_size, content_hash, content, page_count, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, title, sourcePath, extracted.format, byteSize, hash, extracted.content, extracted.pageCount ?? null, now, now);
      }
      this.db.prepare('DELETE FROM knowledge_fts WHERE document_id = ?').run(id);
      this.db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(id);
      const insertChunk = this.db.prepare('INSERT INTO knowledge_chunks (id, document_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)');
      const insertFts = this.db.prepare('INSERT INTO knowledge_fts (document_id, chunk_id, title, content) VALUES (?, ?, ?, ?)');
      for (const chunk of extracted.chunks) {
        const chunkId = randomUUID();
        insertChunk.run(chunkId, id, chunk.locator, chunk.ordinal, chunk.content);
        insertFts.run(id, chunkId, title, chunk.content);
      }
    });
    write();
    const row = this.db.prepare('SELECT id, title, source_path, format, byte_size, content_hash, page_count, imported_at, updated_at FROM knowledge_documents WHERE id = ?').get(id) as KnowledgeRow;
    return this.toSummary(row);
  }

  private rebuildFtsIndex(): void {
    const withoutChunks = this.db.prepare('SELECT d.id, d.content FROM knowledge_documents d LEFT JOIN knowledge_chunks c ON c.document_id = d.id WHERE c.id IS NULL').all() as Array<{ id: string; content: string }>;
    const insertChunk = this.db.prepare('INSERT INTO knowledge_chunks (id, document_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)');
    for (const document of withoutChunks) insertChunk.run(randomUUID(), document.id, '全文', 0, document.content);
    const chunks = this.db.prepare('SELECT c.id, c.document_id, d.title, c.content FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id').all() as Array<{ id: string; document_id: string; title: string; content: string }>;
    const insertFts = this.db.prepare('INSERT INTO knowledge_fts (document_id, chunk_id, title, content) VALUES (?, ?, ?, ?)');
    for (const chunk of chunks) insertFts.run(chunk.document_id, chunk.id, chunk.title, chunk.content);
  }

  private toSummary(row: KnowledgeRow): KnowledgeDocumentSummary {
    return { id: row.id, title: row.title, sourcePath: row.source_path, format: row.format, byteSize: row.byte_size, contentHash: row.content_hash, ...(row.page_count === null ? {} : { pageCount: row.page_count }), importedAt: row.imported_at, updatedAt: row.updated_at };
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
    const paragraphs = result.value.split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
    const chunks = paragraphs.map((content, index) => ({ locator: `段落 ${index + 1}`, ordinal: index, content }));
    return { format, content: chunks.map((chunk) => chunk.content).join('\n\n'), chunks };
  }
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: bytes });
  try {
    const text = await parser.getText({ pageJoiner: '' });
    const chunks = text.pages.map((page) => ({ locator: `第 ${page.num} 页`, ordinal: page.num - 1, content: page.text.trim() })).filter((page) => Boolean(page.content));
    return { format, content: chunks.map((page) => page.content).join('\n\n'), pageCount: text.total, chunks };
  } finally { await parser.destroy(); }
}

function makeExcerpt(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, 180) + (normalized.length > 180 ? '…' : '');
  const start = Math.max(0, index - 60);
  const end = Math.min(normalized.length, index + query.length + 120);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}
