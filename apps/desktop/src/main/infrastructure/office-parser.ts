import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { abortError } from '@betterwork/agent-core';
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

/** 结构化 Sheet 定位（KM12，契约 §11）：内部消费方直接给表名与范围，不再从显示字符串反推。 */
export interface OfficeXlsxLocatorTarget {
  sheet?: string | undefined;
  range?: string | undefined;
}

export interface OfficeParseOptions {
  locator?: string;
  structuredLocator?: OfficeXlsxLocatorTarget;
  signal?: AbortSignal;
}

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_PPTX_SLIDES = 500;
const MAX_XLSX_SHEETS = 200;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
/** 结构文档（presentation.xml 等）必须保留命名空间前缀：p:sldId 的 id 与 r:id 属性会互相覆盖。 */
const namespacedParser = new XMLParser({ ignoreAttributes: false });

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

/**
 * jszip 不公开条目元数据：loadAsync 后 `_data` 为 CompressedObject（uncompressedSize 来自
 * 中央目录）或 DataReader（length 即未压长度）。预算必须在该条目被完整分配前判定，
 * 拿不到元数据的内存构造 zip 退回逐项读取计数。
 */
const declaredUncompressedSize = (entry: JSZip.JSZipObject): number | undefined => {
  const data = (entry as unknown as { _data?: Record<string, unknown> })._data;
  if (!data) return undefined;
  const uncompressed = data['uncompressedSize'];
  if (typeof uncompressed === 'number' && Number.isFinite(uncompressed) && uncompressed >= 0) {
    return uncompressed;
  }
  const length = data['length'];
  if (typeof length === 'number' && Number.isFinite(length) && length >= 0) {
    return length;
  }
  return undefined;
};

const checkArchiveBudget = async (
  zip: JSZip,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> => {
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    throwIfAborted(signal);
    if (entry.dir) continue;
    const declared = declaredUncompressedSize(entry);
    // 无元数据只可能来自受信构造的 zip（JSZip 内存生成后未经 loadAsync）；不受信档案
    // 的每个条目都带中央目录声明大小。此处退回分配该条目本身计数，不谎称防住大分配。
    const size = declared ?? (await entry.async('uint8array')).byteLength;
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error(`${label} 解压内容超过 200 MiB 上限。`);
  }
};

const textOf = async (entry: JSZip.JSZipObject, label: string): Promise<string> => {
  const declared = declaredUncompressedSize(entry);
  if (declared !== undefined && declared > MAX_TEXT_BYTES) {
    throw new Error(`${label} 单个文本条目超过 20 MiB 上限。`);
  }
  const xml = await entry.async('string');
  if (Buffer.byteLength(xml) > MAX_TEXT_BYTES)
    throw new Error(`${label} 单个文本条目超过 20 MiB 上限。`);
  return xml;
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

const slideFileNames = (zip: JSZip): string[] =>
  Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(
      (left, right) => Number(left.match(/\d+/u)?.[0] ?? 0) - Number(right.match(/\d+/u)?.[0] ?? 0),
    );

/** OOXML 关系目标可能写成相对或绝对路径，统一归一化回包内路径。 */
const resolveRelationshipTarget = (baseDirectory: string, target: string): string =>
  (target.startsWith('/')
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(baseDirectory, target))
  ).replace(/^\.\/+/u, '');

/** 播放顺序 = presentation.xml 的 sldIdLst 关系引用顺序；文件名序号不代表页序。 */
const presentationSlideOrder = async (
  zip: JSZip,
): Promise<{ slideNames: string[]; unlisted: number } | undefined> => {
  const presentation = zip.files['ppt/presentation.xml'];
  const relationships = zip.files['ppt/_rels/presentation.xml.rels'];
  if (!presentation || !relationships) return undefined;
  const doc = namespacedParser.parse(await textOf(presentation, 'PPTX')) as unknown;
  const rels = namespacedParser.parse(await textOf(relationships, 'PPTX')) as unknown;
  const targetByRid = new Map<string, string>();
  for (const relationship of collectNodes(rels, 'Relationship')) {
    const id = relationship['@_Id'];
    const target = relationship['@_Target'];
    if (typeof id === 'string' && typeof target === 'string') targetByRid.set(id, target);
  }
  const slideNames: string[] = [];
  for (const entry of collectNodes(doc, 'p:sldId')) {
    const rid = entry['@_r:id'];
    const target = typeof rid === 'string' ? targetByRid.get(rid) : undefined;
    if (!target) continue;
    const normalized = resolveRelationshipTarget('ppt', target);
    if (/^ppt\/slides\/slide\d+\.xml$/u.test(normalized) && zip.files[normalized]) {
      slideNames.push(normalized);
    }
  }
  if (slideNames.length === 0) return undefined;
  const listed = new Set(slideNames);
  const unlisted = slideFileNames(zip).filter((name) => !listed.has(name)).length;
  return { slideNames, unlisted };
};

/** 备注只按该 slide 文件自己的关系解析；不按显示序号猜 notesSlideN.xml。 */
const findNotesEntry = async (
  zip: JSZip,
  slideName: string,
): Promise<JSZip.JSZipObject | undefined> => {
  const relationshipsName = `ppt/slides/_rels/${path.posix.basename(slideName)}.rels`;
  const relationships = zip.files[relationshipsName];
  if (!relationships) return undefined;
  const parsed = namespacedParser.parse(await textOf(relationships, 'PPTX')) as unknown;
  const notesRelationship = collectNodes(parsed, 'Relationship').find((relationship) => {
    const type = relationship['@_Type'];
    return typeof type === 'string' && type.endsWith('/notesSlide');
  });
  const target = notesRelationship?.['@_Target'];
  if (typeof target !== 'string') return undefined;
  return zip.files[resolveRelationshipTarget(path.posix.dirname(slideName), target)];
};

const parsePptx = async (
  buffer: Buffer,
  options: OfficeParseOptions,
): Promise<OfficeParseResult> => {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error('PPTX 压缩包超过 50 MiB 上限。');
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  await checkArchiveBudget(zip, options.signal, 'PPTX');
  const names = Object.keys(zip.files);
  const ordered = await presentationSlideOrder(zip);
  const slideNames = ordered?.slideNames ?? slideFileNames(zip);
  if (slideNames.length > MAX_PPTX_SLIDES) throw new Error('PPTX 页数超过 500 页上限。');
  const sections: OfficeSection[] = [];
  const warnings: OfficeWarning[] = [];
  if (!ordered || ordered.unlisted > 0) warnings.push('unsupported-feature');
  for (const [index, name] of slideNames.entries()) {
    throwIfAborted(options.signal);
    const slideNumber = index + 1;
    const entry = zip.files[name];
    if (!entry) continue;
    const xml = await textOf(entry, 'PPTX 单页文本');
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
    const notesEntry = await findNotesEntry(zip, name);
    if (notesEntry) {
      const notes = textNodes(parser.parse(await textOf(notesEntry, 'PPTX 备注')))
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
      warnings: [...new Set(warnings)],
    };
  }
  return { format: 'pptx', sections, warnings: [...new Set(warnings)] };
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

/** 表名含 `!` 或引号时按 Excel 惯例加引号（内部引号翻倍），保证定位串可往返。 */
const quoteSheetName = (name: string): string =>
  name.includes('!') || name.includes("'") ? `'${name.replace(/'/gu, "''")}'` : name;

const unquoteSheetName = (raw: string): string | undefined => {
  if (!raw.startsWith("'")) return raw;
  const body = raw.slice(1);
  let out = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "'") {
      if (body[index + 1] === "'") {
        out += "'";
        index += 1;
      } else {
        return index === body.length - 1 ? out : undefined;
      }
    } else out += char;
  }
  return undefined;
};

/**
 * 解析 XLSX 定位串（契约 §11 往返修复）：接受输出格式 `sheet:<名>!<范围>`（名可带引号）
 * 与旧任务读取格式 `<名>!<范围>`、`<范围>`。不识别的形态返回 undefined 由调用方报错，
 * 绝不静默返回空结果。
 */
export const parseOfficeXlsxLocator = (locator: string): OfficeXlsxLocatorTarget | undefined => {
  let rest = locator.trim();
  if (rest.startsWith('sheet:')) rest = rest.slice('sheet:'.length);
  if (rest.startsWith("'")) {
    const bang = rest.lastIndexOf("'!");
    if (bang > 0) {
      const sheet = unquoteSheetName(rest.slice(0, bang + 1));
      if (sheet !== undefined) return { sheet, range: rest.slice(bang + 2) };
      return undefined;
    }
    return undefined;
  }
  const bang = rest.indexOf('!');
  if (bang >= 0) return { sheet: rest.slice(0, bang), range: rest.slice(bang + 1) };
  return { range: rest };
};

export const formatOfficeXlsxLocator = (sheet: string, first: string, last: string): string =>
  `sheet:${quoteSheetName(sheet)}!${first}:${last}`;

/** 日期按 ISO 文本序列化（契约 §11）；不计算公式、不执行宏。 */
const toCellText = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
};

const parseXlsx = async (
  buffer: Buffer,
  options: OfficeParseOptions,
): Promise<OfficeParseResult> => {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error('XLSX 文件超过 50 MiB 上限。');
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  await checkArchiveBudget(zip, options.signal, 'XLSX');
  // Sheet 数与表名在 ExcelJS 全量装配前从 workbook.xml 读取（契约 §11：预算先于大分配）。
  const workbookEntry = zip.files['xl/workbook.xml'];
  if (workbookEntry) {
    const sheets = collectNodes(
      namespacedParser.parse(await textOf(workbookEntry, 'XLSX 工作簿清单')) as unknown,
      'sheet',
    );
    if (sheets.length > MAX_XLSX_SHEETS) throw new Error('XLSX Sheet 数量超过 200 个上限。');
  }
  const workbook = new ExcelJS.Workbook();
  const xlsxInput = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(xlsxInput);
  const locatorText = options.locator?.trim();
  const specified =
    options.structuredLocator ?? (locatorText ? parseOfficeXlsxLocator(locatorText) : undefined);
  if (!options.structuredLocator && locatorText && !specified) {
    throw new Error(`XLSX 定位无效：${options.locator ?? ''}`);
  }
  const requestedSheet = specified?.sheet;
  const range = parseRange(specified?.range);
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
            ...(result === undefined ? {} : { value: toCellText(result) }),
          });
          if (result === undefined) warnings.push('formula-without-cached-result');
          return;
        }
        cells.push({ address: cellAddress(rowNumber, columnNumber), value: toCellText(raw) });
      });
    });
    if (cells.length > 0) {
      const first = typeof cells[0]?.address === 'string' ? cells[0].address : 'A1';
      const lastValue = cells[cells.length - 1]?.address;
      const last = typeof lastValue === 'string' ? lastValue : first;
      sections.push({
        locator: formatOfficeXlsxLocator(worksheet.name, first, last),
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

/** 已读取字节的解析核心（契约 §11）：任务 parseFile 与知识导入共用，不复制实现。 */
export const parseOfficeBytes = async (
  format: OfficeFormat,
  bytes: Buffer,
  options: OfficeParseOptions = {},
): Promise<OfficeParseResult> => {
  throwIfAborted(options.signal);
  if (format === 'pptx') return parsePptx(bytes, options);
  if (format === 'xlsx') return parseXlsx(bytes, options);
  return parseCsv(bytes, options);
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
    return parseOfficeBytes(format, bytes, options);
  }
}
