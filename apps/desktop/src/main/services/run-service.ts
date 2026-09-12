import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { AgentTool, ModelProvider, SkillInstruction } from '@betterwork/agent-core';
import {
  describeError,
  FakeModelProvider,
  OpenAICompatibleProvider,
  ReActAgentEngine,
} from '@betterwork/agent-core';
import type {
  AgentMessage,
  AgentRuntimeEvent,
  RuntimeProfileCommand,
  ScriptExecution,
  StartRunRequest,
} from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import {
  type ArtifactFileRegistrar,
  type ArtifactRegisterInput,
  type ArtifactRegisterOutput,
  calculatorTool,
  createArtifactRegisterFileTool,
  createKnowledgeSearchTool,
  createSkillExecuteTool,
  createSkillReadResourceTool,
  createTaskWriteFileTool,
  createWebSearchTool,
  type KnowledgeSearchItem,
  readTextFileTool,
  type SkillCommandExecuteInput,
  type SkillCommandExecuteOutput,
  type SkillResourceReadInput,
  type SkillResourceReadOutput,
  type TaskFileWriteInput,
  type TaskFileWriteOutput,
  type WebSearch,
} from '@betterwork/tool-runtime';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';

import { managedPath, writeManagedText } from '../infrastructure/managed-files';
import type { AppStore } from '../persistence';
import type { FileArtifactService } from './file-artifact-service';
import type { KnowledgeVault } from './knowledge-vault';
import type { NotificationService } from './notification-service';
import { preparePptAttempt } from './ppt-execution-attempt';
import { adaptPptCommand } from './ppt-script-adaptation';
import { createQianfanSearchClient } from './search-engine-service';
import type { AdapterContext, SkillAdapter, SkillAdapterService } from './skill-adapter';
import type { SkillDependencyService } from './skill-dependency-service';
import type { SkillExecutionService } from './skill-execution-service';
import { composeRuntimeConvention } from './skill-runtime-conventions';
import type { SkillService } from './skill-service';
import type { ToolchainSnapshotService } from './toolchain-snapshot-service';

/** 一次执行的绑定解析结果；仅在 Run 启动前有效。 */
interface ResolvedSkillBindings {
  /** 本次 Run 建立的绑定快照 ID，顺序即注入顺序；空表示不开放 Skill 工具。 */
  bindingIds: string[];
  /** 无绑定时为 undefined，避免向模型注入空的 system 指令段。 */
  instructions?: SkillInstruction[];
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
}

const PROMPT_SUMMARY_LENGTH = 80;
const FAILURE_DETAIL_LENGTH = 500;

/**
 * 组装一次 Run 可用的工具集。
 * `web_search` 只在存在已启用且配置了 Key 的搜索引擎时注册——
 * 给模型一个必然失败的工具只会浪费一轮调用。
 *
 * Skill 工具只在提供对应依赖时注册：无绑定的 Run 不需要它们。
 */
export const createRunTools = (dependencies: {
  knowledgeSearch: (query: string) => KnowledgeSearchItem[];
  webSearch?: WebSearch;
  skillResourceReader?: (input: SkillResourceReadInput) => Promise<SkillResourceReadOutput>;
  taskFileWriter?: (input: TaskFileWriteInput) => Promise<TaskFileWriteOutput>;
  skillCommandExecutor?: (input: SkillCommandExecuteInput) => Promise<SkillCommandExecuteOutput>;
  artifactFileRegistrar?: ArtifactFileRegistrar;
}): AgentTool[] => {
  const tools: AgentTool[] = [
    calculatorTool,
    readTextFileTool,
    createKnowledgeSearchTool(dependencies.knowledgeSearch),
  ];
  if (dependencies.webSearch) tools.push(createWebSearchTool(dependencies.webSearch));
  if (dependencies.skillResourceReader)
    tools.push(createSkillReadResourceTool(dependencies.skillResourceReader));
  if (dependencies.taskFileWriter) tools.push(createTaskWriteFileTool(dependencies.taskFileWriter));
  if (dependencies.skillCommandExecutor)
    tools.push(createSkillExecuteTool(dependencies.skillCommandExecutor));
  if (dependencies.artifactFileRegistrar)
    tools.push(createArtifactRegisterFileTool(dependencies.artifactFileRegistrar));
  return tools;
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

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
  ) {}

  start(input: StartRunRequest): string {
    const context = this.store.tasks.getRunContext(input.taskId, input.sessionId);
    if (!context) throw new Error('Session does not belong to task');

    const runId = randomUUID();
    const controller = new AbortController();
    this.activeRuns.set(runId, {
      taskId: input.taskId,
      prompt: input.prompt,
      controller,
      workspacePath: context.workspacePath,
      skillIds: (input.skillBindings ?? []).map((binding) => binding.skillId),
      toolNames: new Map(),
    });

    this.store.transaction(() => {
      this.store.runs.create({
        id: runId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        status: 'running',
        createdAt: Date.now(),
      });
      this.store.tasks.touch(input.taskId, Date.now());
    });

    // 事件流是异步消费的；错误全部在 consume 内部收口，这里不会有未处理 rejection。
    const consumePromise = this.consume(runId, input, context.workspacePath, controller)
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
    let cancelled = 0;
    for (const [runId, active] of this.activeRuns) {
      // 多绑定下按成员判断：指定 Skill 只是其中一个绑定时，整个 Run 仍必须停止（ADR-0012 决策 6）。
      if (active.skillIds.includes(skillId)) {
        active.controller.abort();
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
  ): Promise<void> {
    let terminalEvent: AgentRuntimeEvent | undefined;
    try {
      const model = this.resolveModel();
      const webSearch = this.resolveWebSearch();
      const { bindingIds, instructions: skillInstructions } = await this.resolveSkillBindings(
        runId,
        input,
      );
      const events = this.engine.run({
        runId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        workspacePath,
        messages: this.buildPreviousMessages(input.taskId, runId),
        model,
        tools: createRunTools({
          knowledgeSearch: (query) =>
            this.knowledgeVault
              .search(query)
              .map(({ document, locator, excerpt }) => ({ ...document, locator, excerpt })),
          ...(webSearch ? { webSearch } : {}),
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
        }),
        signal: controller.signal,
        ...(bindingIds.length > 0 ? { maxToolRounds: 40 } : {}),
        ...(skillInstructions ? { skillInstructions } : {}),
      });

      for await (const event of events) {
        if (isTerminalEvent(event)) {
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
      this.publish(terminalEvent);
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
   * 把同一 Task 下早于当前 Run 的已完成对话轮次重建为消息历史，
   * 只取用户提问与助手最终回复，跳过工具调用细节以避免跨 Run 的工具 ID 配对问题。
   */
  private buildPreviousMessages(taskId: string, currentRunId: string): AgentMessage[] {
    const previousRuns = this.store.runs
      .listByTask(taskId)
      .filter((run) => run.status === 'completed' && run.id !== currentRunId);

    const messages: AgentMessage[] = [];
    for (const run of previousRuns) {
      messages.push({ id: randomUUID(), role: 'user', content: run.prompt });

      const events = this.store.runs.listEvents(run.id);
      const completed = events.find(
        (event): event is Extract<AgentRuntimeEvent, { type: 'message.completed' }> =>
          event.type === 'message.completed',
      );
      if (completed?.content) {
        messages.push({ id: randomUUID(), role: 'assistant', content: completed.content });
      }
    }
    return messages;
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
      this.persistEvidence(active.taskId, event, active.toolNames);
    }
    this.broadcast(event);
    if (isTerminalEvent(event) && active) this.notifyTerminal(active, event);
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
      for (const result of event.output.results) {
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
  }

  /** 未配置语言模型时回落到教学 Provider，保证链路始终可复现。 */
  private resolveModel(): ModelProvider {
    const configured = this.store.models.getForRun('language');
    return configured ? new OpenAICompatibleProvider(configured) : this.fallbackModel;
  }

  private resolveWebSearch(): WebSearch | undefined {
    const engine = this.store.searchEngines.getEnabled();
    if (!engine || !engine.apiKey) return undefined;
    // 显式包一层：直接摘出 client.search 会脱离 this 绑定，类型系统无法证明它安全
    const client = createQianfanSearchClient(engine);
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

interface WebSearchOutputItem {
  title: string;
  url: string;
  snippet: string;
  site?: string;
}

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
