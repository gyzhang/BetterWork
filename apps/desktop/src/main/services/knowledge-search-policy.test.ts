import { describe, expect, it } from 'vitest';

import {
  legacySubstringChunkIds,
  mixedSearchText,
} from './fixtures/knowledge-search-read-fixtures';
import type { ScopedSearchText } from './knowledge-index-store';
import { selectSubstringChunkIds } from './knowledge-search-policy';

describe('bounded substring candidate selection', () => {
  it('matches the complete legacy scan across permutations and normalized queries', () => {
    const records = mixedSearchText();
    const permutations = [
      records,
      [...records].reverse(),
      records.slice(91).concat(records.slice(0, 91)),
    ];
    for (const input of permutations) {
      Object.freeze(input);
      for (const chunk of input) {
        Object.freeze(chunk.span);
        Object.freeze(chunk);
      }
      for (const terms of [['alpha', 'beta'], ['alpha'], ['fi'], ['eta', '\u00E9'], ['absent']]) {
        expect(selectSubstringChunkIds(input.values(), terms)).toEqual(
          legacySubstringChunkIds(input, terms),
        );
      }
    }
  });

  it('keeps input order for equal identities at the top-50 boundary', () => {
    const records: ScopedSearchText[] = Array.from({ length: 75 }, (_, index) => ({
      id: `chunk-${index}`,
      revisionId: 'revision',
      span: { sectionOrdinal: 0, start: 0 },
      title: 'alpha',
      content: 'alpha',
    }));
    for (const input of [records, [...records].reverse()]) {
      expect(selectSubstringChunkIds(input, ['alpha'])).toEqual(
        input.slice(0, 50).map(({ id }) => id),
      );
    }
  });

  it('consumes the full iterator and promotes a final better match', () => {
    let scanned = 0;
    function* chunks(): IterableIterator<ScopedSearchText> {
      for (let index = 0; index < 160; index += 1) {
        scanned += 1;
        yield {
          id: `chunk-${index}`,
          revisionId: 'revision',
          span: { sectionOrdinal: 0, start: index },
          title: index === 159 ? 'alpha beta' : 'note',
          content: 'prefix alpha beta',
        };
      }
    }
    const selected = selectSubstringChunkIds(chunks(), ['alpha', 'beta']);
    expect(scanned).toBe(160);
    expect(selected).toHaveLength(50);
    expect(selected[0]).toBe('chunk-159');
    scanned = 0;
    expect(selectSubstringChunkIds(chunks(), [])).toEqual([]);
    expect(scanned).toBe(0);
  });

  it('preserves first query-term position, UTF-16 offsets and NFKC matches', () => {
    const base = { revisionId: 'revision', span: { sectionOrdinal: 0, start: 0 }, title: 'note' };
    const records = [
      { ...base, id: 'first-query-term-late', content: 'beta ...... alpha' },
      { ...base, id: 'wide', content: '\uFF21\uFF2C\uFF30\uFF28\uFF21 beta' },
      { ...base, id: 'utf16', content: '\u{1F9ED}alpha beta' },
      { ...base, id: 'ascii-offset', content: '_alpha beta' },
      { ...base, id: 'title-only', title: 'alpha beta', content: 'no match' },
      { ...base, id: 'partial', content: 'alpha' },
    ];
    expect(selectSubstringChunkIds(records, ['alpha', 'beta'])).toEqual([
      'title-only',
      'wide',
      'ascii-offset',
      'utf16',
      'first-query-term-late',
    ]);
    expect(selectSubstringChunkIds(records, ['alpha', 'beta'])).toEqual(
      legacySubstringChunkIds(records, ['alpha', 'beta']),
    );
  });
});
