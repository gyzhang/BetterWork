import type { KnowledgeCursor, KnowledgeMaterialReference } from '@betterwork/agent-protocol';
import { countCodePoints } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { KnowledgeServiceError } from './knowledge-errors';
import type { KnowledgeSection } from './knowledge-text';
import { readKnowledgeTextPage, revisionTextHash, sha256Hex } from './knowledge-text';

const reference: KnowledgeMaterialReference = {
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'doc-1',
  knowledgeRevisionId: 'rev-1',
  contentHash: 'byte-hash',
  sourcePath: '/tmp/笔记.md',
};

function page(
  sections: KnowledgeSection[],
  extra?: { cursor?: KnowledgeCursor; maxCodePoints?: number },
) {
  return readKnowledgeTextPage({
    reference,
    textHash: revisionTextHash(sections),
    title: '笔记',
    parserVersion: 'text-extract-v1',
    chunkingVersion: 'format-locator-v1',
    warnings: [],
    sections,
    ...extra,
  });
}

describe('revisionTextHash', () => {
  it('is stable under shuffled input and changes with any content byte', () => {
    const sections: KnowledgeSection[] = [
      { ordinal: 0, locator: '第 1 页', content: '甲' },
      { ordinal: 1, locator: '第 2 页', content: '乙' },
    ];
    expect(revisionTextHash([...sections].reverse())).toBe(revisionTextHash(sections));
    expect(revisionTextHash([{ ordinal: 0, locator: '第 1 页', content: '甲改' }])).not.toBe(
      revisionTextHash(sections),
    );
  });
});

describe('readKnowledgeTextPage', () => {
  const mixed = '𐍈A😀中文 tail'; // 码点数 8：增补字符与 emoji 各占多码点单元
  const sections: KnowledgeSection[] = [
    { ordinal: 0, locator: '第 1 页', content: mixed },
    { ordinal: 2, locator: '第 3 页', content: '第二段落内容' },
  ];

  it('pages in code points and reassembles the exact saved text', () => {
    const collected: string[] = [];
    let cursor = undefined;
    for (;;) {
      const result = readKnowledgeTextPage({
        reference,
        textHash: revisionTextHash(sections),
        title: '笔记',
        parserVersion: 'p',
        chunkingVersion: 'c',
        warnings: [],
        sections,
        maxCodePoints: 3,
        ...(cursor ? { cursor } : {}),
      });
      collected.push(...result.parts.map((part) => part.text));
      cursor = result.nextCursor;
      if (result.complete) break;
    }
    expect(collected.join('')).toBe(`${mixed}第二段落内容`);
  });

  it('starts at the first non-empty section and normalizes end-of-section cursors', () => {
    const withEmpty: KnowledgeSection[] = [
      { ordinal: 0, locator: '空页', content: '' },
      { ordinal: 1, locator: '页一', content: 'AAA' },
      { ordinal: 2, locator: '页二', content: 'BBB' },
    ];
    const first = page(withEmpty, { maxCodePoints: 5 });
    expect(first.parts[0]).toMatchObject({
      span: { sectionOrdinal: 1, start: 0, end: 3 },
    });
    // 段末 offset 规范化到下一段起点
    const atEnd = page(withEmpty, {
      maxCodePoints: 5,
      cursor: {
        revisionId: 'rev-1',
        textHash: revisionTextHash(withEmpty),
        sectionOrdinal: 1,
        offset: 3,
      },
    });
    expect(atEnd.parts[0]?.span).toEqual({ sectionOrdinal: 2, start: 0, end: 3 });
    expect(atEnd.complete).toBe(true);
    expect(atEnd.nextCursor).toBeUndefined();
  });

  it('returns an empty complete page past the final section end', () => {
    const tail: KnowledgeSection[] = [{ ordinal: 0, locator: '页', content: 'x' }];
    const result = page(tail, {
      maxCodePoints: 4,
      cursor: {
        revisionId: 'rev-1',
        textHash: revisionTextHash(tail),
        sectionOrdinal: 0,
        offset: 1,
      },
    });
    expect(result.parts).toEqual([]);
    expect(result.returnedCodePoints).toBe(0);
    expect(result.complete).toBe(true);
  });

  it('rejects cursors from another revision, text, ordinal or offset', () => {
    const hash = revisionTextHash(sections);
    const base = { textHash: hash, sectionOrdinal: 0, offset: 0 };
    const attempts = [
      { revisionId: 'other', ...base },
      { revisionId: 'rev-1', ...base, textHash: '别的哈希' },
      { revisionId: 'rev-1', ...base, sectionOrdinal: 99 },
      { revisionId: 'rev-1', ...base, offset: countCodePoints(mixed) + 1 },
    ];
    for (const cursor of attempts) {
      expect(() =>
        readKnowledgeTextPage({
          reference,
          textHash: hash,
          title: '笔记',
          parserVersion: 'p',
          chunkingVersion: 'c',
          warnings: [],
          sections,
          cursor,
        }),
      ).toThrowError(KnowledgeServiceError);
    }
    try {
      page(sections, {
        cursor: { revisionId: 'other', textHash: hash, sectionOrdinal: 0, offset: 0 },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeServiceError);
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_CURSOR_INVALID');
    }
  });

  it('clamps oversized budgets and caps a page at twenty parts', () => {
    const many: KnowledgeSection[] = Array.from({ length: 25 }, (_, index) => ({
      ordinal: index,
      locator: `段 ${index + 1}`,
      content: `${index}`,
    }));
    const bigBudget = page(many, { maxCodePoints: 100_000 });
    expect(bigBudget.parts.length).toBe(20);
    expect(bigBudget.complete).toBe(false);
    expect(bigBudget.nextCursor?.sectionOrdinal).toBe(20);
  });

  it('hashes each returned part with its exact text', () => {
    const result = page(sections, { maxCodePoints: 4 });
    for (const part of result.parts) {
      expect(part.excerptHash).toBe(sha256Hex(part.text));
      const section = sections.find((item) => item.ordinal === part.span.sectionOrdinal);
      expect(Array.from(section?.content ?? '').slice(part.span.start, part.span.end)).toEqual(
        Array.from(part.text),
      );
    }
  });
});
