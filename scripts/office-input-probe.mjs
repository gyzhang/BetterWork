import assert from 'node:assert/strict';
import { stdout } from 'node:process';

import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

const textNodes = (value, result = []) => {
  if (typeof value === 'string' || typeof value === 'number') return result;
  if (Array.isArray(value)) {
    for (const item of value) textNodes(item, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  if (typeof value.t === 'string' || typeof value.t === 'number') result.push(String(value.t));
  for (const [key, child] of Object.entries(value)) {
    if (key !== 't') textNodes(child, result);
  }
  return result;
};

const makePptxFixture = async () => {
  const zip = new JSZip();
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>八月经营报告</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>收入</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>120</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    `<?xml version="1.0"?><p:notes xmlns:p="urn:p" xmlns:a="urn:a"><p:sp><p:txBody><a:p><a:r><a:t>讲解：收入来自财务系统。</a:t></a:r></a:p></p:txBody></p:sp></p:notes>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const parsePptx = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const slides = [];
  for (const name of Object.keys(zip.files).filter((item) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(item),
  )) {
    const xml = await zip.files[name].async('string');
    const parsed = parser.parse(xml);
    slides.push({ locator: name, text: textNodes(parsed).join(' ') });
  }
  const notes = [];
  for (const name of Object.keys(zip.files).filter((item) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(item),
  )) {
    const parsed = parser.parse(await zip.files[name].async('string'));
    notes.push(textNodes(parsed).join(' '));
  }
  return { slides, notes };
};

const parseCsv = (text) =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(','));

const pptx = await parsePptx(await makePptxFixture());
assert.equal(pptx.slides[0]?.text, '八月经营报告 收入 120');
assert.equal(pptx.notes[0], '讲解：收入来自财务系统。');

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('经营数据');
sheet.getCell('A1').value = '月份';
sheet.getCell('B1').value = '收入';
sheet.getCell('A2').value = '2026-08';
sheet.getCell('B2').value = { formula: '120+30', result: 150 };
const xlsxBuffer = await workbook.xlsx.writeBuffer();
const loaded = new ExcelJS.Workbook();
await loaded.xlsx.load(xlsxBuffer);
const loadedSheet = loaded.getWorksheet('经营数据');
assert.ok(loadedSheet);
assert.equal(loadedSheet.getCell('B2').value?.formula, '120+30');
assert.equal(loadedSheet.getCell('B2').value?.result, 150);

const csv = parseCsv('\uFEFF月份,收入\n2026-08,150\n');
assert.deepEqual(csv, [
  ['\uFEFF月份', '收入'],
  ['2026-08', '150'],
]);

stdout.write(
  JSON.stringify(
    {
      pptx: { slides: pptx.slides.length, text: pptx.slides[0]?.text, notes: pptx.notes.length },
      xlsx: {
        sheet: loadedSheet.name,
        range: 'A1:B2',
        formula: loadedSheet.getCell('B2').value?.formula,
        cachedResult: loadedSheet.getCell('B2').value?.result,
      },
      csv: { encoding: 'UTF-8/BOM', rows: csv.length, columns: csv[0]?.length },
      decision: {
        pptx: 'JSZip + fast-xml-parser',
        xlsx: 'ExcelJS 4.4.0',
        csv: 'bounded UTF-8 parser',
      },
    },
    null,
    2,
  ) + '\n',
);
