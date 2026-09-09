import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
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
  calculatorTool,
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

import type { AppStore } from '../persistence';
import type { KnowledgeVault } from './knowledge-vault';
import type { NotificationService } from './notification-service';
import { createQianfanSearchClient } from './search-engine-service';
import type { SkillExecutionService } from './skill-execution-service';
import type { SkillService } from './skill-service';

/** 一次执行期间的内存态；Run 结束后整条丢弃。 */
interface ActiveRun {
  taskId: string;
  prompt: string;
  controller: AbortController;
  workspacePath: string;
  bindingId?: string;
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
  private readonly engine = new ReActAgentEngine();
  private readonly fallbackModel = new FakeModelProvider();

  constructor(
    private readonly store: AppStore,
    private readonly knowledgeVault: KnowledgeVault,
    private readonly notifications: NotificationService,
    private readonly skillService: SkillService,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly skillExecutionService?: SkillExecutionService,
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
    this.consume(runId, input, context.workspacePath, controller).catch((error: unknown) => {
      console.error(`Run ${runId} could not be finalized`, error);
    });
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

  private async consume(
    runId: string,
    input: StartRunRequest,
    workspacePath: string,
    controller: AbortController,
  ): Promise<void> {
    let terminated = false;
    try {
      const model = this.resolveModel();
      const webSearch = this.resolveWebSearch();
      const skillInstructions = await this.resolveSkillInstructions(input);
      const bindingId = await this.resolveBindingId(runId, input);
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
          ...(bindingId
            ? {
                skillResourceReader: (resourceInput) =>
                  this.readSkillResource(bindingId, resourceInput),
                taskFileWriter: (writeInput) =>
                  this.writeTaskFile(runId, input.taskId, workspacePath, writeInput),
                skillCommandExecutor: (execInput) =>
                  this.executeSkillCommand(runId, bindingId, execInput),
              }
            : {}),
        }),
        signal: controller.signal,
        ...(skillInstructions ? { skillInstructions } : {}),
      });

      for await (const event of events) {
        this.publish(event);
        if (isTerminalEvent(event)) terminated = true;
      }
      if (!terminated) {
        throw new Error('Agent 事件流结束时没有给出终态事件');
      }
    } catch (error) {
      this.finalizeFailure(runId, describeError(error));
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
   * 绑定快照：Run 启动时一次性解析 Skill 指令，运行期间不受后续编辑影响。
   * 未启用或未信任的 Skill 直接抛错，由 consume 兜底为 run.failed。
   */
  private async resolveSkillInstructions(
    input: StartRunRequest,
  ): Promise<SkillInstruction[] | undefined> {
    if (!input.skillBinding) return undefined;
    const skill = this.store.skills.get(input.skillBinding.skillId);
    if (!skill) throw new Error('Skill does not exist');
    if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
    if (skill.trustStatus !== 'trusted')
      throw new Error(`Skill「${skill.name}」尚未信任，无法运行`);
    const instruction = await this.skillService.readSkillInstruction(skill);
    return [instruction];
  }

  /** 有 Skill 绑定时创建 RunSkillBinding；无绑定或无执行服务时返回 undefined。 */
  private async resolveBindingId(
    runId: string,
    input: StartRunRequest,
  ): Promise<string | undefined> {
    if (!input.skillBinding || !this.skillExecutionService) return undefined;
    const binding = this.skillExecutionService.createBinding({
      runId,
      skillId: input.skillBinding.skillId,
    });
    return binding.id;
  }

  /** 资源读取桥接：bindingId → Skill → 资源根 → 路径校验 → 读取。 */
  private async readSkillResource(
    bindingId: string,
    input: SkillResourceReadInput,
  ): Promise<SkillResourceReadOutput> {
    const binding = this.store.executions.getBinding(bindingId);
    if (!binding) throw new Error(`Binding ${bindingId} does not exist`);
    const skill = this.findSkillByRevision(binding.skillRevisionId);
    if (!skill) throw new Error('Skill not found for binding');
    if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
    if (skill.trustStatus !== 'trusted') throw new Error(`Skill「${skill.name}」尚未信任`);
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
    await mkdir(workDir, { recursive: true });
    const target = path.resolve(workDir, input.path);
    const realWorkDir = await realpath(workDir);
    const realTarget = await realpath(target).catch(() => target);
    if (!isWithinRoot(realWorkDir, realTarget)) {
      throw new Error(`Task file path escapes work directory: ${input.path}`);
    }
    const contentBuffer = Buffer.from(input.content, 'utf8');
    const contentHash = createHash('sha256').update(contentBuffer).digest('hex');
    const existing = await readFile(realTarget).catch(() => null);
    const created = existing === null;
    if (!created && input.expectedHash) {
      const actualHash = createHash('sha256').update(existing).digest('hex');
      if (actualHash !== input.expectedHash) {
        throw new Error(
          `File ${input.path} has changed (expected ${input.expectedHash}, got ${actualHash}); re-read before overwriting.`,
        );
      }
    }
    await mkdir(path.dirname(realTarget), { recursive: true });
    await writeFile(realTarget, contentBuffer);
    return {
      relativePath: path.relative(realWorkDir, realTarget),
      bytesWritten: contentBuffer.byteLength,
      contentHash,
      created,
    };
  }

  /** 命令执行桥接：binding → profile → command → 构建执行规格 → 启动 → 等待结果。 */
  private async executeSkillCommand(
    runId: string,
    bindingId: string,
    input: SkillCommandExecuteInput,
  ): Promise<SkillCommandExecuteOutput> {
    if (!this.skillExecutionService) {
      throw new Error('Skill execution service is not available');
    }
    const binding = this.store.executions.getBinding(bindingId);
    if (!binding) throw new Error(`Binding ${bindingId} does not exist`);
    if (binding.runId !== runId) {
      throw new Error(`Binding ${bindingId} does not belong to run ${runId}`);
    }
    const skill = this.findSkillByRevision(binding.skillRevisionId);
    if (!skill) throw new Error('Skill not found for binding');
    if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
    if (skill.trustStatus !== 'trusted') {
      throw new Error(`Skill「${skill.name}」尚未信任`);
    }
    const profile = skill.runtimeProfile;
    if (!profile) throw new Error('Skill has no runtime profile');
    const command = profile.profile.commands.find((cmd) => cmd.commandId === input.commandId);
    if (!command) {
      throw new Error(`Command ${input.commandId} is not registered in this Skill profile`);
    }
    const argv = this.buildArgv(command, input.args);
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) throw new Error(`Run ${runId} is not active`);
    const cwd = path.join(
      activeRun.workspacePath,
      '.betterwork',
      'tasks',
      activeRun.taskId,
      'runs',
      runId,
      'work',
    );
    await mkdir(cwd, { recursive: true });
    const env = this.buildCleanEnv();
    const execution = await this.skillExecutionService.startExecution({
      runId,
      bindingId,
      toolCallId: input.toolCallId,
      commandId: input.commandId,
      args: input.args,
      argv,
      executable: command.executableKey,
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

  private findSkillByRevision(revisionId: string) {
    const summary = this.store.skills.list().find((s) => s.currentRevisionId === revisionId);
    if (!summary) return undefined;
    return this.store.skills.get(summary.id);
  }

  private buildArgv(command: RuntimeProfileCommand, args: Record<string, unknown>): string[] {
    const argv: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;
      argv.push(`--${key}`);
      if (typeof value === 'boolean') continue;
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
