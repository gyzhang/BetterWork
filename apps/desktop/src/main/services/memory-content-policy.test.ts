import { describe, expect, it } from 'vitest';

import {
  findSensitiveMemoryContent,
  isSensitiveMemoryContent,
  memoryContentHash,
  memoryTextLength,
  normalizedMemoryHash,
  normalizeMemoryText,
} from './memory-content-policy';

describe('memory content policy', () => {
  it('normalizes only formatting and keeps meaning-bearing characters', () => {
    expect(normalizeMemoryText('  收入按回款\r\n金额统计。  ')).toBe('收入按回款\n金额统计。');
    expect(normalizedMemoryHash('口径A\n')).toBe(normalizedMemoryHash('口径A\r\n'));
    expect(normalizedMemoryHash('  口径A ')).toBe(normalizedMemoryHash('口径A'));
  });

  it('keeps negation, digits and units out of the dedup collision', () => {
    expect(normalizedMemoryHash('不得合并')).not.toBe(normalizedMemoryHash('可以合并'));
    expect(normalizedMemoryHash('10万元')).not.toBe(normalizedMemoryHash('100万元'));
    expect(normalizedMemoryHash('ARR不含一次性实施费')).not.toBe(
      normalizedMemoryHash('ARR含一次性实施费'),
    );
  });

  it('counts code points rather than UTF-16 units for non-BMP content', () => {
    expect(memoryTextLength('𐐀𐐁𐐂')).toBe(3);
    expect(memoryTextLength('中文abc')).toBe(5);
    expect(memoryContentHash('a')).toHaveLength(64);
  });

  it('flags private keys, bearer tokens and credential assignments', () => {
    expect(findSensitiveMemoryContent('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA')).toContain(
      'private-key',
    );
    expect(isSensitiveMemoryContent('Authorization: Bearer abcdefghijklmnop')).toBe(true);
    expect(isSensitiveMemoryContent('api_key = sk-1234567890abcdef')).toBe(true);
    expect(isSensitiveMemoryContent('password: hunter2islong')).toBe(true);
  });

  it('flags a known credential value without echoing it', () => {
    const reasons = findSensitiveMemoryContent('请把口令放在这里 sk-live-9f8e7d6c', [
      'sk-live-9f8e7d6c',
    ]);
    expect(reasons).toContain('known-credential');
    expect(reasons.some((reason) => reason.includes('sk-live'))).toBe(false);
  });

  it('does not treat ordinary business wording as sensitive', () => {
    expect(isSensitiveMemoryContent('收入按回款金额统计，不使用签约金额。')).toBe(false);
    expect(isSensitiveMemoryContent('先列异常和待决策事项，再列总体指标。')).toBe(false);
  });
});
