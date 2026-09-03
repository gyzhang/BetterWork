import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeVault } from './knowledge-vault';

const temporaryDirectories: string[] = [];
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-vault-'));
  temporaryDirectories.push(directory);
  return directory;
};
afterEach(() => temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('KnowledgeVault', () => {
  it('imports local markdown and text, then searches their contents', () => {
    const directory = temporaryDirectory();
    const markdown = path.join(directory, '市场笔记.md');
    const text = path.join(directory, '客户访谈.txt');
    writeFileSync(markdown, '# 增长策略\n华东市场需要关注渠道转化。');
    writeFileSync(text, '客户希望在季度复盘中看到续约风险。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    expect(vault.importPaths([markdown, text]).skipped).toEqual([]);
    expect(vault.listDocuments().map((document) => document.title)).toEqual(['客户访谈', '市场笔记']);
    expect(vault.search('渠道转化')[0]).toMatchObject({ document: { title: '市场笔记', format: 'markdown' }, excerpt: expect.stringContaining('渠道转化') });
    vault.close();
  });

  it('updates an imported source and reports unsupported files', () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '计划.txt');
    const pdf = path.join(directory, '材料.pdf');
    writeFileSync(text, '第一版计划');
    writeFileSync(pdf, 'not a PDF');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const first = vault.importPaths([text]).imported[0]!;
    writeFileSync(text, '第二版计划，包含新的方向。');
    const result = vault.importPaths([text, pdf]);
    expect(result.imported[0]).toMatchObject({ id: first.id, contentHash: expect.not.stringMatching(first.contentHash) });
    expect(result.skipped).toEqual([{ sourcePath: pdf, reason: '暂仅支持 Markdown 和文本文件。' }]);
    expect(vault.search('新的方向')[0]?.document.id).toBe(first.id);
    vault.close();
  });
});
