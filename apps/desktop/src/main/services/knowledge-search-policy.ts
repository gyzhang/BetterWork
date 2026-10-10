import { KNOWLEDGE_SEARCH_CANDIDATE_LIMIT } from '@betterwork/agent-protocol';

import type { ScopedSearchText } from './knowledge-index-store';

type ChunkIdentity = Pick<ScopedSearchText, 'revisionId' | 'span'>;

interface SubstringCandidate extends ChunkIdentity {
  readonly id: string;
  readonly titleHits: number;
  readonly contentHit: number;
}

export const normalizeSearchText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase();

export const compareSearchChunkIdentity = (left: ChunkIdentity, right: ChunkIdentity): number =>
  left.revisionId.localeCompare(right.revisionId) ||
  left.span.sectionOrdinal - right.span.sectionOrdinal ||
  left.span.start - right.span.start;

const compareCandidates = (left: SubstringCandidate, right: SubstringCandidate): number => {
  if (right.titleHits !== left.titleHits) return right.titleHits - left.titleHits;
  const leftBody = left.contentHit < 0 ? Number.POSITIVE_INFINITY : left.contentHit;
  const rightBody = right.contentHit < 0 ? Number.POSITIVE_INFINITY : right.contentHit;
  if (leftBody !== rightBody) return leftBody - rightBody;
  return compareSearchChunkIdentity(left, right);
};

export const selectSubstringChunkIds = (
  chunks: Iterable<ScopedSearchText>,
  terms: readonly string[],
): string[] => {
  if (terms.length === 0) return [];
  const ranked: SubstringCandidate[] = [];
  for (const chunk of chunks) {
    const title = normalizeSearchText(chunk.title);
    const content = normalizeSearchText(chunk.content);
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const hitTerm = terms.find((term) => content.includes(term));
    const contentHit = hitTerm === undefined ? -1 : content.indexOf(hitTerm);
    if (!terms.every((term) => title.includes(term) || content.includes(term))) continue;
    const candidate: SubstringCandidate = {
      id: chunk.id,
      revisionId: chunk.revisionId,
      span: chunk.span,
      titleHits,
      contentHit,
    };
    let low = 0;
    let high = ranked.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const current = ranked[middle];
      if (current !== undefined && compareCandidates(candidate, current) >= 0) low = middle + 1;
      else high = middle;
    }
    if (low >= KNOWLEDGE_SEARCH_CANDIDATE_LIMIT) continue;
    ranked.splice(low, 0, candidate);
    if (ranked.length > KNOWLEDGE_SEARCH_CANDIDATE_LIMIT) ranked.pop();
  }
  return ranked.map((candidate) => candidate.id);
};
