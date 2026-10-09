import { randomUUID } from 'node:crypto';

import { describeError, isAbortError } from '@betterwork/agent-core';
import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

import type { RunRepository } from '../persistence/run-repository';

type RunTerminalEvent = Extract<
  AgentRuntimeEvent,
  { type: 'run.completed' | 'run.failed' | 'run.cancelled' }
>;

interface RunEventLifecycleDependencies {
  journal: RunRepository;
  dispatch: (event: AgentRuntimeEvent) => void;
  finishSkills?: (runId: string) => Promise<{ cleanupFailed: number }>;
  releaseMcp?: (runId: string) => Promise<void>;
}

interface RunCompletionHooks {
  auditFinalContent: (content: string) => void;
  saveMarkdownArtifact: (content: string) => Promise<void>;
  afterCompleted: () => Promise<void>;
}

export const isRunTerminalEvent = (event: AgentRuntimeEvent): event is RunTerminalEvent =>
  event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled';

/** 只协调事件与终态；Run 的活动注册表和准备阶段由 RunService 持有。 */
export class RunEventLifecycle {
  constructor(private readonly ports: RunEventLifecycleDependencies) {}

  async consume(
    runId: string,
    events: AsyncIterable<AgentRuntimeEvent>,
    hooks: RunCompletionHooks,
  ): Promise<void> {
    let terminalEvent: RunTerminalEvent | undefined;
    for await (const event of events) {
      if (isRunTerminalEvent(event)) {
        if (event.type === 'run.completed') hooks.auditFinalContent(event.finalContent);
        terminalEvent = event;
        break;
      }
      this.publish(event);
    }
    if (!terminalEvent) throw new Error('Agent 事件流结束时没有给出终态事件');

    // 设计 §8：先清理子进程，再发布终态；清理失败保持既有快速失败分支。
    if (this.ports.finishSkills) {
      try {
        const cleanup = await this.ports.finishSkills(runId);
        if (cleanup.cleanupFailed > 0) throw new Error('未能确认全部子进程已停止');
      } catch (error) {
        this.fail(runId, `子进程清理失败：${describeError(error)}`);
        return;
      }
    }
    await this.ports.releaseMcp?.(runId);
    if (terminalEvent.type === 'run.completed') {
      await hooks.saveMarkdownArtifact(terminalEvent.finalContent);
    }
    this.publish(terminalEvent);
    if (terminalEvent.type === 'run.completed') await hooks.afterCompleted();
  }

  /** 也处理引擎装配之前的异常；清理不能确认时不得发布安全取消。 */
  async recover(runId: string, signal: AbortSignal, error: unknown): Promise<void> {
    let message = describeError(error);
    let cleanupFailed = false;
    try {
      await this.ports.releaseMcp?.(runId);
    } catch {
      cleanupFailed = true;
      message += '；MCP 连接清理失败';
    }
    try {
      const cleanup = await this.ports.finishSkills?.(runId);
      if (cleanup && cleanup.cleanupFailed > 0) {
        cleanupFailed = true;
        message += '；子进程清理失败';
      }
    } catch (cleanupError) {
      cleanupFailed = true;
      message += `；子进程清理失败：${describeError(cleanupError)}`;
    }
    if (!cleanupFailed && signal.aborted && isAbortError(error)) {
      if (this.ports.journal.get(runId)?.status === 'running') {
        this.publish({
          id: randomUUID(),
          runId,
          sequence: (this.ports.journal.getLatestEvent(runId)?.sequence ?? -1) + 1,
          createdAt: Date.now(),
          type: 'run.cancelled',
        });
      }
    } else this.fail(runId, message);
  }

  /** forceFailure 已在事务中落库，不能再 append；已提交终态保持不变。 */
  fail(runId: string, message: string): void {
    const event = this.ports.journal.forceFailure(runId, message, Date.now());
    if (event) this.ports.dispatch(event);
  }

  /** Journal 必须先于结果适配、广播和终态通知。 */
  private publish(event: AgentRuntimeEvent): void {
    this.ports.journal.appendEvent(event);
    this.ports.dispatch(event);
  }
}
