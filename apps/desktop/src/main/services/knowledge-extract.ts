import type {
  KnowledgeExtractedSection,
  KnowledgeFormat,
  KnowledgeWarningCode,
  KnowledgeWorkerJobContext,
} from '@betterwork/agent-protocol';

/**
 * 原文提取（知识契约 §2.1）。CPU 密集的解析在生产路径由独立 Worker 进程执行
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

export async function extractDocument(
  format: KnowledgeFormat,
  bytes: Buffer,
): Promise<ExtractedDocument> {
  if (format === 'markdown' || format === 'text') {
    const content = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return { format, content, sections: [{ locator: '全文', ordinal: 0, content }] };
  }
  if (format === 'docx') {
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
    return { format, content: sections.map((section) => section.content).join('\n\n'), sections };
  }
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
