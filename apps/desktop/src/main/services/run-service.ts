import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { AgentTool, SkillInstruction } from '@betterwork/agent-core';
import { describeError, FakeModelProvider, ReActAgentEngine } from '@betterwork/agent-core';
import type {
  AgentMessage,
  AgentRuntimeEvent,
  ArtifactInputRelationInput,
  ArtifactInputRelationKind,
  BuiltinToolPolicy,
  ExpertModelReference,
  MaterialReference,
  McpToolBinding,
  RuntimeProfileCommand,
  ScriptExecution,
  StartRunRequest,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import {
  IpcChannel,
  materialReferenceSchema,
  memoryRecallPolicyV1,
} from '@betterwork/agent-protocol';
import {
  type ArtifactFileRegistrar,
  type ArtifactReader,
  type ArtifactRegisterInput,
  type ArtifactRegisterOutput,
  businessMetricsTool,
  calculatorTool,
  createArtifactReadTool,
  createArtifactRegisterFileTool,
  createKnowledgeSearchTool,
  createReadOfficeMaterialTool,
  createReadTextFileTool,
  createSkillExecuteTool,
  createSkillReadResourceTool,
  createTaskWriteFileTool,
  createWebFetchTool,
  createWebSearchTool,
  type KnowledgeSearchItem,
  type OfficeMaterialReader,
  type ReadOfficeMaterialInput,
  type ReadTextFile,
  readTextFileTool,
  type SkillCommandExecuteInput,
  type SkillCommandExecuteOutput,
  type SkillResourceReadInput,
  type SkillResourceReadOutput,
  type TaskFileWriteInput,
  type TaskFileWriteOutput,
  type WebFetch,
  type WebSearch,
} from '@betterwork/tool-runtime';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';

import { managedPath, readManagedFile, writeManagedText } from '../infrastructure/managed-files';
import type { OfficeFormat, OfficeParserService } from '../infrastructure/office-parser';
import {
  type AppStore,
  type CredentialOwnerRef,
  type InputSnapshot,
  materialReferenceKey,
  type MemoryReadInput,
} from '../persistence';
import { API_KEY_SLOT, CredentialError } from '../persistence/credential-repository';
import type { CredentialResolver } from './credential-access';
import type { FileArtifactService } from './file-artifact-service';
import type { InputSnapshotService } from './input-snapshot-service';
import type { KnowledgeVault } from './knowledge-vault';
import type { McpClientService } from './mcp-client-service';
import { withRunMemoryAudit } from './memory-dispatch-gate';
import type { MemoryExtractionService } from './memory-extraction-service';
import {
  GENERAL_TASK_CONTEXT_REVISION_ID,
  prepareRunMemoryDecision,
  type RunMemoryPreparation,
  taskTitleOf,
} from './memory-recall-service';
import { ModelProviderFactory, type ResolvedLanguageModel } from './model-provider-factory';
import type { NotificationService } from './notification-service';
import { preparePptAttempt } from './ppt-execution-attempt';
import { adaptPptCommand } from './ppt-script-adaptation';
import { createQianfanSearchClient } from './search-engine-service';
import type { AdapterContext, SkillAdapter, SkillAdapterService } from './skill-adapter';
import type { SkillDependencyService } from './skill-dependency-service';
import type { SkillExecutionService } from './skill-execution-service';
import { composeRuntimeConvention } from './skill-runtime-conventions';
import type { SkillService } from './skill-service';
import type { TaskMaterialService } from './task-material-service';
import type { ToolchainSnapshotService } from './toolchain-snapshot-service';

/** 一次执行的绑定解析结果；仅在 Run 启动前有效。 */
interface ResolvedSkillBindings {
  /** 本次 Run 建立的绑定快照 ID，顺序即注入顺序；空表示不开放 Skill 工具。 */
  bindingIds: string[];
  /** 无绑定时为 undefined，避免向模型注入空的 system 指令段。 */
  instructions?: SkillInstruction[];
}

interface ResolvedRunContext {
  skillBindings?: StartRunRequest['skillBindings'];
  expertInstruction?: string;
  modelReference?: ExpertModelReference;
  builtinToolPolicy?: BuiltinToolPolicy;
  materials: TaskMaterialSelection[];
  materialScope: boolean;
  taskContextRevisionId?: string;
  expertId?: string;
  expertRevisionId?: string;
  excludedMemoryIds: string[];
  mcpToolBindings: McpToolBinding[];
}

/** 一次执行期间的内存态；Run 结束后整条丢弃。 */
interface ActiveRun {
  taskId: string;
  prompt: string;
  controller: AbortController;
  workspacePath: string;
  /** 本次 Run 绑定的 Skill，仅用于撤销/停用级联；顺序与用户选择顺序一致。 */
  skillIds: string[];
  /** toolCallId -> 工具名，用于在 tool.completed 时判断该不该登记 Evidence。 */
  toolNames: Map<string, string>;
  contextSegmentId: string;
  materialFacts: MaterialFactLedger;
  /** 本次 Run 写入的 Markdown 工作文件；同一路径只保留最后一次写入。 */
  markdownWrites: Map<string, string>;
}

const PROMPT_SUMMARY_LENGTH = 80;
const FAILURE_DETAIL_LENGTH = 500;

interface MaterialFactLedger {
  readonly enabled: boolean;
  materialReadCount: number;
  readonly rawNumbers: Set<number>;
  readonly rawCountNumbers: Set<number>;
  readonly allowedNumbers: Set<number>;
  readonly allowedPercentages: Set<number>;
  readonly supportedQualitativeClaims: Set<string>;
}

const numberPattern = /[-+]?\d+(?:\.\d+)?/gu;
const claimNumberPattern = /([-+]?\d+(?:\.\d+)?)(\s*(?:%|％|万元|万|元|家|户|客户))/gu;
const labeledCountPattern =
  /(?:客户数|客户数量)(?:\s*[（(]\s*(?:家|户|客户)\s*[）)])?(?:\s*(?:为|是|[:：]|[|｜\t])\s*|\s*(?:本期|上期|预算|目标|当前|历史)\s*)*([-+]?\d+(?:\.\d+)?)/gu;
const markdownArtifactRequestPattern =
  /(?:保存|生成|写入|创建|导出|产出|输出|交付).*?(?:markdown|\.md)/iu;
const qualitativeClaimPatterns = [
  { phrase: '已续约', label: '已续约状态' },
  { phrase: '已流失', label: '已流失状态' },
  { phrase: '平均客单价', label: '平均客单价' },
  { phrase: '续约率', label: '续约率' },
  { phrase: '流失率', label: '流失率' },
  { phrase: '客户总数', label: '客户总数' },
  { phrase: '总客户数', label: '总客户数' },
] as const;
const qualitativeNegationPattern =
  /材料(?:未|没有)|未(?:提供|提及|确认)|不可推断|无法(?:判断|确认|推断)|待确认|不确定|未知|没有给出|不能/iu;
const qualitativeNonAssertionPattern =
  /是否|核实|确认|跟进|追踪|了解|检查|判断|若|如果|可能|意向|计划|建议/iu;

const numbersIn = (text: string): number[] =>
  [...text.matchAll(numberPattern)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));

const addNormalizedNumber = (target: Set<number>, value: number): void => {
  if (!Number.isFinite(value)) return;
  for (const precision of [0, 1, 2, 3, 4]) {
    target.add(Number(value.toFixed(precision)));
  }
  if (Math.abs(value) <= 1) {
    const percentage = value * 100;
    for (const precision of [0, 1, 2, 3, 4]) {
      target.add(Number(percentage.toFixed(precision)));
    }
  }
};

const createMaterialFactLedger = (enabled: boolean, prompt: string): MaterialFactLedger => {
  const ledger: MaterialFactLedger = {
    enabled,
    materialReadCount: 0,
    rawNumbers: new Set<number>(),
    rawCountNumbers: new Set<number>(),
    allowedNumbers: new Set<number>(),
    allowedPercentages: new Set<number>(),
    supportedQualitativeClaims: new Set<string>(),
  };
  // 用户在当前请求中明确给出的带业务单位数字属于本 Run 输入，允许模型继续引用。
  for (const match of prompt.matchAll(claimNumberPattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    ledger.rawNumbers.add(value);
    if (isCountUnit(match[2])) ledger.rawCountNumbers.add(value);
    addNormalizedNumber(ledger.allowedNumbers, value);
    if (isPercentageUnit(match[2])) addNormalizedNumber(ledger.allowedPercentages, value);
  }
  for (const match of prompt.matchAll(labeledCountPattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    ledger.rawNumbers.add(value);
    ledger.rawCountNumbers.add(value);
    addNormalizedNumber(ledger.allowedNumbers, value);
  }
  recordQualitativeClaims(ledger.supportedQualitativeClaims, prompt);
  return ledger;
};

const recordMaterialFacts = (ledger: MaterialFactLedger, text: string): void => {
  if (!ledger.enabled) return;
  recordQualitativeClaims(ledger.supportedQualitativeClaims, text);
  for (const match of text.matchAll(claimNumberPattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    if (isCountUnit(match[2])) ledger.rawCountNumbers.add(value);
    if (isPercentageUnit(match[2])) addNormalizedNumber(ledger.allowedPercentages, value);
  }
  for (const match of text.matchAll(labeledCountPattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) ledger.rawCountNumbers.add(value);
  }
  const values = numbersIn(text);
  for (const value of values) {
    ledger.rawNumbers.add(value);
    addNormalizedNumber(ledger.allowedNumbers, value);
  }
  const raw = [...ledger.rawNumbers];
  for (const current of raw) {
    for (const comparison of raw) {
      if (comparison === 0) continue;
      addNormalizedNumber(ledger.allowedNumbers, current - comparison);
      const varianceRate = ((current - comparison) / Math.abs(comparison)) * 100;
      addNormalizedNumber(ledger.allowedNumbers, varianceRate);
      addNormalizedNumber(ledger.allowedPercentages, varianceRate);
      addNormalizedNumber(ledger.allowedPercentages, (current / comparison) * 100);
    }
  }
};

const isCountUnit = (unit: string | undefined): boolean =>
  unit === '家' || unit === '户' || unit === '客户';

const isPercentageUnit = (unit: string | undefined): boolean => unit === '%' || unit === '％';

const requestsMarkdownArtifact = (prompt: string): boolean =>
  markdownArtifactRequestPattern.test(prompt) &&
  !/(?:不要|无需|不必|不需要).{0,12}(?:保存|生成|写入|创建|导出|产出|输出|交付)/u.test(prompt);

const recordQualitativeClaims = (target: Set<string>, text: string): void => {
  for (const claim of qualitativeClaimPatterns) {
    let index = text.indexOf(claim.phrase);
    while (index >= 0) {
      if (!hasNonAssertiveQualitativeClaim(text, claim.phrase, index)) {
        target.add(claim.phrase);
        break;
      }
      index = text.indexOf(claim.phrase, index + claim.phrase.length);
    }
  }
};

const hasAllowedNumber = (
  ledger: MaterialFactLedger,
  value: number,
  unit: string | undefined,
): boolean => {
  const candidates = isCountUnit(unit)
    ? ledger.rawCountNumbers
    : isPercentageUnit(unit)
      ? ledger.allowedPercentages
      : ledger.allowedNumbers;
  return [...candidates].some((candidate) => Math.abs(candidate - value) < 0.01);
};

const hasNonAssertiveQualitativeClaim = (
  content: string,
  phrase: string,
  index: number,
): boolean => {
  const context = content.slice(Math.max(0, index - 50), index + phrase.length + 50);
  return qualitativeNegationPattern.test(context) || qualitativeNonAssertionPattern.test(context);
};

const serializeToolOutput = (output: unknown): string => {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output) ?? 'undefined';
  } catch (error) {
    return `MCP 工具结果无法序列化：${describeError(error)}`;
  }
};

const officeFormatFromSnapshot = (format: string): OfficeFormat => {
  if (format === 'pptx' || format === 'xlsx' || format === 'csv') return format;
  throw new Error(`不支持的 Office 输入格式：${format}`);
};

const officeFormatFromMimeType = (mimeType: string): OfficeFormat => {
  if (mimeType === 'text/csv') return 'csv';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return 'xlsx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    return 'pptx';
  throw new Error(`不支持的 Office 成果类型：${mimeType}`);
};

/**
 * 组装一次 Run 可用的工具集。
 * `web_search` 只在存在已启用且配置了 Key 的搜索引擎时注册——
 * 给模型一个必然失败的工具只会浪费一轮调用。
 *
 * Skill 工具只在提供对应依赖时注册：无绑定的 Run 不需要它们。
 */
export const createRunTools = (dependencies: {
  knowledgeSearch: (query: string) => KnowledgeSearchItem[];
  readTextFile?: ReadTextFile;
  artifactReader?: ArtifactReader;
  webSearch?: WebSearch;
  webFetch?: WebFetch;
  officeMaterialReader?: OfficeMaterialReader;
  allowedBuiltinToolNames?: ReadonlySet<string>;
  skillResourceReader?: (input: SkillResourceReadInput) => Promise<SkillResourceReadOutput>;
  taskFileWriter?: (input: TaskFileWriteInput) => Promise<TaskFileWriteOutput>;
  skillCommandExecutor?: (input: SkillCommandExecuteInput) => Promise<SkillCommandExecuteOutput>;
  artifactFileRegistrar?: ArtifactFileRegistrar;
  mcpTools?: AgentTool[];
}): AgentTool[] => {
  const allows = (name: string): boolean =>
    !dependencies.allowedBuiltinToolNames || dependencies.allowedBuiltinToolNames.has(name);
  const tools: AgentTool[] = [];
  if (allows(calculatorTool.name)) tools.push(calculatorTool);
  if (allows(businessMetricsTool.name)) tools.push(businessMetricsTool);
  if (allows(readTextFileTool.name)) {
    tools.push(
      dependencies.readTextFile
        ? createReadTextFileTool(dependencies.readTextFile)
        : readTextFileTool,
    );
  }
  if (allows('knowledge_search'))
    tools.push(createKnowledgeSearchTool(dependencies.knowledgeSearch));
  if (dependencies.artifactReader && allows('read_artifact'))
    tools.push(createArtifactReadTool(dependencies.artifactReader));
  if (dependencies.webSearch && allows('web_search'))
    tools.push(createWebSearchTool(dependencies.webSearch));
  if (dependencies.webFetch && allows('web_fetch'))
    tools.push(createWebFetchTool(dependencies.webFetch));
  if (dependencies.officeMaterialReader && allows('read_office_material'))
    tools.push(createReadOfficeMaterialTool(dependencies.officeMaterialReader));
  if (dependencies.skillResourceReader)
    tools.push(createSkillReadResourceTool(dependencies.skillResourceReader));
  if (dependencies.taskFileWriter) tools.push(createTaskWriteFileTool(dependencies.taskFileWriter));
  if (dependencies.skillCommandExecutor)
    tools.push(createSkillExecuteTool(dependencies.skillCommandExecutor));
  if (dependencies.artifactFileRegistrar)
    tools.push(createArtifactRegisterFileTool(dependencies.artifactFileRegistrar));
  if (dependencies.mcpTools) tools.push(...dependencies.mcpTools);
  return tools;
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/**
 * 直接注入与历史继承分别登记（契约 §8.1）：同一修订两者可同时成立，
 * 但「本次读到」和「本次注入」必须是两个可区辨的事实。
 */
const memoryReadInputs = (
  store: AppStore,
  runId: string,
  memory: RunMemoryPreparation,
): MemoryReadInput[] => {
  const capturedAt = Date.now();
  const replayedViaRunIds = memory.replay
    .filter((entry) => entry.replayed)
    .map((entry) => entry.runId);
  const reads: MemoryReadInput[] = memory.selectedRecords.map((record) => ({
    runId,
    memory: record,
    capturedAt,
    selectedForInjection: true,
  }));
  const direct = new Set(memory.selectedRecords.map((record) => record.revisionId));
  for (const dependency of memory.memoryDependencyUnion) {
    if (direct.has(dependency.revisionId)) continue;
    const record = store.memories.getRevision(dependency.revisionId);
    if (!record || replayedViaRunIds.length === 0) continue;
    reads.push({
      runId,
      memory: record,
      capturedAt,
      selectedForInjection: false,
      replayedViaRunIds,
    });
  }
  return reads;
};

/**
 * 运行编排：选 Provider、选工具集、消费事件流。
 *
 * 两条不变量由本类负责：
 * 1. **先持久化再广播**——UI 不是事件的唯一消费者，崩溃后仍可从库里重放。
 * 2. **每个 Run 都有明确终态**——引擎自身会收口失败与取消，但编排层在
 *    进入事件循环前后仍可能抛错，这时用 `forceFailure` 兜底合成 `run.failed`。
 */
export class RunService {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly consumePromises = new Map<string, Promise<void>>();
  private readonly engine = new ReActAgentEngine();
  private readonly fallbackModel = new FakeModelProvider();

  constructor(
    private readonly store: AppStore,
    private readonly knowledgeVault: KnowledgeVault,
    private readonly notifications: NotificationService,
    private readonly skillService: SkillService,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly skillExecutionService?: SkillExecutionService,
    private readonly skillAdapterService?: SkillAdapterService,
    private readonly toolchainSnapshotService?: ToolchainSnapshotService,
    private readonly fileArtifactService?: FileArtifactService,
    private readonly dependencies?: SkillDependencyService,
    private readonly inputSnapshots?: InputSnapshotService,
    private readonly taskMaterials?: TaskMaterialService,
    private readonly memoryExtractions?: MemoryExtractionService,
    private readonly mcpClientService?: McpClientService,
    private readonly webFetch?: WebFetch,
    private readonly officeParser?: OfficeParserService,
    private readonly credentialAccess?: CredentialResolver,
  ) {}

  start(input: StartRunRequest): string {
    const context = this.store.tasks.getRunContext(input.taskId, input.sessionId);
    if (!context) throw new Error('Session does not belong to task');
    const workspaceId = this.store.tasks.getWorkspaceId(input.taskId);
    if (!workspaceId) throw new Error('Task workspace does not exist');
    const executionContext = this.resolveRunContext(input);
    const resolvedInput = {
      ...input,
      ...(executionContext.skillBindings ? { skillBindings: executionContext.skillBindings } : {}),
    };

    const runId = randomUUID();
    const controller = new AbortController();
    const contextSegmentId = this.resolveContextSegment(input.taskId, executionContext.materials);
    // 召回、历史重放与审计指纹在同步事务里一次算清；抛错就没有这次 Run。
    const memory = prepareRunMemoryDecision(this.store, {
      workspaceId,
      ...(executionContext.expertId ? { expertId: executionContext.expertId } : {}),
      taskId: input.taskId,
      runId,
      taskContextRevisionId:
        executionContext.taskContextRevisionId ?? GENERAL_TASK_CONTEXT_REVISION_ID,
      evaluatedAt: Date.now(),
      prompt: input.prompt,
      materials: executionContext.materials,
      excludedMemoryIds: executionContext.excludedMemoryIds,
      taskTitle: taskTitleOf(this.store, input.taskId, workspaceId),
    });
    this.activeRuns.set(runId, {
      taskId: input.taskId,
      prompt: input.prompt,
      controller,
      workspacePath: context.workspacePath,
      skillIds: (resolvedInput.skillBindings ?? []).map((binding) => binding.skillId),
      toolNames: new Map(),
      contextSegmentId,
      materialFacts: createMaterialFactLedger(
        executionContext.materialScope && executionContext.materials.length > 0,
        input.prompt,
      ),
      markdownWrites: new Map(),
    });

    try {
      this.store.transaction(() => {
        this.store.runs.create({
          id: runId,
          taskId: input.taskId,
          sessionId: input.sessionId,
          prompt: input.prompt,
          status: 'running',
          createdAt: Date.now(),
        });
        this.store.runContextSnapshots.create({
          runId,
          taskId: input.taskId,
          workspaceId,
          ...(executionContext.taskContextRevisionId
            ? { taskContextRevisionId: executionContext.taskContextRevisionId }
            : {}),
          ...(executionContext.expertId ? { expertId: executionContext.expertId } : {}),
          ...(executionContext.expertRevisionId
            ? { expertRevisionId: executionContext.expertRevisionId }
            : {}),
          ...(executionContext.modelReference
            ? { modelReference: executionContext.modelReference }
            : {}),
          ...(executionContext.builtinToolPolicy
            ? { builtinToolPolicy: executionContext.builtinToolPolicy }
            : {}),
          ...(executionContext.taskContextRevisionId
            ? { mcpToolBindings: executionContext.mcpToolBindings }
            : {}),
          contextSegmentId,
          materials: executionContext.materials,
          createdAt: Date.now(),
        });
        this.store.runMemoryContexts.recordSelection({
          runId,
          evaluatedAt: memory.queryContext.evaluatedAt,
          queryHash: memory.queryHash,
          policySnapshot: memoryRecallPolicyV1,
          selectedItems: memory.selectedItems,
          replay: memory.replay,
          materialDependencyUnion: memory.materialDependencyUnion,
          memoryDependencyUnion: memory.memoryDependencyUnion,
          decisionSummary: memory.decisionSummary,
          authorizationHash: memory.authorizationHash,
        });
        const reads = memoryReadInputs(this.store, runId, memory);
        if (reads.length > 0) this.store.memories.recordReads(reads);
        this.store.tasks.touch(input.taskId, Date.now());
      });
    } catch (error) {
      this.activeRuns.delete(runId);
      throw error;
    }

    // 事件流是异步消费的；错误全部在 consume 内部收口，这里不会有未处理 rejection。
    const consumePromise = this.consume(
      runId,
      resolvedInput,
      context.workspacePath,
      controller,
      executionContext,
      memory,
    )
      .catch((error: unknown) => {
        console.error(`Run ${runId} could not be finalized`, error);
      })
      .finally(() => {
        this.consumePromises.delete(runId);
      });
    this.consumePromises.set(runId, consumePromise);
    return runId;
  }

  cancel(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  isActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  acceptsOutput(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    return Boolean(active && !active.controller.signal.aborted);
  }

  /** 应用关闭前调用：取消所有活跃 Run，等待全部消费结束。 */
  async shutdown(): Promise<void> {
    for (const active of this.activeRuns.values()) {
      active.controller.abort();
    }
    const pending = [...this.consumePromises.values()];
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  /** 撤销信任级联：取消绑定中包含指定 Skill 的所有活跃 Run。 */
  async cancelRunsForSkill(skillId: string): Promise<number> {
    const skill = this.store.skills.get(skillId);
    const skillName = skill?.name ?? '未知技能';
    const reason = `技能「${skillName}」的信任已被撤销，本次运行被终止`;
    let cancelled = 0;
    for (const [runId, active] of this.activeRuns) {
      // 多绑定下按成员判断：指定 Skill 只是其中一个绑定时，整个 Run 仍必须停止（ADR-0012 决策 6）。
      if (active.skillIds.includes(skillId)) {
        active.controller.abort(reason);
        cancelled += 1;
        const pending = this.consumePromises.get(runId);
        if (pending) await pending;
      }
    }
    return cancelled;
  }

  private async consume(
    runId: string,
    input: StartRunRequest,
    workspacePath: string,
    controller: AbortController,
    executionContext: ResolvedRunContext,
    memory: RunMemoryPreparation,
  ): Promise<void> {
    let terminalEvent: AgentRuntimeEvent | undefined;
    try {
      if (executionContext.materialScope && this.taskMaterials) {
        await this.taskMaterials.validateSelections(input.taskId, executionContext.materials);
      }
      const resolvedModel = await this.resolveLanguageModel(executionContext.modelReference);
      const model = withRunMemoryAudit(resolvedModel.provider, {
        runId,
        sink: this.store.runMemoryContexts,
        modelSnapshot: {
          displayName: resolvedModel.displayName,
          fingerprint: resolvedModel.fingerprint,
          endpointDisplay: resolvedModel.endpointDisplay,
          ...(resolvedModel.profileId ? { modelProfileId: resolvedModel.profileId } : {}),
        },
      });
      const webSearch = await this.resolveWebSearch();
      const allowedBuiltinToolNames = this.allowedBuiltinToolNames(
        executionContext.builtinToolPolicy,
      );
      const { bindingIds, instructions: skillInstructions } = await this.resolveSkillBindings(
        runId,
        input,
      );
      const mcpTools =
        this.mcpClientService && executionContext.mcpToolBindings.length > 0
          ? await this.mcpClientService.createAgentTools(executionContext.mcpToolBindings)
          : [];
      const events = this.engine.run({
        runId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        workspacePath,
        messages: this.buildPreviousMessages(executionContext, memory),
        model,
        tools: createRunTools({
          knowledgeSearch: (query) => this.searchKnowledge(query, executionContext),
          ...(executionContext.materialScope && this.inputSnapshots
            ? {
                readTextFile: this.createScopedReadTextFile(
                  executionContext.materials,
                  workspacePath,
                ),
              }
            : {}),
          ...(executionContext.materialScope
            ? {
                artifactReader: (readInput, readContext) =>
                  this.readScopedArtifact(executionContext.materials, readInput, readContext),
              }
            : {}),
          ...(webSearch ? { webSearch } : {}),
          ...(this.webFetch ? { webFetch: this.webFetch } : {}),
          ...(executionContext.materialScope && this.officeParser
            ? {
                officeMaterialReader: (readInput, readContext) =>
                  this.readScopedOfficeMaterial(executionContext.materials, readInput, readContext),
              }
            : {}),
          ...(allowedBuiltinToolNames ? { allowedBuiltinToolNames } : {}),
          ...(bindingIds.length > 0
            ? {
                skillResourceReader: (resourceInput) =>
                  this.readSkillResource(runId, resourceInput),
                taskFileWriter: (writeInput) =>
                  this.writeTaskFile(runId, input.taskId, workspacePath, writeInput),
                skillCommandExecutor: (execInput) => this.executeSkillCommand(runId, execInput),
                ...(this.fileArtifactService
                  ? {
                      artifactFileRegistrar: (registrarInput) =>
                        this.registerFileArtifact(runId, registrarInput),
                    }
                  : {}),
              }
            : {}),
          ...(mcpTools.length > 0 ? { mcpTools } : {}),
        }),
        signal: controller.signal,
        ...(bindingIds.length > 0 ? { maxToolRounds: 40 } : {}),
        ...(executionContext.expertInstruction
          ? { expertInstruction: executionContext.expertInstruction }
          : {}),
        ...(skillInstructions ? { skillInstructions } : {}),
      });

      for await (const event of events) {
        if (isTerminalEvent(event)) {
          if (event.type === 'run.completed') {
            const factError = this.auditMaterialFacts(runId, event.finalContent);
            if (factError) throw new Error(factError);
          }
          terminalEvent = event;
          break;
        }
        this.publish(event);
      }
      if (!terminalEvent) {
        throw new Error('Agent 事件流结束时没有给出终态事件');
      }
      // 设计 §8：先清理子进程，再发布终态；清理失败走 forceFailure 兜底。
      if (this.skillExecutionService) {
        try {
          const cleanup = await this.skillExecutionService.finishRun(runId);
          if (cleanup.cleanupFailed > 0) throw new Error('未能确认全部子进程已停止');
        } catch (error) {
          terminalEvent = undefined;
          this.finalizeFailure(runId, `子进程清理失败：${describeError(error)}`);
          return;
        }
      }
      if (terminalEvent.type === 'run.completed') {
        await this.persistRequestedMarkdownArtifact(
          runId,
          input,
          workspacePath,
          executionContext,
          terminalEvent.finalContent,
        );
      }
      this.publish(terminalEvent);
      if (terminalEvent.type === 'run.completed') this.requestRunExtraction(runId);
    } catch (error) {
      let message = describeError(error);
      try {
        const cleanup = await this.skillExecutionService?.finishRun(runId);
        if (cleanup && cleanup.cleanupFailed > 0) message += '；子进程清理失败';
      } catch (cleanupError) {
        message += `；子进程清理失败：${describeError(cleanupError)}`;
      }
      this.finalizeFailure(runId, message);
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /** 兜底收口：只有 Run 仍在 running 时才会合成事件，因此与引擎自身的终态不冲突。 */
  private finalizeFailure(runId: string, message: string): void {
    const event = this.store.runs.forceFailure(runId, message, Date.now());
    if (!event) return;
    this.dispatch(event);
  }

  /**
   * 契约 §7.3：排队失败绝不能把已成功的主 Run 改成失败，因此这里不 await，
   * 只留下可解释的安全诊断；作业实际执行由提炼服务的排水循环负责。
   */
  private requestRunExtraction(runId: string): void {
    const extractions = this.memoryExtractions;
    if (!extractions) return;
    void extractions
      .requestExtractionForRun(runId)
      .then((outcome) => {
        if (!outcome.ok) {
          console.warn(`[memory-extraction] Run ${runId} 提炼未入队：${outcome.error.code}`);
        }
      })
      .catch((error: unknown) => {
        console.error('[memory-extraction] Run 成功后入队失败：', describeError(error));
      });
  }

  /**
   * 组装模型可见的历史：记忆块＋**已判定可安全重放**的问答对＋本次材料清单。
   *
   * 历史不再由本类自行遍历 Run：哪些轮次可重放、在哪一轮截断、为什么，
   * 全部来自 `prepareRunMemoryDecision` 与库里同一份快照（契约 §6.3）。
   */
  private buildPreviousMessages(
    executionContext: ResolvedRunContext,
    memory: RunMemoryPreparation,
  ): AgentMessage[] {
    const messages: AgentMessage[] = [];
    if (memory.memoryBlock) {
      messages.push({ id: randomUUID(), role: 'system', content: memory.memoryBlock });
    }
    for (const turn of memory.historyMessages) {
      messages.push({ id: randomUUID(), role: turn.role, content: turn.content });
    }
    // 放在旧对话之后、当前用户请求之前，避免旧助手回复遮蔽本次材料范围和事实边界。
    const materialMessage = this.buildMaterialContextMessage(executionContext.materials);
    if (materialMessage) messages.push(materialMessage);
    return messages;
  }

  /**
   * 将本次明确选择的材料变成模型可执行的读取清单。
   * 材料内容仍只通过受范围限制的工具提供，清单只暴露稳定身份、用途和正确的工具参数。
   */
  private buildMaterialContextMessage(
    materials: readonly TaskMaterialSelection[],
  ): AgentMessage | undefined {
    if (materials.length === 0) return undefined;

    const purposeLabels: Record<TaskMaterialSelection['purpose'], string> = {
      rule: '规则口径',
      'current-input': '本期输入',
      'historical-comparison': '历史对比',
      'structure-reference': '结构参考',
      template: '模板',
      background: '背景参考',
      other: '其他（未指定用途）',
    };
    const lines = [
      '以下是用户为本次 Run 明确选择的材料清单。材料内容不会自动出现在对话中，必须先使用清单给出的工具和参数读取。',
      '只使用这些材料中的事实和数字；如果材料无法读取或没有提供某个数字，应明确说明，不要用猜测或其他工作区文件补齐。',
      '历史对话和旧助手回复不是本次 Run 的证据；开始分析前必须重新读取清单中的材料，后续结论只依据本次 Run 成功读取的内容。',
      '不要把不同期间的客户数相加，不要把“本期未提及”解释为已续约或已流失，也不要推导材料未给出的客户数、金额或未来期间；缺少依据时写“材料未提供”。',
      '',
      '本次可读材料：',
    ];

    for (const [index, selection] of materials.entries()) {
      const reference = selection.reference;
      const purpose = purposeLabels[selection.purpose];
      if (reference.kind === 'workspace-input-snapshot') {
        const snapshot = this.store.inputSnapshots.get(reference.snapshotId);
        const sourcePath = snapshot?.sourcePath ?? reference.fileKey;
        lines.push(
          `${index + 1}. 工作区文件「${sourcePath}」【${purpose}】`,
          `   - 文本/Markdown 使用 read_text_file，path="${sourcePath}"。`,
          `   - Office 使用 read_office_material，sourceKind="workspace-input-snapshot"，snapshotId="${reference.snapshotId}"。`,
        );
        continue;
      }
      if (reference.kind === 'knowledge-revision') {
        lines.push(
          `${index + 1}. 知识修订「${reference.sourcePath}」【${purpose}】`,
          `   - 使用 knowledge_search；检索范围已限制为 knowledgeRevisionId="${reference.knowledgeRevisionId}"。`,
        );
        continue;
      }
      lines.push(
        `${index + 1}. 成果版本「${reference.artifactId} / ${reference.artifactVersionId}」【${purpose}】`,
        `   - Markdown 使用 read_artifact，artifactId="${reference.artifactId}"，versionId="${reference.artifactVersionId}"。`,
        '   - Office 使用 read_office_material，并提供对应的 artifactId 和 versionId。',
      );
    }

    return { id: randomUUID(), role: 'system', content: lines.join('\n') };
  }

  private searchKnowledge(query: string, context: ResolvedRunContext): KnowledgeSearchItem[] {
    const revisionIds = context.materials
      .filter((selection) => selection.reference.kind === 'knowledge-revision')
      .map((selection) =>
        selection.reference.kind === 'knowledge-revision'
          ? selection.reference.knowledgeRevisionId
          : '',
      )
      .filter(Boolean);
    return this.knowledgeVault
      .search(query, context.materialScope ? { revisionIds } : undefined)
      .map(({ document, locator, excerpt }) => ({ ...document, locator, excerpt }));
  }

  private resolveContextSegment(
    taskId: string,
    materials: readonly TaskMaterialSelection[],
  ): string {
    const previous = this.store.runContextSnapshots.latestByTask(taskId);
    if (!previous) return randomUUID();
    const previousKeys = new Set(previous.materials.map(materialReferenceKey));
    const currentKeys = new Set(materials.map(materialReferenceKey));
    const isShrink =
      currentKeys.size < previousKeys.size &&
      [...currentKeys].every((key) => previousKeys.has(key));
    return isShrink ? randomUUID() : previous.contextSegmentId;
  }

  private createScopedReadTextFile(
    materials: readonly TaskMaterialSelection[],
    workspacePath: string,
  ): ReadTextFile {
    const snapshots = new Map<string, InputSnapshot>();
    const ambiguousPaths = new Set<string>();
    for (const selection of materials) {
      if (selection.reference.kind !== 'workspace-input-snapshot') continue;
      const snapshot = this.store.inputSnapshots.get(selection.reference.snapshotId);
      if (!snapshot) continue;
      const key = path.normalize(snapshot.sourcePath);
      if (snapshots.has(key)) {
        ambiguousPaths.add(key);
        continue;
      }
      snapshots.set(key, snapshot);
    }
    return async (input, context) => {
      const relative = path.normalize(input.path);
      if (ambiguousPaths.has(relative)) {
        throw new Error('材料范围包含同一路径的多个输入快照，请只选择一个版本。');
      }
      const snapshot = snapshots.get(relative);
      if (!snapshot) throw new Error('材料范围不允许读取该工作区文件，请先选择输入材料。');
      if (
        snapshot.workspaceId !==
        this.store.tasks.getWorkspaceId(this.store.runs.get(context.runId)?.taskId ?? '')
      ) {
        throw new Error('输入快照不属于当前工作空间。');
      }
      if (!this.inputSnapshots || !(await this.inputSnapshots.verify(snapshot))) {
        throw new Error('输入快照缺失或已损坏，无法读取。');
      }
      if (context.signal.aborted) throw new Error('读取已取消。');
      context.reportProgress(`正在读取 ${relative}`);
      const content = await readFile(this.inputSnapshots.resolvePath(snapshot), 'utf8');
      return {
        path: path.relative(workspacePath, path.resolve(workspacePath, relative)),
        content: content.slice(0, 20_000),
        truncated: content.length > 20_000,
      };
    };
  }

  private async readScopedArtifact(
    materials: readonly TaskMaterialSelection[],
    input: Parameters<ArtifactReader>[0],
    context: Parameters<ArtifactReader>[1],
  ): Promise<unknown> {
    const selected = materials.find(
      (selection) =>
        selection.reference.kind === 'artifact-version' &&
        selection.reference.artifactId === input.artifactId &&
        selection.reference.artifactVersionId === input.versionId,
    );
    if (!selected) throw new Error('材料范围不允许读取该成果版本，请先选择准确版本。');
    if (context.signal.aborted) throw new Error('读取已取消。');
    const detail = this.store.artifacts.getVersionDetail(input.versionId);
    if (!detail || detail.artifactId !== input.artifactId) {
      throw new Error('成果版本不存在或已不可读取。');
    }
    if (detail.type !== 'markdown') {
      throw new Error('当前成果版本为演示文件，文本读取将在文件解析阶段提供。');
    }
    return {
      artifactId: detail.artifactId,
      versionId: detail.id,
      versionNumber: detail.versionNumber,
      content: detail.content,
      contentHash: detail.contentHash,
    };
  }

  private async readScopedOfficeMaterial(
    materials: readonly TaskMaterialSelection[],
    input: ReadOfficeMaterialInput,
    context: Parameters<OfficeMaterialReader>[1],
  ): Promise<unknown> {
    if (!this.officeParser) throw new Error('Office 材料解析器不可用。');
    if (context.signal.aborted) throw new Error('Office 材料读取已取消。');
    const selected = materials.find((selection) => {
      const reference = selection.reference;
      if (input.sourceKind === 'workspace-input-snapshot') {
        return (
          reference.kind === 'workspace-input-snapshot' && reference.snapshotId === input.snapshotId
        );
      }
      return (
        reference.kind === 'artifact-version' &&
        reference.artifactId === input.artifactId &&
        reference.artifactVersionId === input.versionId
      );
    });
    if (!selected) throw new Error('材料范围不允许读取该 Office 材料，请先选择准确材料。');
    const reference = selected.reference;

    let filePath: string;
    let format: OfficeFormat;
    let contentHash: string;
    if (reference.kind === 'workspace-input-snapshot') {
      const snapshot = this.store.inputSnapshots.get(reference.snapshotId);
      if (!snapshot || snapshot.status !== 'ready')
        throw new Error('输入快照不存在或尚未准备完成。');
      if (!this.inputSnapshots || !(await this.inputSnapshots.verify(snapshot)))
        throw new Error('输入快照缺失或已损坏，无法读取。');
      filePath = this.inputSnapshots.resolvePath(snapshot);
      format = officeFormatFromSnapshot(snapshot.format);
      contentHash = snapshot.contentHash;
    } else if (reference.kind === 'artifact-version') {
      const detail = this.store.artifacts.getVersionDetail(reference.artifactVersionId);
      if (!detail || detail.artifactId !== reference.artifactId)
        throw new Error('成果版本不存在或已不可读取。');
      if (detail.type !== 'presentation') throw new Error('该成果版本不是 Office 演示文件。');
      if (!this.fileArtifactService) throw new Error('成果文件服务不可用。');
      filePath = this.fileArtifactService.resolveStoredPath(detail.id);
      format = officeFormatFromMimeType(detail.mimeType);
      contentHash = detail.fileHash;
    } else {
      throw new Error('知识材料不能通过 Office 解析器读取。');
    }
    const result = await this.officeParser.parseFile(filePath, format, {
      ...(input.locator ? { locator: input.locator } : {}),
      signal: context.signal,
    });
    return {
      sourceKind: input.sourceKind,
      ...(reference.kind === 'workspace-input-snapshot'
        ? { snapshotId: reference.snapshotId }
        : reference.kind === 'artifact-version'
          ? { artifactId: reference.artifactId, versionId: reference.artifactVersionId }
          : {}),
      material: reference,
      format: result.format,
      sections: result.sections,
      warnings: result.warnings,
      contentHash,
      message: `已读取 ${result.sections.length} 个 Office 材料片段。`,
    };
  }

  /** 落库后再分发；顺序不可颠倒，否则 UI 可能看到库里还不存在的事件。 */
  private publish(event: AgentRuntimeEvent): void {
    this.store.runs.appendEvent(event);
    this.dispatch(event);
  }

  private dispatch(event: AgentRuntimeEvent): void {
    const active = this.activeRuns.get(event.runId);
    if (active) this.recordToolProgress(active, event);
    if (event.type === 'tool.completed' && active) {
      this.recordMarkdownWrite(active, event);
      this.recordMaterialFactsFromTool(active, event);
      this.persistMaterialReads(event, active.toolNames);
      this.persistEvidence(active.taskId, event, active.toolNames);
    }
    this.broadcast(event);
    if (isTerminalEvent(event) && active) this.notifyTerminal(active, event);
  }

  private recordMaterialFactsFromTool(
    active: ActiveRun,
    event: Extract<AgentRuntimeEvent, { type: 'tool.completed' }>,
  ): void {
    const toolName = active.toolNames.get(event.toolCallId);
    if (!toolName) return;
    if (toolName === 'read_text_file' && isReadTextFileOutput(event.output)) {
      active.materialFacts.materialReadCount += 1;
      recordMaterialFacts(active.materialFacts, event.output.content);
      return;
    }
    if (toolName === 'read_artifact' && isReadArtifactOutput(event.output)) {
      active.materialFacts.materialReadCount += 1;
      recordMaterialFacts(active.materialFacts, event.output.content);
      return;
    }
    if (toolName === 'read_office_material' && isOfficeMaterialReadOutput(event.output)) {
      active.materialFacts.materialReadCount += 1;
      recordMaterialFacts(
        active.materialFacts,
        JSON.stringify(event.output.sections.map((section) => officeFactValues(section.content))),
      );
      return;
    }
    if (toolName === 'knowledge_search' && isKnowledgeSearchOutput(event.output)) {
      active.materialFacts.materialReadCount += 1;
      recordMaterialFacts(
        active.materialFacts,
        event.output.results.map((result) => result.excerpt).join('\n'),
      );
      return;
    }
    if (toolName === 'analyze_business_metrics') {
      recordMaterialFacts(active.materialFacts, serializeToolOutput(event.output));
    }
  }

  private recordMarkdownWrite(
    active: ActiveRun,
    event: Extract<AgentRuntimeEvent, { type: 'tool.completed' }>,
  ): void {
    if (active.toolNames.get(event.toolCallId) !== 'task_write_file') return;
    if (!isTaskFileWriteOutput(event.output)) return;
    if (path.extname(event.output.path).toLowerCase() !== '.md') return;
    active.markdownWrites.set(event.output.path, event.output.contentHash);
  }

  /**
   * 将用户明确要求交付的 Markdown 工作文件登记为正式 Artifact。
   * 任务 work 目录只是中间产物，只有 Run 成功且事实校验、子进程清理均通过后才进入成果表。
   */
  private async persistRequestedMarkdownArtifact(
    runId: string,
    input: StartRunRequest,
    workspacePath: string,
    executionContext: ResolvedRunContext,
    finalContent: string,
  ): Promise<void> {
    if (!requestsMarkdownArtifact(input.prompt)) return;
    const active = this.activeRuns.get(runId);
    if (!active) throw new Error('Run 已结束，无法登记 Markdown 成果');

    let content = finalContent;
    let title = 'Markdown 成果';
    const latestWrite = [...active.markdownWrites.keys()].at(-1);
    if (latestWrite) {
      const workDir = path.join(
        workspacePath,
        '.betterwork',
        'tasks',
        input.taskId,
        'runs',
        runId,
        'work',
      );
      const bytes = readManagedFile(workDir, latestWrite);
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      const expectedHash = active.markdownWrites.get(latestWrite);
      if (expectedHash && actualHash !== expectedHash) {
        throw new Error(`Markdown 工作文件在登记前发生变化：${latestWrite}`);
      }
      content = bytes.toString('utf8');
      title = truncate(path.basename(latestWrite, path.extname(latestWrite)), 160);
    }
    if (content.trim().length === 0) throw new Error('未生成可登记的 Markdown 内容');

    const inputRelations = this.readArtifactInputRelations(runId, executionContext.materials);
    this.store.transaction(() => {
      const saved = this.store.artifacts.saveMarkdown({
        taskId: input.taskId,
        origin: 'assistant-run',
        runId,
        title,
        content,
      });
      if (inputRelations.length === 0) return;
      this.store.artifactInputRelations.saveForRun(
        saved.currentVersionId,
        runId,
        inputRelations,
        (relationInput) =>
          relationInput.kind === 'evidence'
            ? this.store.evidence.get(relationInput.evidenceId)?.runId === runId
            : this.store.materialReads.hasMaterialRead(
                runId,
                JSON.stringify(relationInput),
                relationInput.contentHash,
              ),
      );
    });
  }

  private readArtifactInputRelations(
    runId: string,
    materials: readonly TaskMaterialSelection[],
  ): ArtifactInputRelationInput[] {
    return materials
      .filter((selection) =>
        this.store.materialReads.hasMaterialRead(
          runId,
          JSON.stringify(selection.reference),
          selection.reference.contentHash,
        ),
      )
      .map((selection) => ({
        input: selection.reference,
        relation: artifactRelationForPurpose(selection.purpose),
      }));
  }

  private auditMaterialFacts(runId: string, content: string): string | undefined {
    const active = this.activeRuns.get(runId);
    if (!active?.materialFacts.enabled) return undefined;
    if (active.materialFacts.materialReadCount === 0) {
      return '材料事实校验失败：本次 Run 选择了材料，但没有成功读取任何材料。请先读取清单中的材料后再完成输出。';
    }
    const unsupported = new Set<number>();
    for (const match of content.matchAll(claimNumberPattern)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      const unit = match[2]?.trim();
      if (!unit) continue;
      if (!hasAllowedNumber(active.materialFacts, value, unit)) unsupported.add(value);
    }
    for (const match of content.matchAll(labeledCountPattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && !hasAllowedNumber(active.materialFacts, value, '客户')) {
        unsupported.add(value);
      }
    }
    const unsupportedQualitative = qualitativeClaimPatterns
      .filter((claim) => !active.materialFacts.supportedQualitativeClaims.has(claim.phrase))
      .filter((claim) => {
        let index = content.indexOf(claim.phrase);
        while (index >= 0) {
          if (!hasNonAssertiveQualitativeClaim(content, claim.phrase, index)) return true;
          index = content.indexOf(claim.phrase, index + claim.phrase.length);
        }
        return false;
      })
      .map((claim) => claim.label);
    if (unsupported.size > 0) {
      return `材料事实校验失败：最终输出包含本次 Run 材料或确定性工具未提供的数字（${[...unsupported].join('、')}）。请重新读取材料，并将缺失数据明确写为“材料未提供”。`;
    }
    if (unsupportedQualitative.length > 0) {
      return `材料事实校验失败：最终输出包含材料未提供的定性事实（${unsupportedQualitative.join('、')}）。请将缺失状态明确写为“材料未提供”或“不可推断”。`;
    }
    return undefined;
  }

  private recordToolProgress(active: ActiveRun, event: AgentRuntimeEvent): void {
    if (event.type === 'tool.started') active.toolNames.set(event.toolCall.id, event.toolCall.name);
  }

  private broadcast(event: AgentRuntimeEvent): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IpcChannel.RunEvent, event);
  }

  /** run 取消是用户主动行为，不产生通知（ADR-0006）。 */
  private notifyTerminal(active: ActiveRun, event: AgentRuntimeEvent): void {
    if (event.type !== 'run.completed' && event.type !== 'run.failed') return;
    const completed = event.type === 'run.completed';
    this.notifications.create(
      {
        level: completed ? 'success' : 'error',
        kind: 'run',
        title: `${completed ? '任务完成' : '任务失败'}：${truncate(active.prompt, PROMPT_SUMMARY_LENGTH)}`,
        ...(completed ? {} : { detail: truncate(event.error, FAILURE_DETAIL_LENGTH) }),
        target: { kind: 'task', taskId: active.taskId },
      },
      { systemNotify: true },
    );
  }

  private persistEvidence(
    taskId: string,
    event: Extract<AgentRuntimeEvent, { type: 'tool.completed' }>,
    toolNames: Map<string, string>,
  ): void {
    const toolName = toolNames.get(event.toolCallId);
    if (toolName === 'knowledge_search' && isKnowledgeSearchOutput(event.output)) {
      const output = event.output;
      for (const result of output.results) {
        this.store.evidence.saveLocal({
          taskId,
          runId: event.runId,
          sourceUri: result.sourcePath,
          title: result.title,
          locator: result.locator,
          excerpt: result.excerpt,
          contentHash: result.contentHash,
        });
      }
      return;
    }
    if (toolName === 'web_search' && isWebSearchOutput(event.output)) {
      for (const result of event.output.results) {
        if (!result.url) continue;
        this.store.evidence.saveWeb({
          taskId,
          runId: event.runId,
          sourceUri: result.url,
          title: result.title,
          locator: result.site || '网页',
          excerpt: result.snippet,
          contentHash: createHash('sha256')
            .update(`${result.url}\n${result.snippet}`)
            .digest('hex'),
        });
      }
    }
    if (toolName === 'web_fetch' && isWebFetchOutput(event.output)) {
      this.store.evidence.saveWeb({
        taskId,
        runId: event.runId,
        sourceUri: event.output.url,
        title: event.output.title,
        locator: `${event.output.contentType} · HTTP ${event.output.status}`,
        excerpt: event.output.content.slice(0, 2_000),
        contentHash: createHash('sha256')
          .update(`${event.output.url}\n${event.output.content}`)
          .digest('hex'),
      });
      return;
    }
    if (toolName?.startsWith('mcp_')) {
      const sourceUri = `mcp:${toolName}`;
      const excerpt = serializeToolOutput(event.output).slice(0, 2_000);
      this.store.evidence.saveMcp({
        taskId,
        runId: event.runId,
        sourceUri,
        title: toolName,
        locator: 'MCP 工具结果',
        excerpt,
        contentHash: createHash('sha256').update(`${sourceUri}\n${excerpt}`).digest('hex'),
      });
    }
  }

  private persistMaterialReads(
    event: Extract<AgentRuntimeEvent, { type: 'tool.completed' }>,
    toolNames: Map<string, string>,
  ): void {
    const snapshot = this.store.runContextSnapshots.get(event.runId);
    if (!snapshot) return;
    const toolName = toolNames.get(event.toolCallId);
    if (toolName === 'knowledge_search' && isKnowledgeSearchOutput(event.output)) {
      for (const result of event.output.results) {
        const selectedMaterial = snapshot.materials.find(
          (selection) =>
            selection.reference.kind === 'knowledge-revision' &&
            selection.reference.sourcePath === result.sourcePath &&
            selection.reference.contentHash === result.contentHash,
        )?.reference;
        const revision =
          selectedMaterial?.kind === 'knowledge-revision'
            ? undefined
            : this.knowledgeVault.findRevisionBySource(result.sourcePath, result.contentHash);
        const material: MaterialReference | undefined =
          selectedMaterial ??
          (snapshot.taskContextRevisionId || !revision
            ? undefined
            : {
                kind: 'knowledge-revision',
                knowledgeDocumentId: revision.documentId,
                knowledgeRevisionId: revision.id,
                contentHash: revision.contentHash,
                sourcePath: revision.sourcePath,
              });
        if (!material) continue;
        this.saveMaterialRead(
          event.runId,
          material,
          'search',
          result.locator,
          result.contentHash,
          result.excerpt,
        );
      }
      return;
    }
    if (toolName === 'read_text_file' && isReadTextFileOutput(event.output)) {
      const output = event.output;
      const material = snapshot.materials
        .filter((selection) => selection.reference.kind === 'workspace-input-snapshot')
        .map((selection) => selection.reference)
        .find((reference) => {
          if (reference.kind !== 'workspace-input-snapshot') return false;
          const snapshotRecord = this.store.inputSnapshots.get(reference.snapshotId);
          return (
            snapshotRecord !== undefined &&
            path.normalize(snapshotRecord.sourcePath) === path.normalize(output.path)
          );
        });
      if (material && material.kind === 'workspace-input-snapshot') {
        this.saveMaterialRead(
          event.runId,
          material,
          'read',
          output.path,
          material.contentHash,
          output.content,
        );
      }
      return;
    }
    if (toolName === 'read_artifact' && isReadArtifactOutput(event.output)) {
      const output = event.output;
      const material = snapshot.materials.find(
        (selection) =>
          selection.reference.kind === 'artifact-version' &&
          selection.reference.artifactId === output.artifactId &&
          selection.reference.artifactVersionId === output.versionId &&
          selection.reference.contentHash === output.contentHash,
      )?.reference;
      if (material) {
        this.saveMaterialRead(
          event.runId,
          material,
          'read',
          `artifact-version:${output.versionId}`,
          output.contentHash,
          output.content,
        );
      }
      return;
    }
    if (toolName === 'read_office_material' && isOfficeMaterialReadOutput(event.output)) {
      const output = event.output;
      const selectedMaterial = snapshot.materials.find((selection) =>
        sameMaterialReference(selection.reference, output.material),
      )?.reference;
      if (!selectedMaterial) return;
      const sections = output.sections;
      if (sections.length === 0) {
        this.saveMaterialRead(
          event.runId,
          selectedMaterial,
          'parse',
          'document',
          output.contentHash,
          'Office 材料未产生可读取片段。',
        );
        return;
      }
      for (const section of sections) {
        const excerpt = JSON.stringify(section.content).slice(0, 20_000);
        this.saveMaterialRead(
          event.runId,
          selectedMaterial,
          'parse',
          section.locator,
          output.contentHash,
          excerpt,
        );
      }
    }
  }

  private saveMaterialRead(
    runId: string,
    material: MaterialReference,
    operation: 'search' | 'read' | 'parse',
    locator: string,
    contentHash: string,
    excerpt: string,
  ): void {
    this.store.materialReads.save({
      id: randomUUID(),
      runId,
      material,
      operation,
      locator,
      contentHash,
      excerptHash: createHash('sha256').update(excerpt).digest('hex'),
      capturedAt: Date.now(),
    });
  }

  /** 语言模型解析统一走 Main 内共享工厂；未配置时保持既有的教学 Provider 回落（契约 §7.1）。 */
  private async resolveLanguageModel(
    reference?: ExpertModelReference,
  ): Promise<ResolvedLanguageModel> {
    return new ModelProviderFactory({
      models: this.store.models,
      ...(this.credentialAccess ? { credentialAccess: this.credentialAccess } : {}),
      fallbackProvider: this.fallbackModel,
    }).resolveForRun(reference);
  }

  /**
   * 新读优先：done→从 credentials 取明文；pending/failed→拒绝新 Run（不回落明文）；
   * none→用旧列（回滚窗口/keyless）。未注入凭据访问点时保持原列行为，兼容旧测试。
   */
  private async credentialSecret(
    ref: CredentialOwnerRef,
    legacyPlaintext: string,
  ): Promise<string> {
    const access = this.credentialAccess;
    if (!access) return legacyPlaintext;
    const status = access.migrationStatus(ref);
    if (status === 'pending' || status === 'failed') {
      throw new CredentialError(
        'credential_migration_required',
        '相关凭据尚未完成加密迁移，请确认应用已成功启动并迁移后重试',
      );
    }
    if (status === 'done') return access.resolveSecret(ref);
    return legacyPlaintext;
  }

  private allowedBuiltinToolNames(policy?: BuiltinToolPolicy): ReadonlySet<string> | undefined {
    if (!policy || policy.mode === 'application-defaults') return undefined;
    return new Set(policy.toolNames);
  }

  private resolveRunContext(input: StartRunRequest): ResolvedRunContext {
    if (!input.taskContextRevisionId) {
      return {
        ...(input.skillBindings ? { skillBindings: input.skillBindings } : {}),
        materials: [],
        materialScope: false,
        excludedMemoryIds: [],
        mcpToolBindings: [],
      };
    }
    const expected = input.expectedTaskContextRevision;
    if (expected === undefined) throw new Error('TaskContextRevision 缺少期望修订号');
    const context = this.store.taskContexts.get(input.taskContextRevisionId, input.taskId);
    if (!context) throw new Error('TaskContextRevision 不存在或不属于当前 Task');
    if (context.revision !== expected) {
      throw new Error(`TaskContextRevision 已更新：期望 ${expected}，当前为 ${context.revision}`);
    }
    if (input.skillBindings && input.skillBindings.length > 0) {
      throw new Error('TaskContextRevision 与直接 Skill 绑定不能同时提交');
    }
    if (context.executor.kind === 'general') {
      return {
        ...(context.skillBindings.length > 0 ? { skillBindings: context.skillBindings } : {}),
        ...(context.modelReference ? { modelReference: context.modelReference } : {}),
        ...(context.builtinToolPolicy ? { builtinToolPolicy: context.builtinToolPolicy } : {}),
        materials: context.materials ?? [],
        materialScope: true,
        taskContextRevisionId: context.id,
        excludedMemoryIds: context.excludedMemoryIds ?? [],
        mcpToolBindings: context.mcpToolBindings ?? [],
      };
    }
    const expert = this.store.experts.get(context.executor.expertId);
    if (!expert) throw new Error(`Expert 不存在：${context.executor.expertId}`);
    if (expert.lifecycle !== 'active') throw new Error(`Expert「${expert.name}」当前不可用`);
    const revision = this.store.experts.getRevision(
      context.executor.expertId,
      context.executor.expertRevisionId,
    );
    if (!revision) throw new Error('Expert 修订不存在或不属于该 Expert');
    return {
      skillBindings: context.skillBindings,
      expertInstruction: this.composeExpertInstruction(revision),
      modelReference: context.modelReference ?? revision.modelReference,
      builtinToolPolicy: context.builtinToolPolicy ?? revision.builtinToolPolicy,
      materials: context.materials ?? [],
      materialScope: true,
      taskContextRevisionId: context.id,
      expertId: context.executor.expertId,
      expertRevisionId: context.executor.expertRevisionId,
      excludedMemoryIds: context.excludedMemoryIds ?? [],
      mcpToolBindings: context.mcpToolBindings ?? [],
    };
  }

  private composeExpertInstruction(revision: {
    identity: string;
    principles: string[];
    inputRequirements: string[];
    deliveryRequirements: string[];
  }): string {
    const lines = ['以下是当前 Expert 的工作方式，请在本次任务中遵循：', '', revision.identity];
    if (revision.principles.length > 0) {
      lines.push('', '工作原则：', ...revision.principles.map((item) => `- ${item}`));
    }
    if (revision.inputRequirements.length > 0) {
      lines.push('', '输入要求：', ...revision.inputRequirements.map((item) => `- ${item}`));
    }
    if (revision.deliveryRequirements.length > 0) {
      lines.push(
        '',
        '交付与检查要求：',
        ...revision.deliveryRequirements.map((item) => `- ${item}`),
      );
    }
    return lines.join('\n');
  }

  private async resolveWebSearch(): Promise<WebSearch | undefined> {
    const engine = this.store.searchEngines.getEnabled();
    if (!engine) return undefined;
    const apiKey = await this.credentialSecret(
      { ownerKind: 'api-service-profile', ownerId: engine.provider, slot: API_KEY_SLOT },
      engine.apiKey,
    );
    if (!apiKey) return undefined;
    // 显式包一层：直接摘出 client.search 会脱离 this 绑定，类型系统无法证明它安全
    const client = createQianfanSearchClient({ ...engine, apiKey });
    return (query, signal) => client.search(query, signal);
  }

  /**
   * 能力绑定解析（ADR-0012 决策 3/5）：按用户选择顺序先整体校验前置条件，再逐个建立绑定快照、读取指令快照。
   * 任一 Skill 不满足条件即抛错，整个 Run 不启动——不允许静默少装一个技能。
   * 没有显式绑定时什么都不做：不延续同 Task 的历史绑定。
   * 没有执行服务时只注入指令、不开放 Skill 工具，保持提示词试运行的既有语义。
   */
  private async resolveSkillBindings(
    runId: string,
    input: StartRunRequest,
  ): Promise<ResolvedSkillBindings> {
    const requested = input.skillBindings ?? [];
    if (requested.length === 0) return { bindingIds: [] };
    // 先整体校验再落快照：任一技能不合格时，不得留下半个绑定记录。
    const selected = requested.map(({ skillId, revisionId }) => {
      const skill = this.store.skills.get(skillId);
      if (!skill) throw new Error(`Skill ${skillId} does not exist`);
      if (revisionId && revisionId !== skill.revision.id)
        throw new Error(`Skill「${skill.name}」的修订已变化，请重新选择后再运行`);
      if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
      if (skill.trustStatus !== 'trusted')
        throw new Error(`Skill「${skill.name}」尚未信任，无法运行`);
      return skill;
    });
    const bindingIds: string[] = [];
    const instructions: SkillInstruction[] = [];
    for (const skill of selected) {
      const binding = this.skillExecutionService?.createBinding({ runId, skillId: skill.id });
      if (binding) bindingIds.push(binding.id);
      // 有快照时按快照读，运行期间不受后续编辑影响；无快照时退回当前修订。
      const snapshot = binding
        ? this.store.skills.getBoundDetail(binding.skillRevisionId, binding.profileRevisionId)
        : skill;
      if (!snapshot) throw new Error(`Skill「${skill.name}」的绑定快照缺失，无法运行`);
      if (snapshot.runtimeProfile?.profile.commands.length)
        await this.skillService.verifyResourceRoot(snapshot);
      const instruction = await this.skillService.readSkillInstruction(snapshot);
      if (binding && snapshot.runtimeProfile?.profile.commands.length) {
        // 命令表逐条带上自己的 bindingId 与技能名：多绑定下模型只拿 commandId 无法寻址到哪个 Skill。
        const commands = snapshot.runtimeProfile.profile.commands;
        const adapter = this.skillAdapterService?.findAdapter(snapshot.revision.contentHash);
        const presetConventions = adapter?.runtimeConventions?.(
          new Set(commands.map((command) => command.commandId)),
        );
        instruction.instruction += composeRuntimeConvention({
          bindingId: binding.id,
          skillName: skill.name,
          commands,
          ...(presetConventions ? { presetConventions } : {}),
        });
      }
      // 正文为空时不注入：否则会给模型一条只剩标题的空 system 段。
      if (instruction.instruction.trim().length > 0) instructions.push(instruction);
    }
    return { bindingIds, instructions };
  }

  /**
   * 资源读取桥接：bindingId → Skill → 资源根 → 路径校验 → 读取。
   * bindingId 由模型提供，因此必须先确认它属于本 Run，不能只靠存在性检查。
   */
  private async readSkillResource(
    runId: string,
    input: SkillResourceReadInput,
  ): Promise<SkillResourceReadOutput> {
    const binding = this.store.executions.getBinding(input.bindingId);
    if (!binding) throw new Error(`Binding ${input.bindingId} does not exist`);
    if (binding.runId !== runId) {
      throw new Error(`Binding ${input.bindingId} does not belong to run ${runId}`);
    }
    const skill = this.store.skills.getBoundDetail(
      binding.skillRevisionId,
      binding.profileRevisionId,
    );
    if (!skill) throw new Error('Skill not found for binding');
    if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
    if (!this.store.executions.isBindingAuthorized(binding.id))
      throw new Error(`Skill「${skill.name}」尚未信任`);
    const resourceRoot = await this.skillService.resolveResourceRoot(skill);
    const target = path.resolve(resourceRoot, input.path);
    const realRoot = await realpath(resourceRoot);
    const realTarget = await realpath(target).catch(() => target);
    if (!isWithinRoot(realRoot, realTarget)) {
      throw new Error(`Resource path escapes skill root: ${input.path}`);
    }
    const content = await readFile(realTarget);
    return { content, relativePath: path.relative(realRoot, realTarget) };
  }

  /** 任务文件写入桥接：解析工作目录 → 路径校验 → 冲突检测 → 写入。 */
  private async writeTaskFile(
    runId: string,
    taskId: string,
    workspacePath: string,
    input: TaskFileWriteInput,
  ): Promise<TaskFileWriteOutput> {
    const workDir = path.join(workspacePath, '.betterwork', 'tasks', taskId, 'runs', runId, 'work');
    const relativeDirectory = path.relative(workspacePath, workDir);
    managedPath(workspacePath, path.join(relativeDirectory, input.path), true);
    const active = this.activeRuns.get(runId);
    if (!active || active.controller.signal.aborted) throw new Error('Run is no longer active');
    return writeManagedText(workDir, input.path, input.content, input.expectedHash);
  }

  /** 文件成果登记桥接：工具入参 → FileArtifactService → 结构化返回。 */
  private async registerFileArtifact(
    runId: string,
    input: ArtifactRegisterInput,
  ): Promise<ArtifactRegisterOutput> {
    if (!this.fileArtifactService) {
      throw new Error('File artifact service is not available');
    }
    const result = await this.fileArtifactService.register({
      runId,
      executionId: input.executionId,
      outputId: input.outputId,
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      title: input.title,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.validation ? { validation: input.validation } : {}),
    });
    return {
      artifactId: result.artifactId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      fileKey: result.fileKey,
      fileHash: result.fileHash,
      fileSize: result.fileSize,
      message: `文件成果已登记：${input.title}`,
    };
  }

  /**
   * 命令执行桥接：binding → profile → command → 构建执行规格 → 启动 → 等待结果。
   * bindingId 由模型从指令里的命令表取得，必须先确认它属于本 Run 才能取用其环境与授权。
   */
  private async executeSkillCommand(
    runId: string,
    input: SkillCommandExecuteInput,
  ): Promise<SkillCommandExecuteOutput> {
    if (!this.skillExecutionService) {
      throw new Error('Skill execution service is not available');
    }
    const bindingId = input.bindingId;
    const binding = this.store.executions.getBinding(bindingId);
    if (!binding) throw new Error(`Binding ${bindingId} does not exist`);
    if (binding.runId !== runId) {
      throw new Error(`Binding ${bindingId} does not belong to run ${runId}`);
    }
    const skill = this.store.skills.getBoundDetail(
      binding.skillRevisionId,
      binding.profileRevisionId,
    );
    if (!skill) throw new Error('Skill not found for binding');
    if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
    if (!this.store.executions.isBindingAuthorized(bindingId)) {
      throw new Error(`Skill「${skill.name}」尚未信任`);
    }
    const profile = skill.runtimeProfile;
    if (!profile) throw new Error('Skill has no runtime profile');
    const command = profile.profile.commands.find((cmd) => cmd.commandId === input.commandId);
    if (!command) {
      throw new Error(`Command ${input.commandId} is not registered in this Skill profile`);
    }
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun || activeRun.controller.signal.aborted)
      throw new Error(`Run ${runId} is not active`);
    z.fromJSONSchema(command.argumentSchema).parse(input.args);
    const workRelativePath = path.join(
      '.betterwork',
      'tasks',
      activeRun.taskId,
      'runs',
      runId,
      'work',
    );
    const cwd = path.dirname(
      managedPath(activeRun.workspacePath, path.join(workRelativePath, '.ready'), true),
    );

    const adapter = this.skillAdapterService?.findAdapter(skill.revision.contentHash);
    if (adapter) {
      return this.executeWithAdapter(runId, bindingId, input, command, skill, adapter, cwd);
    }

    if (
      !command.executableKey.startsWith('scripts/') ||
      !command.executableKey.endsWith('.py') ||
      command.validatorId
    ) {
      throw new Error('未匹配受支持的执行适配预设；通用入口必须是 Skill 内已授权的 scripts/*.py');
    }
    const resourceRoot = await this.skillService.verifyResourceRoot(skill);
    const script = managedPath(resourceRoot, command.executableKey);
    if (!binding.environmentId || !this.dependencies) throw new Error('绑定的运行环境不可用');
    const python = this.dependencies.resolveEnvironmentPython(binding.environmentId);
    const argv = [script, ...this.buildArgv(command, input.args)];
    const env = this.buildCleanEnv();
    const execution = await this.skillExecutionService.startExecution({
      runId,
      bindingId,
      signal: this.runSignal(runId),
      toolCallId: input.toolCallId,
      commandId: input.commandId,
      args: input.args,
      argv,
      executable: python,
      cwd,
      env,
      timeoutMs: command.timeoutMs,
      maxOutputBytes: 32 * 1024,
      maxLogBytes: 10 * 1024 * 1024,
      expectedOutputs: command.expectedOutputs,
      ...(command.validatorId ? { validatorId: command.validatorId } : {}),
      workDirKey: createHash('sha256').update(cwd).digest('hex'),
    });
    const awaited = await this.skillExecutionService.awaitExecution(execution.id);
    return this.formatExecutionResult(awaited);
  }

  /** 适配预设路径：adapter 解析 executable/argv/env，执行后可覆盖结果解释。 */
  private async executeWithAdapter(
    runId: string,
    bindingId: string,
    input: SkillCommandExecuteInput,
    command: RuntimeProfileCommand,
    skill: NonNullable<ReturnType<AppStore['skills']['getBoundDetail']>>,
    adapter: SkillAdapter,
    cwd: string,
  ): Promise<SkillCommandExecuteOutput> {
    if (!this.skillExecutionService) {
      throw new Error('Skill execution service is not available');
    }
    const skillScriptsRoot = await this.skillService.verifyResourceRoot(skill);
    const binding = this.store.executions.getBinding(bindingId);
    if (!binding?.environmentId || !this.dependencies) throw new Error('绑定的运行环境不可用');
    const toolchainSnapshotRoot = this.resolveToolchainSnapshotRoot(binding.dependencySnapshotIds);
    for (const snapshotId of binding.dependencySnapshotIds) {
      const verification = await this.toolchainSnapshotService?.verifySnapshot(snapshotId);
      if (!verification?.valid) throw new Error('绑定的工具链快照内容已变化，请重新登记并确认授权');
    }
    const adapterContext: AdapterContext = {
      skillScriptsRoot,
      ...(toolchainSnapshotRoot ? { toolchainSnapshotRoot, pptmHome: toolchainSnapshotRoot } : {}),
      managedPythonPath: this.dependencies.resolveEnvironmentPython(binding.environmentId),
      runWorkDir: cwd,
    };
    const attemptArgs = preparePptAttempt(input.commandId, input.args, cwd, skillScriptsRoot);
    const candidate = adapter.resolveCommand(input.commandId, attemptArgs, adapterContext);
    if (!candidate) {
      throw new Error(`Adapter ${adapter.name} cannot resolve command ${input.commandId}`);
    }
    const resolved = adaptPptCommand(input.commandId, candidate, skillScriptsRoot);
    const execution = await this.skillExecutionService.startExecution({
      runId,
      bindingId,
      signal: this.runSignal(runId),
      toolCallId: input.toolCallId,
      commandId: input.commandId,
      args: input.args,
      argv: resolved.argv,
      executable: resolved.executable,
      cwd: resolved.cwd,
      env: resolved.env,
      timeoutMs: command.timeoutMs,
      maxOutputBytes: 32 * 1024,
      maxLogBytes: 10 * 1024 * 1024,
      expectedOutputs:
        input.commandId === 'pptx-validate' && resolved.argv[1]
          ? [path.relative(cwd, resolved.argv[1])]
          : command.expectedOutputs,
      ...(input.commandId === 'pptx-validate' ? { validatorId: 'pptx-validate' } : {}),
      workDirKey: createHash('sha256').update(cwd).digest('hex'),
    });
    const awaited = await this.skillExecutionService.awaitExecution(execution.id);
    const result = this.formatExecutionResult(awaited);
    return { ...result, message: `${result.message}；本次参数：${JSON.stringify(attemptArgs)}` };
  }

  private resolveToolchainSnapshotRoot(snapshotIds: string[]): string | undefined {
    if (!this.toolchainSnapshotService || snapshotIds.length === 0) return undefined;
    if (snapshotIds.length !== 1) throw new Error('PPT 预设需要明确绑定一个工具链快照');
    const id = snapshotIds[0];
    const snapshot = id ? this.store.snapshots.getSnapshot(id) : undefined;
    if (!snapshot) throw new Error('绑定的工具链快照不存在');
    return this.toolchainSnapshotService.resolveSnapshotRoot(snapshot);
  }

  private runSignal(runId: string): AbortSignal {
    const active = this.activeRuns.get(runId);
    if (!active || active.controller.signal.aborted) throw new Error('Run is no longer active');
    return active.controller.signal;
  }

  private buildArgv(command: RuntimeProfileCommand, args: Record<string, unknown>): string[] {
    const argv: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;
      if (value === false) continue;
      argv.push(`--${key}`);
      if (value === true) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        argv.push(String(value));
      } else {
        argv.push(JSON.stringify(value));
      }
    }
    return argv;
  }

  private buildCleanEnv(): Record<string, string> {
    return {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TZ: 'UTC',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
      PYTHONNOUSERSITE: '1',
    };
  }

  private formatExecutionResult(awaited: {
    execution: ScriptExecution;
    stdout: string;
    stderr: string;
    outputTruncated: boolean;
  }): SkillCommandExecuteOutput {
    const { execution, stdout, stderr } = awaited;
    const common = {
      executionId: execution.id,
      ...(stdout ? { stdout } : {}),
      ...(stderr ? { stderr } : {}),
      ...(execution.reportHash ? { reportHash: execution.reportHash } : {}),
      ...(execution.outputIds.length > 0 ? { outputIds: execution.outputIds } : {}),
    };
    if (execution.status === 'succeeded') {
      return { ...common, status: 'succeeded', message: `命令执行成功` };
    }
    if (execution.status === 'failed') {
      return {
        ...common,
        status: 'failed',
        ...(execution.reason ? { reason: execution.reason } : {}),
        message: `命令执行失败：${execution.reason ?? 'unknown'}`,
      };
    }
    if (execution.status === 'timed-out') {
      return {
        ...common,
        status: 'timed-out',
        ...(execution.reason ? { reason: execution.reason } : {}),
        message: `命令执行超时`,
      };
    }
    return {
      ...common,
      status: 'cancelled',
      ...(execution.reason ? { reason: execution.reason } : {}),
      message: `命令已取消`,
    };
  }
}

const isTerminalEvent = (event: AgentRuntimeEvent): boolean =>
  event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled';

interface KnowledgeSearchOutputItem {
  title: string;
  sourcePath: string;
  locator: string;
  excerpt: string;
  contentHash: string;
}

const isKnowledgeSearchOutput = (
  value: unknown,
): value is { results: KnowledgeSearchOutputItem[] } => {
  if (!isRecord(value) || !Array.isArray(value.results)) return false;
  return value.results.every(
    (result) =>
      isRecord(result) &&
      isString(result.title) &&
      isString(result.sourcePath) &&
      isString(result.locator) &&
      isString(result.excerpt) &&
      isString(result.contentHash),
  );
};

interface ReadTextFileOutput {
  path: string;
  content: string;
}

const isReadTextFileOutput = (value: unknown): value is ReadTextFileOutput =>
  isRecord(value) && isString(value.path) && isString(value.content);

interface ReadArtifactOutput {
  artifactId: string;
  versionId: string;
  contentHash: string;
  content: string;
}

const isReadArtifactOutput = (value: unknown): value is ReadArtifactOutput =>
  isRecord(value) &&
  isString(value.artifactId) &&
  isString(value.versionId) &&
  isString(value.contentHash) &&
  isString(value.content);

interface WebSearchOutputItem {
  title: string;
  url: string;
  snippet: string;
  site?: string;
}

interface WebFetchOutput {
  url: string;
  title: string;
  content: string;
  contentType: string;
  status: number;
}

interface OfficeMaterialReadOutput {
  material: MaterialReference;
  format: OfficeFormat;
  sections: Array<{ locator: string; content: unknown }>;
  contentHash: string;
}

const isOfficeMaterialReadOutput = (value: unknown): value is OfficeMaterialReadOutput => {
  if (!isRecord(value) || !materialReferenceSchema.safeParse(value.material).success) return false;
  if (
    !isOfficeFormat(value.format) ||
    !isString(value.contentHash) ||
    !Array.isArray(value.sections)
  )
    return false;
  return value.sections.every(
    (section) => isRecord(section) && isString(section.locator) && 'content' in section,
  );
};

const isOfficeFormat = (value: unknown): value is OfficeFormat =>
  value === 'pptx' || value === 'xlsx' || value === 'csv';

const officeFactValues = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(officeFactValues);
  if (!isRecord(value)) return value;
  if ('value' in value) return officeFactValues(value.value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'address' && key !== 'locator')
      .map(([key, child]) => [key, officeFactValues(child)]),
  );
};

const artifactRelationForPurpose = (
  purpose: TaskMaterialSelection['purpose'],
): ArtifactInputRelationKind => {
  switch (purpose) {
    case 'rule':
      return 'rule';
    case 'current-input':
      return 'data';
    case 'historical-comparison':
      return 'comparison';
    case 'structure-reference':
      return 'structure';
    case 'template':
      return 'template';
    case 'background':
      return 'background';
    case 'other':
      return 'other';
  }
};

const isTaskFileWriteOutput = (value: unknown): value is { path: string; contentHash: string } =>
  isRecord(value) && isString(value.path) && isString(value.contentHash);

const sameMaterialReference = (left: MaterialReference, right: MaterialReference): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'knowledge-revision' && right.kind === 'knowledge-revision')
    return left.knowledgeRevisionId === right.knowledgeRevisionId;
  if (left.kind === 'artifact-version' && right.kind === 'artifact-version')
    return left.artifactVersionId === right.artifactVersionId;
  if (left.kind === 'workspace-input-snapshot' && right.kind === 'workspace-input-snapshot')
    return left.snapshotId === right.snapshotId;
  return false;
};

const isWebFetchOutput = (value: unknown): value is WebFetchOutput =>
  isRecord(value) &&
  isString(value.url) &&
  isString(value.title) &&
  isString(value.content) &&
  isString(value.contentType) &&
  typeof value.status === 'number';

const isWebSearchOutput = (value: unknown): value is { results: WebSearchOutputItem[] } => {
  if (!isRecord(value) || !Array.isArray(value.results)) return false;
  return value.results.every(
    (result) =>
      isRecord(result) &&
      isString(result.title) &&
      isString(result.url) &&
      isString(result.snippet),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isWithinRoot = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};
