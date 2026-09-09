import { createHash, randomUUID } from 'node:crypto';

import type {
  JobResult,
  JobSpec,
  RunSkillBinding,
  ScriptExecution,
  ScriptExecutionReason,
} from '@betterwork/agent-protocol';

import type { ProcessSupervisor, SupervisorHandle } from '../infrastructure/process-supervisor';
import { type AppStore, isTerminalExecutionStatus } from '../persistence';

/** 设计 §8：Run 收口时清理最长 5 秒，超时走既有失败兜底并说明可能残留。 */
const CLEANUP_GRACE_MS = 5_000;

export interface CreateExecutionBindingInput {
  runId: string;
  skillId: string;
  environmentId?: string;
  dependencySnapshotIds?: string[];
}

export interface StartExecutionInput {
  runId: string;
  bindingId: string;
  toolCallId: string;
  commandId: string;
  args: Record<string, unknown>;
  argv: string[];
  executable: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  maxLogBytes: number;
  expectedOutputs: string[];
  validatorId?: string;
  workDirKey: string;
}

export interface FinishRunReport {
  cancelled: number;
  cleanupFailed: number;
}

export interface CancelReport {
  applied: boolean;
  cleanupCompleted: boolean;
}

const digestArguments = (args: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(args)).digest('hex');

/**
 * 脚本执行编排：登记先于启动、取消与终止幂等、终态条件更新。
 *
 * 本服务不解析目录、不选择解释器：executable / cwd / env 由调用方（A13/A14 的
 * 工具层）经 Main 解析后传入，模型只能提交 bindingId + commandId + 结构化参数。
 */
export interface AwaitedExecution {
  execution: ScriptExecution;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export class SkillExecutionService {
  private readonly handles = new Map<string, SupervisorHandle>();
  private readonly settling = new Map<string, Promise<void>>();
  private readonly captures = new Map<
    string,
    { stdout: string; stderr: string; truncated: boolean }
  >();
  private readonly cancelling = new Set<string>();
  private readonly finishingRuns = new Set<string>();

  constructor(
    private readonly store: AppStore,
    private readonly supervisor: ProcessSupervisor,
  ) {}

  createBinding(input: CreateExecutionBindingInput): RunSkillBinding {
    const detail = this.store.skills.get(input.skillId);
    if (!detail) throw new Error(`Skill ${input.skillId} does not exist`);
    if (!detail.enabled) throw new Error(`Skill ${input.skillId} is disabled`);
    const profile = detail.runtimeProfile;
    if (!profile) throw new Error(`Skill ${input.skillId} has no runtime profile`);
    const grant = this.store.executions.findActiveGrant(
      input.skillId,
      detail.revision.id,
      profile.profileHash,
    );
    if (!grant) throw new Error(`Skill ${input.skillId} has no active trust grant`);
    return this.store.executions.createBinding({
      runId: input.runId,
      skillRevisionId: detail.revision.id,
      profileRevisionId: profile.id,
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      dependencySnapshotIds: input.dependencySnapshotIds ?? [],
      grantId: grant.id,
    });
  }

  async startExecution(input: StartExecutionInput): Promise<ScriptExecution> {
    if (this.finishingRuns.has(input.runId)) {
      throw new Error(`Run ${input.runId} is finishing; new executions are blocked`);
    }
    const binding = this.store.executions.getBinding(input.bindingId);
    if (!binding) throw new Error(`Binding ${input.bindingId} does not exist`);
    if (binding.runId !== input.runId) {
      throw new Error(`Binding ${input.bindingId} does not belong to run ${input.runId}`);
    }

    const executionId = randomUUID();
    this.store.executions.createExecution({
      id: executionId,
      runId: input.runId,
      bindingId: input.bindingId,
      toolCallId: input.toolCallId,
      commandId: input.commandId,
      argumentDigest: digestArguments(input.args),
      inputHashes: [],
      workDirKey: input.workDirKey,
      attemptKey: executionId,
    });

    const spec: JobSpec = {
      protocolVersion: 1,
      executionId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      bindingId: input.bindingId,
      commandId: input.commandId,
      executable: input.executable,
      argv: input.argv,
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      maxLogBytes: input.maxLogBytes,
      expectedOutputs: input.expectedOutputs,
      ...(input.validatorId ? { validatorId: input.validatorId } : {}),
    };

    let handle: SupervisorHandle;
    try {
      handle = await this.supervisor.launch(spec);
    } catch (error) {
      this.store.executions.finishExecution(executionId, 'failed', {
        reason: 'spawn-failed',
        finishedAt: Date.now(),
      });
      throw new Error(`Supervisor could not launch execution ${executionId}`, { cause: error });
    }

    this.handles.set(executionId, handle);
    this.store.executions.markRunning(executionId, Date.now());
    this.settling.set(
      executionId,
      this.settle(executionId, handle).catch((error: unknown) => {
        console.error(`Execution ${executionId} could not be settled`, error);
      }),
    );
    const started = this.store.executions.getExecution(executionId);
    if (!started) throw new Error(`Execution ${executionId} disappeared after launch`);
    return started;
  }

  /** 终态写入是条件更新：重复结束与迟到结果返回 false，不改写已有终态。 */
  recordResult(executionId: string, result: JobResult): boolean {
    if (this.cancelling.has(executionId)) return false;
    if (result.kind === 'succeeded') {
      return this.store.executions.finishExecution(executionId, 'succeeded', {
        ...(result.reportHash ? { reportHash: result.reportHash } : {}),
        outputIds: result.outputIds,
        finishedAt: Date.now(),
      });
    }
    if (result.kind === 'failed') {
      const reason: ScriptExecutionReason = `${result.phase}-failed`;
      return this.store.executions.finishExecution(executionId, 'failed', {
        reason,
        finishedAt: Date.now(),
      });
    }
    if (result.kind === 'timed-out') {
      return this.store.executions.finishExecution(executionId, 'timed-out', {
        reason: 'timed-out',
        finishedAt: Date.now(),
      });
    }
    return this.store.executions.finishExecution(executionId, 'cancelled', {
      reason: 'cancelled-by-user',
      finishedAt: Date.now(),
    });
  }

  async cancelExecution(
    executionId: string,
    reason: ScriptExecutionReason = 'cancelled-by-user',
  ): Promise<CancelReport> {
    const execution = this.store.executions.getExecution(executionId);
    if (!execution || isTerminalExecutionStatus(execution.status)) {
      return { applied: false, cleanupCompleted: true };
    }
    const handle = this.handles.get(executionId);
    this.cancelling.add(executionId);
    try {
      const cleanup = handle ? await handle.cancel() : { cleanupCompleted: true };
      const applied = cleanup.cleanupCompleted
        ? this.store.executions.finishExecution(executionId, 'cancelled', {
            reason,
            finishedAt: Date.now(),
          })
        : this.store.executions.finishExecution(executionId, 'failed', {
            reason: 'cleanup-failed',
            finishedAt: Date.now(),
          });
      return { applied, cleanupCompleted: cleanup.cleanupCompleted };
    } finally {
      this.cancelling.delete(executionId);
    }
  }

  /** Run 收口：禁止新启动、清理全部活跃执行、有界等待收尾，再交还终态广播。 */
  async finishRun(runId: string): Promise<FinishRunReport> {
    this.finishingRuns.add(runId);
    const open = this.store.executions
      .listExecutionsByRun(runId)
      .filter((execution) => !isTerminalExecutionStatus(execution.status));
    let cleanupFailed = 0;
    for (const execution of open) {
      const report = await this.cancelExecution(execution.id, 'cancelled-by-run');
      if (!report.cleanupCompleted) cleanupFailed += 1;
    }
    const pending = open
      .map((execution) => this.settling.get(execution.id))
      .filter((promise): promise is Promise<void> => promise !== undefined);
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => {
        setTimeout(resolve, CLEANUP_GRACE_MS);
      }),
    ]);
    return { cancelled: open.length, cleanupFailed };
  }

  /** 启动恢复：上次被强杀留下的非终态执行收口为 interrupted 失败，不自动重放。 */
  recoverInterruptedExecutions(): number {
    return this.store.executions.failInterruptedExecutions(Date.now());
  }

  /** 等待指定执行收口并返回终态与输出快照；工具层桥接用。 */
  async awaitExecution(executionId: string): Promise<AwaitedExecution> {
    const pending = this.settling.get(executionId);
    if (pending) await pending;
    const execution = this.store.executions.getExecution(executionId);
    if (!execution) throw new Error(`Execution ${executionId} is not available`);
    const captured = this.captures.get(executionId);
    this.captures.delete(executionId);
    return {
      execution,
      stdout: captured?.stdout ?? '',
      stderr: captured?.stderr ?? '',
      outputTruncated: captured?.truncated ?? false,
    };
  }

  private async settle(executionId: string, handle: SupervisorHandle): Promise<void> {
    try {
      const result = await handle.result;
      const snapshot = handle.capture();
      this.captures.set(executionId, {
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        truncated: snapshot.truncated,
      });
      this.recordResult(executionId, result);
    } finally {
      this.handles.delete(executionId);
      this.settling.delete(executionId);
    }
  }
}
