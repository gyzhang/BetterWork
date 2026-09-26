import { createHash, randomUUID } from 'node:crypto';

import {
  type DatePatch,
  LIST_PAGE_DEFAULT_LIMIT,
  type ListCursor,
  type ListMemoriesRequest,
  listMemoriesRequestSchema,
  MEMORY_QUERY_TERM_MAX,
  type MemoryCandidateDisposition,
  type MemoryDependency,
  type MemoryEditPatch,
  type MemoryEffectiveStatus,
  type MemoryFacet,
  type MemoryGovernanceAction,
  type MemoryGovernanceTransition,
  memoryGovernanceTransitions,
  type MemoryKind,
  type MemoryProvenance,
  memoryProvenanceSchema,
  type MemoryRead,
  memoryReadSchema,
  type MemoryRecallPolicy,
  type MemoryRecord,
  memoryRecordSchema,
  type MemoryScope,
  memoryScopeSchema,
  type MemorySourceType,
  type MemoryStatus,
  terminalMemoryStatuses,
  type TopicKeyPatch,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

/** 修订 CAS 冲突：调用方必须重新加载后重试（服务层映射 REVISION_CONFLICT）。 */
export class MemoryConflictError extends Error {
  constructor(message = '记忆已被其他操作更新，请重新加载。') {
    super(message);
    this.name = 'MemoryConflictError';
  }
}

export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

/** §5.2：deleted/superseded 是终态，不接受编辑、确认、续期或恢复（映射 TERMINAL_MEMORY）。 */
export class MemoryTerminalError extends Error {
  constructor(message = '该记忆已进入终态，不能再编辑、确认、续期或恢复。') {
    super(message);
    this.name = 'MemoryTerminalError';
  }
}

/** §5.4：替代要求新旧记录处于同一规范 scope（映射 SCOPE_MISMATCH）。 */
export class MemoryScopeMismatchError extends Error {
  constructor(message = '替代只允许在规范范围一致的记忆之间进行，请先明确范围。') {
    super(message);
    this.name = 'MemoryScopeMismatchError';
  }
}

/** §8.3：父对象删除预检结论；blocking 为真时调用方必须给出可操作错误而不是静默级联。 */
export interface MemoryDeletionImpact {
  parentKind: 'workspace' | 'expert';
  parentId: string;
  cascadedRevisionCount: number;
  historyReferencedRevisionCount: number;
  blocking: boolean;
  sampleRevisionIds: string[];
}

/**
 * §6.1 过滤顺序中属于存储的前四步：最新修订 → confirmed/生效 → scope → 任务排除。
 * 相关性、冲突组与预算都在召回层，仓储不再夹带额度。
 */
export interface RecallCandidateQuery {
  workspaceId: string;
  expertId?: string;
  evaluatedAt: number;
  excludedMemoryIds?: readonly string[];
  /**
   * §8.4：来源门禁与 legacy 复核入口在 WM03 同卡启用；WM02 保持 false，
   * 避免「先全禁用再让用户等下一卡」。
   */
  onlyVerifiedProvenance?: boolean;
}

export interface MemoryListPageQuery extends ListMemoriesRequest {
  /** 游标分页；排序固定 updatedAt DESC / id ASC（§9.1）。 */
  cursor?: ListCursor;
  /** 自然到期是查询派生的：传入时只回该时点有效的记录。 */
  effectiveAt?: number;
}

export interface MemoryListPage {
  items: MemoryRecord[];
  nextCursor?: ListCursor;
}

export interface MemoryCreateInput {
  facet: MemoryFacet;
  scope: MemoryScope;
  content: string;
  /** §5.1：归一化只在 memory-content-policy 定义一次，因此摘要由调用方提交。 */
  normalizedHash: string;
  provenance: MemoryProvenance;
  topicKey?: string;
  validFrom?: number;
  validUntil?: number;
  confidence: number;
  /** §5.4：create 只接受 Main 判定后的 confirmed，或内部服务写入的 candidate。 */
  status: 'confirmed' | 'candidate';
  candidateDisposition?: MemoryCandidateDisposition;
  createdAt?: number;
}

export interface MemoryEditCommand {
  id: string;
  expectedRevision: number;
  patch: MemoryEditPatch;
  /** patch.content 存在时必须同时提交新正文的 normalizedHash。 */
  normalizedHash?: string;
  /** 来源不是可编辑 JSON：只能整体换成 Main 构造的声明（legacy 复核、自主口径）。 */
  provenance?: MemoryProvenance;
  confidence?: number;
  updatedAt?: number;
}

export interface MemoryGovernanceCommand {
  id: string;
  expectedRevision: number;
  action: MemoryGovernanceAction;
  confirmPatch?: MemoryEditPatch;
  normalizedHash?: string;
  provenance?: MemoryProvenance;
  updatedAt?: number;
}

export interface MemoryReplaceCommand {
  winnerId: string;
  winnerExpectedRevision: number;
  loserId: string;
  loserExpectedRevision: number;
  updatedAt?: number;
}

export interface MemoryReplacement {
  /** 裁决行与 replacesRevisionId 都只绑定胜出的精确修订。 */
  winnerRevisionId: string;
  winner: MemoryRecord;
  loser: MemoryRecord;
}

export interface MemoryWriteOutcome {
  /** §5.2/§5.6：无变化的提交返回 unchanged，不堆积空修订；重复候选返回 deduplicated/suppressed。 */
  effect: 'created' | 'updated' | 'unchanged' | 'deduplicated' | 'suppressed';
  record: MemoryRecord;
}

export interface MemoryReadInput {
  runId: string;
  memory: MemoryRecord;
  capturedAt: number;
  /** 缺省 true：沿用「只登记实际注入」的旧口径；重放继承要显式传 false。 */
  selectedForInjection?: boolean;
  replayedViaRunIds?: readonly string[];
}

/** 一条记忆「当前状态」的可比较投影；身份、修订链与时间戳都在它之外。 */
interface MemoryState {
  scope: MemoryScope;
  kind: MemoryKind;
  facet: MemoryFacet;
  content: string;
  normalizedHash: string;
  contentHash: string;
  provenance: MemoryProvenance;
  status: MemoryStatus;
  confidence: number;
  topicKey?: string;
  validFrom?: number;
  validUntil?: number;
  candidateDisposition?: MemoryCandidateDisposition;
  recallPolicy: MemoryRecallPolicy;
}

interface MemoryRow {
  revision_id: string;
  id: string;
  revision: number;
  scope_kind: MemoryScope['kind'];
  scope_id: string;
  expert_id: string | null;
  workspace_id: string | null;
  kind: MemoryKind;
  facet: MemoryFacet;
  topic_key: string | null;
  normalized_hash: string;
  recall_policy: 'relevant' | 'pinned';
  provenance_json: string;
  candidate_disposition: MemoryCandidateDisposition | null;
  replaces_revision_id: string | null;
  content: string;
  source_type: MemorySourceType;
  source_id: string | null;
  source_locator: string | null;
  confidence: number;
  status: MemoryStatus;
  valid_from: number | null;
  valid_until: number | null;
  supersedes_id: string | null;
  content_hash: string;
  created_at: number;
  updated_at: number;
}

interface MemoryReadRow {
  id: string;
  run_id: string;
  memory_id: string;
  memory_revision_id: string;
  content_hash: string;
  captured_at: number;
  selected_for_injection: number;
  replayed_via_run_ids_json: string;
  provenance_state: 'known' | 'legacy_unknown';
}

interface MemoryReadRunRow {
  workspace_id: string;
  expert_id: string | null;
}

interface CountRow {
  count: number;
}

const DELETION_SAMPLE_LIMIT = 10;

/** §5.1：contentHash 就是保存正文 UTF-8 的 SHA-256；normalizedHash 另由策略层计算。 */
const hashContent = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

/** §5.2：细分面到 kind 的机械映射与协议同源（facetToKind），这里只补 SQL 需要的方向。 */
const kindOfFacet = (facet: MemoryFacet): MemoryKind => {
  switch (facet) {
    case 'goal':
    case 'constraint':
    case 'decision':
    case 'fact':
      return 'semantic';
    case 'method':
      return 'procedural';
    case 'preference':
      return 'preference';
    case 'experience':
      return 'episodic';
  }
};

const sourceColumnsOf = (
  provenance: MemoryProvenance,
): { sourceType: MemorySourceType; sourceId?: string; sourceLocator?: string } => {
  if (provenance.verification === 'legacy-unverified') {
    return {
      sourceType: provenance.sourceType,
      ...(provenance.sourceId === undefined ? {} : { sourceId: provenance.sourceId }),
      ...(provenance.sourceLocator === undefined
        ? {}
        : { sourceLocator: provenance.sourceLocator }),
    };
  }
  const first = provenance.sources.at(0);
  if (first === undefined) {
    return {
      sourceType: provenance.authority === 'user-instruction' ? 'user-explicit' : 'conversation',
    };
  }
  // verified 来源的多态事实以 provenance_json 为准；旧列只保留可解释的单一身份。
  const sourceType: MemorySourceType =
    provenance.authority === 'user-instruction' ? 'user-explicit' : 'conversation';
  if (first.kind === 'run-user' || first.kind === 'run-assistant') {
    return { sourceType, sourceId: first.runId };
  }
  if (first.kind === 'checkpoint') {
    return { sourceType, sourceId: first.checkpointId };
  }
  if (first.kind === 'artifact-version') {
    return {
      sourceType,
      sourceId: first.artifactVersionId,
      ...(first.locator === undefined ? {} : { sourceLocator: first.locator }),
    };
  }
  return { sourceType, sourceId: first.operationId };
};

const scopeToColumns = (
  scope: MemoryScope,
): {
  scopeKind: MemoryScope['kind'];
  scopeId: string;
  expertId?: string;
  workspaceId?: string;
} => {
  switch (scope.kind) {
    case 'user':
      return { scopeKind: scope.kind, scopeId: 'user' };
    case 'workspace':
      return { scopeKind: scope.kind, scopeId: scope.workspaceId, workspaceId: scope.workspaceId };
    case 'expert':
      return { scopeKind: scope.kind, scopeId: scope.expertId, expertId: scope.expertId };
    case 'expert-workspace':
      return {
        scopeKind: scope.kind,
        scopeId: `${scope.expertId}:${scope.workspaceId}`,
        expertId: scope.expertId,
        workspaceId: scope.workspaceId,
      };
  }
};

const rowScope = (row: MemoryRow): MemoryScope => {
  switch (row.scope_kind) {
    case 'user':
      return { kind: 'user' };
    case 'workspace':
      if (!row.workspace_id) throw new MemoryValidationError('记忆范围字段不完整。');
      return { kind: 'workspace', workspaceId: row.workspace_id };
    case 'expert':
      if (!row.expert_id) throw new MemoryValidationError('记忆范围字段不完整。');
      return { kind: 'expert', expertId: row.expert_id };
    case 'expert-workspace':
      if (!row.expert_id || !row.workspace_id) {
        throw new MemoryValidationError('记忆范围字段不完整。');
      }
      return { kind: 'expert-workspace', expertId: row.expert_id, workspaceId: row.workspace_id };
  }
};

const parseProvenance = (value: string): MemoryProvenance =>
  memoryProvenanceSchema.parse(JSON.parse(value) as unknown);

const toRecord = (row: MemoryRow): MemoryRecord =>
  memoryRecordSchema.parse({
    id: row.id,
    revisionId: row.revision_id,
    revision: row.revision,
    scope: rowScope(row),
    kind: row.kind,
    facet: row.facet,
    content: row.content,
    sourceType: row.source_type,
    ...(row.source_id === null ? {} : { sourceId: row.source_id }),
    ...(row.source_locator === null ? {} : { sourceLocator: row.source_locator }),
    confidence: row.confidence,
    status: row.status,
    ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
    ...(row.supersedes_id === null ? {} : { supersedesId: row.supersedes_id }),
    ...(row.topic_key === null ? {} : { topicKey: row.topic_key }),
    normalizedHash: row.normalized_hash,
    recallPolicy: row.recall_policy,
    provenance: parseProvenance(row.provenance_json),
    ...(row.candidate_disposition === null
      ? {}
      : { candidateDisposition: row.candidate_disposition }),
    ...(row.replaces_revision_id === null ? {} : { replacesRevisionId: row.replaces_revision_id }),
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const stateOf = (record: MemoryRecord): MemoryState => ({
  scope: record.scope,
  kind: record.kind,
  facet: record.facet,
  content: record.content,
  normalizedHash: record.normalizedHash,
  contentHash: record.contentHash,
  provenance: record.provenance,
  status: record.status,
  confidence: record.confidence,
  ...(record.topicKey === undefined ? {} : { topicKey: record.topicKey }),
  ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
  ...(record.validUntil === undefined ? {} : { validUntil: record.validUntil }),
  ...(record.candidateDisposition === undefined
    ? {}
    : { candidateDisposition: record.candidateDisposition }),
  recallPolicy: record.recallPolicy,
});

/** 稳定序列化后比较：来源声明换期、换事件都不许被当成「无变化」。 */
const stableKey = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => stableKey(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, item]) => `${key}:${stableKey(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const sameState = (left: MemoryState, right: MemoryState): boolean =>
  stableKey(left) === stableKey(right);

const sameCanonicalScope = (left: MemoryScope, right: MemoryScope): boolean =>
  stableKey(left) === stableKey(right);

const applyDatePatch = (
  patch: DatePatch | undefined,
  current: number | undefined,
): number | undefined => {
  if (patch === undefined) return current;
  return patch.action === 'clear' ? undefined : patch.value;
};

const applyTopicKeyPatch = (
  patch: TopicKeyPatch | undefined,
  current: string | undefined,
): string | undefined => {
  if (patch === undefined) return current;
  return patch.action === 'clear' ? undefined : patch.value;
};

const assertValidityWindow = (
  validFrom: number | undefined,
  validUntil: number | undefined,
): void => {
  if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
    throw new MemoryValidationError('有效期结束时间必须晚于开始时间。');
  }
};

const isTerminal = (status: MemoryStatus): boolean => terminalMemoryStatuses.includes(status);

/** §5.1：有效区间 validFrom ≤ now < validUntil，缺省端点无界。 */
export const isMemoryEffectiveAt = (record: MemoryRecord, at: number): boolean =>
  (record.validFrom === undefined || record.validFrom <= at) &&
  (record.validUntil === undefined || record.validUntil > at);

/** §3.4/§9.1：到期与「已拒绝候选」都是查询派生的展示状态，不落库、不定任务。 */
export const deriveEffectiveStatus = (record: MemoryRecord, at: number): MemoryEffectiveStatus => {
  if (record.status === 'candidate') {
    return record.candidateDisposition === 'rejected' ? 'rejected' : 'candidate';
  }
  if (record.status === 'confirmed' && record.validUntil !== undefined && record.validUntil <= at) {
    return 'expired';
  }
  return record.status;
};

const latestQuery = `
  SELECT r.*
    FROM memory_records r
   WHERE r.revision = (
     SELECT MAX(latest.revision) FROM memory_records latest WHERE latest.id = r.id
   )
`;

const EFFECTIVE_PREDICATE = `
  (r.valid_from IS NULL OR r.valid_from <= ?) AND (r.valid_until IS NULL OR r.valid_until > ?)
`;

/**
 * 检索词切分：与正文同一套 NFC 归一（memory-content-policy），再小写折叠按空白切词。
 * 逐词做子串匹配并取 AND，所以「回款 口径」命中同时含两词的记录；不用 LIKE 是为了
 * 让用户输入的 % 与 _ 只表示字面量，不改变匹配语义。
 */
const queryTerms = (query: string): string[] =>
  query
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== '')
    .slice(0, MEMORY_QUERY_TERM_MAX);

export class MemoryRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** §5.6：同 scope＋同 normalizedHash 的自动候选被抑制，不产生第二条待审记录。 */
  create(input: MemoryCreateInput): MemoryWriteOutcome {
    const scope = memoryScopeSchema.parse(input.scope);
    this.assertScopeExists(scope);
    const provenance = memoryProvenanceSchema.parse(input.provenance);
    assertValidityWindow(input.validFrom, input.validUntil);
    const normalizedHash = input.normalizedHash;
    if (input.status === 'candidate') {
      const duplicate = this.findCandidateByDedupeKey(scope, normalizedHash);
      if (duplicate) {
        return {
          effect: duplicate.candidateDisposition === 'rejected' ? 'suppressed' : 'deduplicated',
          record: duplicate,
        };
      }
    }
    const now = input.createdAt ?? this.clock();
    const state: MemoryState = {
      scope,
      kind: kindOfFacet(input.facet),
      facet: input.facet,
      content: input.content,
      normalizedHash,
      contentHash: hashContent(input.content),
      provenance,
      status: input.status,
      confidence: input.confidence,
      // 契约 §11.3：新建（含自动候选）一律 relevant，模型不能自报优先。
      recallPolicy: 'relevant' as const,
      ...(input.topicKey === undefined ? {} : { topicKey: input.topicKey }),
      ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
      ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
      ...(input.candidateDisposition === undefined
        ? {}
        : { candidateDisposition: input.candidateDisposition }),
    };
    return { effect: 'created', record: this.insertState(state, now, now) };
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.db.prepare(`${latestQuery} AND r.id = ?`).get(id) as MemoryRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  /** 精确修订读取：历史修订永远不可编辑（§9.2 memory:get 的 revisionId?）。 */
  getRevision(revisionId: string): MemoryRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM memory_records WHERE revision_id = ?')
      .get(revisionId) as MemoryRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  list(input: ListMemoriesRequest = {}): MemoryRecord[] {
    const parsed = listMemoriesRequestSchema.parse(input);
    const { clause, values } = this.scopeAndStatusFilter(parsed);
    const rows = this.db
      .prepare(`${latestQuery} ${clause} ORDER BY r.updated_at DESC, r.id ASC`)
      .all(...values) as MemoryRow[];
    return rows.map(toRecord);
  }

  listPage(input: MemoryListPageQuery): MemoryListPage {
    const parsed = listMemoriesRequestSchema.parse({
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      ...(input.expertId === undefined ? {} : { expertId: input.expertId }),
      ...(input.statuses === undefined ? {} : { statuses: input.statuses }),
      ...(input.includeCandidates === undefined
        ? {}
        : { includeCandidates: input.includeCandidates }),
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    const limit = parsed.limit ?? LIST_PAGE_DEFAULT_LIMIT;
    const { clause, values } = this.scopeAndStatusFilter(parsed);
    const conditions = [clause];
    const parameters = [...values];
    if (parsed.cursor) {
      conditions.push('AND (r.updated_at < ? OR (r.updated_at = ? AND r.id > ?))');
      parameters.push(parsed.cursor.updatedAt, parsed.cursor.updatedAt, parsed.cursor.id);
    }
    if (input.effectiveAt !== undefined) {
      conditions.push(`AND ${EFFECTIVE_PREDICATE}`);
      parameters.push(input.effectiveAt, input.effectiveAt);
    }
    const rows = this.db
      .prepare(
        `${latestQuery} ${conditions.join(' ')} ORDER BY r.updated_at DESC, r.id ASC LIMIT ?`,
      )
      .all(...parameters, limit + 1) as MemoryRow[];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toRecord),
      ...(rows.length > limit && last
        ? { nextCursor: { version: 1, updatedAt: last.updated_at, id: last.id } }
        : {}),
    };
  }

  listRecallCandidates(input: RecallCandidateQuery): MemoryRecord[] {
    const excluded = [...new Set(input.excludedMemoryIds ?? [])];
    const scopes: string[] = ["r.scope_kind = 'user'"];
    const parameters: unknown[] = [];
    // 每条子句自己追加参数，绑定顺序与 SQL 文本顺序一致。
    const pushScope = (clause: string, ...values: unknown[]): void => {
      scopes.push(clause);
      parameters.push(...values);
    };
    pushScope("(r.scope_kind = 'workspace' AND r.workspace_id = ?)", input.workspaceId);
    if (input.expertId !== undefined) {
      pushScope("(r.scope_kind = 'expert' AND r.expert_id = ?)", input.expertId);
      pushScope(
        "(r.scope_kind = 'expert-workspace' AND r.workspace_id = ? AND r.expert_id = ?)",
        input.workspaceId,
        input.expertId,
      );
    }
    const bindings = [input.evaluatedAt, input.evaluatedAt, ...parameters, ...excluded];
    const rows = this.db
      .prepare(
        `SELECT r.*
           FROM memory_records r
          WHERE r.revision = (
            SELECT MAX(latest.revision) FROM memory_records latest WHERE latest.id = r.id
          )
            AND r.status = 'confirmed'
            AND ${EFFECTIVE_PREDICATE}
            AND (${scopes.join(' OR ')})
            ${
              input.onlyVerifiedProvenance === true
                ? "AND json_extract(r.provenance_json, '$.verification') = 'verified'"
                : ''
            }
            ${excluded.length > 0 ? `AND r.id NOT IN (${excluded.map(() => '?').join(', ')})` : ''}
          ORDER BY r.updated_at DESC, r.id ASC`,
      )
      .all(...bindings) as MemoryRow[];
    return rows.map(toRecord);
  }

  /** §5.2：同内容无变化的提交返回 unchanged，不堆积空修订。 */
  update(input: MemoryEditCommand): MemoryWriteOutcome {
    const current = this.requireCurrent(input.id, input.expectedRevision);
    if (isTerminal(current.status)) {
      throw new MemoryTerminalError(`记忆处于 ${current.status} 终态，不能再编辑。`);
    }
    const projected = this.projectPatch(current, input.patch, {
      ...(input.normalizedHash === undefined ? {} : { normalizedHash: input.normalizedHash }),
      ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    });
    if (sameState(stateOf(current), projected)) {
      return { effect: 'unchanged', record: current };
    }
    return {
      effect: 'updated',
      record: this.appendRevision(current, projected, input.updatedAt ?? this.clock()),
    };
  }

  /** §5.4：状态由动作驱动，转移表是唯一判据；confirm/reconfirm 的编辑在同一修订里完成。 */
  applyGovernance(input: MemoryGovernanceCommand): MemoryWriteOutcome {
    const current = this.requireCurrent(input.id, input.expectedRevision);
    assertGovernanceTransition(current, input.action);
    const transition: MemoryGovernanceTransition = memoryGovernanceTransitions[input.action];
    if (
      input.confirmPatch !== undefined &&
      input.action !== 'confirm' &&
      input.action !== 'reconfirm'
    ) {
      throw new MemoryValidationError('confirmPatch 只随 confirm 或 reconfirm 提交。');
    }
    if (
      transition.requiresConfirmPatch === true &&
      (input.confirmPatch === undefined ||
        (input.confirmPatch.validFrom === undefined && input.confirmPatch.validUntil === undefined))
    ) {
      throw new MemoryValidationError('重新确认必须明确修改有效期。');
    }
    const projected = input.confirmPatch
      ? this.projectPatch(current, input.confirmPatch, {
          ...(input.normalizedHash === undefined ? {} : { normalizedHash: input.normalizedHash }),
          ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
        })
      : stateOf(current);
    const dispositionCarry = projected.candidateDisposition;
    const state: MemoryState = {
      scope: projected.scope,
      kind: projected.kind,
      facet: projected.facet,
      content: projected.content,
      normalizedHash: projected.normalizedHash,
      contentHash: projected.contentHash,
      provenance: projected.provenance,
      confidence: projected.confidence,
      recallPolicy: projected.recallPolicy,
      status: transition.toStatus,
      ...(projected.topicKey === undefined ? {} : { topicKey: projected.topicKey }),
      ...(projected.validFrom === undefined ? {} : { validFrom: projected.validFrom }),
      ...(projected.validUntil === undefined ? {} : { validUntil: projected.validUntil }),
      ...(transition.toStatus === 'candidate'
        ? {
            candidateDisposition:
              transition.toCandidateDisposition ?? dispositionCarry ?? 'pending',
          }
        : {}),
    };
    if (sameState(stateOf(current), state)) {
      return { effect: 'unchanged', record: current };
    }
    return {
      effect: 'updated',
      record: this.appendRevision(current, state, input.updatedAt ?? this.clock()),
    };
  }

  /**
   * §5.4：替代校验两条 expectedRevision，旧规则追加 superseded 修订并写 replacesRevisionId。
   * 调用方必须在同一事务里补裁决行与回执，任一步失败整体回滚。
   */
  replace(input: MemoryReplaceCommand): MemoryReplacement {
    const winner = this.requireCurrent(input.winnerId, input.winnerExpectedRevision);
    const loser = this.requireCurrent(input.loserId, input.loserExpectedRevision);
    if (winner.id === loser.id) {
      throw new MemoryValidationError('替代需要两条不同的记忆身份。');
    }
    if (isTerminal(winner.status) || isTerminal(loser.status)) {
      throw new MemoryTerminalError('替代只处理未进入终态的记忆。');
    }
    if (winner.status !== 'confirmed' || loser.status !== 'confirmed') {
      throw new MemoryValidationError('只有两条已确认的记忆之间可以判定替代。');
    }
    if (!sameCanonicalScope(winner.scope, loser.scope)) {
      throw new MemoryScopeMismatchError();
    }
    // 终态标记不携带候选处置；superseded 只可能来自 confirmed，此处已判定。
    const state: MemoryState = {
      scope: loser.scope,
      kind: loser.kind,
      facet: loser.facet,
      // 被替代只是终态标记，历史策略值仍作为事实留在行里。
      recallPolicy: loser.recallPolicy,
      content: loser.content,
      normalizedHash: loser.normalizedHash,
      contentHash: loser.contentHash,
      provenance: loser.provenance,
      confidence: loser.confidence,
      status: 'superseded',
      ...(loser.topicKey === undefined ? {} : { topicKey: loser.topicKey }),
      ...(loser.validFrom === undefined ? {} : { validFrom: loser.validFrom }),
      ...(loser.validUntil === undefined ? {} : { validUntil: loser.validUntil }),
    };
    const superseded = this.appendRevision(loser, state, input.updatedAt ?? this.clock(), {
      replacesRevisionId: winner.revisionId,
    });
    return { winnerRevisionId: winner.revisionId, winner, loser: superseded };
  }

  /** §5.6：自动候选去重键＝scope＋normalizedHash；已拒绝的同样抑制。 */
  findCandidateByDedupeKey(scope: MemoryScope, normalizedHash: string): MemoryRecord | undefined {
    const columns = scopeToColumns(scope);
    const rows = this.db
      .prepare(
        `${latestQuery}
          AND r.status = 'candidate' AND r.normalized_hash = ?
          AND r.scope_kind = ? AND r.scope_id = ?
         ORDER BY r.updated_at DESC, r.id ASC`,
      )
      .all(normalizedHash, columns.scopeKind, columns.scopeId) as MemoryRow[];
    const match = rows.map(toRecord).find((record) => sameCanonicalScope(record.scope, scope));
    return match;
  }

  /** 直接注入与历史继承可以同时成立：冲突时合并标记，不覆盖成新行。 */
  recordReads(reads: readonly MemoryReadInput[]): void {
    const insert = this.db.prepare(
      `INSERT INTO run_memory_reads (
         id, run_id, memory_id, memory_revision_id, content_hash, captured_at,
         selected_for_injection, replayed_via_run_ids_json, provenance_state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, memory_revision_id) DO UPDATE SET
         selected_for_injection = MAX(selected_for_injection, excluded.selected_for_injection),
         replayed_via_run_ids_json = excluded.replayed_via_run_ids_json`,
    );
    const stored = this.db.prepare(
      'SELECT id, content_hash FROM memory_records WHERE revision_id = ?',
    );
    const run = this.db.prepare(
      `SELECT tasks.workspace_id, run_context_snapshots.expert_id
         FROM runs
         JOIN tasks ON tasks.id = runs.task_id
         LEFT JOIN run_context_snapshots ON run_context_snapshots.run_id = runs.id
        WHERE runs.id = ?`,
    );
    const transaction = this.db.transaction(() => {
      for (const read of reads) {
        const memory = memoryRecordSchema.parse(read.memory);
        const target = run.get(read.runId) as MemoryReadRunRow | undefined;
        if (!target) throw new MemoryValidationError('运行不存在。');
        if (!this.memoryAppliesToRun(memory, target)) {
          throw new MemoryValidationError('记忆范围不适用于该 Run。');
        }
        if (memory.status !== 'confirmed' || !isMemoryEffectiveAt(memory, read.capturedAt)) {
          throw new MemoryValidationError('只能记录运行实际注入的有效记忆。');
        }
        const existing = stored.get(memory.revisionId) as
          { id: string; content_hash: string } | undefined;
        if (!existing) throw new MemoryValidationError('记忆修订不存在。');
        if (existing.id !== memory.id) throw new MemoryValidationError('记忆修订身份不一致。');
        if (existing.content_hash !== memory.contentHash) {
          throw new MemoryValidationError('记忆内容哈希不一致。');
        }
        const replayedViaRunIds = [...new Set(read.replayedViaRunIds ?? [])].sort();
        insert.run(
          randomUUID(),
          read.runId,
          memory.id,
          memory.revisionId,
          memory.contentHash,
          read.capturedAt,
          read.selectedForInjection === false ? 0 : 1,
          JSON.stringify(replayedViaRunIds),
          // §8.4：legacy 来源不补造确认事实，读回即 legacy_unknown。
          memory.provenance.verification === 'verified' ? 'known' : 'legacy_unknown',
        );
      }
    });
    transaction();
  }

  listReads(runId: string): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM run_memory_reads rr
          JOIN memory_records m ON m.revision_id = rr.memory_revision_id
         WHERE rr.run_id = ? ORDER BY rr.captured_at ASC, rr.rowid ASC`,
      )
      .all(runId) as MemoryRow[];
    return rows.map(toRecord);
  }

  /** §8.1：读取足迹的完整形状（实际注入、重放来源、来源是否可解释）。 */
  listMemoryReads(runId: string): MemoryRead[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, memory_id, memory_revision_id, content_hash, captured_at,
                selected_for_injection, replayed_via_run_ids_json, provenance_state
           FROM run_memory_reads
          WHERE run_id = ? ORDER BY captured_at ASC, rowid ASC`,
      )
      .all(runId) as MemoryReadRow[];
    return rows.map((row) =>
      memoryReadSchema.parse({
        id: row.id,
        runId: row.run_id,
        memoryId: row.memory_id,
        memoryRevisionId: row.memory_revision_id,
        contentHash: row.content_hash,
        capturedAt: row.captured_at,
        selectedForInjection: row.selected_for_injection === 1,
        replayedViaRunIds: parseRunIds(row.replayed_via_run_ids_json),
        provenanceState: row.provenance_state,
      }),
    );
  }

  /** §8.3：Workspace/Expert 移除前必须问它，不能靠外键抛错或静默级联清除历史。 */
  assessWorkspaceDeletionImpact(workspaceId: string): MemoryDeletionImpact {
    return this.assessDeletionImpact('workspace_id', workspaceId, 'workspace');
  }

  assessExpertDeletionImpact(expertId: string): MemoryDeletionImpact {
    return this.assessDeletionImpact('expert_id', expertId, 'expert');
  }

  /** §5.3：记忆派生记忆的精确依赖，供依赖闭包与失效判定使用。 */
  listMemoryDependencies(revisionId: string): MemoryDependency[] {
    const record = this.getRevision(revisionId);
    if (!record || record.provenance.verification !== 'verified') return [];
    return record.provenance.memoryDependencies;
  }

  private projectPatch(
    current: MemoryRecord,
    patch: MemoryEditPatch,
    options: { normalizedHash?: string; provenance?: MemoryProvenance; confidence?: number },
  ): MemoryState {
    const scope = patch.scope === undefined ? current.scope : memoryScopeSchema.parse(patch.scope);
    if (patch.scope !== undefined) this.assertScopeExists(scope);
    const content = patch.content ?? current.content;
    const normalizedHash =
      patch.content === undefined
        ? current.normalizedHash
        : this.requireNormalizedHash(content, options.normalizedHash);
    const provenance = options.provenance
      ? memoryProvenanceSchema.parse(options.provenance)
      : current.provenance;
    const validFrom = applyDatePatch(patch.validFrom, current.validFrom);
    const validUntil = applyDatePatch(patch.validUntil, current.validUntil);
    assertValidityWindow(validFrom, validUntil);
    const facet = patch.facet ?? current.facet;
    const topicKey = applyTopicKeyPatch(patch.topicKey, current.topicKey);
    const base = stateOf(current);
    return {
      scope,
      kind: kindOfFacet(facet),
      facet,
      content,
      normalizedHash,
      contentHash: hashContent(content),
      provenance,
      status: base.status,
      confidence: options.confidence ?? current.confidence,
      // 策略只在 patch 显式提交时变化；其余写入必须原样带上，不能被默认值清掉。
      recallPolicy: patch.recallPolicy ?? current.recallPolicy,
      ...(topicKey === undefined ? {} : { topicKey }),
      ...(validFrom === undefined ? {} : { validFrom }),
      ...(validUntil === undefined ? {} : { validUntil }),
      ...(base.candidateDisposition === undefined
        ? {}
        : { candidateDisposition: base.candidateDisposition }),
    };
  }

  private requireNormalizedHash(content: string, normalizedHash: string | undefined): string {
    if (normalizedHash === undefined) {
      throw new MemoryValidationError('修改记忆正文必须同时提交归一化摘要（normalizedHash）。');
    }
    return normalizedHash;
  }

  private insertState(state: MemoryState, createdAt: number, updatedAt: number): MemoryRecord {
    const record = memoryRecordSchema.parse({
      ...state,
      // 顶层 source_* 是 provenance 的派生投影，写列时同样取自 sourceColumnsOf（§8.1）。
      ...sourceColumnsOf(state.provenance),
      id: randomUUID(),
      revisionId: randomUUID(),
      revision: 1,
      createdAt,
      updatedAt,
    });
    this.insert(record);
    return record;
  }

  private appendRevision(
    current: MemoryRecord,
    state: MemoryState,
    updatedAt: number,
    extra: { replacesRevisionId?: string } = {},
  ): MemoryRecord {
    const record = memoryRecordSchema.parse({
      ...state,
      ...sourceColumnsOf(state.provenance),
      id: current.id,
      revisionId: randomUUID(),
      revision: current.revision + 1,
      supersedesId: current.revisionId,
      ...(extra.replacesRevisionId === undefined
        ? {}
        : { replacesRevisionId: extra.replacesRevisionId }),
      createdAt: current.createdAt,
      updatedAt,
    });
    this.insert(record);
    return record;
  }

  private insert(record: MemoryRecord): void {
    const columns = scopeToColumns(record.scope);
    const source = sourceColumnsOf(record.provenance);
    this.db
      .prepare(
        `INSERT INTO memory_records (
          revision_id, id, revision, scope_kind, scope_id, expert_id, workspace_id,
          kind, facet, topic_key, normalized_hash, recall_policy, provenance_json,
          candidate_disposition, replaces_revision_id, content, source_type, source_id,
          source_locator, confidence, status, valid_from, valid_until, supersedes_id,
          content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.revisionId,
        record.id,
        record.revision,
        columns.scopeKind,
        columns.scopeId,
        columns.expertId ?? null,
        columns.workspaceId ?? null,
        record.kind,
        record.facet,
        record.topicKey ?? null,
        record.normalizedHash,
        record.recallPolicy,
        JSON.stringify(record.provenance),
        record.candidateDisposition ?? null,
        record.replacesRevisionId ?? null,
        record.content,
        source.sourceType,
        source.sourceId ?? null,
        source.sourceLocator ?? null,
        record.confidence,
        record.status,
        record.validFrom ?? null,
        record.validUntil ?? null,
        record.supersedesId ?? null,
        record.contentHash,
        record.createdAt,
        record.updatedAt,
      );
  }

  private requireCurrent(id: string, expectedRevision: number): MemoryRecord {
    const current = this.get(id);
    if (!current) throw new MemoryValidationError('记忆不存在。');
    if (current.revision !== expectedRevision) {
      throw new MemoryConflictError(`期望修订 ${expectedRevision}，当前修订 ${current.revision}。`);
    }
    return current;
  }

  private assertScopeExists(scope: MemoryScope): void {
    if (scope.kind === 'user') return;
    if (scope.kind === 'workspace' || scope.kind === 'expert-workspace') {
      const workspaceId = scope.workspaceId;
      const workspace = this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId);
      if (!workspace) throw new MemoryValidationError('工作空间不存在。');
    }
    if (scope.kind === 'expert' || scope.kind === 'expert-workspace') {
      const expertId = scope.expertId;
      const expert = this.db.prepare('SELECT id FROM experts WHERE id = ?').get(expertId);
      if (!expert) throw new MemoryValidationError('专家不存在。');
    }
  }

  private memoryAppliesToRun(memory: MemoryRecord, run: MemoryReadRunRow): boolean {
    switch (memory.scope.kind) {
      case 'user':
        return true;
      case 'workspace':
        return memory.scope.workspaceId === run.workspace_id;
      case 'expert':
        return memory.scope.expertId === run.expert_id;
      case 'expert-workspace':
        return (
          memory.scope.expertId === run.expert_id && memory.scope.workspaceId === run.workspace_id
        );
    }
  }

  private scopeAndStatusFilter(input: ListMemoriesRequest): {
    clause: string;
    values: unknown[];
  } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (input.workspaceId || input.expertId) {
      const scopeConditions: string[] = [];
      if (input.workspaceId) {
        scopeConditions.push("(r.scope_kind = 'workspace' AND r.workspace_id = ?)");
        values.push(input.workspaceId);
      }
      if (input.expertId) {
        scopeConditions.push("(r.scope_kind = 'expert' AND r.expert_id = ?)");
        values.push(input.expertId);
      }
      if (input.workspaceId && input.expertId) {
        scopeConditions.push(
          "(r.scope_kind = 'expert-workspace' AND r.workspace_id = ? AND r.expert_id = ?)",
        );
        values.push(input.workspaceId, input.expertId);
      }
      scopeConditions.push("r.scope_kind = 'user'");
      conditions.push(`AND (${scopeConditions.join(' OR ')})`);
    }
    if (input.statuses && input.statuses.length > 0) {
      conditions.push(`AND r.status IN (${input.statuses.map(() => '?').join(', ')})`);
      values.push(...input.statuses);
    }
    if (input.includeCandidates === false) conditions.push("AND r.status != 'candidate'");
    for (const term of input.query === undefined ? [] : queryTerms(input.query)) {
      conditions.push(
        "AND (instr(lower(r.content), ?) > 0 OR instr(lower(COALESCE(r.topic_key, '')), ?) > 0)",
      );
      values.push(term, term);
    }
    return { clause: conditions.join(' '), values };
  }

  private assessDeletionImpact(
    column: 'workspace_id' | 'expert_id',
    parentId: string,
    parentKind: 'workspace' | 'expert',
  ): MemoryDeletionImpact {
    const cascaded = this.db
      .prepare(`SELECT COUNT(*) AS count FROM memory_records WHERE ${column} = ?`)
      .get(parentId) as CountRow | undefined;
    const referenced = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM memory_records r
          WHERE r.${column} = ?
            AND (
              EXISTS (SELECT 1 FROM run_memory_reads s WHERE s.memory_revision_id = r.revision_id)
              OR EXISTS (SELECT 1 FROM memory_conflict_decisions d
                          WHERE d.left_revision_id = r.revision_id
                             OR d.right_revision_id = r.revision_id
                             OR d.winner_revision_id = r.revision_id)
              OR EXISTS (SELECT 1 FROM memory_records x
                          WHERE x.replaces_revision_id = r.revision_id)
            )`,
      )
      .get(parentId) as CountRow | undefined;
    const samples = this.db
      .prepare(
        `SELECT r.revision_id FROM memory_records r
          WHERE r.${column} = ?
            AND EXISTS (SELECT 1 FROM run_memory_reads s WHERE s.memory_revision_id = r.revision_id)
          ORDER BY r.updated_at ASC LIMIT ?`,
      )
      .all(parentId, DELETION_SAMPLE_LIMIT) as { revision_id: string }[];
    const referencedCount = referenced?.count ?? 0;
    return {
      parentKind,
      parentId,
      cascadedRevisionCount: cascaded?.count ?? 0,
      historyReferencedRevisionCount: referencedCount,
      blocking: referencedCount > 0,
      sampleRevisionIds: samples.map((row) => row.revision_id),
    };
  }
}

const parseRunIds = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new MemoryValidationError('重放来源必须是一个数组。');
  return parsed.filter((item): item is string => typeof item === 'string');
};

/** §5.4：转移表是唯一判据；协议里那份表就是它，本文件不写第二套。 */
const assertGovernanceTransition = (
  current: MemoryRecord,
  action: MemoryGovernanceAction,
): void => {
  if (isTerminal(current.status)) {
    throw new MemoryTerminalError(`记忆处于 ${current.status} 终态，不能执行 ${action}。`);
  }
  const transition: MemoryGovernanceTransition = memoryGovernanceTransitions[action];
  if (!transition.fromStatuses.includes(current.status)) {
    throw new MemoryValidationError(`当前状态 ${current.status} 不允许执行 ${action}。`);
  }
  if (transition.fromCandidateDispositions === undefined) return;
  // 历史 candidate 没有处置事实：未标记即「未被拒绝」，不回填 pending（§8.4）。
  const disposition = current.candidateDisposition ?? 'pending';
  if (!transition.fromCandidateDispositions.includes(disposition)) {
    throw new MemoryValidationError(`候选当前处置 ${disposition}，不允许执行 ${action}。`);
  }
};
