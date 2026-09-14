import { readFile } from 'node:fs/promises';
import path from 'node:path';

import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

export type OfficeFormat = 'pptx' | 'xlsx' | 'csv';
export type OfficeSectionKind = 'text' | 'table' | 'notes' | 'cells';
export type OfficeWarning = 'formula-without-cached-result' | 'truncated' | 'unsupported-feature';

export interface OfficeSection {
  locator: string;
  kind: OfficeSectionKind;
  content: unknown;
}

export interface OfficeParseResult {
  format: OfficeFormat;
  sections: OfficeSection[];
  warnings: OfficeWarning[];
}

export interface OfficeParseOptions {
  locator?: string;
  signal?: AbortSignal;
}

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_PPTX_SLIDES = 500;
const MAX_XLSX_SHEETS = 200;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Error('Office 材料读取已取消。');
};

const textNodes = (value: unknown, result: string[] = []): string[] => {
  if (value === null || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const item of value) textNodes(item, result);
    return result;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.t === 'string' || typeof record.t === 'number') result.push(String(record.t));
  for (const [key, child] of Object.entries(record)) if (key !== 't') textNodes(child, result);
  return result;
};

const collectNodes = (value: unknown, key: string, result: Record<string, unknown>[] = []) => {
  if (value === null || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, key, result);
    return result;
  }
  const record = value as Record<string, unknown>;
  for (const [name, child] of Object.entries(record)) {
    if (name === key) {
      if (Array.isArray(child)) {
        for (const item of child)
          if (item && typeof item === 'object') result.push(item as Record<string, unknown>);
      } else if (child && typeof child === 'object') result.push(child as Record<string, unknown>);
    }
    collectNodes(child, key, result);
  }
  return result;
};

const tableRows = (table: Record<string, unknown>): string[][] => {
  const rows = table.tr === undefined ? [] : Array.isArray(table.tr) ? table.tr : [table.tr];
  return rows.map((row) => {
    const rowRecord = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const cells =
      rowRecord.tc === undefined ? [] : Array.isArray(rowRecord.tc) ? rowRecord.tc : [rowRecord.tc];
    return cells.map((cell) => textNodes(cell).join(' ').trim());
  });
};

const findNotesEntry = async (
  zip: JSZip,
  slideName: string,
  slideNumber: number,
): Promise<JSZip.JSZipObject | undefined> => {
  const relationshipsName = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
  const relationships = zip.files[relationshipsName];
  if (relationships) {
    const parsed = parser.parse(await relationships.async('string')) as unknown;
    const relationshipNodes = collectNodes(parsed, 'Relationship');
    const notesRelationship = relationshipNodes.find((relationship) => {
      const type = relationship['@_Type'];
      return typeof type === 'string' && type.endsWith('/notesSlide');
    });
    const target = notesRelationship?.['@_Target'];
    if (typeof target === 'string') {
      const normalized = path.posix.normalize(
        path.posix.join(path.posix.dirname(slideName), target),
      );
      const resolved = zip.files[normalized.replace(/^\//u, '')];
      if (resolved) return resolved;
    }
  }
  return zip.files[`ppt/notesSlides/notesSlide${slideNumber}.xml`];
};

const parsePptx = async (
  buffer: Buffer,
  options: OfficeParseOptions,
): Promise<OfficeParseResult> => {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error('PPTX 压缩包超过 50 MiB 上限。');
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const names = Object.keys(zip.files);
  let expanded = 0;
  for (const name of names) {
    throwIfAborted(options.signal);
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    const data = await entry.async('uint8array');
    expanded += data.byteLength;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('PPTX 解压内容超过 200 MiB 上限。');
  }
  const slideNames = names
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(
      (left, right) => Number(left.match(/\d+/u)?.[0] ?? 0) - Number(right.match(/\d+/u)?.[0] ?? 0),
    );
  if (slideNames.length > MAX_PPTX_SLIDES) throw new Error('PPTX 页数超过 500 页上限。');
  const sections: OfficeSection[] = [];
  const warnings: OfficeWarning[] = [];
  for (const [index, name] of slideNames.entries()) {
    throwIfAborted(options.signal);
    const slideNumber = index + 1;
    const entry = zip.files[name];
    if (!entry) continue;
    const xml = await entry.async('string');
    if (Buffer.byteLength(xml) > MAX_TEXT_BYTES) throw new Error('PPTX 单页文本超过 20 MiB 上限。');
    const parsed = parser.parse(xml) as unknown;
    const text = textNodes(parsed).join(' ').trim();
    if (text) sections.push({ locator: `slide:${slideNumber}`, kind: 'text', content: text });
    for (const [tableIndex, table] of collectNodes(parsed, 'tbl').entries()) {
      const rows = tableRows(table);
      if (rows.length > 0)
        sections.push({
          locator: `slide:${slideNumber}/table:${tableIndex + 1}`,
          kind: 'table',
          content: rows,
        });
    }
    const notesEntry = await findNotesEntry(zip, name, slideNumber);
    if (notesEntry) {
      const notes = textNodes(parser.parse(await notesEntry.async('string')))
        .join(' ')
        .trim();
      if (notes)
        sections.push({ locator: `slide:${slideNumber}/notes`, kind: 'notes', content: notes });
    }
  }
  if (names.some((name) => name.startsWith('ppt/charts/'))) warnings.push('unsupported-feature');
  if (options.locator) {
    const locator = options.locator.trim();
    if (!/^slide:\d+(?:\/(?:table:\d+|notes))?$/u.test(locator))
      throw new Error(`PPTX 定位无效：${options.locator}`);
    return {
      format: 'pptx',
      sections: sections.filter(
        (section) => section.locator === locator || section.locator.startsWith(`${locator}/`),
      ),
      warnings,
    };
  }
  return { format: 'pptx', sections, warnings };
};

const cellAddress = (row: number, column: number): string => {
  let value = column;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return `${letters}${row}`;
};

const parseRange = (
  value: string | undefined,
): { startRow: number; startColumn: number; endRow: number; endColumn: number } | undefined => {
  if (!value) return undefined;
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/iu.exec(value.trim());
  if (!match) throw new Error(`XLSX 范围无效：${value}`);
  const columnNumber = (letters: string): number =>
    [...letters.toUpperCase()].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  const startRow = Number(match[2] ?? 0);
  const startColumn = columnNumber(match[1] ?? 'A');
  const endRow = match[4] ? Number(match[4]) : startRow;
  const endColumn = match[3] ? columnNumber(match[3]) : startColumn;
  return { startRow, startColumn, endRow, endColumn };
};

const parseXlsx = async (
  buffer: Buffer,
  options: OfficeParseOptions,
): Promise<OfficeParseResult> => {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error('XLSX 文件超过 50 MiB 上限。');
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    throwIfAborted(options.signal);
    if (entry.dir) continue;
    expanded += (await entry.async('uint8array')).byteLength;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('XLSX 解压内容超过 200 MiB 上限。');
  }
  const workbook = new ExcelJS.Workbook();
  const xlsxInput = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(xlsxInput);
  if (workbook.worksheets.length > MAX_XLSX_SHEETS)
    throw new Error('XLSX Sheet 数量超过 200 个上限。');
  const range = parseRange(
    options.locator?.includes('!') ? options.locator.split('!').pop() : options.locator,
  );
  const requestedSheet = options.locator?.includes('!') ? options.locator.split('!')[0] : undefined;
  const sections: OfficeSection[] = [];
  const warnings: OfficeWarning[] = [];
  for (const worksheet of workbook.worksheets) {
    throwIfAborted(options.signal);
    if (requestedSheet && worksheet.name !== requestedSheet) continue;
    const cells: Array<Record<string, unknown>> = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (
          range &&
          (rowNumber < range.startRow ||
            rowNumber > range.endRow ||
            columnNumber < range.startColumn ||
            columnNumber > range.endColumn)
        )
          return;
        const raw = cell.value;
        if (raw && typeof raw === 'object' && 'formula' in raw) {
          const formula = String(raw.formula);
          const result = 'result' in raw ? raw.result : undefined;
          cells.push({
            address: cellAddress(rowNumber, columnNumber),
            formula,
            ...(result === undefined ? {} : { value: result }),
          });
          if (result === undefined) warnings.push('formula-without-cached-result');
          return;
        }
        cells.push({ address: cellAddress(rowNumber, columnNumber), value: raw ?? null });
      });
    });
    if (cells.length > 0) {
      const first = typeof cells[0]?.address === 'string' ? cells[0].address : 'A1';
      const lastValue = cells[cells.length - 1]?.address;
      const last = typeof lastValue === 'string' ? lastValue : first;
      sections.push({
        locator: `sheet:${worksheet.name}!${first}:${last}`,
        kind: 'cells',
        content: cells,
      });
    }
  }
  return { format: 'xlsx', sections, warnings: [...new Set(warnings)] };
};

const parseCsvText = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 引号不完整。');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

const parseCsv = (buffer: Buffer, options: OfficeParseOptions): OfficeParseResult => {
  if (buffer.byteLength > MAX_TEXT_BYTES) throw new Error('CSV 文本超过 20 MiB 上限。');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error('CSV 编码不是受支持的 UTF-8，请先转换编码。', { cause: error });
  }
  text = text.replace(/^\uFEFF/u, '');
  const rows = parseCsvText(text);
  let selectedRows = rows;
  let locator = `rows:1-${rows.length}`;
  if (options.locator) {
    const match = /^rows:(\d+)-(\d+)$/u.exec(options.locator.trim());
    if (!match) throw new Error(`CSV 定位无效：${options.locator}`);
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start < 1 || end < start || end > rows.length)
      throw new Error(`CSV 定位超出范围：${options.locator}`);
    selectedRows = rows.slice(start - 1, end);
    locator = `rows:${start}-${end}`;
  }
  const sections: OfficeSection[] =
    selectedRows.length > 0 ? [{ locator, kind: 'cells', content: selectedRows }] : [];
  return { format: 'csv', sections, warnings: [] };
};

export class OfficeParserService {
  async parseFile(
    filePath: string,
    format: OfficeFormat,
    options: OfficeParseOptions = {},
  ): Promise<OfficeParseResult> {
    throwIfAborted(options.signal);
    const bytes = await readFile(filePath);
    throwIfAborted(options.signal);
    if (format === 'pptx') return parsePptx(bytes, options);
    if (format === 'xlsx') return parseXlsx(bytes, options);
    if (format === 'csv') return parseCsv(bytes, options);
    throw new Error(`不支持的 Office 输入格式：${path.extname(filePath)}`);
  }
}
