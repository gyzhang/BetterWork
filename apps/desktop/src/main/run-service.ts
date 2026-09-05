import { createHash, randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { AgentTool } from '@betterwork/agent-core';
import { ReActAgentEngine, FakeModelProvider, OpenAICompatibleProvider } from '@betterwork/agent-core';
import type { AgentRuntimeEvent, StartRunRequest } from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import { calculatorTool, createKnowledgeSearchTool, createWebSearchTool, readTextFileTool, type KnowledgeSearchItem, type WebSearch } from '@betterwork/tool-runtime';
import { RunJournal } from './run-journal';
import { KnowledgeVault } from './knowledge-vault';
import { createQianfanSearchClient } from './search-engine-service';

export const createRunTools = (dependencies: { knowledgeSearch: (query: string) => KnowledgeSearchItem[]; webSearch?: WebSearch }): AgentTool[] => {
  const tools: AgentTool[] = [calculatorTool, readTextFileTool, createKnowledgeSearchTool(dependencies.knowledgeSearch)];
  return dependencies.webSearch ? [...tools, createWebSearchTool(dependencies.webSearch)] : tools;
};

export class RunService {
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly activeRunTasks = new Map<string, string>();
  private readonly activeToolCalls = new Map<string, Map<string, string>>();
  private readonly engine = new ReActAgentEngine();
  private readonly model = new FakeModelProvider();

  constructor(
    private readonly journal: RunJournal,
    private readonly knowledgeVault: KnowledgeVault,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  start(input: StartRunRequest): string {
    const runId = randomUUID();
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    this.activeRunTasks.set(runId, input.taskId);
    this.activeToolCalls.set(runId, new Map());
    this.journal.createRun({
      id: runId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: 'running',
      createdAt: Date.now(),
    });

    void this.consume(runId, input, controller);
    return runId;
  }

  cancel(runId: string): boolean {
    const controller = this.activeRuns.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private async consume(runId: string, input: StartRunRequest, controller: AbortController): Promise<void> {
    try {
      const configured = this.journal.getModelForRun('language');
      const searchEngine = this.journal.getEnabledSearchEngine();
      const webSearch = searchEngine?.apiKey ? createQianfanSearchClient(searchEngine).search : undefined;
      for await (const event of this.engine.run({
        runId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        workspacePath: input.workspacePath,
        model: configured ? new OpenAICompatibleProvider(configured) : this.model,
        tools: createRunTools({
          knowledgeSearch: (query) => this.knowledgeVault.search(query).map(({ document, locator, excerpt }) => ({ ...document, locator, excerpt })),
          ...(webSearch ? { webSearch } : {}),
        }),
        signal: controller.signal,
      })) this.publish(event);
    } finally {
      this.activeRuns.delete(runId);
      this.activeRunTasks.delete(runId);
      this.activeToolCalls.delete(runId);
    }
  }

  private publish(event: AgentRuntimeEvent): void {
    this.journal.appendEvent(event);
    if (event.type === 'tool.started') this.activeToolCalls.get(event.runId)?.set(event.toolCall.id, event.toolCall.name);
    if (event.type === 'tool.completed' && this.activeToolCalls.get(event.runId)?.get(event.toolCallId) === 'knowledge_search') {
      const taskId = this.activeRunTasks.get(event.runId);
      if (taskId) this.persistKnowledgeEvidence(taskId, event.runId, event.output);
    }
    if (event.type === 'tool.completed' && this.activeToolCalls.get(event.runId)?.get(event.toolCallId) === 'web_search') {
      const taskId = this.activeRunTasks.get(event.runId);
      if (taskId) this.persistWebEvidence(taskId, event.runId, event.output);
    }
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(IpcChannel.RunEvent, event);
  }

  private persistKnowledgeEvidence(taskId: string, runId: string, output: unknown): void {
    if (!isKnowledgeSearchOutput(output)) return;
    for (const result of output.results) this.journal.saveLocalEvidence({
      taskId, runId, sourceUri: result.sourcePath, title: result.title, locator: result.locator,
      excerpt: result.excerpt, contentHash: result.contentHash,
    });
  }

  private persistWebEvidence(taskId: string, runId: string, output: unknown): void {
    if (!isWebSearchOutput(output)) return;
    for (const result of output.results) {
      if (!result.url) continue;
      this.journal.saveWebEvidence({
        taskId,
        runId,
        sourceUri: result.url,
        title: result.title,
        locator: result.site || '网页',
        excerpt: result.snippet,
        contentHash: createHash('sha256').update(`${result.url}\n${result.snippet}`).digest('hex'),
      });
    }
  }
}

interface KnowledgeSearchOutputItem { title: string; sourcePath: string; locator: string; excerpt: string; contentHash: string; }
const isKnowledgeSearchOutput = (value: unknown): value is { results: KnowledgeSearchOutputItem[] } => {
  if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results)) return false;
  return value.results.every((result) => result && typeof result === 'object'
    && 'title' in result && typeof result.title === 'string'
    && 'sourcePath' in result && typeof result.sourcePath === 'string'
    && 'locator' in result && typeof result.locator === 'string'
    && 'excerpt' in result && typeof result.excerpt === 'string'
    && 'contentHash' in result && typeof result.contentHash === 'string');
};

interface WebSearchOutputItem { title: string; url: string; snippet: string; site?: string; }
const isWebSearchOutput = (value: unknown): value is { results: WebSearchOutputItem[] } => {
  if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results)) return false;
  return value.results.every((result) => result && typeof result === 'object'
    && 'title' in result && typeof result.title === 'string'
    && 'url' in result && typeof result.url === 'string'
    && 'snippet' in result && typeof result.snippet === 'string');
};
