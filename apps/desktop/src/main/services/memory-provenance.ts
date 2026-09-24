import { createHash } from 'node:crypto';

import type {
  MaterialReference,
  MemoryDependency,
  MemoryProvenance,
  MemorySourceRef,
  MemorySourceSelector,
} from '@betterwork/agent-protocol';
import {
  countCodePoints,
  MEMORY_MATERIAL_DEPENDENCY_MAX,
  MEMORY_MEMORY_DEPENDENCY_MAX,
  memoryProvenanceSchema,
} from '@betterwork/agent-protocol';

import { memoryContentHash } from './memory-content-policy';

/**
 * 来源只能由 Main 读取已登记实体后生成（总稿 §5.3）。Renderer 提交的永远是选择器，
 * 不能自报来源真实性；摘录区间按 code point 左闭右开校验，越界即整条来源非法。
 */

export interface ProvenanceReader {
  runPrompt(runId: string): string | undefined;
  runAssistantEventContent(runId: string, eventId: string): string | undefined;
  runMaterialReferences(runId: string): readonly MaterialReference[] | undefined;
  checkpointField(checkpointId: string, field: 'feedback' | 'summary'): string | undefined;
  artifactVersion(
    artifactVersionId: string,
  ): { artifactId: string; contentHash: string; readableText: string | undefined } | undefined;
}

export type ProvenanceErrorCode =
  'SOURCE_UNAVAILABLE' | 'SOURCE_MISMATCH' | 'SOURCE_DEPENDENCY_LIMIT';

export interface ResolvedMemorySource {
  readonly source: MemorySourceRef;
  readonly authority: 'user-instruction' | 'derived';
  /** 只有来自某次运行的派生内容才继承该运行的材料依赖。 */
  readonly materialDependencies: readonly MaterialReference[];
}

export type ResolveResult =
  | { readonly ok: true; readonly value: ResolvedMemorySource }
  | { readonly ok: false; readonly code: ProvenanceErrorCode; readonly message: string };

const sliceCodePoints = (value: string, start: number, end: number): string =>
  [...value].slice(start, end).join('');

const excerptHashOf = (excerpt: string): string =>
  createHash('sha256').update(excerpt).digest('hex');

export const promptHashOf = (prompt: string): string => memoryContentHash(prompt);

const buildExcerpt = (text: string, start: number, end: number): string | undefined => {
  if (start < 0 || end <= start) return undefined;
  if (end > countCodePoints(text)) return undefined;
  const excerpt = sliceCodePoints(text, start, end);
  return excerpt.length === 0 ? undefined : excerpt;
};

/** 在 code point 序列中查找子序列，返回起点下标；UTF-16 下标不可直接使用。 */
const indexOfCodePointSequence = (
  haystack: readonly string[],
  needle: readonly string[],
): number => {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  const target = needle.join('');
  for (let offset = 0; offset + needle.length <= haystack.length; offset += 1) {
    if (haystack.slice(offset, offset + needle.length).join('') === target) return offset;
  }
  return -1;
};

const unavailable = (message: string): ResolveResult => ({
  ok: false,
  code: 'SOURCE_UNAVAILABLE',
  message,
});

const excerptFailure = (): ResolveResult => ({
  ok: false,
  code: 'SOURCE_MISMATCH',
  message: '摘录区间超出来源正文范围。',
});

const dependencyFailure = (what: string): ResolveResult => ({
  ok: false,
  code: 'SOURCE_DEPENDENCY_LIMIT',
  message: `来源${what}依赖超出上限，请缩小范围后重试。`,
});

export const resolveMemorySourceSelector = (
  selector: MemorySourceSelector,
  reader: ProvenanceReader,
): ResolveResult => {
  switch (selector.kind) {
    case 'run-user': {
      const prompt = reader.runPrompt(selector.runId);
      if (prompt === undefined) return unavailable('来源运行不存在或不可读。');
      const excerpt = buildExcerpt(prompt, selector.start, selector.end);
      if (excerpt === undefined) return excerptFailure();
      return {
        ok: true,
        value: {
          authority: 'user-instruction',
          materialDependencies: [],
          source: {
            kind: 'run-user',
            runId: selector.runId,
            promptHash: promptHashOf(prompt),
            excerpt,
            excerptHash: excerptHashOf(excerpt),
            start: selector.start,
            end: selector.end,
          },
        },
      };
    }
    case 'run-assistant': {
      const content = reader.runAssistantEventContent(selector.runId, selector.eventId);
      if (content === undefined) {
        return unavailable('来源事件不是该运行已登记的助手最终回答。');
      }
      const excerpt = buildExcerpt(content, selector.start, selector.end);
      if (excerpt === undefined) return excerptFailure();
      const materials = reader.runMaterialReferences(selector.runId) ?? [];
      if (materials.length > MEMORY_MATERIAL_DEPENDENCY_MAX) return dependencyFailure('材料');
      return {
        ok: true,
        value: {
          authority: 'derived',
          materialDependencies: materials,
          source: {
            kind: 'run-assistant',
            runId: selector.runId,
            eventId: selector.eventId,
            contentHash: memoryContentHash(content),
            excerpt,
            excerptHash: excerptHashOf(excerpt),
            start: selector.start,
            end: selector.end,
          },
        },
      };
    }
    case 'checkpoint': {
      // 只取字段正文本身：节点的 status 与 updatedAt 变化不得伪装成内容变化。
      const content = reader.checkpointField(selector.checkpointId, selector.field);
      if (content === undefined) return unavailable('讨论节点或该字段不存在。');
      const excerpt = buildExcerpt(content, selector.start, selector.end);
      if (excerpt === undefined) return excerptFailure();
      return {
        ok: true,
        value: {
          authority: 'derived',
          materialDependencies: [],
          source: {
            kind: 'checkpoint',
            checkpointId: selector.checkpointId,
            field: selector.field,
            contentHash: memoryContentHash(content),
            excerpt,
            excerptHash: excerptHashOf(excerpt),
            start: selector.start,
            end: selector.end,
          },
        },
      };
    }
    case 'artifact-version': {
      const version = reader.artifactVersion(selector.artifactVersionId);
      if (version === undefined) return unavailable('成果版本不存在。');
      if (version.readableText === undefined) {
        // 无法精确定位的格式只允许用户走独立人工表单，不伪造摘录。
        return unavailable('该格式当前不可精确读取，请改用人工来源。');
      }
      const characters = [...version.readableText];
      const target = [...selector.selectedText];
      const start = indexOfCodePointSequence(characters, target);
      if (start < 0) {
        return { ok: false, code: 'SOURCE_MISMATCH', message: '选中文本不在该版本正文中。' };
      }
      const end = start + target.length;
      return {
        ok: true,
        value: {
          authority: 'derived',
          materialDependencies: [],
          source: {
            kind: 'artifact-version',
            artifactId: version.artifactId,
            artifactVersionId: selector.artifactVersionId,
            contentHash: version.contentHash,
            excerpt: selector.selectedText,
            excerptHash: excerptHashOf(selector.selectedText),
            start,
            end,
            locator: selector.locator,
          },
        },
      };
    }
  }
};

export const manualMemorySource = (operationId: string, content: string): MemorySourceRef => {
  const characters = [...content];
  return {
    kind: 'manual',
    operationId,
    contentHash: memoryContentHash(content),
    excerpt: content,
    excerptHash: excerptHashOf(content),
    start: 0,
    end: characters.length,
  };
};

/** §5.3：人工自主口径是空依赖的新 manual 来源。 */
export const buildUserInstructionProvenance = (input: {
  capturedAt: number;
  operationId: string;
  content: string;
  genericDeclaration?: boolean;
  originWorkspaceId?: string;
}): MemoryProvenance =>
  memoryProvenanceSchema.parse({
    schemaVersion: 1,
    verification: 'verified',
    authority: 'user-instruction',
    capturedAt: input.capturedAt,
    sources: [manualMemorySource(input.operationId, input.content)],
    materialDependencies: [],
    memoryDependencies: [],
    ...(input.originWorkspaceId ? { originWorkspaceId: input.originWorkspaceId } : {}),
    ...(input.genericDeclaration === undefined
      ? {}
      : { genericDeclaration: input.genericDeclaration }),
  });

export const buildDerivedProvenance = (input: {
  capturedAt: number;
  sources: readonly MemorySourceRef[];
  materialDependencies: readonly MaterialReference[];
  memoryDependencies: readonly MemoryDependency[];
  originWorkspaceId?: string;
}): MemoryProvenance => {
  if (input.materialDependencies.length > MEMORY_MATERIAL_DEPENDENCY_MAX) {
    throw new RangeError('材料依赖超出上限。');
  }
  if (input.memoryDependencies.length > MEMORY_MEMORY_DEPENDENCY_MAX) {
    throw new RangeError('记忆依赖超出上限。');
  }
  return memoryProvenanceSchema.parse({
    schemaVersion: 1,
    verification: 'verified',
    authority: 'derived',
    capturedAt: input.capturedAt,
    sources: input.sources,
    materialDependencies: input.materialDependencies,
    memoryDependencies: input.memoryDependencies,
    ...(input.originWorkspaceId ? { originWorkspaceId: input.originWorkspaceId } : {}),
  });
};

/** §8.4：legacy 行只保留原字段并标注待复核，不补造来源、确认人或时间。 */
export const buildLegacyProvenance = (input: {
  sourceType: 'user-explicit' | 'conversation' | 'artifact' | 'reflection';
  sourceId?: string;
  sourceLocator?: string;
}): MemoryProvenance =>
  memoryProvenanceSchema.parse({
    schemaVersion: 1,
    verification: 'legacy-unverified',
    sourceType: input.sourceType,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(input.sourceLocator ? { sourceLocator: input.sourceLocator } : {}),
  });

/** 记忆依赖按精确修订与哈希引用，展开时拒绝自引用。 */
export const memoryDependencyOf = (record: {
  id: string;
  revisionId: string;
  contentHash: string;
}): MemoryDependency => ({
  memoryId: record.id,
  revisionId: record.revisionId,
  contentHash: record.contentHash,
});
