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
  MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS,
  memoryProvenanceSchema,
  stableStringifyJson,
} from '@betterwork/agent-protocol';

import { memoryContentHash } from './memory-content-policy';

/**
 * 来源只能由 Main 读取已登记实体后生成（契约 §5.3、§11.1）。Renderer 提交的永远是选择器，
 * 不能自报来源真实性；摘录区间按 code point 左闭右开校验，越界即整条来源非法。
 *
 * MI01 的收口点：**读不到的依赖是「不可证明」，不是「没有依赖」**。因此各来源分支只在
 * 审计记录确实存在时才接受合法空数组，缺记录一律 `SOURCE_REVIEW_REQUIRED`，不做 `?? []` 降级。
 */

/** 某个来源实体自己登记的空间与完整依赖；缺任何一环都由读取方返回 undefined。 */
export interface SourceDependencies {
  readonly workspaceId: string;
  readonly materials: readonly MaterialReference[];
  readonly memories: readonly MemoryDependency[];
}

/** 依赖链上一跳的精确修订事实，用于哈希复核与递归展开。 */
export interface MemoryRevisionFacts {
  readonly memoryId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  /** 该修订所属记忆当前是否仍可作依赖继承（已删除、被替代或仅作候选即不可）。 */
  readonly usable: boolean;
  readonly materialDependencies: readonly MaterialReference[];
  readonly memoryDependencies: readonly MemoryDependency[];
}

export interface ProvenanceReader {
  runPrompt(runId: string): string | undefined;
  /** 只有该运行的真实工作空间可解析时才返回值。 */
  runWorkspace(runId: string): string | undefined;
  /**
   * 只接受「所属 Run 已 completed」且「按 sequence 最后一个非工具调用的 message.completed」
   * 的那条回答；不能用 run.completed 的事件 ID 或中间工具轮冒充最终回答。
   */
  runAssistantAnswer(runId: string, eventId: string): string | undefined;
  /** 缺准备快照或缺记忆审计记录 → undefined；合法零依赖 → 两数组都为空。 */
  runDependencies(runId: string): SourceDependencies | undefined;
  checkpointField(checkpointId: string, field: 'feedback' | 'summary'): string | undefined;
  /** 节点来源事实足以证明完整依赖时返回，否则 undefined。 */
  checkpointDependencies(checkpointId: string): SourceDependencies | undefined;
  artifactVersion(
    artifactVersionId: string,
  ): { artifactId: string; contentHash: string; readableText: string | undefined } | undefined;
  /** 版本自身材料引用＋继承的输入关系；无法证明精确来源链时 undefined。 */
  artifactVersionDependencies(artifactVersionId: string): SourceDependencies | undefined;
  memoryRevision(revisionId: string): MemoryRevisionFacts | undefined;
}

export type ProvenanceErrorCode =
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_MISMATCH'
  | 'SOURCE_REVIEW_REQUIRED'
  | 'SOURCE_DEPENDENCY_LIMIT'
  | 'SOURCE_DEPENDENCY_CYCLE'
  | 'SCOPE_MISMATCH';

export interface ResolvedMemorySource {
  readonly source: MemorySourceRef;
  readonly authority: 'user-instruction' | 'derived';
  /** 来源实体登记的完整材料依赖（直接＋传递）。 */
  readonly materialDependencies: readonly MaterialReference[];
  /** 来源实体登记的记忆依赖（直接＋传递），不得由调用方补空数组。 */
  readonly memoryDependencies: readonly MemoryDependency[];
}

/** Main 依据提交范围做的归属核对：派生内容只能落在有真实工作空间的范围里。 */
export interface SourceCheckContext {
  readonly workspaceId: string | undefined;
}

export type ResolveResult =
  | { readonly ok: true; readonly value: ResolvedMemorySource }
  | { readonly ok: false; readonly code: ProvenanceErrorCode; readonly message: string };

type Failure = Exclude<ResolveResult, { ok: true }>;

const sliceCodePoints = (value: string, start: number, end: number): string =>
  [...value].slice(start, end).join('');

const excerptHashOf = (excerpt: string): string =>
  createHash('sha256').update(excerpt).digest('hex');

export const promptHashOf = (prompt: string): string => memoryContentHash(prompt);

const unavailable = (message: string): Failure => ({
  ok: false,
  code: 'SOURCE_UNAVAILABLE',
  message,
});

const mismatch = (message: string): Failure => ({ ok: false, code: 'SOURCE_MISMATCH', message });

const reviewRequired = (message: string): Failure => ({
  ok: false,
  code: 'SOURCE_REVIEW_REQUIRED',
  message,
});

const dependencyLimit = (what: string): Failure => ({
  ok: false,
  code: 'SOURCE_DEPENDENCY_LIMIT',
  message: `来源${what}依赖超出上限，请缩小范围后重试。`,
});

const dependencyCycle = (): Failure => ({
  ok: false,
  code: 'SOURCE_DEPENDENCY_CYCLE',
  message: '记忆依赖存在循环引用，无法证明完整来源链。',
});

const scopeMismatch = (): Failure => ({
  ok: false,
  code: 'SCOPE_MISMATCH',
  message: '来源所属工作空间与记忆范围不一致，请先切换范围后重试。',
});

/**
 * 摘录区间必须落在原始正文内且不超出上限（契约 §11.1）：
 * 这里先行拒绝，避免把超长摘录交给输出 Schema 变成内部错误。
 */
const buildExcerpt = (
  text: string,
  start: number,
  end: number,
): { readonly excerpt: string } | { readonly failure: Failure } => {
  if (start < 0 || end <= start) return { failure: mismatch('摘录区间为空或顺序不合法。') };
  if (end > countCodePoints(text)) return { failure: mismatch('摘录区间超出来源正文范围。') };
  const excerpt = sliceCodePoints(text, start, end);
  if (excerpt.length === 0) return { failure: mismatch('摘录区间为空或顺序不合法。') };
  if (countCodePoints(excerpt) > MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS) {
    return {
      failure: mismatch(
        `摘录最多 ${MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS} 码点，请在原文重新选取更短的片段。`,
      ),
    };
  }
  return { excerpt };
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

/**
 * 同一材料引用按精确身份去重；sourcePath 只是定位入口，不参与身份。
 * 读取器与解析器共用这一把键，避免两侧对「同一条材料」判定不一致。
 */
export const materialReferenceKeyOf = (reference: MaterialReference): string =>
  stableStringifyJson(
    Object.entries(reference)
      .filter(([key]) => key !== 'sourcePath')
      .sort(([left], [right]) => (left < right ? -1 : 1)),
  );

/**
 * 依赖闭包：直接引用先入，再沿记忆修订递归展开，途中拒绝缺修订、哈希不符、失效与循环。
 * 计数超限一律拒绝而不是截断，静默丢弃依赖等于伪造「无依赖」。
 */
const closeMemoryDependencies = (
  base: SourceDependencies,
  reader: ProvenanceReader,
): { readonly ok: true; readonly value: Omit<SourceDependencies, 'workspaceId'> } | Failure => {
  const materials = new Map<string, MaterialReference>();
  const memories = new Map<string, MemoryDependency>();
  const path = new Set<string>();

  const addMaterial = (reference: MaterialReference): Failure | undefined => {
    const key = materialReferenceKeyOf(reference);
    if (materials.has(key)) return undefined;
    materials.set(key, reference);
    return materials.size > MEMORY_MATERIAL_DEPENDENCY_MAX ? dependencyLimit('材料') : undefined;
  };

  const visit = (dependency: MemoryDependency): Failure | undefined => {
    // 先查当前路径再查「已并入」，否则 A→B→A 会被当成去重命中而放过循环。
    if (path.has(dependency.revisionId)) return dependencyCycle();
    if (memories.has(dependency.revisionId)) return undefined;
    const facts = reader.memoryRevision(dependency.revisionId);
    if (!facts || facts.memoryId !== dependency.memoryId) {
      return reviewRequired('依赖的记忆修订不存在，来源链无法证明。');
    }
    if (facts.contentHash !== dependency.contentHash) {
      return reviewRequired('依赖的记忆修订哈希不符，来源链无法证明。');
    }
    if (!facts.usable) {
      return reviewRequired('依赖的记忆当前不再有效，请先复核来源后重试。');
    }
    memories.set(dependency.revisionId, dependency);
    if (memories.size > MEMORY_MEMORY_DEPENDENCY_MAX) return dependencyLimit('记忆');
    path.add(dependency.revisionId);
    for (const nested of facts.memoryDependencies) {
      const failure = visit(nested);
      if (failure) return failure;
    }
    path.delete(dependency.revisionId);
    for (const reference of facts.materialDependencies) {
      const failure = addMaterial(reference);
      if (failure) return failure;
    }
    return undefined;
  };

  for (const reference of base.materials) {
    const failure = addMaterial(reference);
    if (failure) return failure;
  }
  for (const dependency of base.memories) {
    const failure = visit(dependency);
    if (failure) return failure;
  }
  return {
    ok: true,
    value: { materials: [...materials.values()], memories: [...memories.values()] },
  };
};

/** 所有 selector 都必须落在同一真实工作空间；全局范围不能收容派生内容（契约 §11.1）。 */
const checkWorkspace = (
  context: SourceCheckContext,
  sourceWorkspaceId: string,
): Failure | undefined => {
  if (context.workspaceId === undefined) {
    return scopeMismatch();
  }
  return context.workspaceId === sourceWorkspaceId ? undefined : scopeMismatch();
};

export const resolveMemorySourceSelector = (
  selector: MemorySourceSelector,
  reader: ProvenanceReader,
  context: SourceCheckContext,
): ResolveResult => {
  switch (selector.kind) {
    case 'run-user': {
      const prompt = reader.runPrompt(selector.runId);
      if (prompt === undefined) return unavailable('来源运行不存在或不可读。');
      const runWorkspaceId = reader.runWorkspace(selector.runId);
      if (runWorkspaceId === undefined) return unavailable('来源运行所属工作空间不可确认。');
      const workspaceFailure = checkWorkspace(context, runWorkspaceId);
      if (workspaceFailure) return workspaceFailure;
      const built = buildExcerpt(prompt, selector.start, selector.end);
      if ('failure' in built) return built.failure;
      return {
        ok: true,
        value: {
          authority: 'user-instruction',
          materialDependencies: [],
          memoryDependencies: [],
          source: {
            kind: 'run-user',
            runId: selector.runId,
            promptHash: promptHashOf(prompt),
            excerpt: built.excerpt,
            excerptHash: excerptHashOf(built.excerpt),
            start: selector.start,
            end: selector.end,
          },
        },
      };
    }
    case 'run-assistant': {
      const content = reader.runAssistantAnswer(selector.runId, selector.eventId);
      if (content === undefined) {
        return unavailable('来源事件不是该已完成运行的最终无工具回答。');
      }
      const built = buildExcerpt(content, selector.start, selector.end);
      if ('failure' in built) return built.failure;
      const facts = reader.runDependencies(selector.runId);
      if (facts === undefined) {
        return reviewRequired('来源运行缺少准备快照或记忆审计记录，无法证明完整依赖。');
      }
      const workspaceFailure = checkWorkspace(context, facts.workspaceId);
      if (workspaceFailure) return workspaceFailure;
      const closure = closeMemoryDependencies(facts, reader);
      if (!closure.ok) return closure;
      return {
        ok: true,
        value: {
          authority: 'derived',
          materialDependencies: closure.value.materials,
          memoryDependencies: closure.value.memories,
          source: {
            kind: 'run-assistant',
            runId: selector.runId,
            eventId: selector.eventId,
            contentHash: memoryContentHash(content),
            excerpt: built.excerpt,
            excerptHash: excerptHashOf(built.excerpt),
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
      const facts = reader.checkpointDependencies(selector.checkpointId);
      if (facts === undefined) {
        return reviewRequired('讨论节点缺少可证明的来源运行或材料引用，无法保存为派生来源。');
      }
      const built = buildExcerpt(content, selector.start, selector.end);
      if ('failure' in built) return built.failure;
      const workspaceFailure = checkWorkspace(context, facts.workspaceId);
      if (workspaceFailure) return workspaceFailure;
      const closure = closeMemoryDependencies(facts, reader);
      if (!closure.ok) return closure;
      return {
        ok: true,
        value: {
          authority: 'derived',
          materialDependencies: closure.value.materials,
          memoryDependencies: closure.value.memories,
          source: {
            kind: 'checkpoint',
            checkpointId: selector.checkpointId,
            field: selector.field,
            contentHash: memoryContentHash(content),
            excerpt: built.excerpt,
            excerptHash: excerptHashOf(built.excerpt),
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
      const facts = reader.artifactVersionDependencies(selector.artifactVersionId);
      if (facts === undefined) {
        return reviewRequired('成果版本的来源链无法精确证明，请改用可核验来源或人工口径。');
      }
      const characters = [...version.readableText];
      const target = [...selector.selectedText];
      const start = indexOfCodePointSequence(characters, target);
      if (start < 0) return mismatch('选中文本不在该版本正文中。');
      const built = buildExcerpt(version.readableText, start, start + target.length);
      if ('failure' in built) return built.failure;
      const workspaceFailure = checkWorkspace(context, facts.workspaceId);
      if (workspaceFailure) return workspaceFailure;
      const closure = closeMemoryDependencies(facts, reader);
      if (!closure.ok) return closure;
      return {
        ok: true,
        value: {
          authority: 'derived',
          materialDependencies: closure.value.materials,
          memoryDependencies: closure.value.memories,
          source: {
            kind: 'artifact-version',
            artifactId: version.artifactId,
            artifactVersionId: selector.artifactVersionId,
            contentHash: version.contentHash,
            excerpt: selector.selectedText,
            excerptHash: excerptHashOf(selector.selectedText),
            start,
            end: start + target.length,
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
