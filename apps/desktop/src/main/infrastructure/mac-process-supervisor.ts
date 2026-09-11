import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { JobFailurePhase, JobResult, JobSpec } from '@betterwork/agent-protocol';

import type {
  ProcessSupervisor,
  SupervisorCapture,
  SupervisorCleanup,
  SupervisorHandle,
} from './process-supervisor';

/**
 * macOS 进程组 supervisor（设计 §8、任务 A08）。
 *
 * 宿主自己 spawn 目标是不够的：Node 的 `child.kill()` 只作用于直接子进程，脚本派生的
 * 子孙会继续持有任务目录与输出管道；宿主崩溃时更没有人负责收尾。因此每次执行都启动一个
 * 独立 guardian 进程（`skill-guardian.ts`），由它把目标放进新的会话/进程组并在组外监控：
 *
 * - 控制通道是本进程与 guardian 之间的 NDJSON（stdin 下发指令、stdout 接收事件），
 *   目标脚本的 stdout/stderr 是 guardian 的另外两条管道，脚本文本永远不当控制消息；
 * - 每条事件带本次执行的 nonce，串台或迟到的控制消息不会终止别的执行；
 * - 取消/超时由 guardian 执行 SIGTERM 整组 → 宽限 → SIGKILL，并用 `ps` 核验组内已无存活成员；
 * - guardian 失联或不响应时，宿主按进程组直接兜底终止并自行核验，核验不出结果就如实报告
 *   `cleanupCompleted=false`，绝不退化成「只杀父 PID 然后宣布已取消」。
 *
 * 明确不支持脚本主动 `setsid` / daemonize 逃逸：那已不在本进程组内，属于受信任本地代码
 * 模式的既有边界（设计 §7.2），不在本实现里伪装成沙箱能力。
 */

/** 设计 §8：SIGTERM 整组后 2 秒升级 SIGKILL。 */
const defaultTerminateGraceMs = 2_000;
/** 等待 guardian 报告目标已启动的上限；超时按 spawn 失败处理。 */
const defaultHandshakeTimeoutMs = 10_000;
/** 取消后等待 guardian 完成清理的上限；与 RunService 的 5 秒收口预算保持同量级。 */
const defaultEscalationTimeoutMs = 4_000;
/** settle 之后等待 guardian 自行退出的上限，超时由宿主 SIGKILL。 */
const guardianExitTimeoutMs = 1_000;
/** guardian 退出后等待其事件流关闭的上限：确保已到达的事件先被解析，再决定兜底动作。 */
const guardianStreamCloseTimeoutMs = 250;
/** 宿主兜底终止时 TERM → KILL 的等待。 */
const escalationTermWaitMs = 250;
/** guardian 自身诊断写入执行日志的上限，避免诊断反过来淹没日志。 */
const maxDiagnosticBytes = 8_192;

export type ExecutionLogStream = 'stdout' | 'stderr' | 'guardian' | 'supervisor';

/** 一次执行的有界日志出口。落盘位置与格式由调用方决定（设计 §5 的 execution-logs）。 */
export interface ExecutionLogSink {
  readonly key: string;
  write(stream: ExecutionLogStream, text: string): void;
  close(): Promise<void>;
}

/** guardian 的运行方式：Electron 下用 ELECTRON_RUN_AS_NODE 跑构建产物，测试下由 Node 跑源文件。 */
export interface GuardianRuntime {
  readonly executable: string;
  readonly scriptPath: string;
  /** 运行时参数，位于脚本路径之前（node / electron 自己的选项）。 */
  readonly args?: readonly string[];
  /** 脚本参数，位于脚本路径之后。正式 guardian 不接受参数，仅测试替身使用。 */
  readonly scriptArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

export interface MacProcessSupervisorOptions {
  readonly guardian: GuardianRuntime;
  readonly createLogSink: (executionId: string) => ExecutionLogSink;
  readonly terminateGraceMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly escalationTimeoutMs?: number;
}

type TerminationOrigin = 'natural' | 'cancel' | 'timeout' | 'parent-disconnect' | 'guardian-signal';

type FailurePhase = 'spawn' | 'execute' | 'cleanup' | 'protocol';

interface StartedEvent {
  type: 'started';
  nonce: string;
  pid: number;
  pgid: number;
  startedAt: number;
}

interface OutputEvent {
  type: 'output';
  nonce: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

interface ExitEvent {
  type: 'exit';
  nonce: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
}

interface CleanupEvent {
  type: 'cleanup';
  nonce: string;
  origin: TerminationOrigin;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  cleanupCompleted: boolean;
  groupVerified: boolean;
  residualPids: number[];
  droppedBytes: number;
}

interface FailureEvent {
  type: 'failure';
  nonce: string;
  phase: FailurePhase;
  code: string;
  summary: string;
  retryable: boolean;
}

type GuardianEvent = StartedEvent | OutputEvent | ExitEvent | CleanupEvent | FailureEvent;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

const createDeferred = <T>(): Deferred<T> => {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      settle?.(value);
    },
  };
};

interface HostJob {
  readonly spec: JobSpec;
  readonly nonce: string;
  readonly escalationTimeoutMs: number;
  readonly guardian: ChildProcess;
  readonly sink: ExecutionLogSink;
  readonly resultDeferred: Deferred<JobResult>;
  readonly startedSignal: Deferred<void>;
  readonly finishedSignal: Deferred<void>;
  readonly guardianExitSignal: Deferred<void>;
  readonly logDecoders: Record<'stdout' | 'stderr', StringDecoder>;
  readonly captureDecoders: Record<'stdout' | 'stderr', StringDecoder>;
  readonly captureChunks: Record<'stdout' | 'stderr', string[]>;
  handshakeCompleted: boolean;
  pgid: number | null;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  receivedBytes: number;
  capturedBytes: number;
  droppedBytes: number;
  truncated: boolean;
  logBytes: number;
  diagnosticBytes: number;
  cleanupCompleted: boolean;
  settled: boolean;
  cancelPromise: Promise<SupervisorCleanup> | null;
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 在预算内等待 target；预算耗尽返回 false，调用方据此升级处置。 */
const raceTimeout = async (target: Promise<void>, budgetMs: number): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    const winner = await Promise.race([
      target.then(() => 'done' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), budgetMs);
      }),
    ]);
    return winner === 'done';
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const killGroup = (pgid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ESRCH') return;
    console.error(`[skill-supervisor] kill(-${pgid}, ${signal}) failed`, error);
  }
};

/** 组内核验与 guardian 用的是同一套判据；null 表示无法核验，不能当作已清空。 */
const listProcessGroup = (pgid: number): Promise<number[] | null> =>
  new Promise((resolve) => {
    let ps: ChildProcess;
    try {
      ps = spawn('/bin/ps', ['-axo', 'pid=,pgid=,state='], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      console.error('[skill-supervisor] ps spawn failed', error);
      resolve(null);
      return;
    }
    const stdout = ps.stdout;
    if (!stdout) {
      resolve(null);
      return;
    }
    let raw = '';
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      raw += chunk;
    });
    ps.on('error', () => resolve(null));
    ps.on('close', () => {
      const members: number[] = [];
      for (const line of raw.split('\n')) {
        const columns = line.trim().split(/\s+/u);
        if (columns.length < 3) continue;
        const pid = Number(columns[0]);
        if (!Number.isInteger(pid) || Number(columns[1]) !== pgid) continue;
        if (columns[2]?.startsWith('Z') === true) continue;
        members.push(pid);
      }
      resolve(members);
    });
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readText = (fields: Record<string, unknown>, key: string): string | null => {
  const value = fields[key];
  return typeof value === 'string' ? value : null;
};

const readNullableNumber = (
  fields: Record<string, unknown>,
  key: string,
): number | null | undefined => {
  const value = fields[key];
  if (value === null) return null;
  return typeof value === 'number' ? value : undefined;
};

const readNullableText = (
  fields: Record<string, unknown>,
  key: string,
): string | null | undefined => {
  const value = fields[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
};

/** guardian 事件按形状解析；不认识的事件忽略，不让协议演进把宿主拖崩。 */
const readEvent = (parsed: unknown): GuardianEvent | null => {
  if (!isRecord(parsed)) return null;
  const type = parsed['type'];
  const nonce = readText(parsed, 'nonce');
  if (nonce === null) return null;
  if (type === 'started') {
    const pid = parsed['pid'];
    const pgid = parsed['pgid'];
    const startedAt = parsed['startedAt'];
    if (typeof pid !== 'number' || typeof pgid !== 'number' || typeof startedAt !== 'number') {
      return null;
    }
    return { type: 'started', nonce, pid, pgid, startedAt };
  }
  if (type === 'output') {
    const stream = parsed['stream'];
    const data = readText(parsed, 'data');
    if ((stream !== 'stdout' && stream !== 'stderr') || data === null) return null;
    return { type: 'output', nonce, stream, data };
  }
  if (type === 'exit') {
    const exitCode = readNullableNumber(parsed, 'exitCode');
    const signal = readNullableText(parsed, 'signal');
    const durationMs = parsed['durationMs'];
    if (exitCode === undefined || signal === undefined || typeof durationMs !== 'number')
      return null;
    return { type: 'exit', nonce, exitCode, signal, durationMs };
  }
  if (type === 'cleanup') {
    const origin = parsed['origin'];
    const exitCode = readNullableNumber(parsed, 'exitCode');
    const signal = readNullableText(parsed, 'signal');
    const durationMs = parsed['durationMs'];
    const residualPids = parsed['residualPids'];
    const droppedBytes = parsed['droppedBytes'];
    if (
      origin !== 'natural' &&
      origin !== 'cancel' &&
      origin !== 'timeout' &&
      origin !== 'parent-disconnect' &&
      origin !== 'guardian-signal'
    ) {
      return null;
    }
    if (exitCode === undefined || signal === undefined || typeof durationMs !== 'number')
      return null;
    if (typeof parsed['cleanupCompleted'] !== 'boolean') return null;
    if (!Array.isArray(residualPids)) return null;
    const dropped = isRecord(droppedBytes)
      ? Number(droppedBytes['stdout'] ?? 0) + Number(droppedBytes['stderr'] ?? 0)
      : 0;
    return {
      type: 'cleanup',
      nonce,
      origin,
      exitCode,
      signal,
      durationMs,
      cleanupCompleted: parsed['cleanupCompleted'],
      groupVerified: parsed['groupVerified'] === true,
      residualPids: residualPids.filter((pid): pid is number => typeof pid === 'number'),
      droppedBytes: Number.isFinite(dropped) ? dropped : 0,
    };
  }
  if (type === 'failure') {
    const phase = parsed['phase'];
    const code = readText(parsed, 'code');
    const summary = readText(parsed, 'summary');
    if (phase !== 'spawn' && phase !== 'execute' && phase !== 'cleanup' && phase !== 'protocol') {
      return null;
    }
    if (code === null || summary === null) return null;
    return {
      type: 'failure',
      nonce,
      phase,
      code,
      summary,
      retryable: parsed['retryable'] === true,
    };
  }
  return null;
};

const sendCommand = (job: HostJob, command: Record<string, unknown>): void => {
  const stdin = job.guardian.stdin;
  if (!stdin || stdin.destroyed) return;
  stdin.write(`${JSON.stringify(command)}\n`, (error: Error | null | undefined) => {
    if (!error) return;
    // 写不进去说明 guardian 已经没了；由 guardian 的 exit/error 路径统一收口。
    job.sink.write('supervisor', `控制通道写入失败：${describeError(error)}\n`);
  });
};

const appendCapture = (job: HostJob, stream: 'stdout' | 'stderr', chunk: Buffer): void => {
  const budget = job.spec.maxOutputBytes - job.capturedBytes;
  if (budget <= 0) {
    job.truncated = true;
    return;
  }
  const taken = chunk.byteLength > budget ? chunk.subarray(0, budget) : chunk;
  if (taken.byteLength < chunk.byteLength) job.truncated = true;
  job.capturedBytes += taken.byteLength;
  job.captureChunks[stream].push(job.captureDecoders[stream].write(taken));
};

const appendLog = (job: HostJob, stream: 'stdout' | 'stderr', chunk: Buffer): void => {
  const budget = job.spec.maxLogBytes - job.logBytes;
  if (budget <= 0) {
    job.truncated = true;
    return;
  }
  const taken = chunk.byteLength > budget ? chunk.subarray(0, budget) : chunk;
  job.logBytes += taken.byteLength;
  if (taken.byteLength < chunk.byteLength) job.truncated = true;
  job.sink.write(stream, job.logDecoders[stream].write(taken));
};

const teardown = async (job: HostJob): Promise<void> => {
  try {
    // 先关控制通道：guardian 收到 EOF 后自行退出，宿主只在它赖着不走时才 SIGKILL。
    const stdin = job.guardian.stdin;
    if (stdin && !stdin.destroyed) stdin.end();
    const exited = await raceTimeout(job.guardianExitSignal.promise, guardianExitTimeoutMs);
    if (!exited && job.guardian.pid !== undefined && job.guardian.exitCode === null) {
      job.guardian.kill('SIGKILL');
    }
  } catch (error) {
    job.sink.write('supervisor', `guardian 收尾失败：${describeError(error)}\n`);
  } finally {
    await job.sink.close();
  }
};

/** 结果一定在 teardown（含日志关闭）之后才对外可见，调用方拿到 result 时日志已完整。 */
const settleAfterTeardown = async (job: HostJob, result: JobResult): Promise<void> => {
  try {
    await teardown(job);
  } catch (error) {
    console.error(`[skill-supervisor] teardown failed for ${job.spec.executionId}`, error);
  }
  job.resultDeferred.resolve(result);
  job.finishedSignal.resolve();
};

const settle = (job: HostJob, result: JobResult): void => {
  if (job.settled) return;
  job.settled = true;
  // 握手阶段的失败（可执行文件不存在、协议不匹配）也必须立刻唤醒 launch，
  // 否则调用方要白等一整个握手预算才知道启动失败。
  job.startedSignal.resolve();
  settleAfterTeardown(job, result).catch((error: unknown) => {
    console.error(`[skill-supervisor] settle failed for ${job.spec.executionId}`, error);
  });
};

/**
 * guardian 的 `protocol` 失败在共享协议的 JobFailurePhase 里没有对应值：目标根本没跑起来，
 * 因此按 spawn 阶段落库，原始 code（malformed-launch 等）保留在结果里供诊断。
 */
const toJobPhase = (phase: FailurePhase): JobFailurePhase =>
  phase === 'protocol' ? 'spawn' : phase;

const failureResult = (
  job: HostJob,
  phase: FailurePhase,
  code: string,
  summary: string,
  retryable: boolean,
): JobResult => ({
  kind: 'failed',
  phase: toJobPhase(phase),
  code,
  summary,
  ...(job.sink.key === '' ? {} : { logKey: job.sink.key }),
  retryable,
});

const resultFromCleanup = (job: HostJob, event: CleanupEvent): JobResult => {
  job.cleanupCompleted = event.cleanupCompleted;
  job.droppedBytes += event.droppedBytes;
  job.durationMs = event.durationMs;
  if (event.droppedBytes > 0) {
    job.truncated = true;
    job.sink.write(
      'supervisor',
      `输出超过日志上限，已丢弃 ${event.droppedBytes} 字节（目标进程未被阻塞）。\n`,
    );
  }
  if (!event.cleanupCompleted) {
    job.sink.write(
      'supervisor',
      `进程组清理未确认完成（组内核验=${String(event.groupVerified)}，残留 pid=${event.residualPids.join(',') || '无'}）。\n`,
    );
  }
  if (event.origin === 'cancel' || event.origin === 'timeout') {
    return {
      kind: event.origin === 'cancel' ? 'cancelled' : 'timed-out',
      cleanupCompleted: event.cleanupCompleted,
      diagnosticOutputIds: [],
    };
  }
  if (event.origin === 'parent-disconnect' || event.origin === 'guardian-signal') {
    // 控制通道断开或 guardian 被外部信号终止：本次执行不是正常完成，按取消上报。
    return { kind: 'cancelled', cleanupCompleted: event.cleanupCompleted, diagnosticOutputIds: [] };
  }

  const exitCode = event.exitCode ?? job.exitCode;
  const signal = event.signal ?? job.signal;
  if (exitCode === 0) {
    if (!event.cleanupCompleted) {
      return failureResult(job, 'cleanup', 'residual-processes', '未能确认全部子进程已停止', false);
    }
    return { kind: 'succeeded', exitCode: 0, outputIds: [], durationMs: event.durationMs };
  }
  const code = exitCode === null ? `signal-${signal ?? 'unknown'}` : `exit-${exitCode}`;
  return failureResult(
    job,
    'execute',
    code,
    `目标进程以 ${code} 结束${event.cleanupCompleted ? '' : '，且进程组清理未确认完成'}`,
    true,
  );
};

/**
 * 宿主兜底：guardian 失联或不响应取消时，直接按进程组终止并自行核验。
 * 返回是否核验通过；核验不了就返回 false，由调用方如实记录清理失败。
 */
const escalate = async (job: HostJob, reason: string): Promise<boolean> => {
  job.sink.write('supervisor', `guardian ${reason}，宿主直接按进程组终止并核验。\n`);
  const pgid = job.pgid;
  if (pgid !== null) {
    killGroup(pgid, 'SIGTERM');
    await delay(escalationTermWaitMs);
    killGroup(pgid, 'SIGKILL');
  }
  if (job.guardian.pid !== undefined && job.guardian.exitCode === null)
    job.guardian.kill('SIGKILL');
  if (pgid === null) return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const members = await listProcessGroup(pgid);
    if (members === null) return false;
    if (members.length === 0) return true;
    killGroup(pgid, 'SIGKILL');
    await delay(escalationTermWaitMs);
  }
  return false;
};

const handleEvent = (job: HostJob, event: GuardianEvent): void => {
  // nonce 是事件身份：串台或迟到的事件直接丢弃。握手前的失败事件由 guardian 以空 nonce 上报。
  if (event.nonce !== job.nonce && !(event.nonce === '' && !job.handshakeCompleted)) return;
  if (event.type === 'started') {
    job.handshakeCompleted = true;
    job.pgid = event.pgid;
    job.sink.write(
      'supervisor',
      `目标进程已启动 pid=${event.pid} pgid=${event.pgid} nonce=${job.nonce}\n`,
    );
    job.startedSignal.resolve();
    return;
  }
  if (event.type === 'output') {
    const chunk = Buffer.from(event.data, 'base64');
    job.receivedBytes += chunk.byteLength;
    appendLog(job, event.stream, chunk);
    appendCapture(job, event.stream, chunk);
    return;
  }
  if (event.type === 'exit') {
    job.exitCode = event.exitCode;
    job.signal = event.signal;
    job.durationMs = event.durationMs;
    return;
  }
  if (event.type === 'failure') {
    settle(job, failureResult(job, event.phase, event.code, event.summary, event.retryable));
    return;
  }
  settle(job, resultFromCleanup(job, event));
};

/** 握手看门狗：guardian 起来了却没报告目标启动时，兜底终止并把执行判为 spawn 失败。 */
const watchHandshake = async (job: HostJob, handshakeTimeoutMs: number): Promise<void> => {
  try {
    const started = await raceTimeout(job.startedSignal.promise, handshakeTimeoutMs);
    if (started || job.settled) return;
    const verified = await escalate(job, '握手超时');
    if (job.settled) return;
    settle(
      job,
      verified
        ? failureResult(
            job,
            'spawn',
            'handshake-timeout',
            `guardian 未在 ${handshakeTimeoutMs}ms 内报告目标进程启动`,
            true,
          )
        : failureResult(
            job,
            'cleanup',
            'cleanup-failed',
            'guardian 握手超时且进程组未能确认清理干净',
            false,
          ),
    );
  } finally {
    // 无论成功失败都要唤醒 launch：握手失败也必须让调用方拿到明确结论，不能悬挂。
    job.startedSignal.resolve();
  }
};

/** guardian 退出后先有界等待它的事件流关闭，否则可能在读到 started 之前就误判 pgid 未知。 */
const waitStreamClose = async (
  stream: NodeJS.ReadableStream | null,
  budgetMs: number,
): Promise<void> => {
  if (!stream) return;
  const readable = stream as NodeJS.ReadableStream & { readableEnded?: boolean };
  if (readable.readableEnded === true) return;
  await raceTimeout(
    new Promise<void>((resolve) => {
      stream.once('close', () => resolve());
      stream.once('end', () => resolve());
    }),
    budgetMs,
  );
};

const handleGuardianExit = async (job: HostJob): Promise<void> => {
  job.guardianExitSignal.resolve();
  if (job.settled) return;
  await waitStreamClose(job.guardian.stdout, guardianStreamCloseTimeoutMs);
  if (job.settled) return;
  // guardian 先没了：目标组可能还活着，必须兜底终止并核验后再下结论。
  const verified = await escalate(job, '已退出');
  if (job.settled) return;
  settle(
    job,
    verified
      ? failureResult(
          job,
          'execute',
          'guardian-lost',
          'guardian 在执行期间退出，目标进程组已由宿主终止并核验',
          true,
        )
      : failureResult(
          job,
          'cleanup',
          'cleanup-failed',
          'guardian 退出且进程组未能确认清理干净',
          false,
        ),
  );
};

const attachGuardian = (job: HostJob, handshakeTimeoutMs: number): void => {
  let buffer = '';
  const stdout = job.guardian.stdout;
  if (stdout) {
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch (error) {
          job.sink.write('guardian', `无法解析的控制消息：${describeError(error)}\n`);
          continue;
        }
        const event = readEvent(parsed);
        if (!event) {
          job.sink.write('guardian', `忽略未知控制事件：${line.slice(0, 200)}\n`);
          continue;
        }
        handleEvent(job, event);
      }
    });
  }
  const stderr = job.guardian.stderr;
  if (stderr) {
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => {
      if (job.diagnosticBytes >= maxDiagnosticBytes) return;
      job.diagnosticBytes += chunk.length;
      job.sink.write('guardian', chunk);
    });
  }
  job.guardian.on('error', (error: Error) => {
    settle(job, failureResult(job, 'spawn', 'guardian-spawn-failed', describeError(error), false));
  });
  job.guardian.on('exit', () => {
    handleGuardianExit(job).catch((error: unknown) => {
      console.error('[skill-supervisor] escalation after guardian exit failed', error);
    });
  });
  watchHandshake(job, handshakeTimeoutMs).catch((error: unknown) => {
    console.error('[skill-supervisor] handshake watchdog failed', error);
  });
};

const runCancel = async (job: HostJob): Promise<SupervisorCleanup> => {
  if (job.settled) return { cleanupCompleted: job.cleanupCompleted };
  sendCommand(job, { type: 'cancel', nonce: job.nonce });
  const finished = await raceTimeout(job.finishedSignal.promise, job.escalationTimeoutMs);
  if (finished) return { cleanupCompleted: job.cleanupCompleted };
  const verified = await escalate(job, '未响应取消');
  settle(job, { kind: 'cancelled', cleanupCompleted: verified, diagnosticOutputIds: [] });
  return { cleanupCompleted: verified };
};

const launchJob = async (
  options: MacProcessSupervisorOptions,
  spec: JobSpec,
): Promise<SupervisorHandle> => {
  const graceMs = options.terminateGraceMs ?? defaultTerminateGraceMs;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs;
  const escalationTimeoutMs = options.escalationTimeoutMs ?? defaultEscalationTimeoutMs;
  const sink = options.createLogSink(spec.executionId);
  const nonce = randomBytes(16).toString('hex');

  let guardian: ChildProcess;
  try {
    guardian = spawn(
      options.guardian.executable,
      [
        ...(options.guardian.args ?? []),
        options.guardian.scriptPath,
        ...(options.guardian.scriptArgs ?? []),
      ],
      {
        env: options.guardian.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // guardian 必须活过宿主所在进程组，才能在宿主被整组信号打中时完成清理。
        detached: true,
      },
    );
  } catch (error) {
    await sink.close();
    throw new Error(`无法启动 Skill guardian（execution ${spec.executionId}）`, { cause: error });
  }

  const job: HostJob = {
    spec,
    nonce,
    guardian,
    sink,
    escalationTimeoutMs,
    resultDeferred: createDeferred<JobResult>(),
    startedSignal: createDeferred<void>(),
    finishedSignal: createDeferred<void>(),
    guardianExitSignal: createDeferred<void>(),
    logDecoders: { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') },
    captureDecoders: { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') },
    captureChunks: { stdout: [], stderr: [] },
    handshakeCompleted: false,
    pgid: null,
    exitCode: null,
    signal: null,
    durationMs: 0,
    receivedBytes: 0,
    capturedBytes: 0,
    droppedBytes: 0,
    truncated: false,
    logBytes: 0,
    diagnosticBytes: 0,
    cleanupCompleted: false,
    settled: false,
    cancelPromise: null,
  };

  attachGuardian(job, handshakeTimeoutMs);
  // 完整 JobSpec 原样下发：guardian 按协议 1 校验自己需要的字段，两处字段清单不会漂移。
  sendCommand(job, { type: 'launch', protocolVersion: 1, nonce, graceMs, spec });

  await job.startedSignal.promise;
  if (!job.handshakeCompleted) {
    // 握手失败已由看门狗 settle：等结果与日志收尾落定，再把启动失败如实抛给执行服务。
    const failure = await job.resultDeferred.promise;
    const detail =
      failure.kind === 'failed'
        ? `${failure.code}（${failure.summary}）`
        : `执行已进入 ${failure.kind}`;
    throw new Error(`Skill guardian 未能启动目标进程（execution ${spec.executionId}）：${detail}`);
  }

  return {
    executionId: spec.executionId,
    result: job.resultDeferred.promise,
    capture: (): SupervisorCapture => ({
      stdout: job.captureChunks.stdout.join(''),
      stderr: job.captureChunks.stderr.join(''),
      truncated: job.truncated,
      receivedBytes: job.receivedBytes,
      droppedBytes: job.droppedBytes,
    }),
    cancel: (): Promise<SupervisorCleanup> => {
      const existing = job.cancelPromise;
      if (existing) return existing;
      const started = runCancel(job);
      job.cancelPromise = started;
      return started;
    },
  };
};

export const createMacProcessSupervisor = (
  options: MacProcessSupervisorOptions,
): ProcessSupervisor => ({
  launch: (spec: JobSpec): Promise<SupervisorHandle> => launchJob(options, spec),
});

/**
 * guardian 入口定位：Electron 下运行 electron-vite 为 guardian 单独构建的 JS 入口，
 * 测试下由 Node 直接执行同一份 TS 源文件（Node ≥ 22.18 原生剥离类型）。
 * 调用方（main/index.ts）传入主进程产物目录，Renderer 永远看不到这个路径。
 */
export const resolveGuardianRuntime = (mainDirectory: string): GuardianRuntime => {
  const underElectron = process.versions.electron !== undefined;
  const scriptPath = path.join(
    mainDirectory,
    underElectron ? 'skill-guardian.js' : 'skill-guardian.ts',
  );
  return {
    executable: process.execPath,
    scriptPath,
    env: underElectron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : { ...process.env },
  };
};
