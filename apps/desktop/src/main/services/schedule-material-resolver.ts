import {
  LIST_PAGE_MAX_LIMIT,
  type MaterialReference,
  materialReferenceSchema,
  sameKnowledgeReference,
  SCHEDULE_SOURCE_ITEM_MAX,
  type ScheduleSourceItem,
  type ScheduleSourceOrigin,
  type TaskMaterialSelection,
  taskMaterialSelectionSchema,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

export interface ScheduleEffectiveMaterial {
  reference: MaterialReference;
  purpose: ScheduleSourceItem['purpose'];
  source: 'schedule' | 'supplement' | 'schedule-and-supplement';
  scheduleOrigin?: ScheduleSourceOrigin;
  displayName?: string;
  selection?: TaskMaterialSelection;
}

export interface ResolveScheduleMaterialsRequest {
  taskId: string;
  workspaceId: string;
  scheduleSourceSnapshotId?: string;
  materials: readonly TaskMaterialSelection[];
}

export class ScheduleMaterialResolutionError extends Error {
  constructor(
    readonly code:
      | 'task_not_found'
      | 'material_reference_duplicate'
      | 'schedule_source_missing'
      | 'schedule_source_conflict'
      | 'schedule_source_budget_exceeded',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleMaterialResolutionError';
  }
}

const identityKey = (reference: MaterialReference): string => {
  if (reference.kind === 'knowledge-revision') {
    return `knowledge-document:${reference.knowledgeDocumentId}`;
  }
  if (reference.kind === 'artifact-version') {
    return `artifact:${reference.artifactId}`;
  }
  return `workspace-input:${reference.snapshotId}`;
};

const sameReference = (left: MaterialReference, right: MaterialReference): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'knowledge-revision' && right.kind === 'knowledge-revision') {
    return sameKnowledgeReference(left, right);
  }
  if (left.kind === 'artifact-version' && right.kind === 'artifact-version') {
    return (
      left.artifactId === right.artifactId &&
      left.artifactVersionId === right.artifactVersionId &&
      left.contentHash === right.contentHash &&
      left.originWorkspaceId === right.originWorkspaceId
    );
  }
  return (
    left.kind === 'workspace-input-snapshot' &&
    right.kind === 'workspace-input-snapshot' &&
    left.snapshotId === right.snapshotId &&
    left.workspaceId === right.workspaceId &&
    left.contentHash === right.contentHash &&
    left.format === right.format &&
    left.fileKey === right.fileKey
  );
};

const parseSupplement = (materials: readonly TaskMaterialSelection[]): TaskMaterialSelection[] =>
  taskMaterialSelectionSchema
    .array()
    .max(50)
    .parse([...materials]);

/** Merge an immutable Schedule manifest with explicit Task additions without changing the 50-item Task limit. */
export const mergeScheduleMaterials = (
  sourceItems: readonly ScheduleSourceItem[],
  supplements: readonly TaskMaterialSelection[],
): ScheduleEffectiveMaterial[] => {
  const parsedSupplements = parseSupplement(supplements);
  const byIdentity = new Map<
    string,
    { material: ScheduleEffectiveMaterial; selectedAlready: boolean }
  >();

  for (const sourceItem of sourceItems) {
    const reference = materialReferenceSchema.parse(sourceItem.reference);
    const key = identityKey(reference);
    const existing = byIdentity.get(key);
    if (existing) {
      throw new ScheduleMaterialResolutionError(
        'schedule_source_conflict',
        `定时来源快照包含重复材料身份：${key}`,
      );
    }
    byIdentity.set(key, {
      material: {
        reference,
        purpose: sourceItem.purpose,
        source: 'schedule',
        scheduleOrigin: sourceItem.origin,
        displayName: sourceItem.displayName,
      },
      selectedAlready: false,
    });
  }

  for (const selection of parsedSupplements) {
    const reference = materialReferenceSchema.parse(selection.reference);
    const key = identityKey(reference);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, {
        material: {
          reference,
          purpose: selection.purpose,
          source: 'supplement',
          selection,
        },
        selectedAlready: true,
      });
      continue;
    }
    if (!sameReference(existing.material.reference, reference)) {
      throw new ScheduleMaterialResolutionError(
        'schedule_source_conflict',
        `定时来源与显式补充指向同一资料的不同修订或哈希：${key}`,
      );
    }
    if (existing.selectedAlready) {
      throw new ScheduleMaterialResolutionError(
        'material_reference_duplicate',
        `显式补充材料重复：${key}`,
      );
    }
    byIdentity.set(key, {
      material: {
        ...existing.material,
        purpose: selection.purpose,
        source: 'schedule-and-supplement',
        selection,
      },
      selectedAlready: true,
    });
  }

  if (byIdentity.size > SCHEDULE_SOURCE_ITEM_MAX) {
    throw new ScheduleMaterialResolutionError(
      'schedule_source_budget_exceeded',
      `本期有效材料超过 ${SCHEDULE_SOURCE_ITEM_MAX} 项，请缩小范围。`,
    );
  }
  return [...byIdentity.values()].map(({ material }) => material);
};

export class ScheduleMaterialResolver {
  constructor(private readonly store: AppStore) {}

  resolve(request: ResolveScheduleMaterialsRequest): ScheduleEffectiveMaterial[] {
    const taskWorkspaceId = this.store.tasks.getWorkspaceId(request.taskId);
    if (!taskWorkspaceId) {
      throw new ScheduleMaterialResolutionError('task_not_found', '任务不存在。');
    }
    if (taskWorkspaceId !== request.workspaceId) {
      throw new ScheduleMaterialResolutionError(
        'schedule_source_conflict',
        'Task 与当前 Workspace 不匹配。',
      );
    }
    const supplements = parseSupplement(request.materials);
    if (request.scheduleSourceSnapshotId === undefined) {
      return mergeScheduleMaterials([], supplements);
    }

    const snapshot = this.store.scheduleSources.assertReadyForTask(
      request.scheduleSourceSnapshotId,
      request.taskId,
      request.workspaceId,
    );
    const sourceItems: ScheduleSourceItem[] = [];
    let cursor: ReturnType<typeof this.store.scheduleSources.listItems>['nextCursor'];
    do {
      const page = this.store.scheduleSources.listItems({
        occurrenceId: snapshot.occurrenceId,
        ...(cursor ? { cursor } : {}),
        limit: LIST_PAGE_MAX_LIMIT,
      });
      sourceItems.push(...page.items);
      if (sourceItems.length > SCHEDULE_SOURCE_ITEM_MAX) {
        throw new ScheduleMaterialResolutionError(
          'schedule_source_budget_exceeded',
          `本期固定来源超过 ${SCHEDULE_SOURCE_ITEM_MAX} 项。`,
        );
      }
      cursor = page.nextCursor;
    } while (cursor);
    return mergeScheduleMaterials(sourceItems, supplements);
  }
}
