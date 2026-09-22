import { createHash } from 'node:crypto';

import type {
  ListWorkspaceReferenceVersionsRequest,
  MaterialReference,
  MemoryError,
  MemoryOperationRecord,
  MemoryReferenceWriteReceipt,
  MemoryWarning,
  RemoveWorkspaceReferenceVersionRequest,
  Result,
  SetWorkspaceReferenceVersionRequest,
  WorkspaceArtifactReference,
  WorkspaceReferenceListData,
  WorkspaceReferenceSetData,
} from '@betterwork/agent-protocol';
import {
  listWorkspaceReferenceVersionsRequestSchema,
  memoryErrorSchema,
  memoryReferenceWriteReceiptSchema,
  removeWorkspaceReferenceVersionRequestSchema,
  setWorkspaceReferenceVersionRequestSchema,
  stableStringifyJson,
  workspaceReferenceListDataSchema,
  workspaceReferenceSetDataSchema,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { MemoryIdempotencyConflictError } from '../persistence/memory-operation-repository';
import { MemoryConflictError, MemoryValidationError } from '../persistence/memory-repository';
import {
  WorkspaceReferenceLimitError,
  WorkspaceReferenceMismatchError,
  WorkspaceReferenceUnavailableError,
} from '../persistence/workspace-reference-repository';

/**
 * 成果版本参考标记的 Main 侧服务（契约 §10、§9.3，通道 workspace:*-reference-version）。
 *
 * 标记只表示「用户指定这一精确版本」，不表示审批；固定 versionId＋contentHash，
 * 不跟随 latest；同空间 active 标记 ≤20，跨空间、版本缺失、超上限一律领域失败。
 *
 * 契约未写死之处按最贴近 docs/development/memory-contracts.md 的口径实现：
 * 1. §5.6「事务包含业务修订和回执」：claim 先行判定幂等，仓储写入与
 *    memoryOperations.append 同处一个 store.transaction()；失败不留回执，
 *    同一 operationId 可以原样重试。replay 依据回执修订读回「当前最新展示状态」。
 * 2. HISTORY_REFERENCE_BLOCKS_DELETE 对「取消参考」的约束：移除是软删除、行仍可审计，
 *    真正不可逆的是历史运行上下文快照已消费的版本身份——当该精确版本仍是本空间任一
 *    已持久化 Run 的材料时拒绝移除；与版本删除入口的
 *    assessVersionDeletionBlock（外键 RESTRICT）互为补充。
 * 3. 参考没有 Markdown 投影：回执 projectionState 恒为 synced，warnings 恒为空。
 */

const requestHashOf = (value: unknown): string =>
  createHash('sha256').update(stableStringifyJson(value)).digest('hex');

interface DomainFailure {
  ok: false;
  error: MemoryError;
}
type ReferenceLookup = { ok: true; reference: WorkspaceArtifactReference } | DomainFailure;
type MaterialLookup = { ok: true; value: MaterialReference } | DomainFailure;

type ParsedSetRequest = ReturnType<typeof setWorkspaceReferenceVersionRequestSchema.parse>;

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
 * 判定只看错误类型；消息文本已由仓储给出可操作中文。
 */
const mapDomainError = (error: unknown): DomainFailure => {
  if (error instanceof MemoryIdempotencyConflictError) {
    return failResult('IDEMPOTENCY_CONFLICT', '该操作已以不同内容提交过，请使用新的操作标识重试。');
  }
  if (error instanceof MemoryConflictError) {
    return failResult('REVISION_CONFLICT', error.message);
  }
  if (error instanceof WorkspaceReferenceMismatchError) {
    return failResult('REFERENCE_WORKSPACE_MISMATCH', error.message);
  }
  if (error instanceof WorkspaceReferenceLimitError) {
    return failResult('REFERENCE_LIMIT', error.message);
  }
  if (error instanceof WorkspaceReferenceUnavailableError) {
    return failResult('REFERENCE_UNAVAILABLE', error.message);
  }
  if (error instanceof MemoryValidationError) {
    return failResult('INTERNAL_ERROR', '参考标记写入未命中唯一行，请重新加载后重试。');
  }
  throw error;
};

export class WorkspaceReferenceService {
  constructor(private readonly deps: { store: AppStore }) {}

  /** workspace:list-reference-versions：active 标记＋版本可用性（哈希不符即 unavailable）。 */
  listReferenceVersions(
    input: ListWorkspaceReferenceVersionsRequest,
  ): Result<WorkspaceReferenceListData> {
    try {
      const request = listWorkspaceReferenceVersionsRequestSchema.parse(input);
      const items = this.deps.store.workspaceReferences.listActiveWithAvailability(
        request.workspaceId,
      );
      return okResult(workspaceReferenceListDataSchema.parse({ items }));
    } catch (error) {
      return mapDomainError(error);
    }
  }

  /** workspace:set-reference-version：expectedRevision 新建为 0；回执附带既有 MaterialReference。 */
  setReferenceVersion(
    input: SetWorkspaceReferenceVersionRequest,
  ): Result<WorkspaceReferenceSetData> {
    try {
      const request = setWorkspaceReferenceVersionRequestSchema.parse(input);
      const requestHash = requestHashOf({ kind: 'set-reference', request });
      const claim = this.deps.store.memoryOperations.claim({
        operationId: request.operationId,
        operationKind: 'set-reference',
        requestHash,
      });
      if (claim.kind === 'replay') return this.replaySet(claim.operation);
      const stale = this.checkSetRevision(request);
      if (stale) return stale;

      const committed = this.deps.store.transaction(() => {
        const write = this.deps.store.workspaceReferences.set({
          workspaceId: request.workspaceId,
          artifactVersionId: request.artifactVersionId,
          expectedRevision: request.expectedRevision,
          ...(request.label === undefined ? {} : { label: request.label }),
        });
        const operation = this.deps.store.memoryOperations.append({
          operationId: request.operationId,
          operationKind: 'set-reference',
          requestHash,
          effect: write.effect,
          committedRevisionIds: [write.reference.id],
        });
        return { operation, write };
      });
      return okResult(
        workspaceReferenceSetDataSchema.parse({
          receipt: this.buildReceipt(committed.operation, committed.write.reference),
          material: committed.write.material,
        }),
      );
    } catch (error) {
      return mapDomainError(error);
    }
  }

  /** workspace:remove-reference-version：软删除；被历史运行材料消费时拒绝。 */
  removeReferenceVersion(
    input: RemoveWorkspaceReferenceVersionRequest,
  ): Result<MemoryReferenceWriteReceipt> {
    try {
      const request = removeWorkspaceReferenceVersionRequestSchema.parse(input);
      const requestHash = requestHashOf({ kind: 'remove-reference', request });
      const claim = this.deps.store.memoryOperations.claim({
        operationId: request.operationId,
        operationKind: 'remove-reference',
        requestHash,
      });
      if (claim.kind === 'replay') {
        const lookup = this.currentReference(claim.operation);
        if (!lookup.ok) return lookup;
        return okResult(this.buildReceipt(claim.operation, lookup.reference));
      }

      const existing = this.deps.store.workspaceReferences.get(request.id);
      if (!existing) {
        return failResult('REFERENCE_UNAVAILABLE', '参考标记不存在，请重新加载后重试。');
      }
      if (existing.revision !== request.expectedRevision) {
        return failResult(
          'REVISION_CONFLICT',
          '参考标记已被其他操作更新，请重新加载后重试。',
          existing.revision,
        );
      }
      if (
        existing.status === 'active' &&
        this.historyConsumesVersion(existing.workspaceId, existing.artifactVersionId)
      ) {
        return failResult(
          'HISTORY_REFERENCE_BLOCKS_DELETE',
          '该成果版本仍是本空间历史运行的材料，暂时不能取消参考。',
        );
      }

      const committed = this.deps.store.transaction(() => {
        const write = this.deps.store.workspaceReferences.remove({
          id: request.id,
          expectedRevision: request.expectedRevision,
        });
        const operation = this.deps.store.memoryOperations.append({
          operationId: request.operationId,
          operationKind: 'remove-reference',
          requestHash,
          effect: write.effect,
          committedRevisionIds: [write.reference.id],
        });
        return { operation, write };
      });
      return okResult(this.buildReceipt(committed.operation, committed.write.reference));
    } catch (error) {
      return mapDomainError(error);
    }
  }

  /** CAS 预检给出 currentRevision；仓储在事务内还会按同一口径复核一次。 */
  private checkSetRevision(request: ParsedSetRequest): DomainFailure | undefined {
    const existing = this.deps.store.workspaceReferences.find(
      request.workspaceId,
      request.artifactVersionId,
    );
    if (!existing) {
      if (request.expectedRevision !== 0) {
        return failResult('REVISION_CONFLICT', '该成果版本还没有参考标记，请以期望修订 0 新建。');
      }
      return undefined;
    }
    if (existing.revision !== request.expectedRevision) {
      return failResult(
        'REVISION_CONFLICT',
        '参考标记已被其他操作更新，请重新加载后重试。',
        existing.revision,
      );
    }
    return undefined;
  }

  /** §5.6：重复提交返回原提交效果＋当前最新展示状态，不再写第二遍。 */
  private replaySet(operation: MemoryOperationRecord): Result<WorkspaceReferenceSetData> {
    const lookup = this.currentReference(operation);
    if (!lookup.ok) return lookup;
    const material = this.materialOf(lookup.reference);
    if (!material.ok) return material;
    return okResult(
      workspaceReferenceSetDataSchema.parse({
        receipt: this.buildReceipt(operation, lookup.reference),
        material: material.value,
      }),
    );
  }

  private currentReference(operation: MemoryOperationRecord): ReferenceLookup {
    const referenceId = operation.committedRevisionIds[0];
    if (referenceId === undefined) {
      return failResult('REFERENCE_UNAVAILABLE', '参考回执缺少标记身份，请重新加载后重试。');
    }
    const reference = this.deps.store.workspaceReferences.get(referenceId);
    if (!reference) {
      return failResult('REFERENCE_UNAVAILABLE', '参考标记已不可见，请重新加载后重试。');
    }
    return { ok: true, reference };
  }

  /** 版本行被 RESTRICT 外键挡住不会被物理删除；artifactId 从成果仓储读回，不猜。 */
  private materialOf(reference: WorkspaceArtifactReference): MaterialLookup {
    const version = this.deps.store.artifacts.getVersionDetail(reference.artifactVersionId);
    if (!version) {
      return failResult('REFERENCE_UNAVAILABLE', '被参考的成果版本已不可读，请重新选择。');
    }
    return {
      ok: true,
      value: {
        kind: 'artifact-version',
        artifactId: version.artifactId,
        artifactVersionId: reference.artifactVersionId,
        contentHash: reference.contentHash,
        originWorkspaceId: reference.workspaceId,
      },
    };
  }

  private buildReceipt(
    operation: MemoryOperationRecord,
    reference: WorkspaceArtifactReference,
  ): MemoryReferenceWriteReceipt {
    return memoryReferenceWriteReceiptSchema.parse({
      operationId: operation.operationId,
      commit: 'committed',
      effect: operation.effect,
      committedRevisionIds: [...operation.committedRevisionIds],
      projectionState: 'synced',
      currentReference: reference,
    });
  }

  /** 头注释第 2 条：历史运行上下文快照仍是「不可撤销的消费」，逐 Run 材料核对。 */
  private historyConsumesVersion(workspaceId: string, artifactVersionId: string): boolean {
    for (const run of this.deps.store.runs.list()) {
      const snapshot = this.deps.store.runContextSnapshots.get(run.id);
      if (!snapshot || snapshot.workspaceId !== workspaceId) continue;
      const consumed = snapshot.materials.some(
        (material) =>
          material.reference.kind === 'artifact-version' &&
          material.reference.artifactVersionId === artifactVersionId,
      );
      if (consumed) return true;
    }
    return false;
  }
}
