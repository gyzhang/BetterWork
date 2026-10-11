import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openKnowledgeDatabase } from '../db';
import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeIndexStore } from './knowledge-index-store';

const stores: Array<{ store: KnowledgeIndexStore; db: Database.Database }> = [];

const openStore = (): { store: KnowledgeIndexStore; db: Database.Database } => {
  const db = openKnowledgeDatabase(':memory:');
  const store = new KnowledgeIndexStore(db);
  const entry = { store, db };
  stores.push(entry);
  return entry;
};

afterEach(() => {
  for (const entry of stores.splice(0)) entry.db.close();
  vi.restoreAllMocks();
});

const insertRevision = (
  db: Database.Database,
  id: string,
  overrides: Partial<{
    documentId: string;
    revision: number;
    title: string;
    sourcePath: string;
    format: string;
    byteSize: number;
    contentHash: string;
    content: string;
    textHash: string;
    sectionCount: number;
    parserVersion: string;
    chunkingVersion: string;
    importedAt: number;
    createdAt: number;
  }> = {},
): void => {
  db.transaction(() => {
    const docId = overrides.documentId ?? 'doc-1';
    const docExists = db.prepare('SELECT id FROM knowledge_documents WHERE id = ?').get(docId) as
      { id: string } | undefined;
    if (!docExists) {
      db.prepare(
        `INSERT INTO knowledge_documents
          (id, title, source_path, format, byte_size, content_hash, content, imported_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        docId,
        overrides.title ?? 'Test Document',
        overrides.sourcePath ?? '/tmp/test.md',
        overrides.format ?? 'markdown',
        overrides.byteSize ?? 100,
        overrides.contentHash ?? 'abc123',
        overrides.content ?? 'Test content',
        overrides.importedAt ?? 1,
        overrides.createdAt ?? 1,
      );
    }
    db.prepare(
      `INSERT INTO knowledge_revisions
        (id, document_id, revision, title, source_path, format, byte_size, content_hash,
         content, parser_version, chunking_version, text_hash, section_count, imported_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      docId,
      overrides.revision ?? 1,
      overrides.title ?? 'Test Document',
      overrides.sourcePath ?? '/tmp/test.md',
      overrides.format ?? 'markdown',
      overrides.byteSize ?? 100,
      overrides.contentHash ?? 'abc123',
      overrides.content ?? 'Test content',
      overrides.parserVersion ?? 'text-extract-v1',
      overrides.chunkingVersion ?? 'format-locator-v1',
      overrides.textHash ?? 'texthash1',
      overrides.sectionCount ?? 1,
      overrides.importedAt ?? 1,
      overrides.createdAt ?? 1,
    );
  })();
};

describe('KnowledgeIndexStore', () => {
  describe('settings', () => {
    it('returns defaults when no settings row exists', () => {
      const { store, db } = openStore();
      db.exec("DELETE FROM knowledge_search_settings WHERE id = 'singleton'");
      const result = store.settings();
      expect(result.semanticEnabled).toBe(false);
      expect(result.revision).toBe(1);
      expect(result.embeddingProfileId).toBeUndefined();
    });

    it('reads the persisted singleton settings', () => {
      const { store } = openStore();
      const result = store.settings();
      expect(result.semanticEnabled).toBe(false);
      expect(result.revision).toBe(1);
    });
  });

  describe('saveSettings with CAS', () => {
    it('updates settings when revision matches', () => {
      const { store } = openStore();
      const updated = store.saveSettings({
        expectedRevision: 1,
        semanticEnabled: true,
        embeddingProfileId: 'profile-1',
      });
      expect(updated.semanticEnabled).toBe(true);
      expect(updated.embeddingProfileId).toBe('profile-1');
      expect(updated.revision).toBe(2);
    });

    it('throws REVISION_CONFLICT when expected revision does not match', () => {
      const { store } = openStore();
      expect(() => store.saveSettings({ expectedRevision: 99, semanticEnabled: true })).toThrow(
        KnowledgeServiceError,
      );
    });

    it('increments revision on each successful save', () => {
      const { store } = openStore();
      store.saveSettings({ expectedRevision: 1, semanticEnabled: true });
      const second = store.saveSettings({ expectedRevision: 2, semanticEnabled: false });
      expect(second.revision).toBe(3);
      expect(second.semanticEnabled).toBe(false);
    });

    it('clears embeddingProfileId when not provided', () => {
      const { store } = openStore();
      store.saveSettings({
        expectedRevision: 1,
        semanticEnabled: true,
        embeddingProfileId: 'profile-1',
      });
      const cleared = store.saveSettings({ expectedRevision: 2, semanticEnabled: false });
      expect(cleared.embeddingProfileId).toBeUndefined();
    });
  });

  describe('embedding space lifecycle', () => {
    it('creates a new space when none exists for the fingerprint', () => {
      const { store } = openStore();
      const space = store.ensureCurrentSpace('model-a');
      expect(space.modelFingerprint).toBe('model-a');
      expect(space.epoch).toBe(1);
      expect(space.status).toBe('current');
      expect(space.dimension).toBeUndefined();
    });

    it('returns existing space when one already exists', () => {
      const { store } = openStore();
      const first = store.ensureCurrentSpace('model-a');
      const second = store.ensureCurrentSpace('model-a');
      expect(second.id).toBe(first.id);
    });

    it('creates separate spaces for different fingerprints', () => {
      const { store } = openStore();
      const spaceA = store.ensureCurrentSpace('model-a');
      const spaceB = store.ensureCurrentSpace('model-b');
      expect(spaceA.id).not.toBe(spaceB.id);
      expect(spaceA.modelFingerprint).toBe('model-a');
      expect(spaceB.modelFingerprint).toBe('model-b');
    });

    it('currentSpace returns undefined when no space exists', () => {
      const { store } = openStore();
      expect(store.currentSpace('nonexistent')).toBeUndefined();
    });

    it('currentSpace returns the active space', () => {
      const { store } = openStore();
      const created = store.ensureCurrentSpace('model-a');
      const found = store.currentSpace('model-a');
      expect(found?.id).toBe(created.id);
    });

    it('spaceById returns undefined for unknown id', () => {
      const { store } = openStore();
      expect(store.spaceById('nonexistent')).toBeUndefined();
    });

    it('spaceById returns the space by its id', () => {
      const { store } = openStore();
      const created = store.ensureCurrentSpace('model-a');
      const found = store.spaceById(created.id);
      expect(found?.id).toBe(created.id);
      expect(found?.modelFingerprint).toBe('model-a');
    });
  });

  describe('resetCurrentSpace', () => {
    it('retires old space and creates a new one with incremented epoch', () => {
      const { store } = openStore();
      const original = store.ensureCurrentSpace('model-a');
      const result = store.resetCurrentSpace('model-a');
      expect(result.retiredIds).toEqual([original.id]);
      expect(result.space.modelFingerprint).toBe('model-a');
      expect(result.space.epoch).toBe(2);
      expect(result.space.status).toBe('current');
    });

    it('retired space is no longer returned by currentSpace', () => {
      const { store } = openStore();
      const original = store.ensureCurrentSpace('model-a');
      store.resetCurrentSpace('model-a');
      const current = store.currentSpace('model-a');
      expect(current?.id).not.toBe(original.id);
      const retired = store.spaceById(original.id);
      expect(retired?.status).toBe('retired');
    });

    it('creates a new space even when no current space existed', () => {
      const { store } = openStore();
      const result = store.resetCurrentSpace('model-new');
      expect(result.retiredIds).toEqual([]);
      expect(result.space.epoch).toBe(1);
    });
  });

  describe('lockDimension', () => {
    it('locks dimension on first call', () => {
      const { store } = openStore();
      const space = store.ensureCurrentSpace('model-a');
      const result = store.lockDimension(space.id, 384);
      expect(result).toBe('locked');
      const updated = store.spaceById(space.id);
      expect(updated?.dimension).toBe(384);
    });

    it('returns matched when same dimension is locked again', () => {
      const { store } = openStore();
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 384);
      const result = store.lockDimension(space.id, 384);
      expect(result).toBe('matched');
    });

    it('returns conflict when a different dimension is requested', () => {
      const { store } = openStore();
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 384);
      const result = store.lockDimension(space.id, 768);
      expect(result).toBe('conflict');
    });

    it('throws INDEX_CONFIGURATION_CHANGED for unknown space', () => {
      const { store } = openStore();
      expect(() => store.lockDimension('nonexistent', 384)).toThrow(KnowledgeServiceError);
    });
  });

  describe('retrieval chunks', () => {
    it('replaceRetrievalChunks inserts chunks and FTS entries', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test Document', [
        {
          id: 'chunk-1',
          chunkingVersion: 'format-locator-v1',
          span: { sectionOrdinal: 0, start: 0, end: 100 },
          locator: 'p1',
          content: 'Hello world',
          contentHash: 'hash1',
        },
        {
          id: 'chunk-2',
          chunkingVersion: 'format-locator-v1',
          span: { sectionOrdinal: 1, start: 100, end: 200 },
          locator: 'p2',
          content: 'Second chunk',
          contentHash: 'hash2',
        },
      ]);
      const chunks = store.retrievalChunks('rev-1');
      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.id).toBe('chunk-1');
      expect(chunks[0]?.content).toBe('Hello world');
      expect(chunks[0]?.span).toEqual({ sectionOrdinal: 0, start: 0, end: 100 });
      expect(chunks[1]?.id).toBe('chunk-2');
    });

    it('replaceRetrievalChunks replaces previous chunks for the same revision', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-old',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Old content',
          contentHash: 'oldhash',
        },
      ]);
      store.replaceRetrievalChunks('rev-1', 'texthash2', 'Test', [
        {
          id: 'chunk-new',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 80 },
          locator: 'p1',
          content: 'New content',
          contentHash: 'newhash',
        },
      ]);
      const chunks = store.retrievalChunks('rev-1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.id).toBe('chunk-new');
    });

    it('retrievalChunks returns empty for unknown revision', () => {
      const { store } = openStore();
      expect(store.retrievalChunks('nonexistent')).toEqual([]);
    });

    it('retrievalChunks are ordered by section_ordinal then start', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-b',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 1, start: 0, end: 50 },
          locator: 'p2',
          content: 'Section 1',
          contentHash: 'h1',
        },
        {
          id: 'chunk-a',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Section 0',
          contentHash: 'h2',
        },
      ]);
      const chunks = store.retrievalChunks('rev-1');
      expect(chunks[0]?.id).toBe('chunk-a');
      expect(chunks[1]?.id).toBe('chunk-b');
    });
  });

  describe('generation lifecycle', () => {
    it('createStagingGeneration creates a generation in staging status', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      const space = store.ensureCurrentSpace('model-a');
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: { name: 'test-model' },
        chunkingVersion: 'format-locator-v1',
        chunkCount: 2,
      });
      expect(gen.status).toBe('staging');
      expect(gen.revisionId).toBe('rev-1');
      expect(gen.spaceId).toBe(space.id);
      expect(gen.chunkCount).toBe(2);
      expect(gen.publishedAt).toBeUndefined();
    });

    it('generation returns undefined for unknown id', () => {
      const { store } = openStore();
      expect(store.generation('nonexistent')).toBeUndefined();
    });

    it('activeGeneration returns undefined when no active generation exists', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      const space = store.ensureCurrentSpace('model-a');
      expect(store.activeGeneration('rev-1', space.id)).toBeUndefined();
    });
  });

  describe('staging vectors', () => {
    it('addStagingVectors stores vectors for a staging generation', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      expect(store.stagedVectorCount(gen.id)).toBe(1);
    });

    it('addStagingVectors throws when generation does not exist', () => {
      const { store } = openStore();
      expect(() =>
        store.addStagingVectors('nonexistent', [
          { chunkId: 'c1', chunkHash: 'h', vector: new Float32Array([0.1]) },
        ]),
      ).toThrow(KnowledgeServiceError);
    });

    it('addStagingVectors throws when generation is not in staging', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      store.publishGeneration({
        generationId: gen.id,
        expect: {
          revisionId: 'rev-1',
          textHash: 'texthash1',
          spaceId: space.id,
          modelFingerprint: 'model-a',
          dimension: 3,
          chunkingVersion: 'v1',
          registeredRevisionId: 'rev-1',
        },
      });
      expect(() =>
        store.addStagingVectors(gen.id, [
          { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
        ]),
      ).toThrow(KnowledgeServiceError);
    });

    it('stagedVectorCount returns 0 for generation with no vectors', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      const space = store.ensureCurrentSpace('model-a');
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 0,
      });
      expect(store.stagedVectorCount(gen.id)).toBe(0);
    });
  });

  describe('publishGeneration', () => {
    it('publishes a valid staging generation', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      const published = store.publishGeneration({
        generationId: gen.id,
        expect: {
          revisionId: 'rev-1',
          textHash: 'texthash1',
          spaceId: space.id,
          modelFingerprint: 'model-a',
          dimension: 3,
          chunkingVersion: 'v1',
          registeredRevisionId: 'rev-1',
        },
      });
      expect(published.status).toBe('active');
      expect(published.publishedAt).toBeDefined();
    });

    it('supersedes previous active generation for same revision/space/chunking', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);

      const gen1 = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen1.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      store.publishGeneration({
        generationId: gen1.id,
        expect: {
          revisionId: 'rev-1',
          textHash: 'texthash1',
          spaceId: space.id,
          modelFingerprint: 'model-a',
          dimension: 3,
          chunkingVersion: 'v1',
          registeredRevisionId: 'rev-1',
        },
      });

      const gen2 = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen2.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.4, 0.5, 0.6]) },
      ]);
      const published2 = store.publishGeneration({
        generationId: gen2.id,
        expect: {
          revisionId: 'rev-1',
          textHash: 'texthash1',
          spaceId: space.id,
          modelFingerprint: 'model-a',
          dimension: 3,
          chunkingVersion: 'v1',
          registeredRevisionId: 'rev-1',
        },
      });
      expect(published2.status).toBe('active');
      const first = store.generation(gen1.id);
      expect(first?.status).toBe('superseded');
    });

    it('throws when chunk count does not match staged vectors', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 2,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      expect(() =>
        store.publishGeneration({
          generationId: gen.id,
          expect: {
            revisionId: 'rev-1',
            textHash: 'texthash1',
            spaceId: space.id,
            modelFingerprint: 'model-a',
            dimension: 3,
            chunkingVersion: 'v1',
            registeredRevisionId: 'rev-1',
          },
        }),
      ).toThrow(KnowledgeServiceError);
    });

    it('throws when space has been retired', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      store.resetCurrentSpace('model-a');
      expect(() =>
        store.publishGeneration({
          generationId: gen.id,
          expect: {
            revisionId: 'rev-1',
            textHash: 'texthash1',
            spaceId: space.id,
            modelFingerprint: 'model-a',
            dimension: 3,
            chunkingVersion: 'v1',
            registeredRevisionId: 'rev-1',
          },
        }),
      ).toThrow(KnowledgeServiceError);
    });

    it('throws when dimension does not match space', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      expect(() =>
        store.publishGeneration({
          generationId: gen.id,
          expect: {
            revisionId: 'rev-1',
            textHash: 'texthash1',
            spaceId: space.id,
            modelFingerprint: 'model-a',
            dimension: 768,
            chunkingVersion: 'v1',
            registeredRevisionId: 'rev-1',
          },
        }),
      ).toThrow(KnowledgeServiceError);
    });

    it('throws when model fingerprint does not match', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      expect(() =>
        store.publishGeneration({
          generationId: gen.id,
          expect: {
            revisionId: 'rev-1',
            textHash: 'texthash1',
            spaceId: space.id,
            modelFingerprint: 'model-wrong',
            dimension: 3,
            chunkingVersion: 'v1',
            registeredRevisionId: 'rev-1',
          },
        }),
      ).toThrow(KnowledgeServiceError);
    });
  });

  describe('discardStagingGeneration', () => {
    it('removes vectors and the staging generation', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      store.discardStagingGeneration(gen.id);
      expect(store.generation(gen.id)).toBeUndefined();
      expect(store.stagedVectorCount(gen.id)).toBe(0);
    });

    it('does not remove an active generation', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      store.publishGeneration({
        generationId: gen.id,
        expect: {
          revisionId: 'rev-1',
          textHash: 'texthash1',
          spaceId: space.id,
          modelFingerprint: 'model-a',
          dimension: 3,
          chunkingVersion: 'v1',
          registeredRevisionId: 'rev-1',
        },
      });
      store.discardStagingGeneration(gen.id);
      expect(store.generation(gen.id)?.status).toBe('active');
    });
  });

  describe('searchChunks', () => {
    it('returns empty for empty revision list', () => {
      const { store } = openStore();
      expect(store.searchChunks([], 'test')).toEqual([]);
    });

    it('returns empty for empty match string', () => {
      const { store } = openStore();
      expect(store.searchChunks(['rev-1'], '')).toEqual([]);
    });

    it('finds chunks matching the FTS query within scope', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1', { title: 'Quarterly Report' });
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Quarterly Report', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Revenue increased by 20 percent',
          contentHash: 'hash1',
        },
      ]);
      const results = store.searchChunks(['rev-1'], 'revenue');
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('chunk-1');
      expect(results[0]?.documentId).toBe('doc-1');
      expect(results[0]?.title).toBe('Quarterly Report');
    });

    it('excludes chunks not in the revision scope', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      insertRevision(db, 'rev-2', {
        documentId: 'doc-2',
        revision: 1,
        contentHash: 'different',
        textHash: 'texthash2',
        sourcePath: '/tmp/other.md',
      });
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Doc 1', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Unique alpha content',
          contentHash: 'hash1',
        },
      ]);
      store.replaceRetrievalChunks('rev-2', 'texthash2', 'Doc 2', [
        {
          id: 'chunk-2',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Unique alpha content',
          contentHash: 'hash2',
        },
      ]);
      const results = store.searchChunks(['rev-1'], 'alpha');
      expect(results).toHaveLength(1);
      expect(results[0]?.revisionId).toBe('rev-1');
    });
  });

  describe('searchTextInScope', () => {
    it('yields nothing for empty revision list', () => {
      const { store } = openStore();
      const results = [...store.searchTextInScope([])];
      expect(results).toEqual([]);
    });

    it('yields chunks ordered by revision, section, and start', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1', { title: 'Test' });
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-b',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 1, start: 0, end: 50 },
          locator: 'p2',
          content: 'Section 1',
          contentHash: 'h1',
        },
        {
          id: 'chunk-a',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Section 0',
          contentHash: 'h2',
        },
      ]);
      const results = [...store.searchTextInScope(['rev-1'])];
      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('chunk-a');
      expect(results[1]?.id).toBe('chunk-b');
      expect(results[0]?.title).toBe('Test');
    });
  });

  describe('chunksByIdsInScope', () => {
    it('returns empty when revision list is empty', () => {
      const { store } = openStore();
      expect(store.chunksByIdsInScope([], ['chunk-1'])).toEqual([]);
    });

    it('returns empty when chunk list is empty', () => {
      const { store } = openStore();
      expect(store.chunksByIdsInScope(['rev-1'], [])).toEqual([]);
    });

    it('returns only matching chunks within scope', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content A',
          contentHash: 'h1',
        },
        {
          id: 'chunk-2',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 1, start: 0, end: 50 },
          locator: 'p2',
          content: 'Content B',
          contentHash: 'h2',
        },
      ]);
      const results = store.chunksByIdsInScope(['rev-1'], ['chunk-1']);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('chunk-1');
    });
  });

  describe('chunksInScope', () => {
    it('returns empty for empty revision list', () => {
      const { store } = openStore();
      expect(store.chunksInScope([])).toEqual([]);
    });

    it('returns all scoped chunks with document metadata', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1', { title: 'My Title', contentHash: 'abc123' });
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'My Title', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 100 },
          locator: 'p1',
          content: 'Hello',
          contentHash: 'h1',
        },
      ]);
      const results = store.chunksInScope(['rev-1']);
      expect(results).toHaveLength(1);
      expect(results[0]?.documentId).toBe('doc-1');
      expect(results[0]?.title).toBe('My Title');
      expect(results[0]?.sourcePath).toBe('/tmp/test.md');
      expect(results[0]?.format).toBe('markdown');
      expect(results[0]?.revisionContentHash).toBe('abc123');
    });
  });

  describe('scopeCoverage', () => {
    it('returns zeros for empty revision list', () => {
      const { store } = openStore();
      expect(store.scopeCoverage([], [])).toEqual({ eligibleChunks: 0, indexedChunks: 0 });
    });

    it('counts eligible chunks from retrieval table', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'A',
          contentHash: 'h1',
        },
        {
          id: 'chunk-2',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 1, start: 0, end: 50 },
          locator: 'p2',
          content: 'B',
          contentHash: 'h2',
        },
      ]);
      const result = store.scopeCoverage(['rev-1'], []);
      expect(result.eligibleChunks).toBe(2);
      expect(result.indexedChunks).toBe(0);
    });

    it('counts indexed vectors from generation ids', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'A',
          contentHash: 'h1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'h1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      const result = store.scopeCoverage(['rev-1'], [gen.id]);
      expect(result.eligibleChunks).toBe(1);
      expect(result.indexedChunks).toBe(1);
    });
  });

  describe('vectorsInGenerations', () => {
    it('returns empty for empty generation list', () => {
      const { store } = openStore();
      expect(store.vectorsInGenerations([])).toEqual([]);
    });

    it('returns deserialized vectors with chunk metadata', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 10, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      const inputVector = new Float32Array([0.1, 0.2, 0.3]);
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: inputVector },
      ]);
      const results = store.vectorsInGenerations([gen.id]);
      expect(results).toHaveLength(1);
      expect(results[0]?.chunkId).toBe('chunk-1');
      expect(results[0]?.generationId).toBe(gen.id);
      expect(results[0]?.revisionId).toBe('rev-1');
      expect(results[0]?.sectionOrdinal).toBe(0);
      expect(results[0]?.start).toBe(10);
      expect(Array.from(results[0]?.vector ?? [])).toEqual([
        expect.closeTo(0.1, 2),
        expect.closeTo(0.2, 2),
        expect.closeTo(0.3, 2),
      ]);
    });
  });

  describe('coverage', () => {
    it('returns zero revisions and vectors for space with no active generations', () => {
      const { store } = openStore();
      const space = store.ensureCurrentSpace('model-a');
      const result = store.coverage(space.id);
      expect(result.revisions).toBe(0);
      expect(result.vectors).toBe(0);
    });

    it('counts active generation revisions and vectors', () => {
      const { store, db } = openStore();
      insertRevision(db, 'rev-1');
      store.replaceRetrievalChunks('rev-1', 'texthash1', 'Test', [
        {
          id: 'chunk-1',
          chunkingVersion: 'v1',
          span: { sectionOrdinal: 0, start: 0, end: 50 },
          locator: 'p1',
          content: 'Content',
          contentHash: 'hash1',
        },
      ]);
      const space = store.ensureCurrentSpace('model-a');
      store.lockDimension(space.id, 3);
      const gen = store.createStagingGeneration({
        revisionId: 'rev-1',
        textHash: 'texthash1',
        spaceId: space.id,
        modelSnapshot: {},
        chunkingVersion: 'v1',
        chunkCount: 1,
      });
      store.addStagingVectors(gen.id, [
        { chunkId: 'chunk-1', chunkHash: 'hash1', vector: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      store.publishGeneration({
        generationId: gen.id,
        expect: {
          revisionId: 'rev-1',
          textHash: 'texthash1',
          spaceId: space.id,
          modelFingerprint: 'model-a',
          dimension: 3,
          chunkingVersion: 'v1',
          registeredRevisionId: 'rev-1',
        },
      });
      const result = store.coverage(space.id);
      expect(result.revisions).toBe(1);
      expect(result.vectors).toBe(1);
    });
  });
});
