import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { KnowledgeDocumentSummary, KnowledgeFormat, KnowledgeImportResult, KnowledgeSearchResult } from '@betterwork/agent-protocol';

interface KnowledgeRow {
  id: string;
  title: string;
  source_path: string;
  format: KnowledgeFormat;
  byte_size: number;
  content_hash: string;
  imported_at: number;
  updated_at: number;
}

const supportedFormats: Record<string, KnowledgeFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
};

export class KnowledgeVault {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        document_id UNINDEXED,
        title,
        content
      );
    `);
  }

  listDocuments(): KnowledgeDocumentSummary[] {
    const rows = this.db.prepare('SELECT id, title, source_path, format, byte_size, content_hash, imported_at, updated_at FROM knowledge_documents ORDER BY updated_at DESC').all() as KnowledgeRow[];
    return rows.map((row) => this.toSummary(row));
  }

  importPaths(sourcePaths: string[]): KnowledgeImportResult {
    const imported: KnowledgeDocumentSummary[] = [];
    const skipped: KnowledgeImportResult['skipped'] = [];
    const importOne = this.db.transaction((sourcePath: string): KnowledgeDocumentSummary | undefined => {
      const extension = path.extname(sourcePath).toLowerCase();
      const format = supportedFormats[extension];
      if (!format) {
        skipped.push({ sourcePath, reason: '暂仅支持 Markdown 和文本文件。' });
        return undefined;
      }
      let fileSize: number;
      let bytes: Buffer;
      try {
        fileSize = statSync(sourcePath).size;
        if (fileSize > 2 * 1024 * 1024) {
          skipped.push({ sourcePath, reason: '文件超过 2 MB，暂不导入。' });
          return undefined;
        }
        bytes = readFileSync(sourcePath);
      } catch {
        skipped.push({ sourcePath, reason: '无法读取此文件。' });
        return undefined;
      }
      const content = bytes.toString('utf8').replace(/^\uFEFF/, '');
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const now = Date.now();
      const existing = this.db.prepare('SELECT id, imported_at FROM knowledge_documents WHERE source_path = ?').get(sourcePath) as { id: string; imported_at: number } | undefined;
      const id = existing?.id ?? `knowledge-${randomUUID()}`;
      const title = path.basename(sourcePath, extension);
      if (existing) {
        this.db.prepare('UPDATE knowledge_documents SET title=?, format=?, byte_size=?, content_hash=?, content=?, updated_at=? WHERE id=?')
          .run(title, format, fileSize, contentHash, content, now, id);
      } else {
        this.db.prepare('INSERT INTO knowledge_documents (id, title, source_path, format, byte_size, content_hash, content, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, title, sourcePath, format, fileSize, contentHash, content, now, now);
      }
      this.db.prepare('DELETE FROM knowledge_fts WHERE document_id = ?').run(id);
      this.db.prepare('INSERT INTO knowledge_fts (document_id, title, content) VALUES (?, ?, ?)').run(id, title, content);
      const row = this.db.prepare('SELECT id, title, source_path, format, byte_size, content_hash, imported_at, updated_at FROM knowledge_documents WHERE id = ?').get(id) as KnowledgeRow;
      return this.toSummary(row);
    });
    for (const sourcePath of sourcePaths) {
      const summary = importOne(sourcePath);
      if (summary) imported.push(summary);
    }
    return { imported, skipped };
  }

  search(query: string): KnowledgeSearchResult[] {
    const terms = query.trim().split(/[\s\p{P}]+/u).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"`);
    const rows = terms.length > 0
      ? this.db.prepare(`SELECT d.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash, d.imported_at, d.updated_at, d.content FROM knowledge_fts f JOIN knowledge_documents d ON d.id = f.document_id WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT 50`).all(terms.join(' AND ')) as Array<KnowledgeRow & { content: string }>
      : [];
    const fallback = rows.length > 0 ? rows : this.db.prepare(`SELECT id, title, source_path, format, byte_size, content_hash, imported_at, updated_at, content FROM knowledge_documents WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 50`).all(`%${query}%`, `%${query}%`) as Array<KnowledgeRow & { content: string }>;
    return fallback.map((row) => ({ document: this.toSummary(row), excerpt: makeExcerpt(row.content, query) }));
  }

  close(): void { this.db.close(); }

  private toSummary(row: KnowledgeRow): KnowledgeDocumentSummary {
    return { id: row.id, title: row.title, sourcePath: row.source_path, format: row.format, byteSize: row.byte_size, contentHash: row.content_hash, importedAt: row.imported_at, updatedAt: row.updated_at };
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
