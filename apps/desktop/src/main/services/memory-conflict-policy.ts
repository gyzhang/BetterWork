import type { MemoryConflictPair, MemoryRecord, MemoryScope } from '@betterwork/agent-protocol';

/**
 * 潜在冲突判定的唯一实现（契约 §5.5）：同一非空 `topicKey`、作用域交集、有效期交集、
 * 不同 `normalizedHash`。召回、简报与管理列表都读这一份规则，
 * 否则「哪两条算冲突」会在三处各说一套，用户看到的待澄清口径也就各不相同。
 * 这里只做识别，不认定真假：裁决一律由用户给出。
 */

/**
 * 作用域交集：两条记录只要可能同时生效就算有交集，只有各自点名了不同的专家或不同的空间才互斥。
 * `user` 不点名空间与专家，因此与所有作用域都有交集。
 */
export const scopesIntersect = (left: MemoryScope, right: MemoryScope): boolean => {
  const expertIdOf = (scope: MemoryScope): string | undefined =>
    'expertId' in scope ? scope.expertId : undefined;
  const workspaceIdOf = (scope: MemoryScope): string | undefined =>
    'workspaceId' in scope ? scope.workspaceId : undefined;
  const leftExpert = expertIdOf(left);
  const rightExpert = expertIdOf(right);
  if (leftExpert !== undefined && rightExpert !== undefined && leftExpert !== rightExpert) {
    return false;
  }
  const leftWorkspace = workspaceIdOf(left);
  const rightWorkspace = workspaceIdOf(right);
  if (
    leftWorkspace !== undefined &&
    rightWorkspace !== undefined &&
    leftWorkspace !== rightWorkspace
  ) {
    return false;
  }
  return true;
};

/** 规范范围完全相同（不是交集）：去重只在同一规范范围内成立。 */
export const scopesMatchExactly = (left: MemoryScope, right: MemoryScope): boolean => {
  switch (left.kind) {
    case 'user':
      return right.kind === 'user';
    case 'expert':
      return right.kind === 'expert' && right.expertId === left.expertId;
    case 'workspace':
      return right.kind === 'workspace' && right.workspaceId === left.workspaceId;
    case 'expert-workspace':
      return (
        right.kind === 'expert-workspace' &&
        right.expertId === left.expertId &&
        right.workspaceId === left.workspaceId
      );
  }
};

export type MemoryConflictCandidate = Pick<
  MemoryRecord,
  'id' | 'revisionId' | 'scope' | 'normalizedHash' | 'topicKey' | 'validFrom' | 'validUntil'
>;

export type MemoryDuplicateCandidate = Pick<
  MemoryRecord,
  'id' | 'scope' | 'normalizedHash' | 'status' | 'candidateDisposition'
>;

/** 有效期交集：先后生效的口径是替代关系，不构成冲突。 */
export const validityIntersects = (
  left: Pick<MemoryRecord, 'validFrom' | 'validUntil'>,
  right: Pick<MemoryRecord, 'validFrom' | 'validUntil'>,
): boolean => {
  const leftStart = left.validFrom ?? 0;
  const leftEnd = left.validUntil ?? Number.MAX_SAFE_INTEGER;
  const rightStart = right.validFrom ?? 0;
  const rightEnd = right.validUntil ?? Number.MAX_SAFE_INTEGER;
  return leftStart < rightEnd && rightStart < leftEnd;
};

export const conflictPairKey = (leftRevisionId: string, rightRevisionId: string): string =>
  leftRevisionId < rightRevisionId
    ? `${leftRevisionId}\u0000${rightRevisionId}`
    : `${rightRevisionId}\u0000${leftRevisionId}`;

export interface PotentialConflictPair<TRecord extends MemoryConflictCandidate = MemoryRecord> {
  readonly left: TRecord;
  readonly right: TRecord;
}

interface TopicMember<TRecord extends MemoryConflictCandidate> {
  readonly record: TRecord;
  readonly group: readonly TRecord[];
  readonly position: number;
}

/** 同议题才枚举；左项仍按原输入顺序，不能按桶输出而改变成对顺序。 */
export const listPotentialConflictPairs = <TRecord extends MemoryConflictCandidate>(
  records: readonly TRecord[],
): PotentialConflictPair<TRecord>[] => {
  const groups = new Map<string, TRecord[]>();
  const members: TopicMember<TRecord>[] = [];
  for (const record of records) {
    if (record === undefined || record.topicKey === undefined) continue;
    let group = groups.get(record.topicKey);
    if (group === undefined) {
      group = [];
      groups.set(record.topicKey, group);
    }
    members.push({ record, group, position: group.length });
    group.push(record);
  }
  const pairs: PotentialConflictPair<TRecord>[] = [];
  for (const { record: left, group, position } of members) {
    for (let next = position + 1; next < group.length; next += 1) {
      const right = group[next];
      if (right === undefined) continue;
      if (
        left.id !== right.id &&
        left.normalizedHash !== right.normalizedHash &&
        scopesIntersect(left.scope, right.scope) &&
        validityIntersects(left, right)
      ) {
        pairs.push({ left, right });
      }
    }
  }
  return pairs;
};

/**
 * 未裁决的潜在冲突对（契约 §5.5，也是 §10 管理提示的计数口径）。
 * 裁决查询由调用方接线：召回批量取当前修订的裁决，简报按精确修订对点查。
 * 输出按精确修订标识规范排序，避免同一对因列表顺序不同而呈现两种方向。
 */
export const unresolvedConflictPairs = (
  records: readonly MemoryConflictCandidate[],
  isDecided: (leftRevisionId: string, rightRevisionId: string) => boolean,
): MemoryConflictPair[] =>
  listPotentialConflictPairs(records)
    .filter((pair) => !isDecided(pair.left.revisionId, pair.right.revisionId))
    .map((pair) => {
      const [leftRevisionId, rightRevisionId]: [string, string] =
        pair.left.revisionId < pair.right.revisionId
          ? [pair.left.revisionId, pair.right.revisionId]
          : [pair.right.revisionId, pair.left.revisionId];
      return { leftRevisionId, rightRevisionId, state: 'unresolved' as const };
    });

/**
 * 与已确认记忆重复的候选（契约 §5.6 的去重口径）：同规范范围＋同 `normalizedHash`。
 * 写入期只抑制候选之间的重复，候选与已确认记忆之间的重复留给用户处理，
 * 因此这里给出它重复的那条已确认记录标识；已拒绝的候选不再待处理。
 */
export const duplicateConfirmedMemoryId = (
  record: MemoryDuplicateCandidate,
  records: readonly MemoryDuplicateCandidate[],
): string | undefined => {
  if (record.status !== 'candidate' || record.candidateDisposition === 'rejected') {
    return undefined;
  }
  const match = records.find(
    (candidate) =>
      candidate.status === 'confirmed' &&
      candidate.id !== record.id &&
      candidate.normalizedHash === record.normalizedHash &&
      scopesMatchExactly(candidate.scope, record.scope),
  );
  return match?.id;
};

/** 调用内按哈希查 confirmed，桶内保留原顺序并复用精确范围判定。 */
export const createConfirmedMemoryLookup = (
  records: readonly MemoryDuplicateCandidate[],
): ((record: MemoryDuplicateCandidate) => string | undefined) => {
  const byHash = new Map<string, MemoryDuplicateCandidate[]>();
  for (const record of records) {
    if (record.status !== 'confirmed') continue;
    const group = byHash.get(record.normalizedHash);
    if (group === undefined) byHash.set(record.normalizedHash, [record]);
    else group.push(record);
  }
  return (record) => duplicateConfirmedMemoryId(record, byHash.get(record.normalizedHash) ?? []);
};
