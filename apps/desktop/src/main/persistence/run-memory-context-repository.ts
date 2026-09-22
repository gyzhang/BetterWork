import {
  type MaterialReference,
  materialReferenceSchema,
  MEMORY_MATERIAL_DEPENDENCY_MAX,
  MEMORY_MEMORY_DEPENDENCY_MAX,
  MEMORY_RECALL_TOTAL_ITEM_LIMIT,
  MEMORY_REPLAY_PAIR_LIMIT,
  type MemoryDecisionSummary,
  memoryDecisionSummarySchema,
  type MemoryDependency,
  memoryDependencySchema,
  type MemoryPolicySnapshot,
  memoryPolicySnapshotSchema,
  type MemoryReplayEntry,
  memoryReplayEntrySchema,
  type MemoryRunPhase,
  memoryRunPhaseSchema,
  type MemorySelectedMemory,
  memorySelectedMemorySchema,
  type RunMemoryContext,
  runMemoryContextSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

/** 阶段推进不成立（倒退、缺前序、时间不单调）；与真正的写入失败一样都必须阻止发包。 */
export class RunMemoryPhaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunMemoryPhaseError';
  }
}

/** 一次运行的记忆决策快照；由 Main 在装配请求前写入（契约 §6.4）。 */
export interface RunMemorySelectionInput {
  runId: string;
  evaluatedAt: number;
  queryHash: string;
  policySnapshot: MemoryPolicySnapshot;
  selectedItems: readonly MemorySelectedMemory[];
  replay?: readonly MemoryReplayEntry[];
  materialDependencyUnion?: readonly MaterialReference[];
  memoryDependencyUnion?: readonly MemoryDependency[];
  decisionSummary: MemoryDecisionSummary;
  authorizationHash: string;
  selectedAt?: number;
}

interface RunMemoryContextRow {
  run_id: string;
  schema_version: number;
  phase: MemoryRunPhase;
  recall_version: string;
  evaluated_at: number;
  query_hash: string;
  policy_snapshot_json: string;
  selected_items_json: string;
  replay_json: string;
  material_dependency_union_json: string;
  memory_dependency_union_json: string;
  decision_summary_json: string;
  authorization_hash: string;
  model_snapshot_json: string | null;
  request_hash: string | null;
  selected_at: number;
  request_prepared_at: number | null;
  dispatch_attempted_at: number | null;
  updated_at: number;
}

const parseJson = (value: string): unknown => JSON.parse(value) as unknown;

const toContext = (row: RunMemoryContextRow): RunMemoryContext =>
  runMemoryContextSchema.parse({
    runId: row.run_id,
    schemaVersion: row.schema_version,
    phase: row.phase,
    recallVersion: row.recall_version,
    evaluatedAt: row.evaluated_at,
    queryHash: row.query_hash,
    policySnapshot: memoryPolicySnapshotSchema.parse(
      JSON.parse(row.policy_snapshot_json) as unknown,
    ),
    selectedItems: memorySelectedMemorySchema
      .array()
      .max(MEMORY_RECALL_TOTAL_ITEM_LIMIT)
      .parse(parseJson(row.selected_items_json)),
    replay: memoryReplayEntrySchema
      .array()
      .max(MEMORY_REPLAY_PAIR_LIMIT * 2)
      .parse(parseJson(row.replay_json)),
    materialDependencyUnion: materialReferenceSchema
      .array()
      .max(MEMORY_MATERIAL_DEPENDENCY_MAX)
      .parse(parseJson(row.material_dependency_union_json)),
    memoryDependencyUnion: memoryDependencySchema
      .array()
      .max(MEMORY_MEMORY_DEPENDENCY_MAX)
      .parse(parseJson(row.memory_dependency_union_json)),
    decisionSummary: memoryDecisionSummarySchema.parse(parseJson(row.decision_summary_json)),
    authorizationHash: row.authorization_hash,
    ...(row.model_snapshot_json === null
      ? {}
      : { modelSnapshot: JSON.parse(row.model_snapshot_json) as Record<string, unknown> }),
    ...(row.request_hash === null ? {} : { requestHash: row.request_hash }),
    selectedAt: row.selected_at,
    ...(row.request_prepared_at === null ? {} : { requestPreparedAt: row.request_prepared_at }),
    ...(row.dispatch_attempted_at === null
      ? {}
      : { dispatchAttemptedAt: row.dispatch_attempted_at }),
    updatedAt: row.updated_at,
  });

/**
 * 一次 Run 的记忆召回快照与请求阶段（契约 §6.4、§8.2）。
 *
 * 三个方法都是同步的：任何抛出都意味着快照没有落库，调用方必须放弃这次请求，
 * 不能「先发包再补审计」。落库后还会读回核对，把「语句执行了但内容不对」也变成可辨失败。
 * 旧运行没有本表行，phaseOf 返回 legacy_unknown，且不补造请求哈希与发送时间（§8.4）。
 */
export class RunMemoryContextRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  recordSelection(input: RunMemorySelectionInput): RunMemoryContext {
    if (this.get(input.runId)) {
      throw new RunMemoryPhaseError('该运行已经记录过记忆快照，不能重复改写。');
    }
    const now = this.clock();
    const selectedAt = input.selectedAt ?? now;
    // 顺序号是快照的一部分：落库即为注入顺序，读回不必再排。
    const orderedItems = input.selectedItems.map((item, index) => ({ ...item, order: index + 1 }));
    const context = runMemoryContextSchema.parse({
      runId: input.runId,
      schemaVersion: 1,
      phase: 'selected',
      recallVersion: input.policySnapshot.recallVersion,
      evaluatedAt: input.evaluatedAt,
      queryHash: input.queryHash,
      policySnapshot: input.policySnapshot,
      selectedItems: orderedItems,
      replay: [...(input.replay ?? [])],
      materialDependencyUnion: [...(input.materialDependencyUnion ?? [])],
      memoryDependencyUnion: [...(input.memoryDependencyUnion ?? [])],
      decisionSummary: input.decisionSummary,
      authorizationHash: input.authorizationHash,
      selectedAt,
      updatedAt: Math.max(selectedAt, now),
    });
    this.db
      .prepare(
        `INSERT INTO run_memory_contexts (
           run_id, schema_version, phase, recall_version, evaluated_at, query_hash,
           policy_snapshot_json, selected_items_json, replay_json,
           material_dependency_union_json, memory_dependency_union_json, decision_summary_json,
           authorization_hash, model_snapshot_json, request_hash,
           selected_at, request_prepared_at, dispatch_attempted_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        context.runId,
        context.schemaVersion,
        context.phase,
        context.recallVersion,
        context.evaluatedAt,
        context.queryHash,
        JSON.stringify(context.policySnapshot),
        JSON.stringify(context.selectedItems),
        JSON.stringify(context.replay),
        JSON.stringify(context.materialDependencyUnion),
        JSON.stringify(context.memoryDependencyUnion),
        JSON.stringify(context.decisionSummary),
        context.authorizationHash,
        null,
        null,
        context.selectedAt,
        context.updatedAt,
      );
    return this.requirePersisted(context.runId, context.phase);
  }

  /** 首个实际 ModelRequest 装配完成后调用；此处的 requestHash 是真实发包内容的指纹。 */
  markRequestPrepared(input: {
    runId: string;
    requestHash: string;
    at?: number;
    modelSnapshot?: Record<string, unknown>;
  }): RunMemoryContext {
    const current = this.requireContext(input.runId);
    if (current.phase !== 'selected') {
      throw new RunMemoryPhaseError(`运行处于 ${current.phase} 阶段，不能再次准备请求。`);
    }
    const at = this.assertMonotonic(current, input.at ?? this.clock(), 'request-prepared');
    const result = this.db
      .prepare(
        `UPDATE run_memory_contexts
            SET phase = 'request-prepared', request_prepared_at = ?, request_hash = ?,
                model_snapshot_json = COALESCE(?, model_snapshot_json), updated_at = ?
          WHERE run_id = ? AND phase = 'selected'`,
      )
      .run(
        at,
        input.requestHash,
        input.modelSnapshot === undefined ? null : JSON.stringify(input.modelSnapshot),
        Math.max(at, current.updatedAt),
        input.runId,
      );
    if (result.changes !== 1) {
      throw new RunMemoryPhaseError('请求阶段推进未落库，放弃本次模型调用。');
    }
    const persisted = this.requirePersisted(input.runId, 'request-prepared');
    if (persisted.requestHash !== input.requestHash) {
      throw new RunMemoryPhaseError('请求哈希与落库结果不一致，放弃本次模型调用。');
    }
    return persisted;
  }

  /** 开始消费委托 Provider 之前调用；本方法成功返回才允许真正发包。 */
  markDispatchAttempted(input: { runId: string; at?: number }): RunMemoryContext {
    const current = this.requireContext(input.runId);
    if (current.phase !== 'request-prepared') {
      throw new RunMemoryPhaseError(
        `运行处于 ${current.phase} 阶段，未准备完成的请求不得标记为已尝试发送。`,
      );
    }
    const at = this.assertMonotonic(current, input.at ?? this.clock(), 'dispatch-attempted');
    const result = this.db
      .prepare(
        `UPDATE run_memory_contexts
            SET phase = 'dispatch-attempted', dispatch_attempted_at = ?, updated_at = ?
          WHERE run_id = ? AND phase = 'request-prepared'`,
      )
      .run(at, Math.max(at, current.updatedAt), input.runId);
    if (result.changes !== 1) {
      throw new RunMemoryPhaseError('发送阶段推进未落库，放弃本次模型调用。');
    }
    return this.requirePersisted(input.runId, 'dispatch-attempted');
  }

  get(runId: string): RunMemoryContext | undefined {
    const row = this.db.prepare('SELECT * FROM run_memory_contexts WHERE run_id = ?').get(runId) as
      RunMemoryContextRow | undefined;
    return row ? toContext(row) : undefined;
  }

  /** §9.2：没有快照的旧运行只报 legacy_unknown，不伪造时间与哈希。 */
  phaseOf(runId: string): MemoryRunPhase {
    const row = this.db
      .prepare('SELECT phase FROM run_memory_contexts WHERE run_id = ?')
      .get(runId) as { phase: MemoryRunPhase } | undefined;
    return row ? memoryRunPhaseSchema.parse(row.phase) : 'legacy_unknown';
  }

  listSelectedItems(runId: string): MemorySelectedMemory[] {
    const context = this.get(runId);
    if (!context) return [];
    return [...context.selectedItems].sort((left, right) => left.order - right.order);
  }

  listSelectedRevisionIds(runId: string): string[] {
    return this.listSelectedItems(runId).map((item) => item.revisionId);
  }

  /** §6.3：安全重放需要的「直接＋传递」依赖并集，一律是精确引用。 */
  listDependencyUnion(runId: string): {
    materials: MaterialReference[];
    memories: MemoryDependency[];
  } {
    const context = this.get(runId);
    if (!context) return { materials: [], memories: [] };
    return {
      materials: [...context.materialDependencyUnion],
      memories: [...context.memoryDependencyUnion],
    };
  }

  /** 该精确修订被哪些运行的快照引用（记忆失效判定与父对象删除预检）。 */
  listRunIdsReferencingRevision(revisionId: string, limit = 200): string[] {
    const rows = this.db
      .prepare(
        `SELECT c.run_id FROM run_memory_contexts c
          WHERE EXISTS (
            SELECT 1 FROM json_each(c.selected_items_json) item
             WHERE json_extract(item.value, '$.revisionId') = ?)
          ORDER BY c.selected_at ASC LIMIT ?`,
      )
      .all(revisionId, limit) as { run_id: string }[];
    return rows.map((row) => row.run_id);
  }

  countReferencingRevision(revisionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM run_memory_contexts c
          WHERE EXISTS (
            SELECT 1 FROM json_each(c.selected_items_json) item
             WHERE json_extract(item.value, '$.revisionId') = ?)`,
      )
      .get(revisionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private requireContext(runId: string): RunMemoryContext {
    const current = this.get(runId);
    if (!current) {
      throw new RunMemoryPhaseError('运行还没有记忆快照，不能推进请求阶段。');
    }
    return current;
  }

  private assertMonotonic(
    current: RunMemoryContext,
    at: number,
    phase: 'request-prepared' | 'dispatch-attempted',
  ): number {
    const floor =
      phase === 'request-prepared'
        ? current.selectedAt
        : (current.requestPreparedAt ?? current.selectedAt);
    if (at < floor) {
      throw new RunMemoryPhaseError(`${phase} 的时间必须不早于前序阶段（${floor}）。`);
    }
    return at;
  }

  private requirePersisted(runId: string, phase: MemoryRunPhase): RunMemoryContext {
    const persisted = this.get(runId);
    if (!persisted) {
      throw new RunMemoryPhaseError('记忆运行快照未落库，放弃本次模型调用。');
    }
    if (persisted.phase !== phase) {
      throw new RunMemoryPhaseError(
        `记忆运行快照落库阶段为 ${persisted.phase}，与预期的 ${phase} 不符。`,
      );
    }
    return persisted;
  }
}
