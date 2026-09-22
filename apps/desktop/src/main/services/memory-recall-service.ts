import { createHash } from 'node:crypto';

import type {
  AgentRuntimeEvent,
  GetRunMemoryContextRequest,
  MaterialReference,
  MemoryConflictDecisionRecord,
  MemoryDecisionSummary,
  MemoryDependency,
  MemoryError,
  MemoryPreviewData,
  MemoryProvenance,
  MemoryQueryContext,
  MemoryRead,
  MemoryRecallExclusion,
  MemoryRecallExclusionReason,
  MemoryRecord,
  MemoryReplayEntry,
  MemoryRunContextData,
  MemoryScope,
  MemorySelectedMemory,
  MemorySelectionReason,
  MemoryViewItem,
  MemoryWarning,
  PreviewMemoryRequest,
  Result,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import {
  countCodePoints,
  getRunMemoryContextRequestSchema,
  memoryErrorSchema,
  memoryPreviewDataSchema,
  memoryQueryContextSchema,
  memoryRecallPolicyV1,
  memoryRunContextDataSchema,
  memorySelectedMemorySchema,
  memoryViewItemSchema,
  previewMemoryRequestSchema,
  stableStringifyJson,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import {
  deriveEffectiveStatus,
  materialReferenceKey,
  MemoryConflictError,
  MemoryScopeMismatchError,
  MemoryTerminalError,
  MemoryValidationError,
} from '../persistence';
import { memoryContentHash } from './memory-content-policy';
import { promptHashOf } from './memory-provenance';
import {
  applyRecallBudget,
  assembleRecallQuery,
  type BudgetSelection,
  type PreferencePoolItem,
  type RankedRecall,
  rankRecallItems,
  RECALL_BUDGET,
  type RecallGroup,
  type RecallItem,
  type RecallReason,
  recallRecordText,
  scoreRecallRecord,
  type SelectedMemory,
} from './memory-retrieval';
import {
  auditRunDependencies,
  HISTORY_LIMITS,
  type LiveMemoryRevision,
  type MemoryRevisionRef,
  planSafeReplay,
  type PriorRunRecord,
  type ReplayReasonCode,
  type SafetyContext,
} from './run-history-policy';

/**
 * WM04/WM05：memory-recall-v1 确定性召回与安全历史重放的唯一入口。
 *
 * 契约歧义的本地裁定（都收在 memory-contracts.md 现有形状内，不新增协议结构）：
 *
 * 1. `taskContextRevisionId` 在协议里是非空字符串，而 §6.3 允许「真正没有上下文的
 *    任务」由 Main 生成明确 general＋空材料上下文。旧通用入口因此使用
 *    `GENERAL_TASK_CONTEXT_REVISION_ID` 作为占位标识：它只声明「本次没有
 *    TaskContext」，材料集合恒为空，因此不会被当成某个可读取范围。
 * 2. §6.1 的「材料依赖可用」需要可判定事实。应用库没有跨库知识修订可用性接口，故按
 *    最贴近契约的口径实现：记忆声明的每个材料依赖必须出现在本次已选材料的精确引用键
 *    集合中，缺失即 `dependency-unavailable`。这与 §6.3 的 `allowedMaterialKeys`
 *    同源，保证不会注入「依赖材料未被授权」的记忆。
 * 3. §9.2 要求 run-context 返回精确 MemoryViewItem，而记忆正文可能在 Run 之后被改写，
 *    因此这里读的是快照引用的*精确修订*（getRevision），不是该身份的最新修订。
 * 4. 排除账本里的 `inactive`/`scope` 计数必须看见未入选的记录，因此本服务额外读一次
 *    「全部最新修订」只做计数；计数只含身份，绝不含正文（§8.2）。
 *
 * 本文件不触网、不读 Markdown 投影：SQLite 是唯一读取源。
 */

/** 旧通用入口的显式占位上下文标识；永远不对应 task_context_revisions 行。 */
export const GENERAL_TASK_CONTEXT_REVISION_ID = 'general-empty-context';

/** 没有 TaskContext 时的检索用标题占位；协议要求 taskTitle 非空。 */
export const GENERAL_TASK_TITLE = '通用任务';

/** §8.2：每个排除原因最多携带的身份数量。 */
export const MEMORY_DECISION_IDENTITY_DISPLAY_LIMIT = 50;

const EMPTY_QUERY_PLACEHOLDER = '空提问';

const EXCLUSION_ORDER: readonly MemoryRecallExclusionReason[] = [
  'inactive',
  'scope',
  'task-excluded',
  'source-unavailable',
  'source-review-required',
  'dependency-unavailable',
  'conflict-unresolved',
  'not-relevant',
  'budget',
];

const MEMORY_BLOCK_HEADER =
  '以下是本次任务可参考的长期记忆，来自用户管理的记忆记录，仅作为工作背景；如与本次任务材料或用户最新指示冲突，以后者为准。';

const CONFLICT_NOTE_PREFIX = '并列记忆的适用条件：';

interface MemoryIdentityRef {
  readonly memoryId: string;
  readonly revisionId: string;
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** 查询指纹：稳定序列化后取 SHA-256，同一输入必得同一哈希（§6.4）。 */
export const memoryQueryHash = (context: MemoryQueryContext): string =>
  sha256Hex(stableStringifyJson(context));

/** 授权指纹：只由范围与已选材料精确引用构成，不含记忆正文。 */
export const memoryAuthorizationHash = (input: {
  workspaceId: string;
  expertId?: string;
  taskId: string;
  taskContextRevisionId: string;
  materialKeys: readonly string[];
}): string =>
  sha256Hex(
    stableStringifyJson({
      workspaceId: input.workspaceId,
      expertId: input.expertId ?? null,
      taskId: input.taskId,
      taskContextRevisionId: input.taskContextRevisionId,
      materialKeys: [...new Set(input.materialKeys)].sort(),
    }),
  );

const okResult = <TData>(data: TData, warnings: readonly MemoryWarning[] = []): Result<TData> => ({
  ok: true,
  data,
  warnings: [...warnings],
});

const failResult = (
  code: MemoryError['code'],
  message: string,
  currentRevision?: number,
): Result<never> => ({
  ok: false,
  error: memoryErrorSchema.parse({
    code,
    message,
    retryable: code === 'STORAGE_ERROR' || code === 'MODEL_REQUEST_FAILED',
    ...(currentRevision === undefined ? {} : { currentRevision }),
  }),
});

const toFailure = (error: unknown): Result<never> => {
  if (error instanceof MemoryConflictError) {
    return failResult('REVISION_CONFLICT', error.message);
  }
  if (error instanceof MemoryTerminalError) {
    return failResult('TERMINAL_MEMORY', error.message);
  }
  if (error instanceof MemoryScopeMismatchError) {
    return failResult('SCOPE_MISMATCH', error.message);
  }
  if (error instanceof MemoryValidationError) {
    return failResult('SOURCE_REVIEW_REQUIRED', error.message);
  }
  if (error instanceof Error) {
    return failResult('INTERNAL_ERROR', `记忆召回失败：${error.message}`.slice(0, 1_000));
  }
  return failResult('INTERNAL_ERROR', '记忆召回失败：未知原因');
};

const identityOf = (record: { id: string; revisionId: string }): MemoryIdentityRef => ({
  memoryId: record.id,
  revisionId: record.revisionId,
});

/** 排除账本：每因一份计数＋最多 50 个身份，绝不复制被排除正文（§8.2）。 */
class ExclusionLedger {
  private readonly buckets = new Map<MemoryRecallExclusionReason, MemoryIdentityRef[]>();

  add(reason: MemoryRecallExclusionReason, identity: MemoryIdentityRef): void {
    const current = this.buckets.get(reason);
    if (current) {
      current.push(identity);
      return;
    }
    this.buckets.set(reason, [identity]);
  }

  has(reason: MemoryRecallExclusionReason): boolean {
    return (this.buckets.get(reason)?.length ?? 0) > 0;
  }

  toSummary(): MemoryRecallExclusion[] {
    const entries: MemoryRecallExclusion[] = [];
    for (const reason of EXCLUSION_ORDER) {
      const identities = this.buckets.get(reason);
      if (identities === undefined || identities.length === 0) continue;
      entries.push({
        reason,
        count: identities.length,
        identities: identities.slice(0, MEMORY_DECISION_IDENTITY_DISPLAY_LIMIT),
      });
    }
    return entries;
  }
}

const scopeAppliesToQuery = (scope: MemoryScope, query: MemoryQueryContext): boolean => {
  switch (scope.kind) {
    case 'user':
      return true;
    case 'workspace':
      return scope.workspaceId === query.workspaceId;
    case 'expert':
      return query.expertId !== undefined && scope.expertId === query.expertId;
    case 'expert-workspace':
      return (
        query.expertId !== undefined &&
        scope.expertId === query.expertId &&
        scope.workspaceId === query.workspaceId
      );
  }
};

const recallItemOf = (record: MemoryRecord): RecallItem => ({
  id: record.id,
  revisionId: record.revisionId,
  contentHash: record.contentHash,
  content: record.content,
  kind: record.kind,
  scope: record.scope,
  updatedAt: record.updatedAt,
  ...(record.topicKey === undefined ? {} : { topicKey: record.topicKey }),
});

const poolItemOf = (record: MemoryRecord): PreferencePoolItem => ({
  id: record.id,
  revisionId: record.revisionId,
  contentHash: record.contentHash,
  content: record.content,
});

/** §6.2 通用偏好小池的唯一判据：verified＋user-instruction＋user 范围＋preference 面。 */
const isPreferencePoolCandidate = (record: MemoryRecord): boolean =>
  record.provenance.verification === 'verified' &&
  record.provenance.authority === 'user-instruction' &&
  record.scope.kind === 'user' &&
  record.facet === 'preference';

type VerifiedProvenance = Extract<MemoryProvenance, { verification: 'verified' }>;

const verifiedProvenanceOf = (record: MemoryRecord): VerifiedProvenance | undefined =>
  record.provenance.verification === 'verified' ? record.provenance : undefined;

const overlapsValidity = (left: MemoryRecord, right: MemoryRecord): boolean => {
  const leftStart = left.validFrom ?? 0;
  const rightStart = right.validFrom ?? 0;
  if (left.validUntil !== undefined && left.validUntil <= rightStart) return false;
  if (right.validUntil !== undefined && right.validUntil <= leftStart) return false;
  return true;
};

const pairKey = (left: string, right: string): string =>
  left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;

/** verified 来源是否仍能定位到已登记实体；定位不到即 source-unavailable（§6.1）。 */
const sourceAvailable = (store: AppStore, record: MemoryRecord): boolean => {
  if (record.provenance.verification !== 'verified') return true;
  for (const source of record.provenance.sources) {
    switch (source.kind) {
      case 'manual':
        if (store.memoryOperations.get(source.operationId) === undefined) return false;
        break;
      case 'run-user':
        if (store.runs.get(source.runId) === undefined) return false;
        break;
      case 'run-assistant':
        if (!store.runs.listEvents(source.runId).some((event) => event.id === source.eventId)) {
          return false;
        }
        break;
      case 'checkpoint':
        if (store.discussionCheckpoints.get(source.checkpointId) === undefined) return false;
        break;
      case 'artifact-version':
        if (store.artifacts.getVersionDetail(source.artifactVersionId) === undefined) return false;
        break;
    }
  }
  return true;
};

const materialEntityAvailable = (store: AppStore, reference: MaterialReference): boolean => {
  switch (reference.kind) {
    case 'knowledge-revision':
      return reference.sourcePath.trim().length > 0;
    case 'artifact-version':
      return store.artifacts.getVersionDetail(reference.artifactVersionId) !== undefined;
    case 'workspace-input-snapshot':
      return store.inputSnapshots.get(reference.snapshotId) !== undefined;
  }
};

interface DependencyProbe {
  readonly store: AppStore;
  readonly allowedMaterialKeys: ReadonlySet<string>;
  readonly visiting: Set<string>;
  readonly resolved: Map<string, boolean>;
}

/** 记忆依赖沿精确修订递归展开；缺事实、被替代、已失效都算不可用（含环保护）。 */
const memoryDependencyAvailable = (
  probe: DependencyProbe,
  dependency: MemoryDependency,
): boolean => {
  if (probe.visiting.has(dependency.revisionId)) return false;
  const cached = probe.resolved.get(dependency.revisionId);
  if (cached !== undefined) return cached;
  probe.visiting.add(dependency.revisionId);
  const current = probe.store.memories.get(dependency.memoryId);
  const revision = probe.store.memories.getRevision(dependency.revisionId);
  let available =
    current !== undefined &&
    revision !== undefined &&
    revision.id === dependency.memoryId &&
    current.revisionId === dependency.revisionId &&
    revision.contentHash === dependency.contentHash &&
    revision.status === 'confirmed';
  if (available && revision !== undefined && revision.provenance.verification === 'verified') {
    for (const material of revision.provenance.materialDependencies) {
      if (
        !probe.allowedMaterialKeys.has(referenceKeyOf(material)) ||
        !materialEntityAvailable(probe.store, material)
      ) {
        available = false;
        break;
      }
    }
    if (available) {
      for (const nested of revision.provenance.memoryDependencies) {
        if (!memoryDependencyAvailable(probe, nested)) {
          available = false;
          break;
        }
      }
    }
  }
  probe.visiting.delete(dependency.revisionId);
  probe.resolved.set(dependency.revisionId, available);
  return available;
};

const dependencyAvailable = (
  store: AppStore,
  record: MemoryRecord,
  allowedMaterialKeys: ReadonlySet<string>,
  probe: DependencyProbe,
): boolean => {
  if (record.provenance.verification !== 'verified') return true;
  for (const material of record.provenance.materialDependencies) {
    if (
      !allowedMaterialKeys.has(referenceKeyOf(material)) ||
      !materialEntityAvailable(store, material)
    ) {
      return false;
    }
  }
  for (const dependency of record.provenance.memoryDependencies) {
    if (!memoryDependencyAvailable(probe, dependency)) return false;
  }
  return true;
};

/**
 * 精确引用键：与仓储层 materialReferenceKey 同源。它只收整条选择记录，
 * 而记忆依赖里只有裸引用，因此用中性用途补齐——键只由引用分支决定，补齐不影响结果。
 */
const referenceKeyOf = (reference: MaterialReference): string =>
  materialReferenceKey({ reference, purpose: 'background', addedFrom: 'user-input' });

export const materialReferenceKeyOf = referenceKeyOf;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const clampTitle = (value: string): string => {
  const trimmed = value.trim();
  if (countCodePoints(trimmed) <= RECALL_BUDGET.materialTitleMaxCodePoints) return trimmed;
  return [...trimmed].slice(0, RECALL_BUDGET.materialTitleMaxCodePoints).join('');
};

/** 材料标题只取已登记实体的稳定显示名；缺实体时退回精确引用，绝不读取正文。 */
const materialTitleOf = (store: AppStore, reference: MaterialReference): string => {
  switch (reference.kind) {
    case 'knowledge-revision':
      return reference.sourcePath;
    case 'workspace-input-snapshot': {
      const snapshot = store.inputSnapshots.get(reference.snapshotId);
      return snapshot?.sourcePath ?? reference.fileKey;
    }
    case 'artifact-version': {
      const artifact = store.artifacts.getDetail(reference.artifactId);
      return artifact?.title ?? reference.artifactId;
    }
  }
};

/** TaskRepository 没有按 id 读取标题的方法（仓储缺口）；这里用最近任务列表定位。 */
export const taskTitleOf = (store: AppStore, taskId: string, workspaceId: string): string =>
  store.tasks.listRecent(workspaceId).find((summary) => summary.id === taskId)?.title ?? '';

export interface MemoryQueryContextInput {
  workspaceId: string;
  expertId?: string;
  taskId: string;
  taskContextRevisionId: string;
  evaluatedAt: number;
  prompt: string;
  taskTitle: string;
  materials: readonly TaskMaterialSelection[];
  excludedMemoryIds: readonly string[];
}

/**
 * 由 Main 构造查询上下文（§6.1）：材料按精确引用键排序去重，标题各截 120。
 * 已选材料标题是检索输入的一部分，不读取材料正文。
 */
export const buildMemoryQueryContext = (
  store: AppStore,
  input: MemoryQueryContextInput,
): MemoryQueryContext => {
  const titles: { reference: MaterialReference; title: string }[] = [];
  const seen = new Set<string>();
  const ordered = [...input.materials].sort((left, right) =>
    compareText(referenceKeyOf(left.reference), referenceKeyOf(right.reference)),
  );
  for (const selection of ordered) {
    const key = referenceKeyOf(selection.reference);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = clampTitle(materialTitleOf(store, selection.reference));
    if (title.length === 0) continue;
    titles.push({ reference: selection.reference, title });
    if (titles.length >= RECALL_BUDGET.materialTitleCount * 5) break;
  }
  const prompt = input.prompt.trim().length > 0 ? input.prompt.trim() : EMPTY_QUERY_PLACEHOLDER;
  return memoryQueryContextSchema.parse({
    workspaceId: input.workspaceId,
    ...(input.expertId === undefined ? {} : { expertId: input.expertId }),
    taskId: input.taskId,
    taskContextRevisionId: input.taskContextRevisionId,
    evaluatedAt: input.evaluatedAt,
    prompt,
    taskTitle: clampTitle(input.taskTitle) || GENERAL_TASK_TITLE,
    materialTitles: titles,
    excludedMemoryIds: [...new Set(input.excludedMemoryIds)].slice(0, 100),
  });
};

interface ConflictComponent {
  readonly ids: readonly string[];
  readonly note?: string;
}

interface ConflictMap {
  /** 存在未裁决（或 replace 后仍共存）冲突的连通分量：整组不召回。 */
  readonly blocked: Set<string>;
  /** 全部成对 keep-both 的分量：整组并列注入。 */
  readonly groups: Map<string, ConflictComponent>;
}

const unionRoot = (parent: Map<string, string>, id: string): string => {
  let current = id;
  for (;;) {
    const next = parent.get(current);
    if (next === undefined || next === current) return current;
    current = next;
  }
};

const unionPair = (parent: Map<string, string>, left: string, right: string): void => {
  const rootLeft = unionRoot(parent, left);
  const rootRight = unionRoot(parent, right);
  if (rootLeft === rootRight) return;
  parent.set(rootRight, rootLeft);
};

const bucketize = (
  parent: Map<string, string>,
  skip: ReadonlySet<string>,
): Map<string, string[]> => {
  const buckets = new Map<string, string[]>();
  for (const id of parent.keys()) {
    if (skip.has(id)) continue;
    const root = unionRoot(parent, id);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(id);
    else buckets.set(root, [id]);
  }
  return buckets;
};

interface ConflictPair {
  readonly left: MemoryRecord;
  readonly right: MemoryRecord;
  readonly decision: MemoryConflictDecisionRecord | undefined;
}

/**
 * 潜在冲突判定（§5.5、§6.1）：同 topicKey、有效期重叠、normalizedHash 不同。
 * 未裁决的连通分量整组排除；全部 keep-both 的分量整组并列，适用条件写进包装文本。
 */
const buildConflictMap = (store: AppStore, records: readonly MemoryRecord[]): ConflictMap => {
  const blocked = new Set<string>();
  const groups = new Map<string, ConflictComponent>();
  const byTopic = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const topic = record.topicKey;
    if (topic === undefined) continue;
    const bucket = byTopic.get(topic);
    if (bucket) bucket.push(record);
    else byTopic.set(topic, [record]);
  }
  const decisionByPair = new Map<string, MemoryConflictDecisionRecord>();
  for (const decision of store.memoryOperations.listDecisionsForRevisionIds(
    records.map((record) => record.revisionId),
    { currentOnly: true },
  )) {
    decisionByPair.set(pairKey(decision.leftRevisionId, decision.rightRevisionId), decision);
  }

  for (const topicRecords of byTopic.values()) {
    if (topicRecords.length < 2) continue;
    const pairs: ConflictPair[] = [];
    for (let index = 0; index < topicRecords.length; index += 1) {
      for (let next = index + 1; next < topicRecords.length; next += 1) {
        const left = topicRecords[index];
        const right = topicRecords[next];
        if (left === undefined || right === undefined) continue;
        if (left.normalizedHash === right.normalizedHash) continue;
        if (!overlapsValidity(left, right)) continue;
        pairs.push({
          left,
          right,
          decision: decisionByPair.get(pairKey(left.revisionId, right.revisionId)),
        });
      }
    }
    if (pairs.length === 0) continue;

    const memberIds = new Set<string>(pairs.flatMap((pair) => [pair.left.id, pair.right.id]));
    const blockedParent = new Map<string, string>([...memberIds].map((id) => [id, id]));
    const keepParent = new Map<string, string>([...memberIds].map((id) => [id, id]));
    const keepNotes = new Map<string, string>();
    for (const pair of pairs) {
      const keepBoth = pair.decision?.decision === 'keep-both' ? pair.decision : undefined;
      if (keepBoth === undefined) {
        unionPair(blockedParent, pair.left.id, pair.right.id);
        continue;
      }
      unionPair(keepParent, pair.left.id, pair.right.id);
      if (keepBoth.applicabilityNote !== undefined) {
        keepNotes.set(pairKey(pair.left.id, pair.right.id), keepBoth.applicabilityNote);
      }
    }
    for (const ids of bucketize(blockedParent, new Set()).values()) {
      if (ids.length < 2) continue;
      for (const id of ids) blocked.add(id);
    }
    for (const ids of bucketize(keepParent, blocked).values()) {
      if (ids.length < 2) continue;
      let note: string | undefined;
      for (let index = 0; index < ids.length; index += 1) {
        for (let next = index + 1; next < ids.length; next += 1) {
          const found = keepNotes.get(pairKey(ids[index] ?? '', ids[next] ?? ''));
          if (found !== undefined) note ??= found;
        }
      }
      for (const id of ids) {
        groups.set(id, { ids, ...(note === undefined ? {} : { note }) });
      }
    }
  }
  return { blocked, groups };
};

interface BlockRendering {
  readonly text: string;
  readonly contentCodePoints: number;
  readonly wrapperCodePoints: number;
  readonly blockCodePoints: number;
}

interface RenderableItem {
  readonly id: string;
  readonly content: string;
  readonly reason: RecallReason;
}

const renderMemoryBlock = (
  items: readonly RenderableItem[],
  records: ReadonlyMap<string, MemoryRecord>,
  components: ReadonlyMap<string, ConflictComponent>,
): BlockRendering => {
  if (items.length === 0) {
    return { text: '', contentCodePoints: 0, wrapperCodePoints: 0, blockCodePoints: 0 };
  }
  const lines = [MEMORY_BLOCK_HEADER, ''];
  const noted = new Set<string>();
  let contentCodePoints = 0;
  for (const [index, item] of items.entries()) {
    const record = records.get(item.id);
    const facet = record?.facet ?? 'fact';
    const scopeKind = record?.scope.kind ?? 'user';
    contentCodePoints += countCodePoints(item.content);
    lines.push(`${index + 1}. [${facet}/${scopeKind}] ${item.content}`);
    if (item.reason !== 'conflict-group') continue;
    const component = components.get(item.id);
    const note = component?.note;
    const marker = component?.ids.join(',') ?? item.id;
    if (note === undefined || noted.has(marker)) continue;
    noted.add(marker);
    lines.push(`   ${CONFLICT_NOTE_PREFIX}${note}`);
  }
  const text = lines.join('\n');
  const blockCodePoints = countCodePoints(text);
  return {
    text,
    contentCodePoints,
    wrapperCodePoints: Math.max(0, blockCodePoints - contentCodePoints),
    blockCodePoints,
  };
};

const selectionReasonOf = (reason: RecallReason): MemorySelectionReason => {
  switch (reason) {
    case 'preference-pool':
      return 'general-preference';
    case 'conflict-group':
      return 'conflict-pair';
    case 'relevance':
      return 'task-relevant';
  }
};

const rankedGroups = (
  ranked: readonly RankedRecall[],
  components: ReadonlyMap<string, ConflictComponent>,
): RecallGroup[] => {
  const positionById = new Map<string, number>();
  for (const [index, item] of ranked.entries()) positionById.set(item.id, index);
  const emitted = new Set<string>();
  const groups: RecallGroup[] = [];
  for (const item of ranked) {
    if (emitted.has(item.id)) continue;
    const component = components.get(item.id);
    const members =
      component === undefined
        ? []
        : component.ids
            .map((id) => positionById.get(id))
            .filter((position): position is number => position !== undefined)
            .sort((left, right) => left - right)
            .map((position) => ranked[position])
            .filter((entry): entry is RankedRecall => entry !== undefined);
    if (members.length < 2) {
      emitted.add(item.id);
      groups.push({ items: [item], reason: 'relevance' });
      continue;
    }
    for (const member of members) emitted.add(member.id);
    groups.push({ items: members, reason: 'conflict-group' });
  }
  return groups;
};

/** 组原子的单元划分：连续 conflict-group 条目是一个整体，其余每条各自成单元。 */
const unitsOf = (items: readonly SelectedMemory[]): SelectedMemory[][] => {
  const units: SelectedMemory[][] = [];
  let index = 0;
  while (index < items.length) {
    const first = items[index];
    if (first === undefined) break;
    if (first.reason !== 'conflict-group') {
      units.push([first]);
      index += 1;
      continue;
    }
    const unit: SelectedMemory[] = [];
    let next = index;
    for (;;) {
      const candidate = items[next];
      if (candidate === undefined || candidate.reason !== 'conflict-group') break;
      unit.push(candidate);
      next += 1;
    }
    units.push(unit);
    index = next;
  }
  return units;
};

/**
 * 块级预算（整体 ≤8,000、包装 ≤2,000）在条目级预算之后再校一次；
 * keep-both 组要么整组带上、要么整组不要，绝不出现「只带一条」。
 */
const trimToBlockBudget = (
  selection: BudgetSelection,
  records: ReadonlyMap<string, MemoryRecord>,
  components: ReadonlyMap<string, ConflictComponent>,
): SelectedMemory[] => {
  const kept: SelectedMemory[] = [];
  for (const unit of unitsOf(selection.items)) {
    const trial = kept.concat(
      unit.map((item, offset) => ({ ...item, order: kept.length + offset })),
    );
    const rendered = renderMemoryBlock(trial, records, components);
    if (
      rendered.blockCodePoints > RECALL_BUDGET.maxMemoryBlockCodePoints ||
      rendered.wrapperCodePoints > RECALL_BUDGET.maxWrapperCodePoints
    ) {
      continue;
    }
    kept.push(...unit.map((item, offset) => ({ ...item, order: kept.length + offset })));
  }
  return kept.map((item, position) => ({ ...item, order: position }));
};

export interface MemoryRecallOutcome {
  queryContext: MemoryQueryContext;
  queryHash: string;
  selectedItems: MemorySelectedMemory[];
  selectedRecords: MemoryRecord[];
  decisionSummary: MemoryDecisionSummary;
  memoryBlock: string;
  conflictReviewRequired: boolean;
  reviewRequiredRelevantCount: number;
}

export interface RecallOptions {
  /** 材料依赖可用性判定集合；缺省即用查询上下文里的已选材料。 */
  readonly allowedMaterialKeys?: ReadonlySet<string>;
}

const emptyBudgetUsage = (): MemoryDecisionSummary['budget'] => ({
  totalItems: 0,
  preferenceItems: 0,
  contentCodePoints: 0,
  wrapperCodePoints: 0,
  blockCodePoints: 0,
});

/**
 * 完整确定性召回：§6.1 过滤顺序、§6.2 预算、排除账本与记忆块文本一次产出。
 * preview 与真实 Run 共用它，因此「预览所见」与「Run 所得」必然一致。
 */
export const recallMemoriesForQuery = (
  store: AppStore,
  query: MemoryQueryContext,
  options: RecallOptions = {},
): MemoryRecallOutcome => {
  const ledger = new ExclusionLedger();
  const queryParts = assembleRecallQuery({
    prompt: query.prompt,
    taskTitle: query.taskTitle,
    materialTitles: query.materialTitles.map((entry) => entry.title),
  });
  const eligible = store.memories.listRecallCandidates({
    workspaceId: query.workspaceId,
    ...(query.expertId === undefined ? {} : { expertId: query.expertId }),
    evaluatedAt: query.evaluatedAt,
    excludedMemoryIds: query.excludedMemoryIds,
  });
  const eligibleById = new Map(eligible.map((record) => [record.id, record]));

  // 未入选的记录只在这里补计数：一条记录只能有一个排除理由，Task 排除不能被说成失效。
  const excludedIds = new Set(query.excludedMemoryIds);
  const allLatest = store.memories.list({});
  for (const record of allLatest) {
    if (eligibleById.has(record.id) || excludedIds.has(record.id)) continue;
    ledger.add(scopeAppliesToQuery(record.scope, query) ? 'inactive' : 'scope', identityOf(record));
  }
  for (const excludedId of excludedIds) {
    const record = eligibleById.get(excludedId) ?? allLatest.find((item) => item.id === excludedId);
    if (record) ledger.add('task-excluded', identityOf(record));
  }

  const relevantIds = new Set<string>();
  for (const record of eligible) {
    if (scoreRecallRecord(queryParts.tokens, recallRecordText(record)) !== undefined) {
      relevantIds.add(record.id);
    }
  }

  const allowedMaterialKeys =
    options.allowedMaterialKeys ??
    new Set(query.materialTitles.map((entry) => referenceKeyOf(entry.reference)));
  const probe: DependencyProbe = {
    store,
    allowedMaterialKeys,
    visiting: new Set<string>(),
    resolved: new Map<string, boolean>(),
  };

  const passed: MemoryRecord[] = [];
  const reviewRequiredIds = new Set<string>();
  for (const record of eligible) {
    if (record.provenance.verification !== 'verified') {
      ledger.add('source-review-required', identityOf(record));
      reviewRequiredIds.add(record.id);
      continue;
    }
    if (!sourceAvailable(store, record)) {
      ledger.add('source-unavailable', identityOf(record));
      continue;
    }
    if (!dependencyAvailable(store, record, allowedMaterialKeys, probe)) {
      ledger.add('dependency-unavailable', identityOf(record));
      continue;
    }
    passed.push(record);
  }

  const conflicts = buildConflictMap(store, passed);
  const survivors: MemoryRecord[] = [];
  for (const record of passed) {
    if (conflicts.blocked.has(record.id)) {
      ledger.add('conflict-unresolved', identityOf(record));
      continue;
    }
    survivors.push(record);
  }

  const pool: PreferencePoolItem[] = [];
  const relevanceRecords: MemoryRecord[] = [];
  for (const record of survivors) {
    if (isPreferencePoolCandidate(record)) {
      pool.push(poolItemOf(record));
      continue;
    }
    relevanceRecords.push(record);
  }

  const ranked = rankRecallItems(queryParts.tokens, relevanceRecords.map(recallItemOf));
  const scoreById = new Map(ranked.map((item) => [item.id, item.score]));
  for (const record of relevanceRecords) {
    if (scoreById.has(record.id)) continue;
    ledger.add('not-relevant', identityOf(record));
  }

  const groups = rankedGroups(ranked, conflicts.groups);
  const selection = applyRecallBudget(groups, pool);
  const recordById = new Map(survivors.map((record) => [record.id, record]));
  const trimmed = trimToBlockBudget(selection, recordById, conflicts.groups);
  const finalIds = new Set(trimmed.map((item) => item.id));
  for (const candidate of [
    ...pool.map((item) => ({ id: item.id, revisionId: item.revisionId })),
    ...groups.flatMap((group) =>
      group.items.map((item) => ({ id: item.id, revisionId: item.revisionId })),
    ),
  ]) {
    if (finalIds.has(candidate.id)) continue;
    ledger.add('budget', { memoryId: candidate.id, revisionId: candidate.revisionId });
  }

  const selectedRecords: MemoryRecord[] = [];
  for (const item of trimmed) {
    const record = recordById.get(item.id);
    if (record) selectedRecords.push(record);
  }
  const rendered = renderMemoryBlock(trimmed, recordById, conflicts.groups);
  const decisionSummary: MemoryDecisionSummary = {
    budget: {
      ...emptyBudgetUsage(),
      totalItems: trimmed.length,
      preferenceItems: trimmed.filter((item) => item.reason === 'preference-pool').length,
      contentCodePoints: rendered.contentCodePoints,
      wrapperCodePoints: rendered.wrapperCodePoints,
      blockCodePoints: rendered.blockCodePoints,
    },
    exclusions: ledger.toSummary(),
    queryTruncated: queryParts.truncated,
    conflictReviewRequired: ledger.has('conflict-unresolved'),
  };

  return {
    queryContext: query,
    queryHash: memoryQueryHash(query),
    selectedItems: trimmed.map((item, position) =>
      memorySelectedMemorySchema.parse({
        memoryId: item.id,
        revisionId: item.revisionId,
        contentHash: item.contentHash,
        order: position + 1,
        score: scoreById.get(item.id) ?? 0,
        reason: selectionReasonOf(item.reason),
      }),
    ),
    selectedRecords,
    decisionSummary,
    memoryBlock: rendered.text,
    conflictReviewRequired: decisionSummary.conflictReviewRequired,
    reviewRequiredRelevantCount: [...reviewRequiredIds].filter((id) => relevantIds.has(id)).length,
  };
};

export interface ReplayTurnMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface RunReplayOutcome {
  replay: MemoryReplayEntry[];
  messages: ReplayTurnMessage[];
  skippedReason: ReplayReasonCode | undefined;
  stoppedEarly: boolean;
  usedCodePoints: number;
  inheritedMaterialReferences: MaterialReference[];
  inheritedMemoryDependencies: MemoryDependency[];
}

export interface RunReplayInput {
  taskId: string;
  currentRunId: string;
  evaluatedAt: number;
  excludedMemoryIds: readonly string[];
  allowedMaterialKeys: readonly string[];
}

interface FinalAnswer {
  readonly eventId: string;
  readonly content: string;
}

/** 最终回答＝按 sequence 最后一条 message.completed（§6.3）；工具事件本就不属于它。 */
const finalAnswerOf = (events: readonly AgentRuntimeEvent[]): FinalAnswer | undefined => {
  let answer: FinalAnswer | undefined;
  for (const event of events) {
    if (event.type !== 'message.completed') continue;
    if (event.content.length === 0) continue;
    answer = { eventId: event.id, content: event.content };
  }
  return answer;
};

interface PriorRunFacts {
  readonly record: PriorRunRecord;
  readonly answer: FinalAnswer | undefined;
  readonly materialReferences: MaterialReference[];
  readonly memoryDependencies: MemoryDependency[];
}

const collectPriorRunFacts = (store: AppStore, input: RunReplayInput): PriorRunFacts[] => {
  const currentRun = store.runs.get(input.currentRunId);
  const facts: PriorRunFacts[] = [];
  for (const run of store.runs.listByTask(input.taskId)) {
    if (run.id === input.currentRunId) continue;
    if (run.status !== 'completed') continue;
    if (currentRun !== undefined && run.createdAt >= currentRun.createdAt) continue;
    if (run.completedAt !== undefined && run.completedAt > input.evaluatedAt) continue;

    const answer = finalAnswerOf(store.runs.listEvents(run.id));
    const context = store.runMemoryContexts.get(run.id);
    const snapshot = store.runContextSnapshots.get(run.id);
    const selectedRefs: MemoryRevisionRef[] = [];
    const memoryDependencies: MemoryDependency[] = [];
    const memoryScopes: Record<string, MemoryScope['kind']> = {};
    for (const item of context?.selectedItems ?? []) {
      const ref: MemoryRevisionRef = {
        memoryId: item.memoryId,
        revisionId: item.revisionId,
        contentHash: item.contentHash,
      };
      selectedRefs.push(ref);
      memoryDependencies.push(ref);
      const revision = store.memories.getRevision(item.revisionId);
      if (revision !== undefined) memoryScopes[item.memoryId] = revision.scope.kind;
    }
    const inheritedMemories = (context?.memoryDependencyUnion ?? []).filter(
      (dependency) => !selectedRefs.some((ref) => ref.revisionId === dependency.revisionId),
    );
    for (const dependency of inheritedMemories) memoryDependencies.push(dependency);

    const ownMaterialKeys = new Set<string>();
    const materialReferences: MaterialReference[] = [];
    for (const selection of snapshot?.materials ?? []) {
      const key = referenceKeyOf(selection.reference);
      if (ownMaterialKeys.has(key)) continue;
      ownMaterialKeys.add(key);
      materialReferences.push(selection.reference);
    }
    for (const read of store.materialReads.listByRun(run.id)) {
      const key = referenceKeyOf(read.material);
      if (ownMaterialKeys.has(key)) continue;
      ownMaterialKeys.add(key);
      materialReferences.push(read.material);
    }
    const inheritedMaterialKeys: string[] = [];
    for (const reference of context?.materialDependencyUnion ?? []) {
      const key = referenceKeyOf(reference);
      materialReferences.push(reference);
      if (ownMaterialKeys.has(key)) continue;
      inheritedMaterialKeys.push(key);
    }

    facts.push({
      record: {
        runId: run.id,
        ...(answer === undefined ? {} : { finalEventId: answer.eventId }),
        prompt: run.prompt,
        answer: answer?.content ?? '',
        promptHash: promptHashOf(run.prompt),
        directMemoryRevisions: selectedRefs,
        inheritedMemoryRevisions: inheritedMemories,
        materialKeys: [...ownMaterialKeys],
        inheritedMaterialKeys: [...new Set(inheritedMaterialKeys)],
        dependencyFactsComplete: context !== undefined && snapshot !== undefined,
        memoryScopes,
      },
      answer,
      materialReferences,
      memoryDependencies,
    });
  }
  return facts;
};

const liveRevisionOf = (store: AppStore, revisionId: string): LiveMemoryRevision | undefined => {
  const revision = store.memories.getRevision(revisionId);
  if (revision === undefined) return undefined;
  const current = store.memories.get(revision.id);
  return {
    memoryId: revision.id,
    contentHash: revision.contentHash,
    status: revision.status,
    ...(revision.validFrom === undefined ? {} : { validFrom: revision.validFrom }),
    ...(revision.validUntil === undefined ? {} : { validUntil: revision.validUntil }),
    latestRevisionOfIdentity: current?.revision ?? revision.revision,
    revision: revision.revision,
    scopeKind: revision.scope.kind,
  };
};

/**
 * §6.3 安全重放：候选只取同 Task、completed、早于当前 Run 且 completedAt 不晚于准备
 * 时点的运行；依赖按「直接＋传递」并集判定，取连续安全后缀。
 */
export const planRunHistoryReplay = (store: AppStore, input: RunReplayInput): RunReplayOutcome => {
  const allowedMaterialKeys = new Set(input.allowedMaterialKeys);
  const facts = collectPriorRunFacts(store, input);

  const liveMemoryRevisions = new Map<string, LiveMemoryRevision>();
  for (const fact of facts) {
    const refs = [...fact.record.directMemoryRevisions, ...fact.record.inheritedMemoryRevisions];
    for (const ref of refs) {
      if (liveMemoryRevisions.has(ref.revisionId)) continue;
      const live = liveRevisionOf(store, ref.revisionId);
      if (live === undefined) continue;
      const recorded = fact.record.memoryScopes?.[ref.memoryId];
      liveMemoryRevisions.set(
        ref.revisionId,
        recorded === undefined ? live : { ...live, recordedScopeKind: recorded },
      );
    }
  }
  const unavailableSourceKeys = new Set<string>();
  for (const fact of facts) {
    for (const reference of fact.materialReferences) {
      if (materialEntityAvailable(store, reference)) continue;
      unavailableSourceKeys.add(referenceKeyOf(reference));
    }
  }
  const context: SafetyContext = {
    now: input.evaluatedAt,
    liveMemoryRevisions,
    excludedMemoryIds: new Set(input.excludedMemoryIds),
    allowedMaterialKeys,
    unavailableSourceKeys,
  };
  const plan = planSafeReplay(
    facts.map((fact) => fact.record),
    context,
  );

  const replay: MemoryReplayEntry[] = [];
  const messages: ReplayTurnMessage[] = [];
  const inheritedMaterialReferences: MaterialReference[] = [];
  const inheritedMemoryDependencies: MemoryDependency[] = [];
  const seenMemoryIds = new Set<string>();
  const seenMaterialKeys = new Set<string>();
  let usedCodePoints = 0;
  for (const turn of plan.turns) {
    const fact = facts.find((entry) => entry.record.runId === turn.runId);
    if (fact === undefined || fact.answer === undefined) continue;
    usedCodePoints += turn.codePoints;
    messages.push({ role: 'user', content: fact.record.prompt });
    messages.push({ role: 'assistant', content: fact.answer.content });
    replay.push({
      replayed: true,
      runId: turn.runId,
      finalEventId: turn.finalEventId,
      promptHash: turn.promptHash,
      contentCodePoints: turn.codePoints,
    });
    for (const dependency of fact.memoryDependencies) {
      if (seenMemoryIds.has(dependency.revisionId)) continue;
      seenMemoryIds.add(dependency.revisionId);
      inheritedMemoryDependencies.push(dependency);
    }
    for (const reference of fact.materialReferences) {
      const key = referenceKeyOf(reference);
      if (seenMaterialKeys.has(key)) continue;
      seenMaterialKeys.add(key);
      inheritedMaterialReferences.push(reference);
    }
  }
  if (plan.stoppedEarly) {
    const boundary = nearestUnreplayedFact(facts, plan.turns, context);
    if (boundary !== undefined) {
      replay.push({
        replayed: false,
        runId: boundary.record.runId,
        reason: auditRunDependencies(boundary.record, context) ?? 'history-budget',
      });
    }
  }
  return {
    replay,
    messages,
    skippedReason: plan.skippedReason,
    stoppedEarly: plan.stoppedEarly,
    usedCodePoints: Math.min(usedCodePoints, HISTORY_LIMITS.maxCodePoints),
    inheritedMaterialReferences,
    inheritedMemoryDependencies,
  };
};

/** 边界轮＝最近的未重放候选；它自己的依赖判定结果就是本次后缀被截断的原因。 */
const nearestUnreplayedFact = (
  facts: readonly PriorRunFacts[],
  turns: readonly { runId: string }[],
  context: SafetyContext,
): PriorRunFacts | undefined => {
  const replayed = new Set(turns.map((turn) => turn.runId));
  const unreplayed = facts.filter((fact) => !replayed.has(fact.record.runId));
  for (let index = unreplayed.length - 1; index >= 0; index -= 1) {
    const fact = unreplayed[index];
    if (fact !== undefined && auditRunDependencies(fact.record, context) !== undefined) {
      return fact;
    }
  }
  return unreplayed.at(-1);
};

/** MemoryViewItem：与治理视图同口径，但读的是快照引用的精确修订。 */
export const toMemoryViewItem = (
  store: AppStore,
  record: MemoryRecord,
  evaluatedAt?: number,
): MemoryViewItem => {
  const at = evaluatedAt ?? Date.now();
  const dependencies = verifiedProvenanceOf(record);
  return memoryViewItemSchema.parse({
    ...record,
    effectiveStatus: deriveEffectiveStatus(record, at),
    sourceAvailability:
      dependencies === undefined
        ? 'review-required'
        : sourceAvailable(store, record)
          ? 'available'
          : 'unavailable',
    requiresMaterialSelection:
      dependencies !== undefined && dependencies.materialDependencies.length > 0,
    conflicts: store.memoryOperations.listConflictPairsForRevisionIds([record.revisionId]),
  });
};

/** 存储一致性守卫：正文与 contentHash 不符就是库损坏，不能继续注入。 */
const assertContentHash = (record: MemoryRecord): MemoryRecord => {
  if (memoryContentHash(record.content) !== record.contentHash) {
    throw new Error('记忆正文与 contentHash 不一致，存储已损坏。');
  }
  return record;
};

export interface RunMemoryPreparation {
  queryContext: MemoryQueryContext;
  queryHash: string;
  authorizationHash: string;
  selectedItems: MemorySelectedMemory[];
  selectedRecords: MemoryRecord[];
  memoryBlock: string;
  decisionSummary: MemoryDecisionSummary;
  replay: MemoryReplayEntry[];
  historyMessages: ReplayTurnMessage[];
  materialDependencyUnion: MaterialReference[];
  memoryDependencyUnion: MemoryDependency[];
  warnings: MemoryWarning[];
}

export interface RunMemoryPreparationInput {
  workspaceId: string;
  expertId?: string;
  taskId: string;
  runId: string;
  taskContextRevisionId: string;
  evaluatedAt: number;
  prompt: string;
  materials: readonly TaskMaterialSelection[];
  excludedMemoryIds: readonly string[];
  taskTitle: string;
}

/**
 * Run 装配请求前的唯一入口：召回＋重放＋审计指纹一次算清。
 * 调用方必须在同步事务里把它写进 run_memory_contexts；任何抛出都不发包。
 */
export const prepareRunMemoryDecision = (
  store: AppStore,
  input: RunMemoryPreparationInput,
): RunMemoryPreparation => {
  const queryContext = buildMemoryQueryContext(store, {
    workspaceId: input.workspaceId,
    ...(input.expertId === undefined ? {} : { expertId: input.expertId }),
    taskId: input.taskId,
    taskContextRevisionId: input.taskContextRevisionId,
    evaluatedAt: input.evaluatedAt,
    prompt: input.prompt,
    taskTitle: input.taskTitle,
    materials: input.materials,
    excludedMemoryIds: input.excludedMemoryIds,
  });
  const recall = recallMemoriesForQuery(store, queryContext);
  const replay = planRunHistoryReplay(store, {
    taskId: input.taskId,
    currentRunId: input.runId,
    evaluatedAt: input.evaluatedAt,
    excludedMemoryIds: input.excludedMemoryIds,
    allowedMaterialKeys: queryContext.materialTitles.map((entry) =>
      referenceKeyOf(entry.reference),
    ),
  });

  const materialDependencyUnion: MaterialReference[] = [];
  const seenMaterialKeys = new Set<string>();
  const pushMaterial = (reference: MaterialReference): void => {
    const key = referenceKeyOf(reference);
    if (seenMaterialKeys.has(key)) return;
    seenMaterialKeys.add(key);
    materialDependencyUnion.push(reference);
  };
  for (const selection of input.materials) pushMaterial(selection.reference);
  for (const record of recall.selectedRecords) {
    if (record.provenance.verification !== 'verified') continue;
    for (const dependency of record.provenance.materialDependencies) pushMaterial(dependency);
  }
  for (const reference of replay.inheritedMaterialReferences) pushMaterial(reference);

  const memoryDependencyUnion: MemoryDependency[] = [];
  const seenMemoryIds = new Set<string>();
  const pushMemory = (dependency: MemoryDependency): void => {
    if (seenMemoryIds.has(dependency.revisionId)) return;
    seenMemoryIds.add(dependency.revisionId);
    memoryDependencyUnion.push(dependency);
  };
  for (const item of recall.selectedItems) {
    pushMemory({
      memoryId: item.memoryId,
      revisionId: item.revisionId,
      contentHash: item.contentHash,
    });
  }
  for (const record of recall.selectedRecords) {
    if (record.provenance.verification !== 'verified') continue;
    for (const dependency of record.provenance.memoryDependencies) pushMemory(dependency);
  }
  for (const dependency of replay.inheritedMemoryDependencies) pushMemory(dependency);

  const warnings: MemoryWarning[] = [];
  if (recall.reviewRequiredRelevantCount > 0) {
    warnings.push({
      code: 'SOURCE_NEEDS_REVIEW',
      message: '有与本次任务相关的记忆来源待复核，本次未注入；请在记忆面板补齐来源或改为自主口径。',
    });
  }
  if (replay.replay.some((entry) => entry.replayed === false)) {
    warnings.push({
      code: 'HISTORY_TRUNCATED',
      message: '历史对话在某个轮次前停止重放，更早的轮次本次不可见。',
    });
  }

  return {
    queryContext,
    queryHash: recall.queryHash,
    authorizationHash: memoryAuthorizationHash({
      workspaceId: input.workspaceId,
      ...(input.expertId === undefined ? {} : { expertId: input.expertId }),
      taskId: input.taskId,
      taskContextRevisionId: input.taskContextRevisionId,
      materialKeys: materialDependencyUnion.map((reference) => referenceKeyOf(reference)),
    }),
    selectedItems: recall.selectedItems,
    selectedRecords: recall.selectedRecords,
    memoryBlock: recall.memoryBlock,
    decisionSummary: recall.decisionSummary,
    replay: replay.replay,
    historyMessages: replay.messages,
    materialDependencyUnion,
    memoryDependencyUnion,
    warnings,
  };
};

const resolveExpertIdOfContext = (
  executor: { kind: 'general' } | { kind: 'expert'; expertId: string; expertRevisionId: string },
): string | undefined => (executor.kind === 'expert' ? executor.expertId : undefined);

/**
 * WM04/WM05 的公开面：只有 memory:preview 与 memory:run-context 两个查询。
 * 两者都是纯读；preview 绝不写 run_memory_reads 或 run_memory_contexts（§9.2）。
 */
export class MemoryRecallService {
  private readonly store: AppStore;

  constructor(deps: { store: AppStore }) {
    this.store = deps.store;
  }

  preview(input: PreviewMemoryRequest): Result<MemoryPreviewData> {
    try {
      const request = previewMemoryRequestSchema.parse(input);
      const workspaceId = this.store.tasks.getWorkspaceId(request.taskId);
      if (workspaceId === undefined) {
        return failResult('NOT_FOUND', `任务不存在：${request.taskId}`);
      }
      const context = this.store.taskContexts.get(request.taskContextRevisionId, request.taskId);
      if (context === undefined) {
        return failResult(
          'CONTEXT_REVISION_REQUIRED',
          '任务上下文不存在或不属于当前 Task，请先保存任务上下文。',
        );
      }
      if (context.revision !== request.expectedTaskContextRevision) {
        return failResult(
          'REVISION_CONFLICT',
          `任务上下文已更新：期望 ${request.expectedTaskContextRevision}，当前为 ${context.revision}，请重新加载。`,
          context.revision,
        );
      }
      const expertId = resolveExpertIdOfContext(context.executor);
      const query = buildMemoryQueryContext(this.store, {
        workspaceId,
        ...(expertId === undefined ? {} : { expertId }),
        taskId: request.taskId,
        taskContextRevisionId: context.id,
        evaluatedAt: Date.now(),
        prompt: request.prompt,
        taskTitle: taskTitleOf(this.store, request.taskId, workspaceId),
        materials: context.materials ?? [],
        excludedMemoryIds: context.excludedMemoryIds ?? [],
      });
      const outcome = recallMemoriesForQuery(this.store, query);
      const data = memoryPreviewDataSchema.parse({
        evaluatedAt: query.evaluatedAt,
        policySnapshot: memoryRecallPolicyV1,
        selectedItems: outcome.selectedItems,
        decisionSummary: outcome.decisionSummary,
      });
      const warnings: MemoryWarning[] = [];
      if (outcome.reviewRequiredRelevantCount > 0) {
        warnings.push({
          code: 'SOURCE_NEEDS_REVIEW',
          message:
            '有与本次任务相关的记忆来源待复核，本次未注入；请在记忆面板补齐来源或改为自主口径。',
        });
      }
      return okResult(data, warnings);
    } catch (error) {
      return toFailure(error);
    }
  }

  runContext(input: GetRunMemoryContextRequest): Result<MemoryRunContextData> {
    try {
      const request = getRunMemoryContextRequestSchema.parse(input);
      if (this.store.runs.get(request.runId) === undefined) {
        return failResult('NOT_FOUND', `运行不存在：${request.runId}`);
      }
      const context = this.store.runMemoryContexts.get(request.runId);
      const phase = this.store.runMemoryContexts.phaseOf(request.runId);
      const reads: MemoryRead[] = this.store.memories.listMemoryReads(request.runId);
      const revisionIds: string[] = [];
      const seen = new Set<string>();
      for (const item of context?.selectedItems ?? []) {
        if (seen.has(item.revisionId)) continue;
        seen.add(item.revisionId);
        revisionIds.push(item.revisionId);
      }
      for (const read of reads) {
        if (seen.has(read.memoryRevisionId)) continue;
        seen.add(read.memoryRevisionId);
        revisionIds.push(read.memoryRevisionId);
      }
      const memories: MemoryViewItem[] = [];
      for (const revisionId of revisionIds) {
        const record = this.store.memories.getRevision(revisionId);
        if (record === undefined) continue;
        memories.push(
          toMemoryViewItem(this.store, assertContentHash(record), context?.evaluatedAt),
        );
      }
      const data = memoryRunContextDataSchema.parse({
        runId: request.runId,
        phase,
        ...(context === undefined ? {} : { context }),
        memories,
        reads,
      });
      const warnings: MemoryWarning[] = [];
      if (context !== undefined && context.replay.some((entry) => entry.replayed === false)) {
        warnings.push({
          code: 'HISTORY_TRUNCATED',
          message: '本次运行只重放了部分历史轮次，原因见 replay 摘要。',
        });
      }
      if (
        context === undefined ||
        reads.some((read) => read.provenanceState === 'legacy_unknown')
      ) {
        warnings.push({
          code: 'SOURCE_NEEDS_REVIEW',
          message:
            '该运行的记忆来源事实不完整（改造前的旧运行），展示内容不补造请求哈希与发送时间。',
        });
      }
      return okResult(data, warnings);
    } catch (error) {
      return toFailure(error);
    }
  }
}
