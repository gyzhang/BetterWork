import { createHash } from 'node:crypto';

import {
  countCodePoints,
  KNOWLEDGE_PAGE_DEFAULT_CODE_POINTS,
  KNOWLEDGE_PAGE_MAX_CODE_POINTS,
  KNOWLEDGE_PAGE_MAX_PARTS,
  type KnowledgeCursor,
  type KnowledgeMaterialReference,
  type KnowledgeTextPage,
  type KnowledgeTextPagePart,
  type KnowledgeWarningCode,
} from '@betterwork/agent-protocol';

import { KnowledgeServiceError } from './knowledge-errors';

/** 已保存正文的定位单元（knowledge_revision_chunks），ordinal 为库中真实值。 */
export interface KnowledgeSection {
  ordinal: number;
  locator: string;
  content: string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 修订提取文本哈希（契约 §2.1）：UTF-8 JSON 数组 `[[ordinal, locator, content], ...]`
 * 按 ordinal 升序、无额外空白序列化后的 SHA-256；不含 ID、时间或源路径。
 */
export function revisionTextHash(sections: readonly KnowledgeSection[]): string {
  const ordered = [...sections]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((section) => [section.ordinal, section.locator, section.content]);
  return sha256Hex(JSON.stringify(ordered));
}

function sliceCodePoints(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('');
}

export interface KnowledgeTextPageInput {
  reference: KnowledgeMaterialReference;
  textHash: string;
  title: string;
  parserVersion: string;
  chunkingVersion: string;
  warnings: readonly KnowledgeWarningCode[];
  /** 按 ordinal 升序的已保存 section。 */
  sections: readonly KnowledgeSection[];
  cursor?: KnowledgeCursor;
  maxCodePoints?: number;
}

/**
 * 正文码点分页（契约 §3.1）。纯函数：同一输入与游标得到同一页，
 * 游标只对同修订同文本有效；段末游标规范化到下一 section，越界拒绝。
 */
export function readKnowledgeTextPage(input: KnowledgeTextPageInput): KnowledgeTextPage {
  const { sections, cursor, reference, textHash } = input;
  if (
    cursor &&
    (cursor.revisionId !== reference.knowledgeRevisionId || cursor.textHash !== textHash)
  ) {
    throw new KnowledgeServiceError(
      'KNOWLEDGE_CURSOR_INVALID',
      '游标指向的修订或文本哈希与当前请求不一致。',
    );
  }

  let sectionIndex = 0;
  let offset = 0;
  if (cursor) {
    const found = sections.findIndex((section) => section.ordinal === cursor.sectionOrdinal);
    if (found < 0) {
      throw new KnowledgeServiceError('KNOWLEDGE_CURSOR_INVALID', '游标指向的段落不在此修订中。');
    }
    const length = countCodePoints(sections[found]?.content ?? '');
    if (cursor.offset > length) {
      throw new KnowledgeServiceError('KNOWLEDGE_CURSOR_INVALID', '游标偏移超出该段落长度。');
    }
    sectionIndex = found;
    offset = cursor.offset;
    if (offset === length) {
      sectionIndex += 1;
      offset = 0;
    }
  }

  const requested = input.maxCodePoints ?? KNOWLEDGE_PAGE_DEFAULT_CODE_POINTS;
  const budget = Math.min(Math.max(requested, 1), KNOWLEDGE_PAGE_MAX_CODE_POINTS);
  const parts: KnowledgeTextPagePart[] = [];
  let returnedCodePoints = 0;
  while (
    sectionIndex < sections.length &&
    returnedCodePoints < budget &&
    parts.length < KNOWLEDGE_PAGE_MAX_PARTS
  ) {
    const section = sections[sectionIndex];
    if (!section) break;
    const length = countCodePoints(section.content);
    if (offset >= length) {
      sectionIndex += 1;
      offset = 0;
      continue;
    }
    const take = Math.min(length - offset, budget - returnedCodePoints);
    const text = sliceCodePoints(section.content, offset, offset + take);
    parts.push({
      span: { sectionOrdinal: section.ordinal, start: offset, end: offset + take },
      locator: section.locator,
      text,
      excerptHash: sha256Hex(text),
    });
    returnedCodePoints += take;
    offset += take;
    if (offset >= length) {
      sectionIndex += 1;
      offset = 0;
    }
  }

  const complete = sectionIndex >= sections.length;
  const nextSection = complete ? undefined : sections[sectionIndex];
  return {
    reference,
    textHash,
    title: input.title,
    parserVersion: input.parserVersion,
    chunkingVersion: input.chunkingVersion,
    warnings: [...input.warnings],
    parts,
    returnedCodePoints,
    complete,
    ...(nextSection
      ? {
          nextCursor: {
            revisionId: reference.knowledgeRevisionId,
            textHash,
            sectionOrdinal: nextSection.ordinal,
            offset,
          },
        }
      : {}),
  };
}
