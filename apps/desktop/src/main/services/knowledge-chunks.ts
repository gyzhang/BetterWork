import type { KnowledgeSpan } from '@betterwork/agent-protocol';

import { sha256Hex } from './knowledge-text';

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

const hasSurrogates = (text: string): boolean => /[\uD800-\uDFFF]/.test(text);

/**
 * 逐窗截取必须对整节只做一次线性处理：2M 码点的节按 900 步长跑 ~2,200 个窗口，
 * 若每个窗口都 `Array.from(整节)` 就是 O(n²)，导入在契约规模下不可完成。
 * 无代理对时码点索引＝UTF-16 索引，直接切片；否则码点数组只展开一次。
 */
const sectionWindowSlicer = (content: string): ((start: number, end: number) => string) => {
  if (!hasSurrogates(content)) {
    return (start, end) => content.slice(start, end);
  }
  const codePoints = Array.from(content);
  return (start, end) => codePoints.slice(start, end).join('');
};

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
    const sliceWindow = sectionWindowSlicer(section.content);
    const length = hasSurrogates(section.content)
      ? codePointLength(section.content)
      : section.content.length;
    let start = 0;
    while (start < length) {
      const end = Math.min(start + KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS, length);
      const content = sliceWindow(start, end);
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
