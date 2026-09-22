import type { DiscussionCheckpoint, MemoryRecord, MemoryScope } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { listPotentialConflictPairs } from './memory-conflict-policy';
import type {
  BriefMemoryRow,
  BriefOpenCheckpoint,
  BriefReader,
  BriefSourceAvailability,
} from './workspace-brief-service';

/**
 * 简报的仓储读取器：把 AppStore 里的既有事实翻译成 `BriefReader` 需要的形状（总稿 §10）。
 *
 * 这里只做读取与判定，不写库、不调用模型、不缓存结果——简报永远当场重算。
 * 「来源是否仍可用」沿用 §6.1 召回的同一口径：verified 来源必须仍能定位到已登记实体；
 * 材料依赖是否仍在不算作源失效，因为 §10 明确允许资料派生内容出现在管理简报中，
 * 只需在条目上标出 `requiresMaterialSelection`（使用时仍需材料，不因此获得模型授权）。
 */

/** 简报的确认区只收本空间的记录：user/expert 记录由个人页负责，不冒充项目事实。 */
const inWorkspaceScope = (
  scope: MemoryScope,
  workspaceId: string,
  expertId: string | undefined,
): boolean => {
  switch (scope.kind) {
    case 'workspace':
      return scope.workspaceId === workspaceId;
    case 'expert-workspace':
      return (
        expertId !== undefined && scope.expertId === expertId && scope.workspaceId === workspaceId
      );
    case 'user':
    case 'expert':
      return false;
  }
};

/** verified 来源的每条引用都必须仍能定位到已登记实体，定位不到即「源失效」。 */
const sourceIsResolvable = (store: AppStore, record: MemoryRecord): boolean => {
  const provenance = record.provenance;
  if (provenance.verification !== 'verified') return true;
  for (const source of provenance.sources) {
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

/** 待复核（legacy）与源失效分别落到各自的可用性，不互相冒充，也不被折叠成「可用」。 */
const availabilityOf = (store: AppStore, record: MemoryRecord): BriefSourceAvailability => {
  if (record.provenance.verification !== 'verified') return 'review-required';
  return sourceIsResolvable(store, record) ? 'available' : 'unavailable';
};

const rowOf = (store: AppStore, record: MemoryRecord): BriefMemoryRow => ({
  memoryId: record.id,
  revisionId: record.revisionId,
  contentHash: record.contentHash,
  content: record.content,
  facet: record.facet,
  scope: record.scope,
  updatedAt: record.updatedAt,
  ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
  ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
  sourceAvailability: availabilityOf(store, record),
  requiresMaterialSelection:
    record.provenance.verification === 'verified' &&
    record.provenance.materialDependencies.length > 0,
});

const checkpointOf = (checkpoint: DiscussionCheckpoint): BriefOpenCheckpoint => ({
  checkpointId: checkpoint.id,
  taskId: checkpoint.taskId,
  summary: checkpoint.summary,
  ...(checkpoint.feedback === undefined ? {} : { feedback: checkpoint.feedback }),
  ...(checkpoint.nextAction === undefined ? {} : { nextAction: checkpoint.nextAction }),
  createdAt: checkpoint.createdAt,
});

/**
 * §5.5 召回口径同样约束简报：潜在冲突的判定规则只在 `memory-conflict-policy.ts` 定义一次，
 * 这里接线精确修订对的裁决查询。未裁决的成对口径整组不进确认区；
 * 已裁决（keep-both / replace）不连坐。简报不能替用户裁决互斥口径。
 */
const blockedByUnresolvedConflict = (
  store: AppStore,
  records: readonly MemoryRecord[],
): Set<string> => {
  const blocked = new Set<string>();
  for (const { left, right } of listPotentialConflictPairs(records)) {
    if (store.memoryOperations.findDecisionForPair(left.revisionId, right.revisionId)) {
      continue;
    }
    blocked.add(left.revisionId);
    blocked.add(right.revisionId);
  }
  return blocked;
};

export const createStoreBriefReader = (store: AppStore): BriefReader => ({
  /**
   * 只取本空间最新修订且已确认的记录；有效期与来源可用性由简报区分，
   * 因此这里不把「过期」当过滤条件，交给 buildWorkspaceBrief 按同一个 now 判定。
   */
  confirmedMemories: (workspaceId, expertId) => {
    const scoped = store.memories
      .list({
        workspaceId,
        ...(expertId === undefined ? {} : { expertId }),
        statuses: ['confirmed'],
        includeCandidates: false,
      })
      .filter((record) => inWorkspaceScope(record.scope, workspaceId, expertId));
    const blocked = blockedByUnresolvedConflict(store, scoped);
    return scoped
      .filter((record) => !blocked.has(record.revisionId))
      .map((record) => rowOf(store, record));
  },

  /**
   * 开放节点只认 status='open'：被后续节点替代（superseded）的讨论不再出现在简报里。
   * Task 枚举沿用最近任务列表（上限 100 个 Task），超出部分属于历史归档而非当前简报口径。
   */
  openCheckpoints: (workspaceId) =>
    store.tasks
      .listRecent(workspaceId)
      .flatMap((task) => store.discussionCheckpoints.listByTask(task.id))
      .filter((checkpoint) => checkpoint.status === 'open')
      .map(checkpointOf),

  /** 可用性沿用参考仓储的同一判定：精确版本行仍在且哈希相符才算 ready。 */
  activeReferences: (workspaceId) =>
    store.workspaceReferences.listActiveWithAvailability(workspaceId).map((item) => ({
      reference: item.reference,
      artifactId: item.artifactId,
      available: item.status === 'ready',
    })),
});
