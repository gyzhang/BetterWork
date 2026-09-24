import { randomUUID } from 'node:crypto';

import { abortError, isAbortError } from '@betterwork/agent-core';
import {
  countCodePoints,
  KNOWLEDGE_PAGE_DEFAULT_CODE_POINTS,
  KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS,
  KNOWLEDGE_SEARCH_TOOL_MAX_RESULTS,
  type KnowledgeMaterialReference,
  type KnowledgeReadRequest,
  type KnowledgeSearchResult,
  type KnowledgeTextPage,
  type RunSourcePreview,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { KnowledgeServiceError } from './knowledge-errors';
import { sha256Hex, sliceCodePoints } from './knowledge-text';
import type { KnowledgeVault } from './knowledge-vault';

/** Run 工具层可见的搜索条目：正文之外的身份与审计引用。 */
export interface KnowledgeAuditedSearchItem {
  id: string;
  title: string;
  sourcePath: string;
  format: KnowledgeSearchResult['document']['format'];
  locator: string;
  excerpt: string;
  contentHash: string;
  reference: KnowledgeMaterialReference;
  textHash: string;
  span: NonNullable<KnowledgeSearchResult['span']>;
  excerptHash: string;
  evidenceId: string;
}

export interface KnowledgeSearchOutcome {
  results: KnowledgeAuditedSearchItem[];
  /** 空材料/旧兼容 Run 的可解释提示；不表示全库没有资料。 */
  notice?: string;
}

export interface KnowledgeReadOutput extends KnowledgeTextPage {
  remainingRunCodePoints: number;
  parts: Array<KnowledgeTextPage['parts'][number] & { evidenceId: string }>;
}

/** Run 侧审计上下文：runId/taskId/材料集合来自宿主，模型不能指定。 */
export interface KnowledgeRunAuditContext {
  runId: string;
  taskId: string;
  toolCallId: string;
  signal: AbortSignal;
  materialScope: boolean;
  materials: readonly KnowledgeMaterialReference[];
}

const sameReference = (
  left: KnowledgeMaterialReference,
  right: KnowledgeMaterialReference,
): boolean =>
  left.knowledgeDocumentId === right.knowledgeDocumentId &&
  left.knowledgeRevisionId === right.knowledgeRevisionId &&
  left.contentHash === right.contentHash &&
  left.sourcePath === right.sourcePath;

/**
 * 知识搜索/读取的审计服务（契约 §5）：先在同一应用库事务内落 Evidence 与整组
 * RunMaterialRead，再把 evidenceId 附到模型可见结果；审计失败禁止返回正文。
 */
export class KnowledgeAudit {
  constructor(
    private readonly store: AppStore,
    private readonly vault: KnowledgeVault,
  ) {}

  searchForRun(context: KnowledgeRunAuditContext, query: string): KnowledgeSearchOutcome {
    if (context.signal.aborted) throw abortError();
    if (!context.materialScope) {
      return {
        results: [],
        notice: '本次运行没有固定材料范围（旧任务兼容）。请在任务中选择资料后再使用知识库。',
      };
    }
    if (context.materials.length === 0) {
      return {
        results: [],
        notice: '本次运行未选择知识资料，不检索全库。',
      };
    }
    const hits = this.vault
      .search(query, { revisionIds: context.materials.map((ref) => ref.knowledgeRevisionId) })
      .filter((hit) => hit.span && hit.excerptHash)
      .slice(0, KNOWLEDGE_SEARCH_TOOL_MAX_RESULTS);
    if (hits.length === 0) return { results: [] };
    try {
      const results = this.store.transaction((): KnowledgeAuditedSearchItem[] =>
        hits.map((hit, index) => {
          const span = hit.span;
          const excerptHash = hit.excerptHash;
          if (!span || !excerptHash) {
            throw new KnowledgeServiceError(
              'KNOWLEDGE_AUDIT_FAILED',
              '搜索命中缺少精确范围，拒绝未审计返回。',
            );
          }
          const evidence = this.store.evidence.saveKnowledge({
            taskId: context.taskId,
            runId: context.runId,
            sourceUri: hit.reference.sourcePath,
            title: hit.document.title,
            locator: hit.locator,
            excerpt: hit.excerpt,
            contentHash: hit.reference.contentHash,
            knowledgeSource: {
              reference: hit.reference,
              textHash: hit.textHash,
              span,
              operation: 'search',
            },
          });
          this.store.materialReads.save({
            id: randomUUID(),
            runId: context.runId,
            material: hit.reference,
            operation: 'search',
            locator: hit.locator,
            contentHash: hit.reference.contentHash,
            excerptHash,
            capturedAt: Date.now(),
            toolCallId: context.toolCallId,
            knowledgePartIndex: index,
            knowledgeSpan: span,
            textHash: hit.textHash,
            evidenceId: evidence.id,
          });
          return {
            id: hit.document.id,
            title: hit.document.title,
            sourcePath: hit.document.sourcePath,
            format: hit.document.format,
            locator: hit.locator,
            excerpt: hit.excerpt,
            contentHash: hit.reference.contentHash,
            reference: hit.reference,
            textHash: hit.textHash,
            span,
            excerptHash,
            evidenceId: evidence.id,
          };
        }),
      );
      if (context.signal.aborted) throw abortError();
      return { results };
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new KnowledgeServiceError(
        'KNOWLEDGE_AUDIT_FAILED',
        '知识来源审计写入失败，未返回任何正文。',
        { cause: error },
      );
    }
  }

  readForRun(
    context: KnowledgeRunAuditContext,
    request: KnowledgeReadRequest,
  ): KnowledgeReadOutput {
    if (context.signal.aborted) throw abortError();
    const selected = context.materials.find((material) =>
      sameReference(material, request.reference),
    );
    if (!context.materialScope || !selected) {
      throw new KnowledgeServiceError('KNOWLEDGE_NOT_SELECTED', '该资料修订不在本次运行范围内。');
    }
    const revision = this.vault.getRevision(request.reference.knowledgeRevisionId);
    if (
      !revision ||
      revision.documentId !== request.reference.knowledgeDocumentId ||
      revision.contentHash !== request.reference.contentHash ||
      revision.sourcePath !== request.reference.sourcePath
    ) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_REVISION_MISMATCH',
        '修订与登记的材料身份不一致，不回落到最新版本。',
      );
    }
    const used = this.store.materialReads.readCodePointsUsed(context.runId);
    const remaining = KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS - used;
    if (remaining <= 0) {
      // 预算为零：只允许返回已读完的空完成页，否则明确拒绝，不伪装读完（契约 §3.1）。
      const probe = this.vault.previewRevision(
        request.reference.knowledgeDocumentId,
        request.reference.knowledgeRevisionId,
        request.cursor,
        1,
      );
      if (probe.complete && probe.parts.length === 0) {
        return { ...probe, parts: [], remainingRunCodePoints: 0 };
      }
      throw new KnowledgeServiceError(
        'KNOWLEDGE_READ_BUDGET_EXCEEDED',
        '本次运行的正文读取预算已耗尽，仍有后续内容未读。',
      );
    }
    const requested = request.maxCodePoints ?? KNOWLEDGE_PAGE_DEFAULT_CODE_POINTS;
    const budget = Math.min(requested, remaining);
    const page = this.vault.previewRevision(
      request.reference.knowledgeDocumentId,
      request.reference.knowledgeRevisionId,
      request.cursor,
      budget,
    );
    if (context.signal.aborted) throw abortError();
    try {
      const parts = this.store.transaction((): KnowledgeReadOutput['parts'] =>
        page.parts.map((part, index) => {
          const evidence = this.store.evidence.saveKnowledge({
            taskId: context.taskId,
            runId: context.runId,
            sourceUri: revision.sourcePath,
            title: revision.title,
            locator: part.locator,
            excerpt: part.text,
            contentHash: revision.contentHash,
            knowledgeSource: {
              reference: request.reference,
              textHash: page.textHash,
              span: part.span,
              operation: 'read',
            },
          });
          this.store.materialReads.save({
            id: randomUUID(),
            runId: context.runId,
            material: request.reference,
            operation: 'read',
            locator: part.locator,
            contentHash: revision.contentHash,
            excerptHash: part.excerptHash,
            capturedAt: Date.now(),
            toolCallId: context.toolCallId,
            knowledgePartIndex: index,
            knowledgeSpan: part.span,
            textHash: page.textHash,
            evidenceId: evidence.id,
          });
          return { ...part, evidenceId: evidence.id };
        }),
      );
      if (context.signal.aborted) throw abortError();
      const returned = page.parts.reduce((total, part) => total + countCodePoints(part.text), 0);
      return {
        ...page,
        parts,
        remainingRunCodePoints: Math.max(remaining - returned, 0),
      };
    } catch (error) {
      if (error instanceof KnowledgeServiceError) throw error;
      throw new KnowledgeServiceError(
        'KNOWLEDGE_AUDIT_FAILED',
        '知识正文审计写入失败，未返回任何正文。',
        { cause: error },
      );
    }
  }

  /**
   * KM04 按运行回看单条证据实际返回过的区间（契约 §3.1）：
   * 只复用保存文本，不接收游标与额度，不能续读未返回正文；旧来源返回 legacy。
   */
  previewRunSource(runId: string, evidenceId: string): RunSourcePreview {
    const evidence = this.store.evidence.get(evidenceId);
    if (!evidence || evidence.runId !== runId) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_REVISION_MISMATCH',
        '来源证据不存在或不属于本次运行。',
      );
    }
    const source = evidence.knowledgeSource;
    if (!source) return { kind: 'legacy', evidence };
    const snapshot = this.store.runContextSnapshots.get(runId);
    const inScope =
      snapshot?.materials.some(
        (selection) =>
          selection.reference.kind === 'knowledge-revision' &&
          sameReference(selection.reference, source.reference),
      ) ?? false;
    if (!inScope) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_REVISION_MISMATCH',
        '证据引用的修订不在该运行的材料快照内。',
      );
    }
    const revision = this.vault.getRevision(source.reference.knowledgeRevisionId);
    if (
      !revision ||
      revision.documentId !== source.reference.knowledgeDocumentId ||
      revision.contentHash !== source.reference.contentHash ||
      revision.sourcePath !== source.reference.sourcePath ||
      revision.textHash !== source.textHash
    ) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_REVISION_MISMATCH',
        '证据的修订身份与保存文本不一致。',
      );
    }
    const section = revision.chunks.find((chunk) => chunk.ordinal === source.span.sectionOrdinal);
    const text = section
      ? sliceCodePoints(section.content, source.span.start, source.span.end)
      : '';
    if (!section || text !== evidence.excerpt) {
      throw new KnowledgeServiceError(
        'KNOWLEDGE_REVISION_MISMATCH',
        '保存文本与证据区间不一致，拒绝伪造精确预览。',
      );
    }
    return {
      kind: 'exact',
      page: {
        reference: source.reference,
        textHash: source.textHash,
        title: revision.title,
        parserVersion: revision.parserVersion,
        chunkingVersion: revision.chunkingVersion,
        warnings: revision.warnings,
        parts: [
          {
            span: source.span,
            locator: section.locator,
            text,
            excerptHash: sha256Hex(text),
          },
        ],
        returnedCodePoints: countCodePoints(text),
        complete: true,
      },
    };
  }
}
