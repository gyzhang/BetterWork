import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hashBytes, readManagedFile, writeManagedText } from './managed-files';

const roots: string[] = [];
const temporary = (): string => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'betterwork-managed-')));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('managed files', () => {
  it('rejects new files through parent symlinks, traversal and hard links', () => {
    const root = temporary();
    const outside = temporary();
    symlinkSync(outside, path.join(root, 'linked'));
    expect(() => writeManagedText(root, 'linked/new.txt', 'bad')).toThrow('symbolic link');
    expect(() => writeManagedText(root, '../new.txt', 'bad')).toThrow('escapes');
    writeFileSync(path.join(outside, 'source.txt'), 'unchanged');
    linkSync(path.join(outside, 'source.txt'), path.join(root, 'hard.txt'));
    expect(() =>
      writeManagedText(root, 'hard.txt', 'bad', hashBytes(Buffer.from('unchanged'))),
    ).toThrow('regular');
    expect(readFileSync(path.join(outside, 'source.txt'), 'utf8')).toBe('unchanged');
  });
  it('supports Unicode and spaces, requires matching hash for replacement', () => {
    const root = temporary();
    const first = writeManagedText(root, '中文 资料/nested/file.txt', 'one');
    expect(first.created).toBe(true);
    expect(() => writeManagedText(root, first.relativePath, 'two')).toThrow('expectedHash');
    expect(() => writeManagedText(root, first.relativePath, 'two', 'wrong')).toThrow('changed');
    const second = writeManagedText(root, first.relativePath, 'two', first.contentHash);
    expect(second.created).toBe(false);
    expect(readManagedFile(root, first.relativePath).toString()).toBe('two');
  });
  it('rejects a linked leaf and a special directory leaf', () => {
    const root = temporary();
    symlinkSync('/missing-target', path.join(root, 'dangling'));
    expect(() => writeManagedText(root, 'dangling', 'bad')).toThrow('symbolic link');
    mkdirSync(path.join(root, 'directory'));
    expect(() => readManagedFile(root, 'directory')).toThrow('regular');
  });
});
