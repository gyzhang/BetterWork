import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { revisionTextHash } from '../services/knowledge-text';
import { hasColumn, hasTable, type Migration, rebuildTable } from './migrate';

/**
 * 本地知识库（`vaults/<id>/vault.sqlite`）的 schema 演进。
 * 与应用状态库共用同一个迁移执行器，规则一致。
 *
 * 这个库整体是可重建的：原始文件始终留在用户自己的路径上，
 * 库里只有提取文本与索引，因此迁移失败时最坏情况是重新导入。
 */

const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    page_count INTEGER,
    imported_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    locator TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    content TEXT NOT NULL,
    UNIQUE(document_id, ordinal)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    document_id UNINDEXED,
    chunk_id UNINDEXED,
    title,
    content
  );
`;

const REVISION_SCHEMA = `
  CREATE TABLE knowledge_revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    title TEXT NOT NULL,
    source_path TEXT NOT NULL,
    format TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    page_count INTEGER,
    parser_version TEXT NOT NULL,
    chunking_version TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(document_id, revision),
    UNIQUE(document_id, content_hash)
  );
  CREATE INDEX idx_knowledge_revisions_document
    ON knowledge_revisions(document_id, revision DESC);
  CREATE TABLE knowledge_revision_chunks (
    id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id) ON DELETE CASCADE,
    locator TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    content TEXT NOT NULL,
    UNIQUE(revision_id, ordinal)
  );
`;

const parserVersion = 'text-extract-v1';
const chunkingVersion = 'format-locator-v1';

interface LegacyDocumentRow {
  id: string;
  content: string;
}

interface LegacyChunkRow {
  id: string;
  document_id: string;
  title: string;
  content: string;
}

/**
 * 从 `knowledge_documents.content` 重建全文索引。
 * 早期版本没有分块表，只有整篇内容；对账时先为这些文档补一个「全文」分块，
 * 再把所有分块灌进 FTS5。
 */
export function rebuildFullTextIndex(db: Database.Database): void {
  const insertChunk = db.prepare(
    'INSERT INTO knowledge_chunks (id, document_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)',
  );
  const withoutChunks = db
    .prepare(
      `SELECT d.id, d.content
         FROM knowledge_documents d
         LEFT JOIN knowledge_chunks c ON c.document_id = d.id
        WHERE c.id IS NULL`,
    )
    .all() as LegacyDocumentRow[];
  for (const document of withoutChunks) {
    insertChunk.run(randomUUID(), document.id, '全文', 0, document.content);
  }

  const insertFts = db.prepare(
    'INSERT INTO knowledge_fts (document_id, chunk_id, title, content) VALUES (?, ?, ?, ?)',
  );
  const chunks = db
    .prepare(
      `SELECT c.id, c.document_id, d.title, c.content
         FROM knowledge_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id`,
    )
    .all() as LegacyChunkRow[];
  for (const chunk of chunks) {
    insertFts.run(chunk.document_id, chunk.id, chunk.title, chunk.content);
  }
}

export const knowledgeMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial knowledge vault schema',
    up(db: Database.Database): void {
      db.exec(INITIAL_SCHEMA);
    },
  },
  {
    version: 2,
    name: 'cascade chunk deletion with their document',
    up(db: Database.Database): void {
      rebuildTable(
        db,
        'knowledge_chunks',
        `CREATE TABLE knowledge_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          locator TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          content TEXT NOT NULL,
          UNIQUE(document_id, ordinal)
        )`,
        ['id', 'document_id', 'locator', 'ordinal', 'content'],
      );
    },
  },
  {
    version: 3,
    name: 'add immutable knowledge content revisions',
    up(db: Database.Database): void {
      db.exec(REVISION_SCHEMA);
      const documents = db
        .prepare(
          `SELECT d.id, d.title, d.source_path, d.format, d.byte_size, d.content_hash,
                  d.content, d.page_count, d.imported_at, d.updated_at
             FROM knowledge_documents d`,
        )
        .all() as Array<{
        id: string;
        title: string;
        source_path: string;
        format: string;
        byte_size: number;
        content_hash: string;
        content: string;
        page_count: number | null;
        imported_at: number;
        updated_at: number;
      }>;
      const insertRevision = db.prepare(
        `INSERT INTO knowledge_revisions
          (id, document_id, revision, title, source_path, format, byte_size, content_hash,
           content, page_count, parser_version, chunking_version, imported_at, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const selectChunks = db.prepare(
        'SELECT locator, ordinal, content FROM knowledge_chunks WHERE document_id = ? ORDER BY ordinal',
      );
      const insertChunk = db.prepare(
        `INSERT INTO knowledge_revision_chunks
          (id, revision_id, locator, ordinal, content) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const document of documents) {
        const revisionId = randomUUID();
        insertRevision.run(
          revisionId,
          document.id,
          document.title,
          document.source_path,
          document.format,
          document.byte_size,
          document.content_hash,
          document.content,
          document.page_count,
          parserVersion,
          chunkingVersion,
          document.imported_at,
          document.updated_at,
        );
        const chunks = selectChunks.all(document.id) as Array<{
          locator: string;
          ordinal: number;
          content: string;
        }>;
        for (const chunk of chunks) {
          insertChunk.run(randomUUID(), revisionId, chunk.locator, chunk.ordinal, chunk.content);
        }
      }
    },
  },
  {
    version: 4,
    name: 'parser-aware revision uniqueness with text hash and section counts',
    up(db: Database.Database): void {
      // 唯一键从 (document, contentHash) 扩为含解析与分段版本：同字节不同解析版本可追加修订。
      // 已存 section 回填提取文本哈希与段数；不重解析原件、不改 ID/hash/版本文本。
      rebuildTable(
        db,
        'knowledge_revisions',
        `CREATE TABLE knowledge_revisions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          title TEXT NOT NULL,
          source_path TEXT NOT NULL,
          format TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          content TEXT NOT NULL,
          page_count INTEGER,
          parser_version TEXT NOT NULL,
          chunking_version TEXT NOT NULL,
          text_hash TEXT NOT NULL DEFAULT '',
          section_count INTEGER NOT NULL DEFAULT 0,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          imported_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(document_id, revision),
          UNIQUE(document_id, content_hash, parser_version, chunking_version)
        )`,
        [
          'id',
          'document_id',
          'revision',
          'title',
          'source_path',
          'format',
          'byte_size',
          'content_hash',
          'content',
          'page_count',
          'parser_version',
          'chunking_version',
          'imported_at',
          'created_at',
        ],
        [
          'CREATE INDEX idx_knowledge_revisions_document ON knowledge_revisions(document_id, revision DESC)',
        ],
      );
      const revisions = db
        .prepare("SELECT id FROM knowledge_revisions WHERE text_hash = ''")
        .all() as Array<{ id: string }>;
      const selectSections = db.prepare(
        'SELECT ordinal, locator, content FROM knowledge_revision_chunks WHERE revision_id = ? ORDER BY ordinal',
      );
      const updateHash = db.prepare(
        'UPDATE knowledge_revisions SET text_hash = ?, section_count = ? WHERE id = ?',
      );
      for (const revision of revisions) {
        const sections = selectSections.all(revision.id) as Array<{
          ordinal: number;
          locator: string;
          content: string;
        }>;
        updateHash.run(revisionTextHash(sections), sections.length, revision.id);
      }
    },
  },
];

/**
 * 历史库对账：补齐 `page_count` 列，并把早期不含 `chunk_id` 的 FTS5 虚表
 * 重建为可按分块定位的版本，重建后从已存内容重灌索引。
 */
export function reconcileLegacyKnowledgeDatabase(db: Database.Database): void {
  if (!hasColumn(db, 'knowledge_documents', 'page_count')) {
    db.exec('ALTER TABLE knowledge_documents ADD COLUMN page_count INTEGER');
  }
  if (!hasTable(db, 'knowledge_fts') || !hasColumn(db, 'knowledge_fts', 'chunk_id')) {
    db.exec('DROP TABLE IF EXISTS knowledge_fts');
    db.exec(`
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        document_id UNINDEXED,
        chunk_id UNINDEXED,
        title,
        content
      )
    `);
    rebuildFullTextIndex(db);
  }
}

export function detectLegacyKnowledgeDatabase(db: Database.Database): boolean {
  return hasTable(db, 'knowledge_documents');
}
