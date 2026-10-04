import { createHash } from 'node:crypto';

import {
  type ExpertReferenceMaterial,
  expertReferenceMaterialSchema,
  type KnowledgeMaterialReference,
  type MaterialPurpose,
  sameKnowledgeReference,
  SCHEDULE_SOURCE_ITEM_MAX,
  type ScheduleDomainErrorCode,
  type ScheduleKnowledgeSource,
  scheduleKnowledgeSourcesSchema,
  type ScheduleSourceOrigin,
} from '@betterwork/agent-protocol';

import type { KnowledgeVault } from './knowledge-vault';

export interface ScheduleKnowledgeSourceItem {
  reference: KnowledgeMaterialReference;
  purpose: MaterialPurpose;
  origin: Exclude<ScheduleSourceOrigin, 'workspace-directory'>;
  displayName: string;
  sourcePath: string;
}

export interface ScheduleKnowledgeSourceCollection {
  workspaceId: string;
  items: ScheduleKnowledgeSourceItem[];
  sources: ScheduleKnowledgeSource[];
  expertReferences: ExpertReferenceMaterial[];
}

export interface ResolveScheduleKnowledgeSourcesRequest {
  workspaceId: string;
  sources: readonly ScheduleKnowledgeSource[];
  expertReferences: readonly ExpertReferenceMaterial[];
  signal?: AbortSignal;
}

export class ScheduleKnowledgeSourcesError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleKnowledgeSourcesError';
  }
}

type ScheduleKnowledgeVault = Pick<KnowledgeVault, 'readScheduledKnowledgeSources'>;

const referenceOrder = (
  left: KnowledgeMaterialReference,
  right: KnowledgeMaterialReference,
): number => {
  const leftKey = `${left.knowledgeDocumentId}\u0000${left.knowledgeRevisionId}\u0000${left.contentHash}`;
  const rightKey = `${right.knowledgeDocumentId}\u0000${right.knowledgeRevisionId}\u0000${right.contentHash}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

const collectionFingerprint = (items: readonly ScheduleKnowledgeSourceItem[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        items.map((item) => [
          item.reference.knowledgeDocumentId,
          item.reference.knowledgeRevisionId,
          item.reference.contentHash,
          item.reference.sourcePath,
          item.purpose,
          item.origin,
        ]),
      ),
    )
    .digest('hex');

const originFor = (
  source: ScheduleKnowledgeSource,
): Exclude<ScheduleSourceOrigin, 'workspace-directory'> => {
  if (source.kind === 'document') return 'selected-document';
  if (source.kind === 'collection') return 'selected-collection';
  return 'selected-vault';
};

export class ScheduleKnowledgeSourcesService {
  constructor(private readonly vault: ScheduleKnowledgeVault) {}

  resolve(request: ResolveScheduleKnowledgeSourcesRequest): ScheduleKnowledgeSourceCollection {
    this.throwIfAborted(request.signal);
    const sources = scheduleKnowledgeSourcesSchema.parse([...request.sources]);
    const expertReferences = expertReferenceMaterialSchema
      .array()
      .max(50)
      .parse([...request.expertReferences]);
    const read = this.vault.readScheduledKnowledgeSources({
      workspaceId: request.workspaceId,
      sources,
      expertReferences,
    });
    this.throwIfAborted(request.signal);
    if (read.overBudget) {
      throw new ScheduleKnowledgeSourcesError(
        'schedule_source_budget_exceeded',
        `本期知识来源超过 ${SCHEDULE_SOURCE_ITEM_MAX} 项，请缩小来源范围。`,
      );
    }
    const conflict = read.failures.find((failure) => failure.kind === 'reference-conflict');
    if (conflict) {
      throw new ScheduleKnowledgeSourcesError(
        'schedule_source_conflict',
        `专家固定参考与当前知识修订身份不一致：${conflict.identity}`,
      );
    }
    if (read.failures.length > 0) {
      const failure = read.failures[0];
      throw new ScheduleKnowledgeSourcesError(
        'schedule_source_missing',
        `已选择的知识来源或修订不可用：${failure?.identity ?? '未知来源'}`,
      );
    }

    const byDocumentId = new Map<string, ScheduleKnowledgeSourceItem>();
    for (const scope of read.scopes) {
      for (const document of scope.documents) {
        const item: ScheduleKnowledgeSourceItem = {
          reference: document.reference,
          purpose: scope.source.purpose,
          origin: originFor(scope.source),
          displayName: document.displayName,
          sourcePath: document.reference.sourcePath,
        };
        this.mergeItem(byDocumentId, item, false);
      }
    }
    for (const expertReference of read.expertReferences) {
      const reference = expertReference.material.reference;
      if (reference.kind !== 'knowledge-revision') continue;
      const item: ScheduleKnowledgeSourceItem = {
        reference,
        purpose: expertReference.material.purpose,
        origin: 'expert-reference',
        displayName: expertReference.document.displayName,
        sourcePath: reference.sourcePath,
      };
      this.mergeItem(byDocumentId, item, true);
    }

    const items = [...byDocumentId.values()].sort((left, right) =>
      referenceOrder(left.reference, right.reference),
    );
    if (items.length > SCHEDULE_SOURCE_ITEM_MAX) {
      throw new ScheduleKnowledgeSourcesError(
        'schedule_source_budget_exceeded',
        `本期知识来源超过 ${SCHEDULE_SOURCE_ITEM_MAX} 项，请缩小来源范围。`,
      );
    }
    return {
      workspaceId: request.workspaceId,
      items,
      sources,
      expertReferences,
    };
  }

  assertUnchanged(
    request: ResolveScheduleKnowledgeSourcesRequest,
    prepared: ScheduleKnowledgeSourceCollection,
  ): void {
    this.throwIfAborted(request.signal);
    const current = this.resolve({
      workspaceId: request.workspaceId,
      sources: prepared.sources,
      expertReferences: prepared.expertReferences,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (collectionFingerprint(current.items) !== collectionFingerprint(prepared.items)) {
      throw new ScheduleKnowledgeSourcesError(
        'schedule_source_conflict',
        '知识文档修订、集合成员或已选范围在本期准备期间发生变化，请重新准备。',
      );
    }
  }

  private mergeItem(
    byDocumentId: Map<string, ScheduleKnowledgeSourceItem>,
    candidate: ScheduleKnowledgeSourceItem,
    isExpertReference: boolean,
  ): void {
    const documentId = candidate.reference.knowledgeDocumentId;
    const existing = byDocumentId.get(documentId);
    if (!existing) {
      byDocumentId.set(documentId, candidate);
      return;
    }
    if (
      existing.reference.knowledgeRevisionId !== candidate.reference.knowledgeRevisionId ||
      existing.reference.contentHash !== candidate.reference.contentHash ||
      !sameKnowledgeReference(existing.reference, candidate.reference)
    ) {
      throw new ScheduleKnowledgeSourcesError(
        'schedule_source_conflict',
        `同一知识文档出现不同修订或内容哈希：${documentId}`,
      );
    }
    if (isExpertReference) byDocumentId.set(documentId, candidate);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ScheduleKnowledgeSourcesError('schedule_cancelled', '本期知识来源准备已取消。');
    }
  }
}
