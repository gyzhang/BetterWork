import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MemoryOperationRecord } from '@betterwork/agent-protocol';
import {
  countCodePoints,
  type CreateMemoryRequest,
  createMemoryRequestSchema,
  facetToKind,
  type GetMemoryRequest,
  getMemoryRequestSchema,
  type ListMemoriesRequest,
  listMemoriesRequestSchema,
  type ListPage,
  type MemoryConflictPair,
  type MemoryConflictResolutionData,
  memoryConflictResolutionDataSchema,
  type MemoryEffectiveStatus,
  type MemoryError,
  memoryErrorSchema,
  type MemoryGovernanceAction,
  type MemoryProvenance,
  memoryProvenanceSchema,
  type MemoryRecord,
  type MemoryScope,
  type MemorySourceSelector,
  type MemoryViewItem,
  memoryViewItemSchema,
  type MemoryWarning,
  type MemoryWriteEffect,
  type MemoryWriteReceipt,
  memoryWriteReceiptSchema,
  type RebuildMemoryProjectionRequest,
  rebuildMemoryProjectionRequestSchema,
  type ResolveMemoryConflictRequest,
  resolveMemoryConflictRequestSchema,
  type Result,
  type SetMemoryStatusRequest,
  setMemoryStatusRequestSchema,
  stableStringifyJson,
  type UpdateMemoryRequest,
  updateMemoryRequestSchema,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { MemoryIdempotencyConflictError } from '../persistence/memory-operation-repository';
import type { MemoryWriteOutcome } from '../persistence/memory-repository';
import {
  deriveEffectiveStatus,
  MemoryConflictError,
  MemoryScopeMismatchError,
  MemoryTerminalError,
  MemoryValidationError,
} from '../persistence/memory-repository';
import { duplicateConfirmedMemoryId, unresolvedConflictPairs } from './memory-conflict-policy';
import { isSensitiveMemoryContent, normalizedMemoryHash } from './memory-content-policy';
import {
  buildUserInstructionProvenance,
  type ProvenanceReader,
  type ResolvedMemorySource,
  resolveMemorySourceSelector,
} from './memory-provenance';
import { createStoreProvenanceReader } from './memory-provenance-reader';

/** 用户当场提交的口径是确定事实，不再叠加统计置信度。 */
const USER_INSTRUCTION_CONFIDENCE = 1;

const requestHashOf = (value: unknown): string =>
  createHash('sha256').update(stableStringifyJson(value)).digest('hex');

interface DomainFailure {
  ok: false;
  error: MemoryError;
}
type MemoryLookup = { ok: true; record: MemoryRecord } | DomainFailure;
type ProvenanceResolution = { ok: true; value: MemoryProvenance } | DomainFailure;

const okResult = <TData>(data: TData, warnings: readonly MemoryWarning[] = []): Result<TData> => ({
  ok: true,
  data,
  warnings: [...warnings],
});

const failResult = (
  code: MemoryError['code'],
  message: string,
  currentRevision?: number,
): DomainFailure => ({
  ok: false,
  error: memoryErrorSchema.parse({
    code,
    message,
    retryable: code === 'REVISION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT',
    ...(currentRevision === undefined ? {} : { currentRevision }),
  }),
});

/**
 * 契约 §9.3：领域失败经 `Result` 返回，因此仓储异常在此一次性映射。
 * 判定只看错误类型；`MemoryValidationError` 内部再按抛出点语义细分，消息文本仅供人阅读。
 */
const mapDomainError = (error: unknown): DomainFailure => {
  if (error instanceof MemoryIdempotencyConflictError) {
    return failResult('IDEMPOTENCY_CONFLICT', '该操作已以不同内容提交过，请使用新的操作标识重试。');
  }
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
    if (error.message.includes('不存在')) return failResult('NOT_FOUND', error.message);
    if (error.message.includes('有效期')) return failResult('INVALID_VALIDITY', error.message);
    return failResult('INVALID_TRANSITION', error.message);
  }
  throw error;
};

const isGlobalScope = (scope: MemoryScope): boolean =>
  scope.kind === 'user' || scope.kind === 'expert';

/** 判定待澄清与重复用的当前记录集合与未裁决冲突对（契约 §5.5、§10 管理提示口径）。 */
interface PendingGovernance {
  readonly current: readonly MemoryRecord[];
  readonly unresolved: MemoryConflictPair[];
}

const needsSourceReview = (record: MemoryRecord): boolean =>
  record.provenance.verification === 'legacy-unverified';

/** 来源是判别联合：只有 verified 分支才带权威、来源与依赖，legacy 分支只有原字段。 */
type VerifiedProvenance = Extract<MemoryProvenance, { verification: 'verified' }>;

const verifiedProvenance = (provenance: MemoryProvenance): VerifiedProvenance | undefined =>
  provenance.verification === 'verified' ? provenance : undefined;

const materialDependencyCount = (record: MemoryRecord): number =>
  verifiedProvenance(record.provenance)?.materialDependencies.length ?? 0;

const scopeOf = (record: MemoryRecord): MemoryScope => record.scope;

const originWorkspaceOf = (scope: MemoryScope): string | undefined =>
  scope.kind === 'workspace' || scope.kind === 'expert-workspace' ? scope.workspaceId : undefined;

/** 来源权威与依赖都由 Main 依据选择器指向的实体判定；Renderer 与模型都不能改写（§11.1）。 */
const provenanceFromResolved = (
  resolved: ResolvedMemorySource,
  capturedAt: number,
  originWorkspaceId: string | undefined,
): MemoryProvenance =>
  memoryProvenanceSchema.parse({
    schemaVersion: 1,
    verification: 'verified',
    authority: resolved.authority,
    capturedAt,
    sources: [resolved.source],
    materialDependencies: resolved.materialDependencies,
    memoryDependencies: resolved.memoryDependencies,
    ...(originWorkspaceId ? { originWorkspaceId } : {}),
  });

/**
 * 契约 §11.3：只有「已确认、当前生效、用户口径、来源可用且不带任何材料/记忆依赖」
 * 的工作要求才能设为优先带入；事实与经验一律拒绝。
 */
const pinnedEligibilityProblem = (record: MemoryRecord, at: number): string | undefined => {
  if (record.facet === 'fact' || record.facet === 'experience') {
    return '优先带入只用于工作要求，事实与经验仍按相关性选择。';
  }
  const provenance = verifiedProvenance(record.provenance);
  if (!provenance) return '来源尚未复核的记忆不能设为优先带入。';
  if (provenance.authority !== 'user-instruction') {
    return '派生自资料或回答的记忆不能直接设为优先带入，请先作为我的工作口径重新保存。';
  }
  if (provenance.materialDependencies.length > 0 || provenance.memoryDependencies.length > 0) {
    return '仍依赖材料或其他记忆的记录不能设为优先带入，请先解除依赖。';
  }
  if (deriveEffectiveStatus(record, at) !== 'confirmed') {
    return '只有已确认且当前生效的记忆才能设为优先带入。';
  }
  return undefined;
};

/** 只用于资格判定：把 patch 的日期与分类落到当前记录上，得到将要写入的形状。 */
const projectedForPolicyCheck = (
  current: MemoryRecord,
  patch: UpdateMemoryRequest['patch'],
  provenance: MemoryProvenance,
): MemoryRecord => {
  const dateOf = (
    action: { action: 'set'; value: number } | { action: 'clear' } | undefined,
    fallback: number | undefined,
  ): number | undefined =>
    action === undefined ? fallback : action.action === 'set' ? action.value : undefined;
  const validFrom = dateOf(patch.validFrom, current.validFrom);
  const validUntil = dateOf(patch.validUntil, current.validUntil);
  const facet = patch.facet ?? current.facet;
  return {
    ...current,
    facet,
    kind: facetToKind[facet],
    provenance,
    recallPolicy: patch.recallPolicy ?? current.recallPolicy,
    ...(patch.scope === undefined ? {} : { scope: patch.scope }),
    ...(patch.content === undefined ? {} : { content: patch.content }),
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
  };
};

const scopeLabel = (record: MemoryRecord): string => {
  switch (record.scope.kind) {
    case 'user':
      return '用户';
    case 'workspace':
      return `工作空间 ${record.scope.workspaceId}`;
    case 'expert':
      return `专家 ${record.scope.expertId}`;
    case 'expert-workspace':
      return `专家 ${record.scope.expertId} · 工作空间 ${record.scope.workspaceId}`;
  }
};

const projectionWarning = (): MemoryWarning => ({
  code: 'PROJECTION_PENDING',
  message: '记忆已保存，但只读投影重建失败，可在记忆页手动重建。',
});

/**
 * 记忆的产品服务层：SQLite 保存可审计真相，Markdown 只是可重建的只读投影。
 *
 * 写命令统一走 `Result` ＋ `operationId` 幂等回执；投影在事务提交之后串行重建，
 * 投影失败表现为「已保存 ＋ 警告」，绝不回滚已提交的业务修订。
 */
export class MemoryService {
  private readonly projectionRoot: string;
  private readonly manifestPath: string;
  private readonly reader: ProvenanceReader;
  private projectionChain: Promise<void> = Promise.resolve();
  private projectionState: 'synced' | 'pending' | 'failed' = 'synced';

  constructor(
    private readonly store: AppStore,
    userDataRoot: string,
    provenanceReader?: ProvenanceReader,
  ) {
    this.projectionRoot = path.join(userDataRoot, 'memory');
    this.manifestPath = path.join(this.projectionRoot, '.managed-manifest.json');
    this.reader = provenanceReader ?? createStoreProvenanceReader(store);
  }

  list(input: ListMemoriesRequest = {}): Result<ListPage<MemoryViewItem>> {
    const parsed = listMemoriesRequestSchema.parse(input);
    const page = this.store.memories.listPage({
      ...(parsed.workspaceId === undefined ? {} : { workspaceId: parsed.workspaceId }),
      ...(parsed.expertId === undefined ? {} : { expertId: parsed.expertId }),
      ...(parsed.statuses === undefined ? {} : { statuses: parsed.statuses }),
      includeCandidates: parsed.includeCandidates,
      ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
    });
    const governance = this.pendingGovernance();
    return okResult({
      items: page.items.map((record) => this.toViewItem(record, governance)),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    });
  }

  get(input: GetMemoryRequest): Result<MemoryViewItem> {
    const parsed = getMemoryRequestSchema.parse(input);
    const record = parsed.revisionId
      ? this.store.memories.getRevision(parsed.revisionId)
      : this.store.memories.get(parsed.id);
    if (!record) return failResult('NOT_FOUND', '记忆不存在。');
    return okResult(this.toViewItem(record));
  }

  async create(input: CreateMemoryRequest): Promise<Result<MemoryWriteReceipt>> {
    try {
      const request = createMemoryRequestSchema.parse(input);
      const requestHash = requestHashOf({ kind: 'create', request });
      const claim = this.store.memoryOperations.claim({
        operationId: request.operationId,
        operationKind: 'create',
        requestHash,
      });
      if (claim.kind === 'replay') return this.receipt(claim.operation);

      if (isSensitiveMemoryContent(request.content)) {
        return failResult('SENSITIVE_CONTENT', '记忆正文疑似包含凭据，已拒绝保存。');
      }
      if (isGlobalScope(request.scope)) {
        if (!request.asUserInstruction) {
          return failResult(
            'GLOBAL_SCOPE_REQUIRES_DECLARATION',
            '全局记忆只能来自用户的通用声明，请改用具体适用范围或勾选通用声明。',
          );
        }
        if (request.genericDeclaration !== true) {
          return failResult(
            'GLOBAL_SCOPE_REQUIRES_DECLARATION',
            '勾选通用声明后才能写入跨空间生效的记忆。',
          );
        }
      }
      const originRevision = this.checkRestatementLink(request);
      if (!originRevision.ok) return originRevision;

      const capturedAt = Date.now();
      const originWorkspaceId = originWorkspaceOf(request.scope);
      const provenance = this.buildCreateProvenance(request, capturedAt, originWorkspaceId);
      if (!provenance.ok) return provenance;

      const outcome = this.store.transaction(() => this.commitCreate(request, provenance.value));
      return this.commitReceipt({
        operationId: request.operationId,
        operationKind: 'create',
        requestHash,
        effect: outcome.effect,
        committedRevisionIds: [outcome.record.revisionId],
        ...(request.fromMemoryRevisionId === undefined
          ? {}
          : { fromMemoryRevisionId: request.fromMemoryRevisionId }),
      });
    } catch (error) {
      return mapDomainError(error);
    }
  }

  async update(input: UpdateMemoryRequest): Promise<Result<MemoryWriteReceipt>> {
    try {
      const request = updateMemoryRequestSchema.parse(input);
      const requestHash = requestHashOf({ kind: 'update', request });
      const claim = this.store.memoryOperations.claim({
        operationId: request.operationId,
        operationKind: 'update',
        requestHash,
      });
      if (claim.kind === 'replay') return this.receipt(claim.operation);

      const current = this.lookup(request.id);
      if (!current.ok) return current;
      const revisionCheck = this.checkRevision(current.record, request.expectedRevision);
      if (revisionCheck) return revisionCheck;

      const content = request.patch.content;
      if (content !== undefined && isSensitiveMemoryContent(content)) {
        return failResult('SENSITIVE_CONTENT', '记忆正文疑似包含凭据，已拒绝保存。');
      }
      const provenance = this.resolveReviewProvenance(
        request.legacySourceReview,
        current.record,
        request.operationId,
        content ?? current.record.content,
      );
      if (!provenance.ok) return provenance;
      if (
        request.patch.scope &&
        isGlobalScope(request.patch.scope) &&
        verifiedProvenance(provenance.value)?.authority === 'derived'
      ) {
        return failResult(
          'WORKSPACE_FACT_CANNOT_BE_GLOBAL',
          '来源属于具体空间的记录不能直接改为全局生效，请先以用户口径重新表述。',
        );
      }

      // 策略改动与编辑在同一条 update 命令里，因此先按将要写入的形状判定资格。
      const policyCheckTarget = projectedForPolicyCheck(
        current.record,
        request.patch,
        provenance.value,
      );
      if (
        request.patch.recallPolicy === 'pinned' ||
        (current.record.recallPolicy === 'pinned' &&
          request.patch.recallPolicy !== 'relevant' &&
          request.patch.recallPolicy !== undefined)
      ) {
        const problem = pinnedEligibilityProblem(policyCheckTarget, Date.now());
        if (problem !== undefined) return failResult('INVALID_TRANSITION', problem);
      }
      if (
        current.record.recallPolicy === 'pinned' &&
        request.patch.recallPolicy === undefined &&
        pinnedEligibilityProblem(policyCheckTarget, Date.now()) !== undefined
      ) {
        // 已优先的记录被编辑成不合格的形状时，要求先显式取消优先，而不是悄悄降级。
        return failResult(
          'INVALID_TRANSITION',
          '这条记忆当前是优先带入：请先取消优先，再修改会使其不再符合资格的内容、分类或范围。',
        );
      }

      const outcome = this.store.transaction(() =>
        this.store.memories.update({
          id: request.id,
          expectedRevision: request.expectedRevision,
          patch: request.patch,
          ...(content === undefined ? {} : { normalizedHash: normalizedMemoryHash(content) }),
          ...(provenance.value === current.record.provenance
            ? {}
            : { provenance: provenance.value }),
        }),
      );
      return this.commitReceipt({
        operationId: request.operationId,
        operationKind: 'update',
        requestHash,
        effect: outcome.effect,
        committedRevisionIds: [outcome.record.revisionId],
      });
    } catch (error) {
      return mapDomainError(error);
    }
  }

  async setStatus(input: SetMemoryStatusRequest): Promise<Result<MemoryWriteReceipt>> {
    try {
      const request = setMemoryStatusRequestSchema.parse(input);
      const requestHash = requestHashOf({ kind: 'set-status', request });
      const claim = this.store.memoryOperations.claim({
        operationId: request.operationId,
        operationKind: 'set-status',
        requestHash,
      });
      if (claim.kind === 'replay') return this.receipt(claim.operation);

      const current = this.lookup(request.id);
      if (!current.ok) return current;
      const revisionCheck = this.checkRevision(current.record, request.expectedRevision);
      if (revisionCheck) return revisionCheck;
      // 新门禁与复核入口同卡生效：未复核的 legacy 记录不得被确认、续期或恢复为候选。
      if (
        needsSourceReview(current.record) &&
        (request.action === 'confirm' ||
          request.action === 'reconfirm' ||
          request.action === 'restore-candidate')
      ) {
        return failResult(
          'SOURCE_REVIEW_REQUIRED',
          '该记忆的来源尚未复核，请先在编辑中补齐来源或以用户口径重新表述。',
        );
      }
      const content = request.confirmPatch?.content;
      if (content !== undefined && isSensitiveMemoryContent(content)) {
        return failResult('SENSITIVE_CONTENT', '记忆正文疑似包含凭据，已拒绝保存。');
      }

      const outcome = this.store.transaction(() =>
        this.store.memories.applyGovernance({
          id: request.id,
          expectedRevision: request.expectedRevision,
          action: request.action,
          ...(request.confirmPatch ? { confirmPatch: request.confirmPatch } : {}),
          ...(content === undefined ? {} : { normalizedHash: normalizedMemoryHash(content) }),
        }),
      );
      return this.commitReceipt({
        operationId: request.operationId,
        operationKind: 'set-status',
        requestHash,
        effect: outcome.effect,
        committedRevisionIds: [outcome.record.revisionId],
        governanceAction: request.action,
      });
    } catch (error) {
      return mapDomainError(error);
    }
  }

  async resolveConflict(
    input: ResolveMemoryConflictRequest,
  ): Promise<Result<MemoryConflictResolutionData>> {
    try {
      const request = resolveMemoryConflictRequestSchema.parse(input);
      const requestHash = requestHashOf({ kind: 'resolve-conflict', request });
      const claim = this.store.memoryOperations.claim({
        operationId: request.operationId,
        operationKind: 'resolve-conflict',
        requestHash,
      });
      if (claim.kind === 'replay') {
        const decision = this.store.memoryOperations.findDecisionByOperation(request.operationId);
        if (!decision) return failResult('NOT_FOUND', '冲突裁决记录不存在。');
        return okResult(
          memoryConflictResolutionDataSchema.parse({
            receipt: this.buildReceipt(claim.operation, 'synced'),
            decision,
          }),
        );
      }

      const left = this.lookup(request.left.id);
      if (!left.ok) return left;
      const right = this.lookup(request.right.id);
      if (!right.ok) return right;
      const leftCheck = this.checkRevision(left.record, request.left.expectedRevision);
      if (leftCheck) return leftCheck;
      const rightCheck = this.checkRevision(right.record, request.right.expectedRevision);
      if (rightCheck) return rightCheck;
      if (left.record.id === right.record.id) {
        return failResult('INVALID_TRANSITION', '冲突裁决需要两条不同的记忆记录。');
      }

      if (request.decision === 'replace') {
        return this.resolveReplace(request, requestHash, left.record, right.record);
      }
      if (!request.applicabilityNote) {
        return failResult('CONFLICT_REVIEW_REQUIRED', '选择「两条都保留」必须写明各自的适用条件。');
      }
      const resolution = this.store.memoryOperations.recordConflictResolution({
        operationId: request.operationId,
        requestHash,
        leftRevisionId: left.record.revisionId,
        rightRevisionId: right.record.revisionId,
        decision: 'keep-both',
        applicabilityNote: request.applicabilityNote,
      });
      return okResult(
        memoryConflictResolutionDataSchema.parse({
          receipt: this.buildReceipt(resolution.operation, 'synced'),
          decision: resolution.decision,
        }),
      );
    } catch (error) {
      return mapDomainError(error);
    }
  }

  /** 启动维护：投影是可重建产物，不属于用户命令，因此不伪造 operationId 回执。 */
  async rebuildManagedProjection(): Promise<void> {
    await this.requestProjectionRebuild();
  }

  async rebuildProjection(
    input: RebuildMemoryProjectionRequest,
  ): Promise<Result<{ projectionState: 'synced' | 'pending' | 'failed' }>> {
    rebuildMemoryProjectionRequestSchema.parse(input);
    const projectionState = await this.requestProjectionRebuild();
    return okResult({ projectionState });
  }

  private commitCreate(
    request: ReturnType<typeof createMemoryRequestSchema.parse>,
    provenance: MemoryProvenance,
  ): MemoryWriteOutcome {
    return this.store.memories.create({
      facet: request.facet,
      scope: request.scope,
      content: request.content,
      normalizedHash: normalizedMemoryHash(request.content),
      provenance,
      ...(request.topicKey === undefined ? {} : { topicKey: request.topicKey }),
      ...(request.validFrom === undefined ? {} : { validFrom: request.validFrom }),
      ...(request.validUntil === undefined ? {} : { validUntil: request.validUntil }),
      confidence: USER_INSTRUCTION_CONFIDENCE,
      status: 'confirmed',
    });
  }

  private resolveReplace(
    request: ResolveMemoryConflictRequest,
    requestHash: string,
    left: MemoryRecord,
    right: MemoryRecord,
  ): Result<MemoryConflictResolutionData> {
    const winnerId = request.winnerId;
    if (!winnerId) return failResult('INVALID_TRANSITION', '替代裁决必须指明胜出的记忆。');
    if (winnerId !== left.id && winnerId !== right.id) {
      return failResult('INVALID_TRANSITION', '胜出的记忆必须是本次冲突双方之一。');
    }
    const winner = winnerId === left.id ? left : right;
    const loser = winnerId === left.id ? right : left;
    if (scopeOf(winner).kind !== scopeOf(loser).kind) {
      return failResult('SCOPE_MISMATCH', '替代只允许在规范范围一致的记忆之间进行，请先明确范围。');
    }
    const resolution = this.store.transaction(() => {
      const replacement = this.store.memories.replace({
        winnerId: winner.id,
        winnerExpectedRevision: winner.revision,
        loserId: loser.id,
        loserExpectedRevision: loser.revision,
      });
      return this.store.memoryOperations.recordConflictResolution({
        operationId: request.operationId,
        requestHash,
        leftRevisionId: left.revisionId,
        rightRevisionId: right.revisionId,
        decision: 'replace',
        winnerRevisionId: replacement.winnerRevisionId,
      });
    });
    return okResult(
      memoryConflictResolutionDataSchema.parse({
        receipt: this.buildReceipt(resolution.operation, 'synced'),
        decision: resolution.decision,
      }),
    );
  }

  /**
   * 串行队列：所有重建共用一条 Promise 链，每个等待者排到自己那一次执行，期间不并发写同一份投影。
   * 每次执行都在自己开始时同步读取最新提交，所以晚到的执行只会写出更新的状态，旧快照不可能覆盖新快照。
   */
  private requestProjectionRebuild(): Promise<'synced' | 'pending' | 'failed'> {
    this.projectionState = 'pending';
    const task = this.projectionChain.then(async () => {
      try {
        await this.rebuildProjectionFiles();
        this.projectionState = 'synced';
      } catch {
        this.projectionState = 'failed';
      }
      return this.projectionState;
    });
    this.projectionChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async commitReceipt(input: {
    operationId: string;
    operationKind: 'create' | 'update' | 'set-status';
    requestHash: string;
    effect: MemoryWriteEffect;
    committedRevisionIds: readonly string[];
    governanceAction?: MemoryGovernanceAction;
    fromMemoryRevisionId?: string;
  }): Promise<Result<MemoryWriteReceipt>> {
    this.store.memoryOperations.append({
      operationId: input.operationId,
      operationKind: input.operationKind,
      requestHash: input.requestHash,
      effect: input.effect,
      committedRevisionIds: input.committedRevisionIds,
      ...(input.governanceAction === undefined ? {} : { governanceAction: input.governanceAction }),
      ...(input.fromMemoryRevisionId === undefined
        ? {}
        : { fromMemoryRevisionId: input.fromMemoryRevisionId }),
    });
    const projectionState = await this.requestProjectionRebuild();
    return this.receipt(
      {
        operationId: input.operationId,
        operationKind: input.operationKind,
        requestHash: input.requestHash,
        effect: input.effect,
        committedRevisionIds: [...input.committedRevisionIds],
        committedAt: Date.now(),
        ...(input.governanceAction === undefined
          ? {}
          : { governanceAction: input.governanceAction }),
        ...(input.fromMemoryRevisionId === undefined
          ? {}
          : { fromMemoryRevisionId: input.fromMemoryRevisionId }),
      },
      projectionState,
    );
  }

  private async receipt(
    operation: MemoryOperationRecord,
    projectionState: 'synced' | 'pending' | 'failed' = this.projectionState,
  ): Promise<Result<MemoryWriteReceipt>> {
    return okResult(
      this.buildReceipt(operation, projectionState),
      projectionState === 'synced' ? [] : [projectionWarning()],
    );
  }

  private buildReceipt(
    operation: MemoryOperationRecord,
    projectionState: 'synced' | 'pending' | 'failed',
  ): MemoryWriteReceipt {
    const current = this.currentMemoryField(operation.committedRevisionIds);
    return memoryWriteReceiptSchema.parse({
      operationId: operation.operationId,
      commit: 'committed',
      effect: operation.effect,
      committedRevisionIds: [...operation.committedRevisionIds],
      projectionState,
      ...(operation.fromMemoryRevisionId === undefined
        ? {}
        : { fromMemoryRevisionId: operation.fromMemoryRevisionId }),
      ...current,
    });
  }

  private currentMemoryField(committedRevisionIds: readonly string[]): {
    currentMemory?: MemoryViewItem;
  } {
    const revisionId = committedRevisionIds[0];
    if (!revisionId) return {};
    const record = this.store.memories.getRevision(revisionId);
    if (!record) return {};
    return { currentMemory: this.toViewItem(record) };
  }

  private lookup(id: string): MemoryLookup {
    const record = this.store.memories.get(id);
    if (!record) return failResult('NOT_FOUND', '记忆不存在。');
    return { ok: true, record };
  }

  private checkRevision(record: MemoryRecord, expectedRevision: number): DomainFailure | undefined {
    if (record.revision === expectedRevision) return undefined;
    return failResult('REVISION_CONFLICT', '记忆已被其他操作更新，请重新加载。', record.revision);
  }

  /**
   * §5.3：自主口径重新保存只留一条审计线索——新记忆仍是人工来源、空模型依赖，
   * 但回执要能指回被重新表述的那条修订，所以这里只校验请求形状与修订确实存在。
   */
  private checkRestatementLink(request: CreateMemoryRequest): { ok: true } | DomainFailure {
    const revisionId = request.fromMemoryRevisionId;
    if (revisionId === undefined) return { ok: true };
    if (!request.asUserInstruction) {
      return failResult(
        'SOURCE_MISMATCH',
        '只有「作为我的工作口径重新保存」可以声明来源记忆，请补齐来源选择器或改用人工口径。',
      );
    }
    if (!this.store.memories.getRevision(revisionId)) {
      return failResult('NOT_FOUND', '来源记忆修订不存在，无法作为重新表述的审计线索。');
    }
    return { ok: true };
  }

  private buildCreateProvenance(
    request: ReturnType<typeof createMemoryRequestSchema.parse>,
    capturedAt: number,
    originWorkspaceId: string | undefined,
  ): ProvenanceResolution {
    if (request.asUserInstruction) {
      if (request.sourceSelector) {
        return failResult(
          'SOURCE_MISMATCH',
          '自主口径与来源选择器互斥：勾选「以我的口径记录」时不要同时提交来源选择器。',
        );
      }
      return {
        ok: true,
        value: buildUserInstructionProvenance({
          capturedAt,
          operationId: request.operationId,
          content: request.content,
          genericDeclaration: request.genericDeclaration ?? false,
          ...(originWorkspaceId ? { originWorkspaceId } : {}),
        }),
      };
    }
    const selector = request.sourceSelector;
    if (!selector) {
      return failResult('SOURCE_REVIEW_REQUIRED', '未勾选「以我的口径记录」时必须提供来源选择器。');
    }
    return this.resolveSelector(selector, capturedAt, originWorkspaceId);
  }

  private resolveSelector(
    selector: MemorySourceSelector,
    capturedAt: number,
    originWorkspaceId: string | undefined,
  ): ProvenanceResolution {
    const resolved = resolveMemorySourceSelector(selector, this.reader, {
      workspaceId: originWorkspaceId,
    });
    if (!resolved.ok) return failResult(resolved.code, resolved.message);
    return {
      ok: true,
      value: provenanceFromResolved(resolved.value, capturedAt, originWorkspaceId),
    };
  }

  private resolveReviewProvenance(
    review: UpdateMemoryRequest['legacySourceReview'],
    current: MemoryRecord,
    operationId: string,
    content: string,
  ): ProvenanceResolution {
    const originWorkspaceId = verifiedProvenance(current.provenance)?.originWorkspaceId;
    if (!needsSourceReview(current)) {
      if (review) {
        return failResult('SOURCE_MISMATCH', '该记忆的来源已复核，无需再次提交来源复核。');
      }
      return { ok: true, value: current.provenance };
    }
    if (!review) {
      return failResult(
        'SOURCE_REVIEW_REQUIRED',
        '该记忆的来源尚未复核，请先补齐来源或以用户口径重新表述。',
      );
    }
    if (review.mode === 'user-instruction') {
      return {
        ok: true,
        value: buildUserInstructionProvenance({
          capturedAt: Date.now(),
          operationId,
          content,
          genericDeclaration: review.genericDeclaration ?? false,
          ...(originWorkspaceId ? { originWorkspaceId } : {}),
        }),
      };
    }
    return this.resolveSelector(review.selector, Date.now(), originWorkspaceId);
  }

  /**
   * 待澄清口径与重复候选都按「当前全部生效记录」判定，与分页和筛选无关：
   * 一条记录是否撞口径，不取决于这一次查到了哪些记录（契约 §5.5、§5.6）。
   */
  private pendingGovernance(): PendingGovernance {
    const current = this.store.memories.list({
      includeCandidates: true,
      statuses: ['candidate', 'confirmed', 'expired'],
    });
    return {
      current,
      unresolved: unresolvedConflictPairs(
        current,
        (left, right) => this.store.memoryOperations.findDecisionForPair(left, right) !== undefined,
      ),
    };
  }

  private toViewItem(record: MemoryRecord, governance?: PendingGovernance): MemoryViewItem {
    const context = governance ?? this.pendingGovernance();
    const requiresMaterialSelection = materialDependencyCount(record) > 0;
    const effectiveStatus: MemoryEffectiveStatus = deriveEffectiveStatus(record, Date.now());
    const pending = context.unresolved.filter(
      (pair) =>
        pair.leftRevisionId === record.revisionId || pair.rightRevisionId === record.revisionId,
    );
    const decided = this.store.memoryOperations.listConflictPairsForRevisionIds([
      record.revisionId,
    ]);
    const duplicatesConfirmedMemoryId = duplicateConfirmedMemoryId(record, context.current);
    return memoryViewItemSchema.parse({
      ...record,
      effectiveStatus,
      sourceAvailability: needsSourceReview(record) ? 'review-required' : 'available',
      requiresMaterialSelection,
      conflicts: [...pending, ...decided],
      ...(duplicatesConfirmedMemoryId === undefined ? {} : { duplicatesConfirmedMemoryId }),
    });
  }

  private async rebuildProjectionFiles(): Promise<void> {
    const records = this.store.memories
      .list({ includeCandidates: false })
      .filter(
        (record) =>
          record.status === 'confirmed' &&
          record.provenance.verification === 'verified' &&
          countCodePoints(record.content) > 0,
      );
    const grouped = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      const relativePath = `${this.scopePath(record)}/index.md`;
      const current = grouped.get(relativePath) ?? [];
      current.push(record);
      grouped.set(relativePath, current);
    }

    await mkdir(this.projectionRoot, { recursive: true });
    for (const relativePath of await this.readManifest()) {
      await rm(path.join(this.projectionRoot, relativePath), { force: true });
    }
    const generated: string[] = [];
    for (const [relativePath, group] of grouped) {
      const lines = [
        '# BetterWork 记忆（受管投影）',
        '',
        '> 此文件由算台根据 SQLite 记忆记录自动生成。请通过算台管理记忆，不要手工编辑。',
        '',
      ];
      for (const record of group) {
        lines.push(`## ${record.facet} · ${scopeLabel(record)}`);
        lines.push(`- 状态：${record.status}`);
        lines.push(`- 来源：${verifiedProvenance(record.provenance)?.authority ?? '未知'}`);
        lines.push(`- 置信度：${record.confidence}`);
        lines.push(`- 修订：${record.revision}`);
        lines.push('');
        lines.push(record.content);
        lines.push('');
      }
      const destination = path.join(this.projectionRoot, relativePath);
      const temporary = `${destination}.${process.pid}.${randomSuffix()}.tmp`;
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(temporary, `${lines.join('\n')}\n`, 'utf8');
      await rename(temporary, destination);
      generated.push(relativePath);
    }
    await writeFile(`${this.manifestPath}.tmp`, JSON.stringify(generated), 'utf8');
    await rename(`${this.manifestPath}.tmp`, this.manifestPath);
  }

  private scopePath(record: MemoryRecord): string {
    switch (record.scope.kind) {
      case 'user':
        return 'user';
      case 'workspace':
        return path.join('workspaces', record.scope.workspaceId);
      case 'expert':
        return path.join('experts', record.scope.expertId);
      case 'expert-workspace':
        return path.join('expert-workspaces', record.scope.expertId, record.scope.workspaceId);
    }
  }

  private async readManifest(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (value): value is string =>
          typeof value === 'string' &&
          value.endsWith('/index.md') &&
          !value.includes('..') &&
          !path.isAbsolute(value),
      );
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }
}

let suffixCounter = 0;
const randomSuffix = (): string => `${Date.now().toString(36)}-${(suffixCounter += 1)}`;

const isMissingFileError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
