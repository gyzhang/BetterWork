import type {
  MemoryScope,
  WorkspaceArtifactReference,
  WorkspaceBrief,
  WorkspaceBriefMemoryItem,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
} from '@betterwork/agent-protocol';
import {
  countCodePoints,
  WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT,
  WORKSPACE_BRIEF_SECTION_ITEM_LIMIT,
  workspaceBriefSchema,
} from '@betterwork/agent-protocol';

/**
 * 工作空间简报是既有事实的可重建只读视图（总稿 §10）。
 *
 * 只做查询与排序：不调用模型、不持久化正文副本、不整体注入模型；
 * 开放讨论节点保持「未决」身份，不被写成已确认结论。
 */

export type BriefSourceAvailability = 'available' | 'unavailable' | 'review-required';

export interface BriefMemoryRow {
  readonly memoryId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly content: string;
  readonly facet:
    'goal' | 'constraint' | 'decision' | 'fact' | 'method' | 'preference' | 'experience';
  readonly scope: MemoryScope;
  readonly updatedAt: number;
  readonly validFrom?: number | undefined;
  readonly validUntil?: number | undefined;
  /** 来源是否仍可访问由持有仓储的调用方判定，这里不猜测。 */
  readonly sourceAvailability: BriefSourceAvailability;
  readonly requiresMaterialSelection: boolean;
}

export interface BriefOpenCheckpoint {
  readonly checkpointId: string;
  readonly taskId: string;
  readonly summary: string;
  readonly feedback?: string | undefined;
  readonly nextAction?: string | undefined;
  readonly createdAt: number;
}

export interface BriefReader {
  /** 该空间的最新修订确认记忆；选专家时额外带上对应的 expert-workspace 记录。 */
  confirmedMemories(workspaceId: string, expertId?: string): readonly BriefMemoryRow[];
  openCheckpoints(workspaceId: string): readonly BriefOpenCheckpoint[];
  activeReferences(
    workspaceId: string,
  ): readonly { reference: WorkspaceArtifactReference; artifactId: string; available: boolean }[];
}

const withinValidity = (row: BriefMemoryRow, now: number): boolean =>
  (row.validFrom === undefined || row.validFrom <= now) &&
  (row.validUntil === undefined || row.validUntil > now);

/** 只有来源可用的记录进入确认区；待复核与不可用来源都不混入。 */
const sourceIsUsable = (row: BriefMemoryRow): boolean => row.sourceAvailability === 'available';

const toItem = (row: BriefMemoryRow): WorkspaceBriefMemoryItem => ({
  memoryId: row.memoryId,
  revisionId: row.revisionId,
  contentHash: row.contentHash,
  content: row.content,
  scope: row.scope,
  sourceAvailability: row.sourceAvailability,
  requiresMaterialSelection: row.requiresMaterialSelection,
});

const compareRows = (left: BriefMemoryRow, right: BriefMemoryRow): number =>
  right.updatedAt - left.updatedAt ||
  (left.memoryId < right.memoryId ? -1 : left.memoryId > right.memoryId ? 1 : 0);

const sectionOf = (
  rows: readonly BriefMemoryRow[],
  facets: readonly BriefMemoryRow['facet'][],
): WorkspaceBrief['goals'] => {
  const matching = rows.filter((row) => facets.includes(row.facet)).sort(compareRows);
  return {
    items: matching.slice(0, WORKSPACE_BRIEF_SECTION_ITEM_LIMIT).map(toItem),
    total: matching.length,
    truncated: matching.length > WORKSPACE_BRIEF_SECTION_ITEM_LIMIT,
  };
};

const issueSectionOf = (
  checkpoints: readonly BriefOpenCheckpoint[],
): WorkspaceBrief['openIssues'] => {
  const ordered = [...checkpoints].sort(
    (left, right) =>
      right.createdAt - left.createdAt ||
      (left.checkpointId < right.checkpointId
        ? -1
        : left.checkpointId > right.checkpointId
          ? 1
          : 0),
  );
  const items: WorkspaceBriefOpenIssue[] = ordered
    .slice(0, WORKSPACE_BRIEF_SECTION_ITEM_LIMIT)
    .map((checkpoint) => ({
      checkpointId: checkpoint.checkpointId,
      taskId: checkpoint.taskId,
      summary: checkpoint.summary,
      ...(checkpoint.feedback === undefined ? {} : { feedback: checkpoint.feedback }),
      ...(checkpoint.nextAction === undefined ? {} : { nextAction: checkpoint.nextAction }),
      createdAt: checkpoint.createdAt,
    }));
  return { items, total: ordered.length, truncated: ordered.length > items.length };
};

const referenceSectionOf = (
  references: readonly {
    reference: WorkspaceArtifactReference;
    artifactId: string;
    available: boolean;
  }[],
): WorkspaceBrief['referenceVersions'] => {
  const ordered = [...references].sort(
    (left, right) =>
      right.reference.selectedAt - left.reference.selectedAt ||
      (left.reference.id < right.reference.id
        ? -1
        : left.reference.id > right.reference.id
          ? 1
          : 0),
  );
  const items: WorkspaceReferenceListItem[] = ordered
    .slice(0, WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT)
    .map((entry) => ({
      reference: entry.reference,
      artifactId: entry.artifactId,
      status: entry.available ? 'ready' : 'unavailable',
    }));
  return { items, total: ordered.length, truncated: ordered.length > items.length };
};

/**
 * 空间视角只取 workspace 记录，选了专家再叠加相应 expert-workspace；
 * user 偏好与 expert 通用方法都是个人/方法性内容，不冒充项目事实。
 */
const inBriefScope = (row: BriefMemoryRow, expertId?: string): boolean =>
  row.scope.kind === 'workspace' ||
  (row.scope.kind === 'expert-workspace' && expertId !== undefined);

export const buildWorkspaceBrief = (
  workspaceId: string,
  reader: BriefReader,
  options: { expertId?: string; now: number },
): WorkspaceBrief => {
  const rows = reader
    .confirmedMemories(workspaceId, options.expertId)
    .filter((row) => withinValidity(row, options.now))
    .filter(sourceIsUsable)
    .filter((row) => inBriefScope(row, options.expertId));

  return workspaceBriefSchema.parse({
    workspaceId,
    ...(options.expertId ? { expertId: options.expertId } : {}),
    generatedAt: options.now,
    goals: sectionOf(rows, ['goal']),
    constraints: sectionOf(rows, ['constraint']),
    decisions: sectionOf(rows, ['decision', 'fact']),
    methods: sectionOf(rows, ['method']),
    openIssues: issueSectionOf(reader.openCheckpoints(workspaceId)),
    referenceVersions: referenceSectionOf(reader.activeReferences(workspaceId)),
  });
};

/** 简报不入库；这里只提供「不整体注入模型」边界的尺寸观察。 */
export const briefTextSize = (brief: WorkspaceBrief): number =>
  countCodePoints(
    [
      ...brief.goals.items,
      ...brief.constraints.items,
      ...brief.decisions.items,
      ...brief.methods.items,
    ]
      .map((item) => item.content)
      .join('\n'),
  );
