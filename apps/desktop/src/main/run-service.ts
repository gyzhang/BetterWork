import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { ReActAgentEngine, FakeModelProvider, OpenAICompatibleProvider } from '@betterwork/agent-core';
import type { AgentRuntimeEvent, StartRunRequest } from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import { calculatorTool, readTextFileTool } from '@betterwork/tool-runtime';
import { RunJournal } from './run-journal';

export class RunService {
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly engine = new ReActAgentEngine();
  private readonly model = new FakeModelProvider();

  constructor(
    private readonly journal: RunJournal,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  start(input: StartRunRequest): string {
    const runId = randomUUID();
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
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
      for await (const event of this.engine.run({
        runId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        prompt: input.prompt,
        workspacePath: input.workspacePath,
        model: configured ? new OpenAICompatibleProvider(configured) : this.model,
        tools: [calculatorTool, readTextFileTool],
        signal: controller.signal,
      })) this.publish(event);
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private publish(event: AgentRuntimeEvent): void {
    this.journal.appendEvent(event);
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(IpcChannel.RunEvent, event);
  }
}
