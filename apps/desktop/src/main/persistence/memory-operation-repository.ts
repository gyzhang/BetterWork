import { randomUUID } from 'node:crypto';

import {
  type MemoryConflictDecision,
  type MemoryConflictDecisionRecord,
  memoryConflictDecisionRecordSchema,
  type MemoryConflictPair,
  type MemoryGovernanceAction,
  memoryOperationIdSchema,
  type MemoryOperationKind,
  type MemoryOperationRecord,
  memoryOperationRecordSchema,
  type MemoryWriteEffect,
  sha256HexSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { MemoryConflictError } from './memory-repository';

/** §5.6：同一 operationId 携带不同请求内容——两次不同写入撞了一个幂等身份。 */
export class MemoryIdempotencyConflictError extends Error {
  constructor(message = '该操作已以不同内容提交过，请重新发起。') {
    super(message);
    this.name = 'MemoryIdempotencyConflictError';
  }
}

export class MemoryOperationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryOperationValidationError';
  }
}

/** commit 表示本次可以写入；replay 表示原样返回第一次的效果，不得再写第二遍。 */
export type MemoryOperationClaim =
  | { readonly kind: 'commit' }
  | { readonly kind: 'replay'; readonly operation: MemoryOperationRecord };

export interface MemoryOperationInput {
  operationId: string;
  operationKind: MemoryOperationKind;
  /** §5.1：由调用方用 stableStringifyJson＋SHA-256 计算，全仓只有一种请求哈希口径。 */
  requestHash: string;
  effect: MemoryWriteEffect;
  committedRevisionIds: readonly string[];
  governanceAction?: MemoryGovernanceAction;
  committedAt?: number;
}

export interface ConflictDecisionInput {
  operationId: string;
  requestHash: string;
  leftRevisionId: string;
  rightRevisionId: string;
  decision: MemoryConflictDecision;
  winnerRevisionId?: string;
  applicabilityNote?: string;
  createdAt?: number;
}

interface OperationRow {
  operation_id: string;
  operation_kind: MemoryOperationKind;
  request_hash: string;
  result_json: string;
  committed_at: number;
}

interface DecisionRow {
  id: string;
  operation_id: string;
  left_revision_id: string;
  right_revision_id: string;
  decision: MemoryConflictDecision;
  winner_revision_id: string | null;
  applicability_note: string | null;
  created_at: number;
}

interface OperationResult {
  effect: MemoryWriteEffect;
  committedRevisionIds: string[];
  governanceAction?: MemoryGovernanceAction;
}

/** §8.2：左右按修订身份规范排序，同一对冲突只有一种落库形状。 */
const canonicalPair = (
  leftRevisionId: string,
  rightRevisionId: string,
): { leftRevisionId: string; rightRevisionId: string } =>
  leftRevisionId <= rightRevisionId
    ? { leftRevisionId, rightRevisionId }
    : { leftRevisionId: rightRevisionId, rightRevisionId: leftRevisionId };

const toOperation = (row: OperationRow): MemoryOperationRecord => {
  const result = JSON.parse(row.result_json) as unknown;
  return memoryOperationRecordSchema.parse({
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    requestHash: row.request_hash,
    committedAt: row.committed_at,
    ...(typeof result === 'object' && result !== null ? result : {}),
  });
};

const toDecision = (row: DecisionRow): MemoryConflictDecisionRecord =>
  memoryConflictDecisionRecordSchema.parse({
    id: row.id,
    operationId: row.operation_id,
    leftRevisionId: row.left_revision_id,
    rightRevisionId: row.right_revision_id,
    decision: row.decision,
    ...(row.winner_revision_id === null ? {} : { winnerRevisionId: row.winner_revision_id }),
    ...(row.applicability_note === null ? {} : { applicabilityNote: row.applicability_note }),
    createdAt: row.created_at,
  });

/**
 * 记忆写命令的幂等回执与冲突裁决（契约 §5.4、§5.6、§8.2）。
 *
 * 只有成功提交的事务才留下回执，因此表里没有 status：失败重试写不进去，也就不会伪装成功。
 * 回执不复制正文，只保存提交实体与精确修订；「当前展示状态」由调用方按修订读回，
 * 因此重复提交返回的是最新视图而不是当初那一次的快照。
 */
export class MemoryOperationRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /**
   * §5.6：幂等判定必须与业务写入同事务，且在写入之前调用。
   * 同 operationId ＋ 同 requestHash → replay；同 ID 不同哈希 → IDEMPOTENCY_CONFLICT。
   * 并发下两个事务可能都拿到 commit，后提交者被 operation_id 主键挡下并整体回滚。
   */
  claim(input: {
    operationId: string;
    operationKind: MemoryOperationKind;
    requestHash: string;
  }): MemoryOperationClaim {
    const operationId = memoryOperationIdSchema.parse(input.operationId);
    const requestHash = sha256HexSchema.parse(input.requestHash);
    const existing = this.get(operationId);
    if (!existing) return { kind: 'commit' };
    if (existing.requestHash !== requestHash || existing.operationKind !== input.operationKind) {
      throw new MemoryIdempotencyConflictError();
    }
    return { kind: 'replay', operation: existing };
  }

  get(operationId: string): MemoryOperationRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM memory_operations WHERE operation_id = ?')
      .get(operationId) as OperationRow | undefined;
    return row ? toOperation(row) : undefined;
  }

  /** 业务修订与回执同事务：调用方把本方法与记忆写入一起包进 store.transaction()。 */
  append(input: MemoryOperationInput): MemoryOperationRecord {
    const record = memoryOperationRecordSchema.parse({
      operationId: input.operationId,
      operationKind: input.operationKind,
      requestHash: input.requestHash,
      effect: input.effect,
      committedRevisionIds: [...input.committedRevisionIds],
      ...(input.governanceAction === undefined ? {} : { governanceAction: input.governanceAction }),
      committedAt: input.committedAt ?? this.clock(),
    });
    const result: OperationResult = {
      effect: record.effect,
      committedRevisionIds: record.committedRevisionIds,
      ...(record.governanceAction === undefined
        ? {}
        : { governanceAction: record.governanceAction }),
    };
    this.db
      .prepare(
        `INSERT INTO memory_operations (
           operation_id, operation_kind, request_hash, result_json, committed_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.operationId,
        record.operationKind,
        record.requestHash,
        JSON.stringify(result),
        record.committedAt,
      );
    return record;
  }

  /**
   * §5.4：回执与裁决行一起落库——replace 必须指明胜出的精确修订、keep-both 必须写明
   * 适用条件（1–300 字符），两条修订都必须真实存在，任一步失败整个事务回滚。
   */
  recordConflictResolution(input: ConflictDecisionInput): {
    operation: MemoryOperationRecord;
    decision: MemoryConflictDecisionRecord;
  } {
    const pair = canonicalPair(input.leftRevisionId, input.rightRevisionId);
    if (pair.leftRevisionId === pair.rightRevisionId) {
      throw new MemoryOperationValidationError('冲突裁决需要两个不同的精确修订。');
    }
    this.assertRevisionsExist([pair.leftRevisionId, pair.rightRevisionId]);
    const run = this.db.transaction(() => {
      const operation = this.append({
        operationId: input.operationId,
        operationKind: 'resolve-conflict',
        requestHash: input.requestHash,
        effect: input.decision === 'replace' ? 'updated' : 'unchanged',
        committedRevisionIds: [pair.leftRevisionId, pair.rightRevisionId],
      });
      const decision = memoryConflictDecisionRecordSchema.parse({
        id: randomUUID(),
        operationId: operation.operationId,
        leftRevisionId: pair.leftRevisionId,
        rightRevisionId: pair.rightRevisionId,
        decision: input.decision,
        ...(input.winnerRevisionId === undefined
          ? {}
          : { winnerRevisionId: input.winnerRevisionId }),
        ...(input.applicabilityNote === undefined
          ? {}
          : { applicabilityNote: input.applicabilityNote }),
        createdAt: input.createdAt ?? operation.committedAt,
      });
      if (
        decision.winnerRevisionId !== undefined &&
        decision.winnerRevisionId !== pair.leftRevisionId &&
        decision.winnerRevisionId !== pair.rightRevisionId
      ) {
        throw new MemoryOperationValidationError('胜出的修订必须是本次裁决的两个修订之一。');
      }
      this.db
        .prepare(
          `INSERT INTO memory_conflict_decisions (
             id, operation_id, left_revision_id, right_revision_id,
             decision, winner_revision_id, applicability_note, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          decision.id,
          decision.operationId,
          decision.leftRevisionId,
          decision.rightRevisionId,
          decision.decision,
          decision.winnerRevisionId ?? null,
          decision.applicabilityNote ?? null,
          decision.createdAt,
        );
      return { operation, decision };
    });
    return run();
  }

  findDecisionByOperation(operationId: string): MemoryConflictDecisionRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM memory_conflict_decisions WHERE operation_id = ?')
      .get(operationId) as DecisionRow | undefined;
    return row ? toDecision(row) : undefined;
  }

  findDecisionForPair(
    leftRevisionId: string,
    rightRevisionId: string,
  ): MemoryConflictDecisionRecord | undefined {
    const pair = canonicalPair(leftRevisionId, rightRevisionId);
    const row = this.db
      .prepare(
        'SELECT * FROM memory_conflict_decisions WHERE left_revision_id = ? AND right_revision_id = ?',
      )
      .get(pair.leftRevisionId, pair.rightRevisionId) as DecisionRow | undefined;
    return row ? toDecision(row) : undefined;
  }

  /**
   * §5.5：裁决只在绑定的两个修订仍是各自最新时有效；任一修订变化后该组重新成为待澄清冲突。
   * currentOnly 供召回与投影使用；不带它可以把 replace 的历史裁决整体查回。
   */
  listDecisionsForRevisionIds(
    revisionIds: readonly string[],
    options: { currentOnly?: boolean; decision?: MemoryConflictDecision } = {},
  ): MemoryConflictDecisionRecord[] {
    const ids = [...new Set(revisionIds)];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const conditions = [
      `(d.left_revision_id IN (${placeholders}) OR d.right_revision_id IN (${placeholders}))`,
    ];
    const parameters: unknown[] = [...ids, ...ids];
    if (options.currentOnly === true) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM memory_records l
            WHERE l.revision_id = d.left_revision_id
              AND l.revision = (SELECT MAX(x.revision) FROM memory_records x WHERE x.id = l.id))`,
        `EXISTS (
           SELECT 1 FROM memory_records r
            WHERE r.revision_id = d.right_revision_id
              AND r.revision = (SELECT MAX(y.revision) FROM memory_records y WHERE y.id = r.id))`,
      );
    }
    if (options.decision !== undefined) {
      conditions.push('d.decision = ?');
      parameters.push(options.decision);
    }
    const rows = this.db
      .prepare(
        `SELECT d.* FROM memory_conflict_decisions d
          WHERE ${conditions.join(' AND ')}
          ORDER BY d.created_at ASC, d.id ASC`,
      )
      .all(...parameters) as DecisionRow[];
    return rows.map(toDecision);
  }

  /** MemoryViewItem.conflicts：精确修订对与当前共存状态（§9.1）。 */
  listConflictPairsForRevisionIds(revisionIds: readonly string[]): MemoryConflictPair[] {
    return this.listDecisionsForRevisionIds(revisionIds, { currentOnly: true }).map((decision) => ({
      leftRevisionId: decision.leftRevisionId,
      rightRevisionId: decision.rightRevisionId,
      state: decision.decision === 'replace' ? 'replaced' : 'keep-both',
    }));
  }

  /** §8.3：被历史引用的裁决数量，供父对象删除预检使用。 */
  countDecisionsReferencingRevisions(revisionIds: readonly string[]): number {
    const ids = [...new Set(revisionIds)];
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM memory_conflict_decisions d
          WHERE d.left_revision_id IN (${placeholders})
             OR d.right_revision_id IN (${placeholders})
             OR d.winner_revision_id IN (${placeholders})`,
      )
      .get(...ids, ...ids, ...ids) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private assertRevisionsExist(revisionIds: readonly string[]): void {
    const placeholders = revisionIds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM memory_records WHERE revision_id IN (${placeholders})`,
      )
      .get(...revisionIds) as { count: number } | undefined;
    if ((row?.count ?? 0) !== revisionIds.length) {
      throw new MemoryOperationValidationError('冲突裁决必须绑定已存在的精确修订。');
    }
  }
}

export { MemoryConflictError };
