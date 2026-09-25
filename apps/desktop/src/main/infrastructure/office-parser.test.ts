import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isAbortError } from '@betterwork/agent-core';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { OfficeParserService, parseOfficeBytes } from './office-parser';

const roots: string[] = [];
const parser = new OfficeParserService();

const writeTemp = async (name: string, data: Buffer | string): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'betterwork-office-'));
  roots.push(root);
  const filePath = path.join(root, name);
  await writeFile(filePath, data);
  return filePath;
};

/**
 * 播放顺序与文件名故意错位：sldIdLst 先引用 slide2 再引用 slide1；
 * slide2 的备注挂在编号错开的 notesSlide7 上，只能靠真实关系解析找到。
 */
const makePptx = async (): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    '<p:presentation xmlns:p="urn:p"><p:sldIdLst><p:sldId id="256" r:id="rIdB"/><p:sldId id="257" r:id="rIdA"/></p:sldIdLst></p:presentation>',
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    '<Relationships xmlns="urn:rels"><Relationship Id="rIdA" Type="urn:slide" Target="slides/slide1.xml"/><Relationship Id="rIdB" Type="urn:slide" Target="slides/slide2.xml"/></Relationships>',
  );
  zip.file(
    'ppt/slides/slide1.xml',
    '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>封底</a:t></p:cSld></p:sld>',
  );
  zip.file(
    'ppt/slides/slide2.xml',
    '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>月报</a:t><a:tbl><a:tr><a:tc><a:t>收入</a:t></a:tc><a:tc><a:t>120</a:t></a:tc></a:tr></a:tbl></p:cSld></p:sld>',
  );
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    '<Relationships xmlns="urn:rels"><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>',
  );
  zip.file(
    'ppt/notesSlides/notesSlide7.xml',
    '<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><a:t>备注</a:t></p:notes>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const makeXlsx = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('经营数据');
  sheet.getCell('A1').value = '收入';
  sheet.getCell('B1').value = { formula: '100+20', result: 120 };
  // 表名含 `!`：定位串必须加引号且能原样往返。
  const tricky = workbook.addWorksheet('Q1!数据');
  tricky.getCell('A1').value = new Date(Date.UTC(2026, 7, 1));
  tricky.getCell('B1').value = 3_456;
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('OfficeParserService', () => {
  it('PPTX 按演示文稿关系排序并沿真实关系解析备注（KM12）', async () => {
    const filePath = await writeTemp('report.pptx', await makePptx());
    const result = await parser.parseFile(filePath, 'pptx');
    expect(result.sections.map((section) => section.locator)).toEqual([
      'slide:1',
      'slide:1/table:1',
      'slide:1/notes',
      'slide:2',
    ]);
    expect(result.sections[0]?.content).toBe('月报 收入 120');
    expect(result.sections[1]?.content).toEqual([['收入', '120']]);
    expect(result.sections[2]?.content).toBe('备注');
    expect(result.sections[3]?.content).toBe('封底');
    expect(result.warnings).toEqual([]);
    const first = await parser.parseFile(filePath, 'pptx', { locator: 'slide:1/table:1' });
    expect(first.sections).toHaveLength(1);
    expect(first.sections[0]?.locator).toBe('slide:1/table:1');
  });

  it('XLSX 定位串输出即输入可往返，特殊表名加引号，日期为 ISO 文本（KM12）', async () => {
    const bytes = await makeXlsx();
    const full = await parseOfficeBytes('xlsx', bytes);
    const plain = full.sections.find((section) => section.locator.startsWith('sheet:经营数据!'));
    const tricky = full.sections.find((section) => section.locator.includes('Q1'));
    expect(plain?.locator).toBe('sheet:经营数据!A1:B1');
    expect(tricky?.locator).toBe(`sheet:'Q1!数据'!A1:B1`);
    expect(tricky?.content).toEqual([
      { address: 'A1', value: '2026-08-01T00:00:00.000Z' },
      { address: 'B1', value: 3456 },
    ]);

    // 回读输出定位串：必须得到与整表解析一致的节，而不是静默空结果。
    if (!plain || !tricky) throw new Error('fixture sections missing');
    const echoPlain = await parseOfficeBytes('xlsx', bytes, { locator: plain.locator });
    expect(echoPlain.sections).toEqual([plain]);
    const echoTricky = await parseOfficeBytes('xlsx', bytes, { locator: tricky.locator });
    expect(echoTricky.sections).toEqual([tricky]);

    // 旧任务读取格式（无 sheet: 前缀）不破坏。
    const legacy = await parseOfficeBytes('xlsx', bytes, { locator: '经营数据!A1:B1' });
    expect(legacy.sections).toEqual([plain]);

    // 结构化定位：不经过显示字符串反推。
    const structured = await parseOfficeBytes('xlsx', bytes, {
      structuredLocator: { sheet: 'Q1!数据', range: 'A1:A1' },
    });
    expect(structured.sections[0]?.content).toEqual([
      { address: 'A1', value: '2026-08-01T00:00:00.000Z' },
    ]);

    await expect(parseOfficeBytes('xlsx', bytes, { locator: 'A1:B1' })).resolves.toEqual(full);
  });

  it('bytes 核心与 parseFile 共用同一实现；无法识别的定位明确报错', async () => {
    const bytes = await makeXlsx();
    const filePath = await writeTemp('same.xlsx', bytes);
    const viaFile = await parser.parseFile(filePath, 'xlsx');
    const viaBytes = await parseOfficeBytes('xlsx', bytes);
    expect(viaBytes).toEqual(viaFile);
    // `'` 开头但没有闭合引号与 `!` 的串不可识别，必须报错而不是空结果。
    await expect(parseOfficeBytes('xlsx', bytes, { locator: "sheet:'未闭合A1" })).rejects.toThrow(
      'XLSX 定位无效',
    );
  });

  it('warns when an XLSX formula has no cached result and rejects a corrupt archive', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('数据').getCell('A1').value = { formula: '1+1' };
    const filePath = await writeTemp(
      'uncached.xlsx',
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    const result = await parser.parseFile(filePath, 'xlsx');
    expect(result.warnings).toContain('formula-without-cached-result');
    const corruptPath = await writeTemp('corrupt.pptx', Buffer.from('not a zip'));
    await expect(parser.parseFile(corruptPath, 'pptx')).rejects.toThrow();
  });

  it('解压预算在分配完整内容前按中央目录声明判定（KM12）', async () => {
    // 21 个 10 MiB 零字节页：压缩后极小，但声明解压总量 210 MiB 超过 200 MiB 上限。
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="urn:p"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships xmlns="urn:rels"><Relationship Id="rId1" Type="urn:slide" Target="slides/slide1.xml"/></Relationships>',
    );
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>第一页</a:t></p:cSld></p:sld>',
    );
    const huge = Buffer.alloc(10 * 1024 * 1024, 0x20);
    for (let index = 1; index <= 21; index += 1) {
      zip.file(`ppt/media/big${index}.bin`, huge);
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(parseOfficeBytes('pptx', bytes)).rejects.toThrow('解压内容超过 200 MiB 上限');

    // 单条 XML 超过 20 MiB：在解码该条目之前按声明大小拒绝。
    const single = new JSZip();
    single.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="urn:p"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    );
    single.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships xmlns="urn:rels"><Relationship Id="rId1" Type="urn:slide" Target="slides/slide1.xml"/></Relationships>',
    );
    single.file(
      'ppt/slides/slide1.xml',
      `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>${'文'.repeat((21 * 1024 * 1024) / 3)}</a:t></p:cSld></p:sld>`,
    );
    const singleBytes = await single.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    await expect(parseOfficeBytes('pptx', singleBytes)).rejects.toThrow('单个文本条目超过 20 MiB');
  }, 30_000);

  it('reads UTF-8 BOM CSV，引号内换行不增加逻辑行号；取消统一 abortError', async () => {
    const filePath = await writeTemp(
      '本期.csv',
      Buffer.from('\uFEFF月份,收入\n"2026-08,\n跨行",120\n', 'utf8'),
    );
    const result = await parser.parseFile(filePath, 'csv');
    expect(result.sections[0]?.content).toEqual([
      ['月份', '收入'],
      ['2026-08,\n跨行', '120'],
    ]);
    expect(result.sections[0]?.locator).toBe('rows:1-2');
    const range = await parser.parseFile(filePath, 'csv', { locator: 'rows:2-2' });
    expect(range.sections[0]?.content).toEqual([['2026-08,\n跨行', '120']]);
    await expect(parser.parseFile(filePath, 'csv', { locator: 'row:2' })).rejects.toThrow(
      '定位无效',
    );
    const controller = new AbortController();
    controller.abort();
    const pending = parser.parseFile(filePath, 'csv', { signal: controller.signal });
    await expect(pending).rejects.toSatisfy(isAbortError);
    await expect(
      parseOfficeBytes('pptx', await makePptx(), { signal: controller.signal }),
    ).rejects.toSatisfy(isAbortError);
  });
});
