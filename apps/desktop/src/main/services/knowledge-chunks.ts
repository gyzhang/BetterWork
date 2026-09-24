import type { KnowledgeSpan } from '@betterwork/agent-protocol';

import { sha256Hex, sliceCodePoints } from './knowledge-text';

/**
 * `knowledge-chunks-v1` 派生块（知识契约 §2.2/§2.3）。
 *
 * 块只在 section 内滑动，绝不跨段；重叠 100 码点用于保住跨窗口边界的句子。
 * 同一修订、同一算法重建出的 id 必须相同，所以 id 由身份字段稳定哈希而来。
 */
export const KNOWLEDGE_CHUNKING_VERSION = 'knowledge-chunks-v1';
export const KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS = 1_000;
export const KNOWLEDGE_CHUNK_OVERLAP_CODE_POINTS = 100;

export interface RetrievalChunkSection {
  ordinal: number;
  locator: string;
  content: string;
}

export interface KnowledgeRetrievalChunk {
  id: string;
  revisionId: string;
  textHash: string;
  chunkingVersion: string;
  span: KnowledgeSpan;
  locator: string;
  content: string;
  contentHash: string;
}

export interface ChunkRevisionInput {
  revisionId: string;
  textHash: string;
  sections: readonly RetrievalChunkSection[];
}

const codePointLength = (text: string): number => [...text].length;

const chunkId = (revisionId: string, sectionOrdinal: number, start: number, end: number): string =>
  sha256Hex(
    JSON.stringify({
      revisionId,
      chunkingVersion: KNOWLEDGE_CHUNKING_VERSION,
      sectionOrdinal,
      start,
      end,
    }),
  );

export function buildRetrievalChunks(input: ChunkRevisionInput): KnowledgeRetrievalChunk[] {
  const chunks: KnowledgeRetrievalChunk[] = [];
  for (const section of input.sections) {
    if (section.content.trim() === '') continue;
    const length = codePointLength(section.content);
    let start = 0;
    while (start < length) {
      const end = Math.min(start + KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS, length);
      const content = sliceCodePoints(section.content, start, end);
      chunks.push({
        id: chunkId(input.revisionId, section.ordinal, start, end),
        revisionId: input.revisionId,
        textHash: input.textHash,
        chunkingVersion: KNOWLEDGE_CHUNKING_VERSION,
        span: { sectionOrdinal: section.ordinal, start, end },
        locator: section.locator,
        content,
        contentHash: sha256Hex(content),
      });
      if (end >= length) break;
      start += KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS - KNOWLEDGE_CHUNK_OVERLAP_CODE_POINTS;
    }
  }
  return chunks;
}
