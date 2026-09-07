import { createHash, randomUUID } from 'node:crypto';

import type { AgentTool, ModelProvider } from '@betterwork/agent-core';
import {
  describeError,
  FakeModelProvider,
  OpenAICompatibleProvider,
  ReActAgentEngine,
} from '@betterwork/agent-core';
import type { AgentRuntimeEvent, StartRunRequest } from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import {
  calculatorTool,
  createKnowledgeSearchTool,
  createWebSearchTool,
  type KnowledgeSearchItem,
  readTextFileTool,
  type WebSearch,
} from '@betterwork/tool-runtime';
import type { BrowserWindow } from 'electron';

import type { AppStore } from '../persistence';
import type { KnowledgeVault } from './knowledge-vault';
import type { NotificationService } from './notification-service';
import { createQianfanSearchClient } from './search-engine-service';

/** 一次执行期间的内存态；Run 结束后整条丢弃。 */
interface ActiveRun {
  taskId: string;
  prompt: string;
  controller: AbortController;
  /** toolCallId -> 工具名，用于在 tool.completed 时判断该不该登记 Evidence。 */
  toolNames: Map<string, string>;
}

const PROMPT_SUMMARY_LENGTH = 80;
const FAILURE_DETAIL_LENGTH = 500;

/**
 * 组装一次 Run 可用的工具集。
 * `web_search` 只在存在已启用且配置了 Key 的搜索引擎时注册——
 * 给模型一个必然失败的工具只会浪费一轮调用。
 */
export const createRunTools = (dependencies: {
  knowledgeSearch: (query: string) => KnowledgeSearchItem[];
  webSearch?: WebSearch;
}): AgentTool[] => {
  const tools: AgentTool[] = [
    calculatorTool,
    readTextFileTool,
    createKnowledgeSearchTool(dependencies.knowledgeSearch),
  ];
  return dependencies.webSearch ? [...tools, createWebSearchTool(dependencies.webSearch)] : tools;
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
    private readonly getWindow: () => BrowserWindow | null,
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
      const events = this.engine.run({
        runId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        workspacePath,
        model,
        tools: createRunTools({
          knowledgeSearch: (query) =>
            this.knowledgeVault
              .search(query)
              .map(({ document, locator, excerpt }) => ({ ...document, locator, excerpt })),
          ...(webSearch ? { webSearch } : {}),
        }),
        signal: controller.signal,
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
