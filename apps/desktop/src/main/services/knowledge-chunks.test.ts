import { describe, expect, it } from 'vitest';

import {
  buildRetrievalChunks,
  KNOWLEDGE_CHUNK_OVERLAP_CODE_POINTS,
  KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS,
  KNOWLEDGE_CHUNKING_VERSION,
} from './knowledge-chunks';

const sections = (
  count: number,
  size: number,
): { ordinal: number; locator: string; content: string }[] =>
  Array.from({ length: count }, (_unused, index) => ({
    ordinal: index,
    locator: `第 ${index + 1} 段`,
    content: '甲'.repeat(size),
  }));

describe('buildRetrievalChunks', () => {
  it('在 section 内按固定窗口滑动并保留重叠', () => {
    const size = KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS + 250;
    const chunks = buildRetrievalChunks({
      revisionId: 'rev-1',
      textHash: 'text-1',
      sections: sections(1, size),
    });

    expect(chunks.map((chunk) => chunk.span)).toEqual([
      {
        sectionOrdinal: 0,
        start: 0,
        end: KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS,
      },
      {
        sectionOrdinal: 0,
        start: KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS - KNOWLEDGE_CHUNK_OVERLAP_CODE_POINTS,
        end: size,
      },
    ]);
    expect(chunks[1]?.content).toHaveLength(
      size - (KNOWLEDGE_CHUNK_WINDOW_CODE_POINTS - KNOWLEDGE_CHUNK_OVERLAP_CODE_POINTS),
    );
    expect(chunks.every((chunk) => chunk.chunkingVersion === KNOWLEDGE_CHUNKING_VERSION)).toBe(
      true,
    );
  });

  it('绝不跨 section 合并，并跳过空白 section', () => {
    const chunks = buildRetrievalChunks({
      revisionId: 'rev-1',
      textHash: 'text-1',
      sections: [
        { ordinal: 0, locator: '第 1 段', content: '第一段落' },
        { ordinal: 1, locator: '第 2 段', content: '   \n  ' },
        { ordinal: 2, locator: '第 3 段', content: '第二段落' },
      ],
    });

    expect(chunks.map((chunk) => chunk.span.sectionOrdinal)).toEqual([0, 2]);
  });

  it('同一修订与范围重建出相同块 id，块正文哈希可回算', () => {
    const input = { revisionId: 'rev-1', textHash: 'text-1', sections: sections(2, 400) };
    const first = buildRetrievalChunks(input);
    const again = buildRetrievalChunks(input);

    expect(again.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
    expect(new Set(first.map((chunk) => chunk.id)).size).toBe(first.length);
    const other = buildRetrievalChunks({ ...input, revisionId: 'rev-2' });
    expect(other[0]?.id).not.toBe(first[0]?.id);
    expect(first[0]?.contentHash).toHaveLength(64);
  });
});
