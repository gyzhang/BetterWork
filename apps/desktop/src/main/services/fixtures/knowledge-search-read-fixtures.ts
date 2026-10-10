import { randomUUID } from 'node:crypto';

import { countCodePoints, KNOWLEDGE_SEARCH_CANDIDATE_LIMIT } from '@betterwork/agent-protocol';

import type {
  KnowledgeIndexStore,
  RetrievalChunkRow,
  ScopedSearchText,
} from '../knowledge-index-store';
import { sha256Hex } from '../knowledge-text';

export const legacySubstringChunkIds = (
  chunks: readonly ScopedSearchText[],
  terms: readonly string[],
): string[] => {
  if (terms.length === 0) return [];
  const scored: Array<{ chunk: ScopedSearchText; titleHits: number; contentHit: number }> = [];
  for (const chunk of chunks) {
    const title = chunk.title.normalize('NFKC').toLocaleLowerCase();
    const content = chunk.content.normalize('NFKC').toLocaleLowerCase();
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
    return (
      left.chunk.revisionId.localeCompare(right.chunk.revisionId) ||
      left.chunk.span.sectionOrdinal - right.chunk.span.sectionOrdinal ||
      left.chunk.span.start - right.chunk.span.start
    );
  });
  return scored.slice(0, KNOWLEDGE_SEARCH_CANDIDATE_LIMIT).map(({ chunk }) => chunk.id);
};

export const seedSearchChunks = (
  index: KnowledgeIndexStore,
  revisionId: string,
  title: string,
  contents: readonly string[],
): RetrievalChunkRow[] => {
  const prior = index.retrievalChunks(revisionId)[0];
  if (prior === undefined) throw new Error('Missing registered fixture revision');
  let offset = 0;
  const chunks = contents.map((content) => {
    const start = offset;
    offset += countCodePoints(content);
    return {
      ...prior,
      id: randomUUID(),
      span: { sectionOrdinal: 0, start, end: offset },
      content,
      contentHash: sha256Hex(content),
    };
  });
  index.replaceRetrievalChunks(revisionId, prior.textHash, title, chunks);
  return chunks;
};

export const mixedSearchText = (): ScopedSearchText[] =>
  Array.from({ length: 204 }, (_, index) => ({
    id: `chunk-${index}`,
    revisionId: ['rev-z', 'rev-a', 'rev-b'][index % 3] ?? 'rev-a',
    span: { sectionOrdinal: index % 4, start: index % 7 },
    title: ['ALPHA beta', 'alpha', '\uFF21\uFF2C\uFF30\uFF28\uFF21', 'note'][index % 4] ?? '',
    content:
      ['beta .... alpha', '\u{1F9ED} alpha beta', '\uFB01 eta e\u0301', 'prefix ALPHA beta'][
        index % 4
      ] ?? '',
  }));
