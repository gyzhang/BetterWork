import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { OfficeParserService } from './office-parser';

const roots: string[] = [];
const parser = new OfficeParserService();

const writeTemp = async (name: string, data: Buffer | string): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'betterwork-office-'));
  roots.push(root);
  const filePath = path.join(root, name);
  await writeFile(filePath, data);
  return filePath;
};

const makePptx = async (): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file(
    'ppt/slides/slide1.xml',
    '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>月报</a:t><a:tbl><a:tr><a:tc><a:t>收入</a:t></a:tc><a:tc><a:t>120</a:t></a:tc></a:tr></a:tbl></p:cSld></p:sld>',
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    '<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><a:t>备注</a:t></p:notes>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const makeXlsx = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('经营数据');
  sheet.getCell('A1').value = '收入';
  sheet.getCell('B1').value = { formula: '100+20', result: 120 };
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('OfficeParserService', () => {
  it('reads PPTX text, table and notes with stable locators', async () => {
    const filePath = await writeTemp('report.pptx', await makePptx());
    const result = await parser.parseFile(filePath, 'pptx');
    expect(result.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locator: 'slide:1', kind: 'text' }),
        expect.objectContaining({
          locator: 'slide:1/table:1',
          kind: 'table',
          content: [['收入', '120']],
        }),
        expect.objectContaining({ locator: 'slide:1/notes', kind: 'notes', content: '备注' }),
      ]),
    );
    const slide = await parser.parseFile(filePath, 'pptx', { locator: 'slide:1/table:1' });
    expect(slide.sections).toHaveLength(1);
    expect(slide.sections[0]?.locator).toBe('slide:1/table:1');
  });

  it('reads an XLSX formula and preserves the cached result without recalculating', async () => {
    const filePath = await writeTemp('data.xlsx', await makeXlsx());
    const result = await parser.parseFile(filePath, 'xlsx', { locator: '经营数据!A1:B1' });
    const section = result.sections[0];
    expect(section?.locator).toBe('sheet:经营数据!A1:B1');
    expect(section?.content).toEqual([
      { address: 'A1', value: '收入' },
      { address: 'B1', formula: '100+20', value: 120 },
    ]);
    expect(result.warnings).toEqual([]);
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

  it('reads UTF-8 BOM CSV and rejects an invalid range or cancelled run', async () => {
    const filePath = await writeTemp(
      '本期.csv',
      Buffer.from('\uFEFF月份,收入\n2026-08,120\n', 'utf8'),
    );
    const result = await parser.parseFile(filePath, 'csv');
    expect(result.sections[0]?.content).toEqual([
      ['月份', '收入'],
      ['2026-08', '120'],
    ]);
    const range = await parser.parseFile(filePath, 'csv', { locator: 'rows:2-2' });
    expect(range.sections[0]?.content).toEqual([['2026-08', '120']]);
    await expect(parser.parseFile(filePath, 'csv', { locator: 'row:2' })).rejects.toThrow(
      '定位无效',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(parser.parseFile(filePath, 'csv', { signal: controller.signal })).rejects.toThrow(
      '已取消',
    );
  });
});
