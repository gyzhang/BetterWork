import type { MemoryScope } from '@betterwork/agent-protocol';
import {
  MEMORY_REPLAY_CODE_POINT_BUDGET,
  MEMORY_REPLAY_PAIR_LIMIT,
} from '@betterwork/agent-protocol';

/**
 * 安全历史重放（总稿 §6.3）。
 *
 * 历史轮次只有在其「直接 + 传递」依赖当前仍然成立时才可重放；依赖事实缺失的旧记录
 * 一律不推断为安全。从最近一轮向前取连续安全后缀，遇到首个不安全轮次即停止，
 * 绝不跨过它拼接更早的对话。
 */

export const HISTORY_LIMITS = {
  maxPairs: MEMORY_REPLAY_PAIR_LIMIT,
  maxCodePoints: MEMORY_REPLAY_CODE_POINT_BUDGET,
} as const;

export type ReplayReasonCode =
  | 'memory-revised'
  | 'memory-excluded'
  | 'memory-inactive'
  | 'source-unavailable'
  | 'material-removed-or-replaced'
  | 'legacy-provenance-unknown'
  | 'history-budget';

export interface MemoryRevisionRef {
  readonly memoryId: string;
  readonly revisionId: string;
  readonly contentHash: string;
}

export interface PriorRunRecord {
  readonly runId: string;
  /** 无法确认最终回答时该字段缺省，整轮不重放。 */
  readonly finalEventId?: string | undefined;
  readonly prompt: string;
  readonly answer: string;
  readonly promptHash: string;
  /** 本轮实际注入的记忆精确修订。 */
  readonly directMemoryRevisions: readonly MemoryRevisionRef[];
  /** 经上一轮重放继承而来的记忆修订。 */
  readonly inheritedMemoryRevisions: readonly MemoryRevisionRef[];
  /** 本轮已选 + 实际读取的材料精确引用键。 */
  readonly materialKeys: readonly string[];
  readonly inheritedMaterialKeys: readonly string[];
  /** 旧记录缺少依赖事实时不可推断安全。 */
  readonly dependencyFactsComplete: boolean;
  /** 记录当时的 scope，用于识别后续缩范围。 */
  readonly memoryScopes?: Readonly<Record<string, MemoryScope['kind']>>;
}

export interface SafetyContext {
  readonly now: number;
  /** 仍然有效且未被替代的记忆修订；键为 revisionId。 */
  readonly liveMemoryRevisions: ReadonlyMap<string, LiveMemoryRevision>;
  readonly excludedMemoryIds: ReadonlySet<string>;
  readonly allowedMaterialKeys: ReadonlySet<string>;
  readonly availableSourceKeys?: ReadonlySet<string>;
  readonly unavailableSourceKeys?: ReadonlySet<string>;
}

export interface LiveMemoryRevision {
  readonly memoryId: string;
  readonly contentHash: string;
  readonly status: 'confirmed' | 'superseded' | 'expired' | 'deleted' | 'candidate';
  readonly validFrom?: number;
  readonly validUntil?: number;
  /** 该记忆身份当前最新的修订号；小于它即视为已被改写。 */
  readonly latestRevisionOfIdentity: number;
  readonly revision: number;
  readonly scopeKind: MemoryScope['kind'];
  readonly recordedScopeKind?: MemoryScope['kind'];
}

export interface ReplayRejection {
  readonly unsafe: true;
  readonly reason: ReplayReasonCode;
}

/** 依赖判定一律使用直接 + 传递并集。 */
const union = <T>(left: readonly T[], right: readonly T[]): T[] => [
  ...new Set([...left, ...right]),
];

export const auditRunDependencies = (
  record: PriorRunRecord,
  context: SafetyContext,
): ReplayReasonCode | undefined => {
  if (record.finalEventId === undefined || record.answer.length === 0) {
    return 'legacy-provenance-unknown';
  }
  if (!record.dependencyFactsComplete) return 'legacy-provenance-unknown';

  for (const reference of union(record.directMemoryRevisions, record.inheritedMemoryRevisions)) {
    const live = context.liveMemoryRevisions.get(reference.revisionId);
    if (context.excludedMemoryIds.has(reference.memoryId)) return 'memory-excluded';
    if (live === undefined) {
      return context.excludedMemoryIds.has(reference.memoryId)
        ? 'memory-excluded'
        : 'memory-revised';
    }
    if (live.contentHash !== reference.contentHash) return 'memory-revised';
    if (live.status !== 'confirmed') return 'memory-inactive';
    if (
      (live.validFrom !== undefined && live.validFrom > context.now) ||
      (live.validUntil !== undefined && live.validUntil <= context.now)
    ) {
      return 'memory-inactive';
    }
    if (live.latestRevisionOfIdentity !== live.revision) return 'memory-revised';
    // 缩范围一定来自一次追加修订，因此按「已改写」而不是「已失效」解释。
    if (live.recordedScopeKind !== undefined && live.recordedScopeKind !== live.scopeKind) {
      return 'memory-revised';
    }
  }

  for (const key of union(record.materialKeys, record.inheritedMaterialKeys)) {
    if (!context.allowedMaterialKeys.has(key)) return 'material-removed-or-replaced';
  }
  if (context.unavailableSourceKeys) {
    for (const key of context.unavailableSourceKeys) {
      if (record.materialKeys.includes(key) || record.inheritedMaterialKeys.includes(key)) {
        return 'source-unavailable';
      }
    }
  }
  return undefined;
};

export interface ReplayedTurn {
  readonly runId: string;
  readonly finalEventId: string;
  readonly promptHash: string;
  readonly memoryRevisions: readonly MemoryRevisionRef[];
  readonly materialKeys: readonly string[];
  readonly codePoints: number;
}

export interface ReplayPlan {
  readonly turns: readonly ReplayedTurn[];
  readonly skippedReason: ReplayReasonCode | undefined;
  readonly stoppedEarly: boolean;
}

const pairCodePoints = (record: PriorRunRecord): number =>
  [...record.prompt].length + [...record.answer].length;

/**
 * 从最近历史向前取连续安全后缀：预算容不下完整一对就停止，
 * 纯增加材料不会无故截断，相关记忆本次未命中或落选也不使历史失效。
 */
export const planSafeReplay = (
  /** 必须已按 createdAt 升序，且已过滤为同 Task、completed、早于当前 Run 的运行。 */
  candidateHistory: readonly PriorRunRecord[],
  context: SafetyContext,
): ReplayPlan => {
  const selected: ReplayedTurn[] = [];
  let usedCodePoints = 0;
  let stoppedEarly = false;
  let skippedReason: ReplayReasonCode | undefined;

  for (let index = candidateHistory.length - 1; index >= 0; index -= 1) {
    const record = candidateHistory[index];
    if (record === undefined) continue;

    if (selected.length >= HISTORY_LIMITS.maxPairs) {
      stoppedEarly = true;
      skippedReason ??= 'history-budget';
      break;
    }
    const rejection = auditRunDependencies(record, context);
    if (rejection !== undefined) {
      stoppedEarly = true;
      skippedReason ??= rejection;
      break;
    }
    const cost = pairCodePoints(record);
    if (usedCodePoints + cost > HISTORY_LIMITS.maxCodePoints) {
      stoppedEarly = true;
      skippedReason ??= 'history-budget';
      break;
    }
    const finalEventId = record.finalEventId;
    if (finalEventId === undefined) {
      stoppedEarly = true;
      skippedReason ??= 'legacy-provenance-unknown';
      break;
    }
    usedCodePoints += cost;
    selected.unshift({
      runId: record.runId,
      finalEventId,
      promptHash: record.promptHash,
      memoryRevisions: union(record.directMemoryRevisions, record.inheritedMemoryRevisions),
      materialKeys: union(record.materialKeys, record.inheritedMaterialKeys),
      codePoints: cost,
    });
  }

  return { turns: selected, skippedReason, stoppedEarly };
};
