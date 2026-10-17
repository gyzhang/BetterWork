import { randomUUID } from 'node:crypto';

import { describeError, isAbortError } from '@betterwork/agent-core';
import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

import type { RunRepository } from '../persistence/run-repository';
import type { RunHostDiagnosticRecorder } from './run-host-diagnostic-recorder';

type RunTerminalEvent = Extract<
  AgentRuntimeEvent,
  { type: 'run.completed' | 'run.failed' | 'run.cancelled' }
>;

interface RunEventLifecycleDependencies {
  journal: RunRepository;
  dispatch: (event: AgentRuntimeEvent) => void;
  finishSkills?: (runId: string) => Promise<{ cleanupFailed: number }>;
  releaseMcp?: (runId: string) => Promise<void>;
  runHostDiagnosticRecorder?: RunHostDiagnosticRecorder;
}

interface RunCompletionHooks {
  auditFinalContent: (content: string) => void;
  beginCommit: () => void;
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
    signal: AbortSignal,
  ): Promise<void> {
    let terminalEvent: RunTerminalEvent | undefined;
    for await (const event of events) {
      if (isRunTerminalEvent(event)) {
        if (event.type === 'run.completed' && !signal.aborted) {
          this.observeSync(runId, 'audit', 'audit-failed', () =>
            hooks.auditFinalContent(event.finalContent),
          );
        }
        terminalEvent = event;
        break;
      }
      this.publish(event);
    }
    if (!terminalEvent) throw new Error('Agent 事件流结束时没有给出终态事件');

    const cleanupErrors = await this.cleanup(runId);
    if (cleanupErrors.length > 0) {
      this.fail(runId, cleanupErrors.join('；'));
      return;
    }
    if (terminalEvent.type === 'run.completed' && signal.aborted)
      terminalEvent = this.cancellationEvent(runId, signal);
    await this.observe(runId, 'artifact-commit', 'commit-failed', async () => {
      hooks.beginCommit();
      if (terminalEvent.type === 'run.completed') {
        await hooks.saveMarkdownArtifact(terminalEvent.finalContent);
      }
      this.publish(terminalEvent);
    });
    if (terminalEvent.type === 'run.completed') await hooks.afterCompleted();
  }

  /** 也处理引擎装配之前的异常；清理不能确认时不得发布安全取消。 */
  async recover(runId: string, signal: AbortSignal, error: unknown): Promise<void> {
    if (this.ports.journal.get(runId)?.status !== 'running') return;
    const cleanupErrors = await this.cleanup(runId);
    if (cleanupErrors.length === 0 && signal.aborted && isAbortError(error))
      this.publish(this.cancellationEvent(runId, signal));
    else this.fail(runId, [describeError(error), ...cleanupErrors].join('；'));
  }

  private async cleanup(runId: string): Promise<string[]> {
    const errors: string[] = [];
    const finishSkills = this.ports.finishSkills;
    if (finishSkills) {
      try {
        await this.observe(runId, 'skill-cleanup', 'cleanup-failed', async () => {
          const cleanup = await finishSkills(runId);
          if (cleanup.cleanupFailed > 0) throw new Error('未能确认全部子进程已停止');
        });
      } catch (error) {
        errors.push(`子进程清理失败：${describeError(error)}`);
      }
    }
    const releaseMcp = this.ports.releaseMcp;
    if (releaseMcp) {
      try {
        await this.observe(runId, 'mcp-cleanup', 'cleanup-failed', () => releaseMcp(runId));
      } catch (error) {
        errors.push(`MCP 连接清理失败：${describeError(error)}`);
      }
    }
    return errors;
  }

  private observeSync<T>(
    runId: string,
    phase: 'audit',
    errorCode: 'audit-failed',
    operation: () => T,
  ): T {
    const recorder = this.ports.runHostDiagnosticRecorder;
    return recorder ? recorder.observeSync({ runId, phase, errorCode }, operation) : operation();
  }

  private observe<T>(
    runId: string,
    phase: 'skill-cleanup' | 'mcp-cleanup' | 'artifact-commit',
    errorCode: 'cleanup-failed' | 'commit-failed',
    operation: () => Promise<T>,
  ): Promise<T> {
    const recorder = this.ports.runHostDiagnosticRecorder;
    return recorder ? recorder.observe({ runId, phase, errorCode }, operation) : operation();
  }

  private cancellationEvent(runId: string, signal: AbortSignal): RunTerminalEvent {
    return {
      id: randomUUID(),
      runId,
      sequence: (this.ports.journal.getLatestEvent(runId)?.sequence ?? -1) + 1,
      createdAt: Date.now(),
      type: 'run.cancelled',
      ...(typeof signal.reason === 'string' ? { reason: signal.reason } : {}),
    };
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
