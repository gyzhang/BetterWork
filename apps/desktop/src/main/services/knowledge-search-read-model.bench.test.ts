import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  legacySubstringChunkIds,
  seedSearchChunks,
} from './fixtures/knowledge-search-read-fixtures';
import type { ScopedRetrievalChunk } from './knowledge-index-store';
import { selectSubstringChunkIds } from './knowledge-search-policy';
import { KnowledgeVault } from './knowledge-vault';

let vault: KnowledgeVault;
let directory: string;
let revisionIds: string[];

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'betterwork-e8-bench-'));
  vault = new KnowledgeVault(':memory:');
  const contents = Array.from({ length: 2_000 }, (_, index) =>
    index === 1_999 ? '\u76D8\u53E3\u5F84' : '\u7532'.repeat(479) + '\u76D8\u53E3\u5F84',
  );
  const sourcePath = path.join(directory, 'material.md');
  await writeFile(sourcePath, contents.join(''));
  await vault.importPaths([sourcePath]);
  const document = vault.listDocuments()[0]!;
  const revisionId = vault.registeredRevisionId(document.id)!;
  revisionIds = [revisionId];
  seedSearchChunks(vault.index, revisionId, 'material', contents);
}, 60_000);

afterAll(async () => {
  vault?.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

const measure = (read: () => unknown): { medianMs: number; p95Ms: number } => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    read();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

const orderedChunks = (
  ids: readonly string[],
  chunks: readonly ScopedRetrievalChunk[],
): ScopedRetrievalChunk[] => {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk] as const));
  return ids.map((id) => byId.get(id)!);
};

const legacyFallbackRead = () => {
  const chunks = vault.index.chunksInScope(revisionIds);
  const ids = legacySubstringChunkIds(chunks, ['\u76D8']);
  return {
    chunks: orderedChunks(ids, chunks),
    coverage: { eligibleChunks: vault.index.chunksInScope(revisionIds).length, indexedChunks: 0 },
  };
};

const projectedFallbackRead = () => {
  const ids = selectSubstringChunkIds(vault.index.searchTextInScope(revisionIds), ['\u76D8']);
  return {
    chunks: orderedChunks(ids, vault.index.chunksByIdsInScope(revisionIds, ids)),
    coverage: vault.index.scopeCoverage(revisionIds, []),
  };
};

const observeReads = (read: () => unknown) => {
  const index = vault.index;
  const full = index.chunksInScope.bind(index);
  const selected = index.chunksByIdsInScope.bind(index);
  const text = index.searchTextInScope.bind(index);
  const counts = { fullRows: 0, textRows: 0, contentBytes: 0 };
  const recordFull = (chunks: readonly ScopedRetrievalChunk[]): void => {
    counts.fullRows += chunks.length;
    for (const chunk of chunks) counts.contentBytes += Buffer.byteLength(chunk.content, 'utf8');
  };
  vi.spyOn(index, 'chunksInScope').mockImplementation((scope) => {
    const chunks = full(scope);
    recordFull(chunks);
    return chunks;
  });
  vi.spyOn(index, 'chunksByIdsInScope').mockImplementation((scope, ids) => {
    const chunks = selected(scope, ids);
    recordFull(chunks);
    return chunks;
  });
  vi.spyOn(index, 'searchTextInScope').mockImplementation(function* (scope) {
    for (const chunk of text(scope)) {
      counts.textRows += 1;
      counts.contentBytes += Buffer.byteLength(chunk.content, 'utf8');
      yield chunk;
    }
  });
  try {
    read();
    return counts;
  } finally {
    vi.restoreAllMocks();
  }
};

describe('Knowledge scope and substring read model scale', () => {
  it('compares aggregate coverage without returning body rows', () => {
    const legacy = () => ({
      eligibleChunks: vault.index.chunksInScope(revisionIds).length,
      indexedChunks: 0,
    });
    const projected = () => vault.index.scopeCoverage(revisionIds, []);
    expect(projected()).toEqual(legacy());
    const legacyTiming = measure(legacy);
    const projectedTiming = measure(projected);
    const legacyReads = observeReads(legacy);
    const projectedReads = observeReads(projected);
    expect(legacyReads.fullRows).toBe(2_000);
    expect(projectedReads).toEqual({ fullRows: 0, textRows: 0, contentBytes: 0 });
    console.warn(
      JSON.stringify({
        benchmark: 'scope-coverage',
        chunks: 2_000,
        legacyTiming,
        projectedTiming,
        legacyReads,
        projectedReads,
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });

  it('preserves complete ranked chunks with bounded full-row hydration', () => {
    const expected = legacyFallbackRead();
    const actual = projectedFallbackRead();
    expect(actual).toEqual(expected);
    expect(actual.chunks).toHaveLength(50);
    const legacyTiming = measure(legacyFallbackRead);
    const projectedTiming = measure(projectedFallbackRead);
    const legacyReads = observeReads(legacyFallbackRead);
    const projectedReads = observeReads(projectedFallbackRead);
    expect(legacyReads.fullRows).toBe(4_000);
    expect(projectedReads.fullRows).toBe(50);
    expect(projectedReads.textRows).toBe(2_000);
    expect(projectedReads.contentBytes).toBeLessThan(legacyReads.contentBytes);
    console.warn(
      JSON.stringify({
        benchmark: 'substring-with-coverage',
        chunks: 2_000,
        resultChunks: actual.chunks.length,
        legacyTiming,
        projectedTiming,
        legacyReads,
        projectedReads,
        machine: `${process.platform} ${process.arch} node ${process.version}`,
      }),
    );
  });
});
