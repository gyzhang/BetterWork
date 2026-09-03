import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
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

const makeDocx = async (paragraphs: string[]): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder('_rels')!.file('.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`).join('');
  zip.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};

describe('KnowledgeVault', () => {
  it('imports Word paragraphs with stable locators', async () => {
    const directory = temporaryDirectory();
    const document = path.join(directory, '客户方案.docx');
    writeFileSync(document, await makeDocx(['客户续约风险需要在复盘中跟进', '第二段作为独立来源定位']));
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const result = await vault.importPaths([document]);
    expect(result).toMatchObject({ imported: [{ title: '客户方案', format: 'docx' }], skipped: [] });
    expect(vault.search('续约风险')[0]).toMatchObject({ document: { title: '客户方案', format: 'docx' }, locator: '段落 1', excerpt: expect.stringContaining('续约风险') });
    vault.close();
  });

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
    expect(vault.getRegisteredSourcePath(markdown)).toBe(markdown);
    expect(vault.getRegisteredSourcePath(path.join(directory, '未导入.txt'))).toBeUndefined();
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

  it('removes only the local index record and its search chunks', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '可移除资料.txt');
    writeFileSync(text, '需要从本地索引中移除的内容。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const document = (await vault.importPaths([text])).imported[0]!;
    expect(vault.removeDocument(document.id)).toBe(true);
    expect(vault.listDocuments()).toEqual([]);
    expect(vault.search('移除')).toEqual([]);
    expect(vault.removeDocument(document.id)).toBe(false);
    expect(existsSync(text)).toBe(true);
    vault.close();
  });

  it('refreshes a registered document from its original source path', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '动态资料.txt');
    writeFileSync(text, '第一版内容。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const original = (await vault.importPaths([text])).imported[0]!;
    writeFileSync(text, '第二版内容，包含新的市场信号。');
    const refreshed = await vault.refreshDocument(original.id);
    expect(refreshed.refreshed).toMatchObject({ id: original.id, contentHash: expect.not.stringMatching(original.contentHash) });
    expect(vault.search('市场信号')[0]?.document.id).toBe(original.id);
    expect(await vault.refreshDocument('missing-document')).toEqual({ error: '资料已不在当前资料库中。' });
    vault.close();
  });

  it('falls back to substring search when full-text match finds nothing', async () => {
    const directory = temporaryDirectory();
    const markdown = path.join(directory, '增长笔记.md');
    writeFileSync(markdown, '# 渠道复盘\nBetterWork 的转化率在三月显著提升。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    await vault.importPaths([markdown]);
    expect(vault.search('etterWork')[0]).toMatchObject({ document: { title: '增长笔记' }, excerpt: expect.stringContaining('BetterWork') });
    expect(vault.search('完全不存在的词组xyz')).toEqual([]);
    vault.close();
  });

  it('keeps the index unchanged when the original file is missing during refresh', async () => {
    const directory = temporaryDirectory();
    const text = path.join(directory, '会消失的资料.txt');
    writeFileSync(text, '待刷新的原始内容。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const original = (await vault.importPaths([text])).imported[0]!;
    rmSync(text);
    const refreshed = await vault.refreshDocument(original.id);
    expect(refreshed.refreshed).toBeUndefined();
    expect(refreshed.error).toMatch(/原始文件/u);
    expect(vault.listDocuments()).toHaveLength(1);
    expect(vault.search('待刷新的原始内容')[0]?.document.id).toBe(original.id);
    vault.close();
  });
});
