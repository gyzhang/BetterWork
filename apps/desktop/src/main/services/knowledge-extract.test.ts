import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { KnowledgeServiceError } from './knowledge-errors';
import { extractDocument } from './knowledge-extract';

/**
 * Office → 知识分节的确定性映射（KM13，契约 §11）：
 * PPTX 每页/每表/备注一节，XLSX 每个非空逻辑行一节，CSV 每个逻辑记录一节；
 * 截断与无文本不伪装成完整知识。解析器本体正确性证据在 office-parser.test.ts。
 */

const presentation = (slides: Array<{ file: string; body: string }>): Promise<Buffer> => {
  const zip = new JSZip();
  const ids = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`);
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="urn:p"><p:sldIdLst>${ids.join('')}</p:sldIdLst></p:presentation>`,
  );
  const rels = slides
    .map(
      (slide, index) =>
        `<Relationship Id="rId${index + 1}" Type="urn:slide" Target="${slide.file}"/>`,
    )
    .join('');
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="urn:rels">${rels}</Relationships>`,
  );
  for (const slide of slides) {
    zip.file(`ppt/${slide.file}`, slide.body);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
};

describe('extractDocument Office 分节（KM13）', () => {
  it('PPTX 每页文本、每表、备注分别成节并保留真实页序', async () => {
    const bytes = await presentation([
      {
        file: 'slides/slide2.xml',
        body: '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>月报</a:t><a:tbl><a:tr><a:tc><a:t>收入</a:t></a:tc><a:tc><a:t>120</a:t></a:tc></a:tr></a:tbl></p:cSld></p:sld>',
      },
      {
        file: 'slides/slide1.xml',
        body: '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:t>封底</a:t></p:cSld></p:sld>',
      },
    ]);
    const extracted = await extractDocument('pptx', bytes);
    expect(extracted.sections.map((section) => section.locator)).toEqual([
      'slide:1',
      'slide:1/table:1',
      'slide:2',
    ]);
    expect(extracted.sections[0]?.content).toContain('月报');
    expect(extracted.pageCount).toBe(2);
  });

  it('PPTX 表格序列化为确定性行文本，slide rels 带出备注节', async () => {
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
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:tbl><a:tr><a:tc><a:t>甲</a:t></a:tc><a:tc><a:t>乙</a:t></a:tc></a:tr></a:tbl></p:cSld></p:sld>',
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      '<Relationships xmlns="urn:rels"><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide9.xml"/></Relationships>',
    );
    zip.file(
      'ppt/notesSlides/notesSlide9.xml',
      '<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><a:t>讲稿</a:t></p:notes>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const extracted = await extractDocument('pptx', bytes);
    expect(extracted.sections.map((section) => section.locator)).toEqual([
      'slide:1',
      'slide:1/table:1',
      'slide:1/notes',
    ]);
    expect(extracted.sections[1]?.content).toBe('甲 | 乙');
    expect(extracted.sections[2]?.content).toBe('讲稿');
  });

  it('XLSX 每个非空逻辑行一节，单元格含地址/公式/缓存值的确定性序列化', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('经营数据');
    sheet.getCell('A1').value = '收入';
    sheet.getCell('B1').value = 120;
    sheet.getCell('A2').value = '回款';
    sheet.getCell('B2').value = { formula: '100+20', result: 120 };
    sheet.getCell('A4').value = { formula: '1+1' };
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const extracted = await extractDocument('xlsx', bytes);
    expect(extracted.sections.map((section) => section.locator)).toEqual([
      'sheet:经营数据!A1:B1',
      'sheet:经营数据!A2:B2',
      'sheet:经营数据!A4:A4',
    ]);
    expect(extracted.sections[0]?.content).toBe('A1=收入 | B1=120');
    expect(extracted.sections[1]?.content).toBe('A2=回款 | B2=100+20（缓存值：120）');
    expect(extracted.sections[2]?.content).toBe('A4=1+1（无缓存值）');
    expect(extracted.warnings).toContain('formula-without-cached-result');
  });

  it('CSV 每个逻辑记录一节，引号内换行不拆行', async () => {
    const bytes = Buffer.from('月份,收入\n"2026-08,\n跨行",120\n2026-09,130\n', 'utf8');
    const extracted = await extractDocument('csv', bytes);
    expect(extracted.sections.map((section) => section.locator)).toEqual([
      'rows:1-1',
      'rows:2-2',
      'rows:3-3',
    ]);
    expect(extracted.sections[1]?.content).toBe('"2026-08,\n跨行",120');
  });

  it('无文本 Office 文件报 no-extractable-text 而不是建立伪知识', async () => {
    const bytes = await presentation([
      { file: 'slides/slide1.xml', body: '<p:sld xmlns:p="urn:p"></p:sld>' },
    ]);
    await expect(extractDocument('pptx', bytes)).rejects.toThrow(/no-extractable-text/);
  });

  it('单节超过正文码点上限按 EXTRACTION_LIMIT_EXCEEDED 失败，不截断发布', async () => {
    const huge = '数'.repeat(2_000_001);
    const bytes = Buffer.from(`长文,${huge}\n`, 'utf8');
    const failure = await extractDocument('csv', bytes).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KnowledgeServiceError);
    expect((failure as KnowledgeServiceError).code).toBe('EXTRACTION_LIMIT_EXCEEDED');
  });
});
