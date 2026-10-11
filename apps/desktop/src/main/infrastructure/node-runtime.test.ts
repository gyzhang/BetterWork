import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { managedNodeBin, managedNodeTool } from './node-runtime';

const tempRoots: string[] = [];
/** 造一个含指定相对文件的临时运行时根目录。 */
const makeRoot = (files: readonly string[]): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'bw-node-runtime-resolve-'));
  tempRoots.push(root);
  for (const file of files) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '');
  }
  return root;
};

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('managedNodeBin', () => {
  it('returns the bundled node path when present', () => {
    const root = makeRoot(['bin/node']);
    expect(managedNodeBin(root)).toBe(path.join(root, 'bin', 'node'));
  });

  it('returns undefined when the runtime is absent', () => {
    expect(managedNodeBin(makeRoot([]))).toBeUndefined();
  });
});

describe('managedNodeTool', () => {
  it('resolves bare node/npm/npx to the bundled runtime', () => {
    const root = makeRoot(['bin/node', 'bin/npm', 'bin/npx']);
    expect(managedNodeTool(root, 'node')).toBe(path.join(root, 'bin', 'node'));
    expect(managedNodeTool(root, 'npm')).toBe(path.join(root, 'bin', 'npm'));
    expect(managedNodeTool(root, 'npx')).toBe(path.join(root, 'bin', 'npx'));
  });

  it('returns undefined for non-Node commands', () => {
    const root = makeRoot(['bin/node']);
    expect(managedNodeTool(root, 'python3')).toBeUndefined();
    expect(managedNodeTool(root, 'uvx')).toBeUndefined();
  });

  it('returns undefined for commands carrying a path separator', () => {
    const root = makeRoot(['bin/node']);
    expect(managedNodeTool(root, '/usr/local/bin/node')).toBeUndefined();
    expect(managedNodeTool(root, './node')).toBeUndefined();
  });

  it('returns undefined when the requested tool is not bundled', () => {
    const root = makeRoot(['bin/node']);
    expect(managedNodeTool(root, 'npx')).toBeUndefined();
  });
});
