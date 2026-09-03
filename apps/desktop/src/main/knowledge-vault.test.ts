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

const makePdf = (text: string): Buffer => {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[()\\]/gu, '\\$&')}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'binary');
};

describe('KnowledgeVault', () => {
  it('imports PDF pages as independently locatable search results', async () => {
    const directory = temporaryDirectory();
    const pdf = path.join(directory, '市场报告.pdf');
    writeFileSync(pdf, makePdf('Market outlook: retention risk requires action'));
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const result = await vault.importPaths([pdf]);
    expect(result).toMatchObject({ imported: [{ title: '市场报告', format: 'pdf', pageCount: 1 }], skipped: [] });
    expect(vault.search('retention risk')[0]).toMatchObject({ document: { title: '市场报告', format: 'pdf' }, locator: '第 1 页', excerpt: expect.stringContaining('retention risk') });
    vault.close();
  });

  it('imports local markdown and text, then searches their contents', async () => {
    const directory = temporaryDirectory();
    const markdown = path.join(directory, '市场笔记.md');
    const text = path.join(directory, '客户访谈.txt');
    writeFileSync(markdown, '# 增长策略\n华东市场需要关注渠道转化。');
    writeFileSync(text, '客户希望在季度复盘中看到续约风险。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    expect((await vault.importPaths([markdown, text])).skipped).toEqual([]);
    expect(vault.listDocuments().map((document) => document.title)).toEqual(['客户访谈', '市场笔记']);
    expect(vault.search('渠道转化')[0]).toMatchObject({ document: { title: '市场笔记', format: 'markdown' }, excerpt: expect.stringContaining('渠道转化') });
    vault.close();
  });

  it('updates an imported source and reports unsupported files', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '计划.txt');
    const pdf = path.join(directory, '材料.pdf');
    writeFileSync(text, '第一版计划');
    writeFileSync(pdf, 'not a PDF');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const first = (await vault.importPaths([text])).imported[0]!;
    writeFileSync(text, '第二版计划，包含新的方向。');
    const result = await vault.importPaths([text, pdf]);
    expect(result.imported[0]).toMatchObject({ id: first.id, contentHash: expect.not.stringMatching(first.contentHash) });
    expect(result.skipped[0]?.sourcePath).toBe(pdf);
    expect(result.skipped[0]?.reason).toMatch(/^导入失败：/u);
    expect(vault.search('新的方向')[0]?.document.id).toBe(first.id);
    vault.close();
  });
});
