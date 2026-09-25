import {
  countCodePoints,
  KNOWLEDGE_REVISION_MAX_TEXT_CODE_POINTS,
  type KnowledgeExtractedSection,
  type KnowledgeFormat,
  type KnowledgeWarningCode,
  type KnowledgeWorkerJobContext,
} from '@betterwork/agent-protocol';

import {
  formatOfficeXlsxLocator,
  type OfficeSection,
  parseOfficeBytes,
  parseOfficeXlsxLocator,
} from '../infrastructure/office-parser.ts';
import { KnowledgeServiceError } from './knowledge-errors.ts';

/**
 * 原文提取（知识契约 §2.1/§11）。CPU 密集的解析在生产路径由独立 Worker 进程执行
 * （`infrastructure/knowledge-worker.ts`）；本模块只保留纯函数实现，
 * Main 与 Worker 共用同一份代码，不出现第二套解析器。
 */
export interface ExtractedDocument {
  format: KnowledgeFormat;
  content: string;
  pageCount?: number;
  warnings?: KnowledgeWarningCode[];
  sections: KnowledgeExtractedSection[];
}

export type DocumentExtractor = (
  format: KnowledgeFormat,
  bytes: Buffer,
  context?: KnowledgeWorkerJobContext,
) => Promise<ExtractedDocument>;

/** Excel 值可能是 richText/超链接等对象：只接受标量或文本结构，绝不输出 [object Object]。 */
const scalarText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return '';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record['richText'])) {
      return record['richText']
        .map((part) =>
          part && typeof part === 'object'
            ? scalarText((part as Record<string, unknown>)['text'])
            : '',
        )
        .join('');
    }
    if (typeof record['text'] === 'string') return record['text'];
  }
  return '';
};

/** 表单元格序列化（契约 §11）：address、value、formula、cachedValue 存在才写，确定性输出。 */
const cellRecordText = (record: Record<string, unknown>): string => {
  const address = scalarText(record['address']);
  if (typeof record['formula'] === 'string') {
    const cached =
      'value' in record ? `（缓存值：${scalarText(record['value'])}）` : '（无缓存值）';
    return `${address}=${record['formula']}${cached}`;
  }
  return `${address}=${scalarText(record['value'])}`;
};

const tableText = (rows: unknown): string => {
  if (!Array.isArray(rows)) return '';
  return rows
    .map((row) => (Array.isArray(row) ? row.map((cell) => scalarText(cell)).join(' | ') : ''))
    .join('\n')
    .trim();
};

const csvCell = (value: string): string =>
  /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;

const pptxSlideNumber = (locator: string): number | undefined => {
  const match = /^slide:(\d+)/u.exec(locator);
  return match ? Number(match[1]) : undefined;
};

const officeSectionText = (section: OfficeSection): string => {
  if (section.kind === 'text' || section.kind === 'notes') return scalarText(section.content);
  if (section.kind === 'table') return tableText(section.content);
  return '';
};

/** 每个非空逻辑行一个 section（契约 §11 XLSX 规则）。 */
const xlsxRowSections = (
  section: OfficeSection,
  ordinalFrom: number,
): KnowledgeExtractedSection[] => {
  const target = parseOfficeXlsxLocator(section.locator);
  if (!target?.sheet) throw new Error(`XLSX 分节定位不可识别：${section.locator}`);
  const records = Array.isArray(section.content)
    ? (section.content as Array<Record<string, unknown>>)
    : [];
  const byRow = new Map<number, Array<{ column: number; text: string; address: string }>>();
  for (const record of records) {
    const address = scalarText(record['address']);
    const match = /^([A-Z]+)(\d+)$/iu.exec(address);
    if (!match) continue;
    const letters = match[1] ?? 'A';
    const rowNumber = Number(match[2] ?? 0);
    let column = 0;
    for (const char of letters.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
    const list = byRow.get(rowNumber) ?? [];
    list.push({ column, text: cellRecordText(record), address });
    byRow.set(rowNumber, list);
  }
  const sections: KnowledgeExtractedSection[] = [];
  for (const [rowNumber, cells] of [...byRow.entries()].sort((left, right) => left[0] - right[0])) {
    const sorted = cells.sort((left, right) => left.column - right.column);
    const content = sorted.map((cell) => cell.text).join(' | ');
    if (!content.trim()) continue;
    const first = sorted[0]?.address ?? `A${rowNumber}`;
    const last = sorted[sorted.length - 1]?.address ?? first;
    sections.push({
      locator: formatOfficeXlsxLocator(target.sheet, first, last),
      ordinal: ordinalFrom + sections.length,
      content,
    });
  }
  return sections;
};

/** 每个逻辑记录一个 section（契约 §11 CSV 规则）。 */
const csvRecordSections = (section: OfficeSection): KnowledgeExtractedSection[] => {
  const rows = Array.isArray(section.content) ? (section.content as unknown[]) : [];
  const sections: KnowledgeExtractedSection[] = [];
  rows.forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const content = row.map((cell) => csvCell(String(cell ?? ''))).join(',');
    if (!content.trim()) return;
    sections.push({
      locator: `rows:${index + 1}-${index + 1}`,
      ordinal: sections.length,
      content,
    });
  });
  return sections;
};

const requireBudget = (format: KnowledgeFormat, locator: string, content: string): void => {
  if (countCodePoints(content) > KNOWLEDGE_REVISION_MAX_TEXT_CODE_POINTS) {
    throw new KnowledgeServiceError(
      'EXTRACTION_LIMIT_EXCEEDED',
      `${format} 单节（${locator}）超过正文码点上限，文件未按完整知识导入。`,
    );
  }
};

/** Office 提取（契约 §11）：复用字节解析核心，不执行宏与公式，不把截断或空文本伪装成知识。 */
const extractOfficeDocument = async (
  format: 'pptx' | 'xlsx' | 'csv',
  bytes: Buffer,
): Promise<ExtractedDocument> => {
  const parsed = await parseOfficeBytes(format, bytes);
  const warnings: KnowledgeWarningCode[] = [...parsed.warnings];
  if (warnings.includes('truncated')) {
    throw new KnowledgeServiceError(
      'EXTRACTION_LIMIT_EXCEEDED',
      'Office 解析结果被截断，不能作为完整知识发布；请拆分文件后重新导入。',
    );
  }
  const sections: KnowledgeExtractedSection[] = [];
  let pageCount: number | undefined;
  if (format === 'pptx') {
    const slideNumbers = parsed.sections
      .map((section) => pptxSlideNumber(section.locator))
      .filter((value): value is number => value !== undefined);
    pageCount = slideNumbers.length > 0 ? Math.max(...slideNumbers) : undefined;
    for (const section of parsed.sections) {
      const content = officeSectionText(section);
      if (!content) continue;
      requireBudget(format, section.locator, content);
      sections.push({ locator: section.locator, ordinal: sections.length, content });
    }
  } else if (format === 'xlsx') {
    for (const section of parsed.sections) {
      const rowSections = xlsxRowSections(section, sections.length);
      for (const row of rowSections) {
        requireBudget(format, row.locator, row.content);
        sections.push(row);
      }
    }
  } else {
    for (const section of parsed.sections) {
      for (const row of csvRecordSections(section)) {
        requireBudget(format, row.locator, row.content);
        sections.push(row);
      }
    }
  }
  if (sections.length === 0) {
    throw new KnowledgeServiceError(
      'EXTRACTION_LIMIT_EXCEEDED',
      `该 ${format.toUpperCase()} 文件没有可提取文本（no-extractable-text），不建立可检索知识。`,
    );
  }
  return {
    format,
    content: sections.map((section) => section.content).join('\n\n'),
    ...(pageCount === undefined ? {} : { pageCount }),
    warnings,
    sections,
  };
};

export async function extractDocument(
  format: KnowledgeFormat,
  bytes: Buffer,
): Promise<ExtractedDocument> {
  switch (format) {
    case 'markdown':
    case 'text': {
      const content = bytes.toString('utf8').replace(/^\uFEFF/u, '');
      return { format, content, sections: [{ locator: '全文', ordinal: 0, content }] };
    }
    case 'docx': {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: bytes });
      const paragraphs = result.value
        .split(/\n{2,}/u)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
      const sections = paragraphs.map((content, index) => ({
        locator: `段落 ${index + 1}`,
        ordinal: index,
        content,
      }));
      return {
        format,
        content: sections.map((section) => section.content).join('\n\n'),
        sections,
      };
    }
    case 'pdf': {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: bytes });
      try {
        const text = await parser.getText({ pageJoiner: '' });
        const sections = text.pages
          .map((page) => ({
            locator: `第 ${page.num} 页`,
            ordinal: page.num - 1,
            content: page.text.trim(),
          }))
          .filter((page) => Boolean(page.content));
        return {
          format,
          content: sections.map((page) => page.content).join('\n\n'),
          pageCount: text.total,
          sections,
        };
      } finally {
        await parser.destroy();
      }
    }
    case 'pptx':
    case 'xlsx':
    case 'csv':
      return extractOfficeDocument(format, bytes);
  }
}
