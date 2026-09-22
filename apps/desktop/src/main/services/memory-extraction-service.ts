import type {
  ModelFinishReason,
  ModelProvider,
  ModelRequest,
  ModelUsage,
} from '@betterwork/agent-core';
import { describeError, isAbortError } from '@betterwork/agent-core';
import {
  type CancelMemoryJobRequest,
  countCodePoints,
  type ExpertModelReference,
  type GetMemorySettingsRequest,
  type ListMemoryJobsRequest,
  type MaterialReference,
  MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT,
  MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS,
  MEMORY_EXTRACTION_TIMEOUT_MS,
  MEMORY_MATERIAL_DEPENDENCY_MAX,
  MEMORY_MEMORY_DEPENDENCY_MAX,
  MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS,
  type MemoryDependency,
  type MemoryError,
  type MemoryErrorCode,
  type MemoryExtractionFragment,
  type MemoryExtractionJob,
  type MemoryExtractionSource,
  type MemoryJobErrorCode,
  type MemoryJobSummary,
  memoryJobSummarySchema,
  type MemorySettingsData,
  memorySettingsWriteReceiptSchema,
  type MemorySourceRef,
  type Result,
  type RetryMemoryJobRequest,
  type SetMemorySettingsRequest,
  type WorkspaceMemorySettings,
} from '@betterwork/agent-protocol';

import { CredentialError } from '../persistence/credential-repository';
import {
  type MemoryExtractionRepository,
  type MemoryJobListPage,
  MemoryJobStateConflictError,
  MemoryQueueFullError,
} from '../persistence/memory-extraction-repository';
import {
  MemoryConflictError,
  type MemoryRepository,
  MemoryValidationError,
} from '../persistence/memory-repository';
import {
  findSensitiveMemoryContent,
  memoryContentHash,
  normalizedMemoryHash,
  normalizeMemoryText,
} from './memory-content-policy';
import {
  type AssembledExtractionRequest,
  assembleExtractionRequest,
  EXTRACTION_LIMITS,
  type ExtractionCandidate,
  type ExtractionParseResult,
  type FragmentRole,
  parseExtractionOutput,
} from './memory-extraction-prompt';
import { buildDerivedProvenance } from './memory-provenance';
import { ModelFactoryError, type ResolvedLanguageModel } from './model-provider-factory';

/**
 * 自动记忆提炼服务（契约 §7，WM09/WM10）。
 *
 * 职责边界：
 * - 设置读写与关闭开关时取消本空间自动作业（§7.3）；
 * - 作业入队（来源键去重、queued 全局 20、依赖先证明再登记）与队列排空（全局并发 1）；
 * - 严格提炼执行：只喂已登记片段、只接受 `stop` 结束原因、候选写入与作业成功同事务；
 * - 失败只落安全错误码与终态，不落提示词、模型原文、凭据或端点。
 *
 * 执行前条件不满足一律 `skipped` 并带可见错误码，绝不静默截断依赖。
 * 协议 memoryJobErrorCodeSchema 没有来源类错误码：「作业输入无法证明」（来源正文
 * 已变化、依赖记忆修订缺失、超额）统一落 `INPUT_LIMIT`，语义由本文件注释锚定，
 * 待协议补充来源类作业码后一并替换；未知存储异常归入唯一通用失败码
 * `MODEL_REQUEST_FAILED`，原始诊断只进本地日志、不落库。
 */

/** 当前自动建议同意版本；设置或作业里的 consentVersion 不等于它就不允许自动提炼。 */
export const MEMORY_SUGGESTION_CONSENT_VERSION = 1;

/** 模型未给 confidence 时候选缺省置信度：待用户审阅，不冒充已核实。 */
const DEFAULT_CANDIDATE_CONFIDENCE = 0.6;

/** 来源读取端口：Run 终态与讨论节点保存方在接线时实现（读已登记实体，不猜内容）。 */
export interface ExtractionRunSourceRecord {
  readonly kind: 'run';
  readonly runId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  /** 只允许对已成功完成的运行自动提炼。 */
  readonly completed: boolean;
  readonly prompt: string;
  /** 由接线方判定「需要消歧」才给出；不带则不送入模型。 */
  readonly backgroundAnswer?: {
    readonly runId: string;
    readonly eventId: string;
    readonly text: string;
  };
  readonly modelProfileId?: string;
  readonly materialDependencies: readonly MaterialReference[];
  readonly memoryDependencies: readonly MemoryDependency[];
}

export interface ExtractionCheckpointSourceRecord {
  readonly kind: 'checkpoint';
  readonly checkpointId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly feedback?: string;
  readonly summary?: string;
  readonly modelProfileId?: string;
  readonly materialDependencies: readonly MaterialReference[];
  readonly memoryDependencies: readonly MemoryDependency[];
}

export type ExtractionSourceRecord = ExtractionRunSourceRecord | ExtractionCheckpointSourceRecord;

export interface ExtractionSourceReader {
  readSource(source: MemoryExtractionSource): ExtractionSourceRecord | undefined;
}

/** 只依赖严格模式解析；Fake Provider 回退在这层之外就被禁止。 */
export interface ExtractionModelResolver {
  requireConfiguredLanguageModel(reference?: ExpertModelReference): Promise<ResolvedLanguageModel>;
}

export interface MemoryExtractionServiceOptions {
  readonly jobs: MemoryExtractionRepository;
  readonly memories: MemoryRepository;
  /** 候选写入、去重统计与作业成功终态必须在同一事务里提交（§7.3）。 */
  readonly transaction: <TBody>(body: () => TBody) => TBody;
  readonly sources: ExtractionSourceReader;
  readonly modelFactory: ExtractionModelResolver;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly knownSecrets?: () => readonly string[];
}

/** 自动触发入队的可见结论；不抛错，主 Run 终态永远不受提炼影响（§7.3）。 */
export type ExtractionRequestStatus = 'queued' | 'existing' | 'not-enqueued';

export interface MemoryExtractionRequestOutcome {
  readonly status: ExtractionRequestStatus;
  readonly reason?: MemoryErrorCode;
  readonly jobId?: string;
}

const okResult = <TData>(data: TData): Result<TData> => ({ ok: true, data, warnings: [] });

const errorResult = (error: MemoryError): Result<never> => ({ ok: false, error });

const domainError = (code: MemoryErrorCode, message: string, retryable = false): MemoryError => ({
  code,
  message,
  retryable,
});

const notEnqueued = (reason?: MemoryErrorCode): MemoryExtractionRequestOutcome => ({
  status: 'not-enqueued',
  ...(reason === undefined ? {} : { reason }),
});

/**
 * §5.3：创建时展开来源依赖并拒绝循环。环只可能来自库里已有的相互引用
 * （新候选是仓储生成的新身份，不会出现在自身依赖里），展开不成有限图就不建候选。
 */
const hasMemoryDependencyCycle = (
  dependencies: readonly MemoryDependency[],
  revisionDependencies: (revisionId: string) => readonly string[],
): boolean => {
  const settled = new Set<string>();
  const onPath = new Set<string>();
  const walk = (revisionId: string): boolean => {
    if (onPath.has(revisionId)) return true;
    if (settled.has(revisionId)) return false;
    onPath.add(revisionId);
    const cyclic = revisionDependencies(revisionId).some(walk);
    onPath.delete(revisionId);
    if (cyclic) return true;
    settled.add(revisionId);
    return false;
  };
  return dependencies.some((dependency) => walk(dependency.revisionId));
};

/** 仓储异常 → 契约 §9.3 错误码；仓储消息本就是可操作中文，不回显内容。 */
const mapError = (error: unknown): MemoryError => {
  if (error instanceof MemoryConflictError) {
    return domainError('REVISION_CONFLICT', describeError(error));
  }
  if (error instanceof MemoryJobStateConflictError) {
    return domainError('JOB_STATE_CONFLICT', describeError(error));
  }
  if (error instanceof MemoryQueueFullError) {
    return domainError('QUEUE_FULL', describeError(error), true);
  }
  if (error instanceof MemoryValidationError) {
    return domainError('NOT_FOUND', describeError(error));
  }
  if (error instanceof ModelFactoryError) {
    return domainError('MODEL_UNAVAILABLE', describeError(error));
  }
  if (error instanceof CredentialError) {
    return domainError('CREDENTIAL_UNAVAILABLE', '模型凭据不可用，请检查模型配置。');
  }
  return domainError('INTERNAL_ERROR', '自动提炼服务内部错误，请查看本地日志。');
};

const summaryOfJob = (job: MemoryExtractionJob): MemoryJobSummary =>
  memoryJobSummarySchema.parse({
    id: job.id,
    workspaceId: job.workspaceId,
    taskId: job.taskId,
    source: job.source,
    status: job.status,
    revision: job.revision,
    attempt: job.attempt,
    trigger: job.trigger,
    candidateCount: job.outcome?.candidateRevisionIds.length ?? 0,
    ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });

/**
 * 送入模型的片段先由本服务做首尾等分截断，产物同时满足角色限额与协议片段
 * 硬上限（MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT），装配器因此不会再截；
 * partial 标记驱动 mapStoredRange 把证据坐标映回全文。
 */
const CLAMP_LIMIT_BY_ASSEMBLER_ROLE: Record<FragmentRole, number> = {
  'user-prompt': EXTRACTION_LIMITS.userPromptMaxCodePoints,
  'assistant-answer': EXTRACTION_LIMITS.backgroundAnswerMaxCodePoints,
  'checkpoint-feedback': EXTRACTION_LIMITS.feedbackMaxCodePoints,
  'checkpoint-summary': EXTRACTION_LIMITS.summaryMaxCodePoints,
};

const STORED_ROLE_BY_ASSEMBLER_ROLE: Record<FragmentRole, MemoryExtractionFragment['role']> = {
  'user-prompt': 'run-prompt',
  'assistant-answer': 'run-assistant',
  'checkpoint-feedback': 'checkpoint-feedback',
  'checkpoint-summary': 'checkpoint-summary',
};

const ASSEMBLER_ROLE_BY_STORED_ROLE: Record<MemoryExtractionFragment['role'], FragmentRole> = {
  'run-prompt': 'user-prompt',
  'run-assistant': 'assistant-answer',
  'checkpoint-feedback': 'checkpoint-feedback',
  'checkpoint-summary': 'checkpoint-summary',
};

/** 装配器入参形状：userPrompt 必填（可为空串），其余按存在性附带。 */
interface AssemblerFields {
  userPrompt: string;
  backgroundAnswer?: string;
  checkpointFeedback?: string;
  checkpointSummary?: string;
}

/** §7.3：来源键的内容部分＝来源正文摘要，不含模型版本，换模型绕不过去重。 */
const sourceVersionHashOf = (record: ExtractionSourceRecord): string => {
  const parts =
    record.kind === 'run'
      ? [
          'run',
          record.runId,
          memoryContentHash(record.prompt),
          record.backgroundAnswer === undefined
            ? '-'
            : `${record.backgroundAnswer.runId}:${record.backgroundAnswer.eventId}:${memoryContentHash(record.backgroundAnswer.text)}`,
        ]
      : [
          'checkpoint',
          record.checkpointId,
          record.feedback === undefined ? '-' : memoryContentHash(record.feedback),
          record.summary === undefined ? '-' : memoryContentHash(record.summary),
        ];
  return memoryContentHash(parts.join('|'));
};

const TRUNCATION_MARK = '\n…（已截去中间内容）\n';
const MARKER_CODE_POINTS = countCodePoints(TRUNCATION_MARK);

interface ClampedField {
  readonly text: string;
  readonly partial: boolean;
}

/** 来源原文 → 送入片段：截断产物同时满足角色限额与协议片段硬上限。 */
const clampField = (value: string, role: FragmentRole): ClampedField => {
  const cap = Math.min(
    CLAMP_LIMIT_BY_ASSEMBLER_ROLE[role],
    MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT,
  );
  if (countCodePoints(value) <= cap) return { text: value, partial: false };
  const characters = [...value];
  const content = cap - MARKER_CODE_POINTS;
  const head = Math.floor(content / 2);
  const tail = content - head;
  return {
    text: `${characters.slice(0, head).join('')}${TRUNCATION_MARK}${characters.slice(-tail).join('')}`,
    partial: true,
  };
};

const assignAssemblerField = (target: AssemblerFields, role: FragmentRole, text: string): void => {
  switch (role) {
    case 'user-prompt':
      target.userPrompt = text;
      return;
    case 'assistant-answer':
      target.backgroundAnswer = text;
      return;
    case 'checkpoint-feedback':
      target.checkpointFeedback = text;
      return;
    case 'checkpoint-summary':
      target.checkpointSummary = text;
      return;
  }
};

/** 入队与执行共用的确定性装配输入：同一来源记录两次装配产物逐字节一致。 */
const buildModelInput = (
  record: ExtractionSourceRecord,
): { fields: AssemblerFields; partialByRole: Map<FragmentRole, boolean> } => {
  const fields: AssemblerFields = { userPrompt: '' };
  const partialByRole = new Map<FragmentRole, boolean>();
  const push = (role: FragmentRole, value: string | undefined): void => {
    if (value === undefined || value.length === 0) return;
    const clamped = clampField(value, role);
    partialByRole.set(role, clamped.partial);
    assignAssemblerField(fields, role, clamped.text);
  };
  if (record.kind === 'run') {
    push('user-prompt', record.prompt);
    push('assistant-answer', record.backgroundAnswer?.text);
  } else {
    push('checkpoint-feedback', record.feedback);
    push('checkpoint-summary', record.summary);
  }
  return { fields, partialByRole };
};

const storedFragmentsOf = (
  request: AssembledExtractionRequest,
  partialByRole: ReadonlyMap<FragmentRole, boolean>,
): MemoryExtractionFragment[] =>
  request.fragments.map((fragment) => ({
    fragmentId: fragment.id,
    role: STORED_ROLE_BY_ASSEMBLER_ROLE[fragment.role],
    text: fragment.text,
    partial: partialByRole.get(fragment.role) ?? false,
  }));

const sliceCodePoints = (value: string, start: number, end: number): string =>
  [...value].slice(start, end).join('');

interface StoredRange {
  readonly start: number;
  readonly end: number;
}

/**
 * 把片段内的 code point 区间映射回来源全文。
 * 非截断片段一一对应；截断片段只允许整体落在头部或尾部，跨越截断标记
 * 时收缩到头/尾段——无法证明的部分直接放弃，绝不虚构全文坐标。
 */
const mapStoredRange = (
  stored: MemoryExtractionFragment,
  range: StoredRange,
  liveText: string,
): StoredRange | undefined => {
  const storedLength = countCodePoints(stored.text);
  const liveLength = countCodePoints(liveText);
  if (!stored.partial) {
    return range.start < range.end && range.end <= storedLength && range.end <= liveLength
      ? { start: range.start, end: range.end }
      : undefined;
  }
  const cap = Math.min(
    CLAMP_LIMIT_BY_ASSEMBLER_ROLE[ASSEMBLER_ROLE_BY_STORED_ROLE[stored.role]],
    MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT,
  );
  const content = cap - MARKER_CODE_POINTS;
  const head = Math.floor(content / 2);
  const tail = content - head;
  const markerLength = storedLength - head - tail;
  if (markerLength !== MARKER_CODE_POINTS) return undefined;
  const markerEnd = head + markerLength;
  const start = Math.max(0, range.start);
  const end = Math.min(storedLength, range.end);
  if (end <= start) return undefined;
  if (end <= head) return { start, end };
  if (start >= markerEnd) {
    const offset = liveLength - tail - markerEnd;
    return { start: start + offset, end: end + offset };
  }
  if (start < head) return { start, end: head };
  return undefined;
};

interface CandidateWritePlan {
  readonly content: string;
  readonly normalizedHash: string;
  readonly facet: ExtractionCandidate['facet'];
  readonly confidence: number;
  readonly topicKey?: string;
  readonly provenance: ReturnType<typeof buildDerivedProvenance>;
}

const usageOf = (usage: ModelUsage | undefined): MemoryExtractionJob['usage'] => {
  if (usage === undefined) return undefined;
  return {
    ...(usage.promptTokens === undefined ? {} : { promptTokens: usage.promptTokens }),
    ...(usage.completionTokens === undefined ? {} : { completionTokens: usage.completionTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  };
};

/** 解析失败码与作业错误码同名，逐个显式映射防止漂移。 */
const parseCodeOf = (
  rejection: Extract<ExtractionParseResult, { ok: false }>,
): MemoryJobErrorCode => {
  switch (rejection.code) {
    case 'INVALID_MODEL_OUTPUT':
      return 'INVALID_MODEL_OUTPUT';
    case 'MODEL_OUTPUT_TRUNCATED':
      return 'MODEL_OUTPUT_TRUNCATED';
    case 'MODEL_TOOL_CALL_REJECTED':
      return 'MODEL_TOOL_CALL_REJECTED';
    case 'MODEL_FINISH_UNKNOWN':
      return 'MODEL_FINISH_UNKNOWN';
    case 'INPUT_LIMIT':
      return 'INPUT_LIMIT';
    case 'OUTPUT_LIMIT':
      return 'OUTPUT_LIMIT';
  }
};

type StreamOutcome =
  | {
      readonly ok: true;
      readonly raw: string;
      readonly candidates: readonly ExtractionCandidate[];
      readonly usage?: ModelUsage;
    }
  | { readonly ok: false; readonly kind: 'failed' | 'skipped'; readonly code: MemoryJobErrorCode };

export class MemoryExtractionService {
  private readonly jobs: MemoryExtractionRepository;
  private readonly memories: MemoryRepository;
  private readonly transaction: <TBody>(body: () => TBody) => TBody;
  private readonly sources: ExtractionSourceReader;
  private readonly modelFactory: ExtractionModelResolver;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly knownSecrets: () => readonly string[];
  /** jobId → 执行中的中止句柄；取消必须先落库终态，再由本表中止请求。 */
  private readonly activeControllers = new Map<string, AbortController>();
  private draining: Promise<number> | undefined;
  /** 来源依赖的下一跳：legacy 来源没有可展开的依赖。 */
  private readonly revisionDependencies = (revisionId: string): readonly string[] => {
    const provenance = this.memories.getRevision(revisionId)?.provenance;
    if (provenance === undefined || provenance.verification !== 'verified') return [];
    return provenance.memoryDependencies.map((dependency) => dependency.revisionId);
  };

  constructor(options: MemoryExtractionServiceOptions) {
    this.jobs = options.jobs;
    this.memories = options.memories;
    this.transaction = options.transaction;
    this.sources = options.sources;
    this.modelFactory = options.modelFactory;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? MEMORY_EXTRACTION_TIMEOUT_MS;
    this.knownSecrets = options.knownSecrets ?? (() => []);
  }

  // ---------------------------------------------------------------- 设置（§7.3）

  async getSettings(input: GetMemorySettingsRequest): Promise<Result<WorkspaceMemorySettings>> {
    try {
      return okResult(this.jobs.getSettings(input.workspaceId));
    } catch (error) {
      return errorResult(mapError(error));
    }
  }

  /** 开启必须携带当前同意版本；关闭在同一事务里取消本空间自动作业。 */
  async setSettings(input: SetMemorySettingsRequest): Promise<Result<MemorySettingsData>> {
    if (input.autoSuggestEnabled && input.consentVersion !== MEMORY_SUGGESTION_CONSENT_VERSION) {
      return errorResult(domainError('CONSENT_REQUIRED', '开启自动建议必须先确认当前同意版本。'));
    }
    try {
      const outcome = this.jobs.applySettings({
        workspaceId: input.workspaceId,
        expectedRevision: input.expectedRevision,
        autoSuggestEnabled: input.autoSuggestEnabled,
        ...(input.consentVersion === undefined ? {} : { consentVersion: input.consentVersion }),
      });
      const receipt = memorySettingsWriteReceiptSchema.parse({
        operationId: input.operationId,
        commit: 'committed',
        effect: outcome.effect,
        committedRevisionIds: [],
        projectionState: 'synced',
        currentSettings: outcome.settings,
      });
      return okResult<MemorySettingsData>({
        receipt,
        cancelledJobCount: outcome.cancelledJobCount,
      });
    } catch (error) {
      return errorResult(mapError(error));
    }
  }

  // ---------------------------------------------------------------- 作业查询与操作（§9.2）

  async listJobs(input: ListMemoryJobsRequest): Promise<Result<MemoryJobListPage>> {
    try {
      const page = this.jobs.listPage({
        workspaceId: input.workspaceId,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
      return okResult(page);
    } catch (error) {
      return errorResult(mapError(error));
    }
  }

  /** 单次手动重试带独立同意；不修改自动开关（§7.3）。 */
  async retryJob(input: RetryMemoryJobRequest): Promise<Result<MemoryJobSummary>> {
    if (input.consentVersion !== MEMORY_SUGGESTION_CONSENT_VERSION) {
      return errorResult(domainError('CONSENT_REQUIRED', '重试需要确认当前同意版本。'));
    }
    try {
      const existing = this.jobs.get(input.jobId);
      if (!existing) {
        return errorResult(domainError('NOT_FOUND', '提炼作业不存在。'));
      }
      const retried = this.jobs.retry({
        jobId: input.jobId,
        expectedRevision: input.expectedRevision,
        consentVersion: input.consentVersion,
        at: this.now(),
      });
      this.scheduleDrain();
      return okResult(summaryOfJob(retried));
    } catch (error) {
      return errorResult(mapError(error));
    }
  }

  /** 取消先落库终态再中止请求；执行器随后的落库会因 CAS 冲突被挡下。 */
  async cancelJob(input: CancelMemoryJobRequest): Promise<Result<MemoryJobSummary>> {
    try {
      const existing = this.jobs.get(input.jobId);
      if (!existing) {
        return errorResult(domainError('NOT_FOUND', '提炼作业不存在。'));
      }
      if (existing.status !== 'queued' && existing.status !== 'running') {
        return errorResult(
          domainError('JOB_STATE_CONFLICT', `作业已处于 ${existing.status} 终态，不能取消。`),
        );
      }
      const cancelled = this.jobs.cancel({
        jobId: input.jobId,
        expectedRevision: input.expectedRevision,
        expectedAttempt: existing.attempt,
        errorCode: 'CANCELLED',
        at: this.now(),
      });
      this.activeControllers.get(input.jobId)?.abort();
      return okResult(summaryOfJob(cancelled));
    } catch (error) {
      return errorResult(mapError(error));
    }
  }

  // ---------------------------------------------------------------- 触发入口（Run / 讨论接线调用）

  async requestExtractionForRun(runId: string): Promise<Result<MemoryExtractionRequestOutcome>> {
    return this.requestExtraction({ kind: 'run', runId });
  }

  async requestExtractionForCheckpoint(
    checkpointId: string,
  ): Promise<Result<MemoryExtractionRequestOutcome>> {
    return this.requestExtraction({ kind: 'checkpoint', checkpointId });
  }

  /**
   * 自动提炼入队：默认关闭零入队；依赖先证明再登记；队列满不阻塞、
   * 不影响主 Run 终态；同一来源版本只保留一条逻辑作业。
   */
  async requestExtraction(
    source: MemoryExtractionSource,
  ): Promise<Result<MemoryExtractionRequestOutcome>> {
    try {
      return okResult(await this.enqueueAutomatic(source));
    } catch (error) {
      return errorResult(mapError(error));
    }
  }

  // ---------------------------------------------------------------- 队列排空与启动收口（§7.3）

  /** 全局并发 1：单实例串行排空；并发调用共享同一轮排空，claim 本身是 CAS。 */
  runPendingJobs(): Promise<number> {
    if (this.draining) return this.draining;
    this.draining = this.drainLoop().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  /** 启动收口：遗留 queued/running 一律 interrupted，零网络。 */
  recoverInterruptedJobs(): number {
    return this.jobs.interruptLeftoverJobs(this.now());
  }

  private scheduleDrain(): void {
    void this.runPendingJobs().catch((error: unknown) => {
      console.error('[memory-extraction] 队列排空失败：', describeError(error));
    });
  }

  private async drainLoop(): Promise<number> {
    let executed = 0;
    for (;;) {
      const job = this.jobs.claimNext(this.now());
      if (!job) break;
      await this.executeJob(job);
      executed += 1;
    }
    return executed;
  }

  private async enqueueAutomatic(
    source: MemoryExtractionSource,
  ): Promise<MemoryExtractionRequestOutcome> {
    const record = this.sources.readSource(source);
    if (!record || (record.kind === 'run' && !record.completed)) {
      return notEnqueued('SOURCE_UNAVAILABLE');
    }
    const settings = this.jobs.getSettings(record.workspaceId);
    if (!settings.autoSuggestEnabled) return notEnqueued();
    const consentRevision = settings.consentVersion ?? 0;
    if (consentRevision !== MEMORY_SUGGESTION_CONSENT_VERSION) {
      return notEnqueued('CONSENT_REQUIRED');
    }
    // §5.3：依赖超额先于登记可见地跳过，绝不静默截断。
    if (
      record.materialDependencies.length > MEMORY_MATERIAL_DEPENDENCY_MAX ||
      record.memoryDependencies.length > MEMORY_MEMORY_DEPENDENCY_MAX
    ) {
      return notEnqueued('SOURCE_DEPENDENCY_LIMIT');
    }
    for (const dependency of record.memoryDependencies) {
      const revision = this.memories.getRevision(dependency.revisionId);
      if (!revision || revision.contentHash !== dependency.contentHash) {
        return notEnqueued('SOURCE_UNAVAILABLE');
      }
    }
    // §5.3：候选整份继承来源依赖，展开不成有限图（库里已有相互引用）就不建候选。
    if (hasMemoryDependencyCycle(record.memoryDependencies, this.revisionDependencies)) {
      return notEnqueued('SOURCE_DEPENDENCY_CYCLE');
    }
    const snapshot = buildModelInput(record);
    const fieldTexts = Object.values(snapshot.fields).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (fieldTexts.length === 0) return notEnqueued('INPUT_LIMIT');
    // §7.2：送入模型的片段先过敏感检查，命中即拒绝提炼，不落原文也不落快照。
    if (
      fieldTexts.some((text) => findSensitiveMemoryContent(text, this.knownSecrets()).length > 0)
    ) {
      return notEnqueued('SENSITIVE_CONTENT');
    }
    const request = assembleExtractionRequest(snapshot.fields);
    if (request.fragments.length === 0) return notEnqueued('INPUT_LIMIT');
    if (countCodePoints(request.text) > EXTRACTION_LIMITS.requestMaxCodePoints) {
      return notEnqueued('INPUT_LIMIT');
    }
    const reference: ExpertModelReference | undefined =
      record.modelProfileId === undefined
        ? undefined
        : { mode: 'profile', modelProfileId: record.modelProfileId };
    let resolved: ResolvedLanguageModel;
    try {
      resolved = await this.modelFactory.requireConfiguredLanguageModel(reference);
    } catch (error) {
      if (error instanceof ModelFactoryError) return notEnqueued('MODEL_UNAVAILABLE');
      if (error instanceof CredentialError) return notEnqueued('CREDENTIAL_UNAVAILABLE');
      throw error;
    }
    const fragments = storedFragmentsOf(request, snapshot.partialByRole);
    try {
      const enqueued = this.jobs.enqueue({
        source,
        workspaceId: record.workspaceId,
        taskId: record.taskId,
        fragments,
        sourceVersionHash: sourceVersionHashOf(record),
        trigger: 'automatic',
        inputCodePoints: countCodePoints(request.text),
        materialDependencies: record.materialDependencies,
        memoryDependencies: record.memoryDependencies,
        ...(record.modelProfileId === undefined ? {} : { modelProfileId: record.modelProfileId }),
        // §7.1：快照只存非敏感指纹与去 userinfo/query 的端点展示值。
        modelSnapshot: {
          fingerprint: resolved.fingerprint,
          endpointDisplay: resolved.endpointDisplay,
        },
        consentRevision,
        at: this.now(),
      });
      if (enqueued.effect === 'existing') {
        return { status: 'existing', jobId: enqueued.job.id };
      }
      this.scheduleDrain();
      return { status: 'queued', jobId: enqueued.job.id };
    } catch (error) {
      if (error instanceof MemoryQueueFullError) return notEnqueued('QUEUE_FULL');
      throw error;
    }
  }

  // ---------------------------------------------------------------- 执行器

  private async executeJob(job: MemoryExtractionJob): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);
    try {
      await this.runJob(job, controller);
    } catch (error) {
      // 执行器兜底：任何未收口异常都不能让作业停在 running 之外没有终态。
      console.error('[memory-extraction] 作业执行异常：', describeError(error));
      this.finish(job, 'failed', 'MODEL_REQUEST_FAILED');
    } finally {
      this.activeControllers.delete(job.id);
    }
  }

  private async runJob(job: MemoryExtractionJob, controller: AbortController): Promise<void> {
    // 1. 同意与开关复核：关闭或同意过期不消耗模型调用。
    const settings = this.jobs.getSettings(job.workspaceId);
    const consentFresh = job.consentRevision === MEMORY_SUGGESTION_CONSENT_VERSION;
    const automaticAllowed =
      job.trigger !== 'automatic' ||
      (settings.autoSuggestEnabled &&
        settings.consentVersion === MEMORY_SUGGESTION_CONSENT_VERSION);
    if (!consentFresh || !automaticAllowed) {
      this.finish(job, 'skipped', 'CONSENT_REQUIRED');
      return;
    }

    // 2. 来源有效性：正文已变化或来源不可读 ⇒ 作业输入无法证明（落 INPUT_LIMIT）。
    const record = this.sources.readSource(job.source);
    if (
      !record ||
      (record.kind === 'run' && !record.completed) ||
      sourceVersionHashOf(record) !== job.sourceVersionHash
    ) {
      this.finish(job, 'skipped', 'INPUT_LIMIT');
      return;
    }

    // 3. 依赖先于执行再证明一次：记忆修订必须存在且哈希一致；超额即跳过。
    if (
      job.materialDependencies.length > MEMORY_MATERIAL_DEPENDENCY_MAX ||
      job.memoryDependencies.length > MEMORY_MEMORY_DEPENDENCY_MAX
    ) {
      this.finish(job, 'skipped', 'INPUT_LIMIT');
      return;
    }
    for (const dependency of job.memoryDependencies) {
      const revision = this.memories.getRevision(dependency.revisionId);
      if (!revision || revision.contentHash !== dependency.contentHash) {
        this.finish(job, 'skipped', 'INPUT_LIMIT');
        return;
      }
    }
    // 入队后来源依赖仍要展开成有限图：期间被改出环同样不建候选。
    // 作业阶段只用 memoryJobErrorCodes，依赖证不出来一律收口成 INPUT_LIMIT。
    if (hasMemoryDependencyCycle(job.memoryDependencies, this.revisionDependencies)) {
      this.finish(job, 'skipped', 'INPUT_LIMIT');
      return;
    }

    // 4. 模型：沿用来源 Run 的配置；不可用/指纹变化 skipped，不暗换另一服务。
    const reference: ExpertModelReference | undefined =
      job.modelProfileId === undefined
        ? undefined
        : { mode: 'profile', modelProfileId: job.modelProfileId };
    let resolved: ResolvedLanguageModel;
    try {
      resolved = await this.modelFactory.requireConfiguredLanguageModel(reference);
    } catch (error) {
      if (error instanceof ModelFactoryError) {
        this.finish(job, 'skipped', 'MODEL_UNAVAILABLE');
        return;
      }
      if (error instanceof CredentialError) {
        this.finish(job, 'skipped', 'CREDENTIAL_UNAVAILABLE');
        return;
      }
      console.error('[memory-extraction] 模型解析失败：', describeError(error));
      this.finish(job, 'failed', 'MODEL_REQUEST_FAILED');
      return;
    }
    const storedFingerprint = job.modelSnapshot?.fingerprint;
    if (typeof storedFingerprint === 'string' && storedFingerprint !== resolved.fingerprint) {
      this.finish(job, 'skipped', 'MODEL_PROFILE_CHANGED');
      return;
    }

    // 5. 已登记片段再扫一次敏感内容（凭据可能是在入队之后才知道的）。
    if (
      job.fragments.some(
        (fragment) => findSensitiveMemoryContent(fragment.text, this.knownSecrets()).length > 0,
      )
    ) {
      this.finish(job, 'failed', 'SENSITIVE_CONTENT');
      return;
    }

    // 6. 来源正文已被哈希证明未变：用同一确定性装配重算送入片段，
    //    再逐段核对与已登记快照一致，任何漂移都拒绝送入模型。
    const snapshot = buildModelInput(record);
    const request = assembleExtractionRequest(snapshot.fields);
    if (
      request.fragments.length !== job.fragments.length ||
      request.fragments.some((fragment, index) => {
        const stored = job.fragments[index];
        return (
          stored === undefined ||
          stored.fragmentId !== fragment.id ||
          stored.text !== fragment.text ||
          stored.role !== STORED_ROLE_BY_ASSEMBLER_ROLE[fragment.role] ||
          stored.partial !== (snapshot.partialByRole.get(fragment.role) ?? false)
        );
      })
    ) {
      this.finish(job, 'skipped', 'INPUT_LIMIT');
      return;
    }

    const outcome = await this.streamExtraction(job, resolved.provider, request, controller);
    if (!outcome.ok) {
      this.finish(job, outcome.kind, outcome.code);
      return;
    }
    this.writeCandidates(job, record, outcome);
  }

  private async streamExtraction(
    job: MemoryExtractionJob,
    provider: ModelProvider,
    request: AssembledExtractionRequest,
    controller: AbortController,
  ): Promise<StreamOutcome> {
    const modelRequest: ModelRequest = {
      messages: [{ id: `extraction-${job.id}`, role: 'user', content: request.text }],
      tools: [],
      signal: controller.signal,
      maxOutputTokens: MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS,
    };
    let raw = '';
    let reasoningCodePoints = 0;
    let finishReason: ModelFinishReason | undefined;
    let usage: ModelUsage | undefined;
    let sawToolCall = false;
    let accumulatedOverflow = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      for await (const chunk of provider.stream(modelRequest)) {
        if (chunk.type === 'text-delta') {
          raw += chunk.delta;
        } else if (chunk.type === 'reasoning-delta') {
          // reasoning 只做额度计量，绝不落库、不成为证据。
          reasoningCodePoints += countCodePoints(chunk.delta);
        } else if (chunk.type === 'tool-call') {
          sawToolCall = true;
        } else {
          finishReason = chunk.finishReason;
          usage = chunk.usage;
        }
        if (
          countCodePoints(raw) + reasoningCodePoints >
          EXTRACTION_LIMITS.accumulatedTextMaxCodePoints
        ) {
          accumulatedOverflow = true;
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (timedOut) return { ok: false, kind: 'failed', code: 'TIMEOUT' };
        if (accumulatedOverflow) return { ok: false, kind: 'failed', code: 'OUTPUT_LIMIT' };
        // 外部取消：终态应已先落库；再试一次并由 CAS 挡下迟到写。
        return { ok: false, kind: 'failed', code: 'CANCELLED' };
      }
      console.error('[memory-extraction] 模型请求失败：', describeError(error));
      return { ok: false, kind: 'failed', code: 'MODEL_REQUEST_FAILED' };
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) return { ok: false, kind: 'failed', code: 'TIMEOUT' };
    if (accumulatedOverflow) return { ok: false, kind: 'failed', code: 'OUTPUT_LIMIT' };
    const parsed = parseExtractionOutput(raw, request.fragments, finishReason);
    if (!parsed.ok) {
      return { ok: false, kind: 'failed', code: parseCodeOf(parsed) };
    }
    if (sawToolCall) {
      return { ok: false, kind: 'failed', code: 'MODEL_TOOL_CALL_REJECTED' };
    }
    return {
      ok: true,
      raw,
      candidates: parsed.candidates,
      ...(usage === undefined ? {} : { usage }),
    };
  }

  private writeCandidates(
    job: MemoryExtractionJob,
    record: ExtractionSourceRecord,
    outcome: {
      readonly raw: string;
      readonly candidates: readonly ExtractionCandidate[];
      readonly usage?: ModelUsage;
    },
  ): void {
    if (
      outcome.candidates.some(
        (candidate) =>
          findSensitiveMemoryContent(candidate.content, this.knownSecrets()).length > 0,
      )
    ) {
      // 输出命中敏感内容：拒绝保存，不落任何原文，也不写候选。
      this.finish(job, 'failed', 'SENSITIVE_CONTENT');
      return;
    }
    const plans: CandidateWritePlan[] = [];
    let preSuppressed = 0;
    for (const candidate of outcome.candidates) {
      const content = normalizeMemoryText(candidate.content);
      if (countCodePoints(content) === 0) {
        preSuppressed += 1;
        continue;
      }
      const sources = this.sourceRefsFor(candidate, job, record);
      if (sources === undefined) {
        // 证据无法映射回可证明的来源：跳过该条建议，不伪造摘录。
        preSuppressed += 1;
        continue;
      }
      try {
        plans.push({
          content,
          normalizedHash: normalizedMemoryHash(candidate.content),
          facet: candidate.facet,
          confidence: candidate.confidence ?? DEFAULT_CANDIDATE_CONFIDENCE,
          ...(candidate.topicKey === undefined ? {} : { topicKey: candidate.topicKey }),
          // 模型无权删依赖：材料/记忆依赖整份继承作业登记。
          provenance: buildDerivedProvenance({
            capturedAt: this.now(),
            sources,
            materialDependencies: job.materialDependencies,
            memoryDependencies: job.memoryDependencies,
            originWorkspaceId: job.workspaceId,
          }),
        });
      } catch {
        // 依赖超额（防御性；协议已在登记时限死）：跳过该条建议而非截断。
        preSuppressed += 1;
      }
    }
    const usage = usageOf(outcome.usage);
    const outputCodePoints = countCodePoints(outcome.raw);
    try {
      this.transaction(() => {
        const candidateRevisionIds: string[] = [];
        let deduplicatedCount = 0;
        let suppressedCount = preSuppressed;
        for (const plan of plans) {
          const created = this.memories.create({
            facet: plan.facet,
            scope: { kind: 'workspace', workspaceId: job.workspaceId },
            content: plan.content,
            normalizedHash: plan.normalizedHash,
            provenance: plan.provenance,
            ...(plan.topicKey === undefined ? {} : { topicKey: plan.topicKey }),
            confidence: plan.confidence,
            status: 'candidate',
            candidateDisposition: 'pending',
            createdAt: this.now(),
          });
          // §5.6：重复自动候选按 scope＋normalizedHash 抑制；已拒绝候选同样抑制。
          if (created.effect === 'created') candidateRevisionIds.push(created.record.revisionId);
          else if (created.effect === 'deduplicated') deduplicatedCount += 1;
          else suppressedCount += 1;
        }
        this.jobs.succeed({
          jobId: job.id,
          expectedRevision: job.revision,
          expectedAttempt: job.attempt,
          outcome: { candidateRevisionIds, deduplicatedCount, suppressedCount },
          outputCodePoints,
          at: this.now(),
          ...(usage === undefined ? {} : { usage }),
        });
      });
    } catch (error) {
      if (error instanceof MemoryJobStateConflictError) {
        // 迟到结果（已被取消或重试）：整笔事务回滚后静默收口，不覆盖新状态。
        return;
      }
      console.error('[memory-extraction] 候选写入失败：', describeError(error));
      this.finish(job, 'failed', 'MODEL_REQUEST_FAILED');
    }
  }

  /** 候选证据 → 可证明的 SourceRef；任何一段映射失败即整条候选不可写。 */
  private sourceRefsFor(
    candidate: ExtractionCandidate,
    job: MemoryExtractionJob,
    record: ExtractionSourceRecord,
  ): MemorySourceRef[] | undefined {
    const refs: MemorySourceRef[] = [];
    const seen = new Set<string>();
    for (const evidence of candidate.evidence) {
      if (seen.has(evidence.fragmentId)) continue;
      if (refs.length >= 3) break;
      const fragment = job.fragments.find((stored) => stored.fragmentId === evidence.fragmentId);
      if (!fragment) return undefined;
      seen.add(evidence.fragmentId);
      const built = this.buildSourceRef(
        fragment,
        { start: evidence.start, end: evidence.end },
        job,
        record,
      );
      if (built === undefined) return undefined;
      refs.push(built);
    }
    return refs.length > 0 ? refs : undefined;
  }

  private buildSourceRef(
    fragment: MemoryExtractionFragment,
    range: StoredRange,
    job: MemoryExtractionJob,
    record: ExtractionSourceRecord,
  ): MemorySourceRef | undefined {
    const role = ASSEMBLER_ROLE_BY_STORED_ROLE[fragment.role];
    const excerptOf = (
      liveText: string,
    ): { excerpt: string; start: number; end: number } | undefined => {
      const mapped = mapStoredRange(fragment, range, liveText);
      if (mapped === undefined) return undefined;
      const end = Math.min(mapped.end, mapped.start + MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS);
      if (end <= mapped.start) return undefined;
      const excerpt = sliceCodePoints(liveText, mapped.start, end);
      if (countCodePoints(excerpt) !== end - mapped.start || excerpt.length === 0) {
        return undefined;
      }
      return { excerpt, start: mapped.start, end };
    };
    if (role === 'user-prompt') {
      if (record.kind !== 'run' || job.source.kind !== 'run') return undefined;
      const built = excerptOf(record.prompt);
      if (built === undefined) return undefined;
      return {
        kind: 'run-user',
        runId: job.source.runId,
        promptHash: memoryContentHash(record.prompt),
        start: built.start,
        end: built.end,
        excerpt: built.excerpt,
        excerptHash: memoryContentHash(built.excerpt),
      };
    }
    if (role === 'assistant-answer') {
      if (record.kind !== 'run' || record.backgroundAnswer === undefined) return undefined;
      const answer = record.backgroundAnswer;
      const built = excerptOf(answer.text);
      if (built === undefined) return undefined;
      return {
        kind: 'run-assistant',
        runId: answer.runId,
        eventId: answer.eventId,
        contentHash: memoryContentHash(answer.text),
        start: built.start,
        end: built.end,
        excerpt: built.excerpt,
        excerptHash: memoryContentHash(built.excerpt),
      };
    }
    if (record.kind !== 'checkpoint' || job.source.kind !== 'checkpoint') return undefined;
    const field = role === 'checkpoint-feedback' ? 'feedback' : 'summary';
    const live = field === 'feedback' ? record.feedback : record.summary;
    if (live === undefined) return undefined;
    const built = excerptOf(live);
    if (built === undefined) return undefined;
    return {
      kind: 'checkpoint',
      checkpointId: record.checkpointId,
      field,
      contentHash: memoryContentHash(live),
      start: built.start,
      end: built.end,
      excerpt: built.excerpt,
      excerptHash: memoryContentHash(built.excerpt),
    };
  }

  /** 终态写入统一收口：状态已被移动的（取消/重试/收口）由仓储 CAS 挡下，不覆盖。 */
  private finish(
    job: MemoryExtractionJob,
    kind: 'failed' | 'skipped',
    errorCode: MemoryJobErrorCode,
  ): void {
    try {
      const patch = {
        jobId: job.id,
        expectedRevision: job.revision,
        expectedAttempt: job.attempt,
        errorCode,
        at: this.now(),
      };
      if (kind === 'skipped') this.jobs.markSkipped(patch);
      else this.jobs.fail(patch);
    } catch (error) {
      if (error instanceof MemoryJobStateConflictError) return;
      console.error('[memory-extraction] 终态写入失败：', describeError(error));
    }
  }
}
