import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import type { JobSpec } from '@betterwork/agent-protocol';

/**
 * macOS 执行 guardian（设计 §8、任务 A08）。
 *
 * 宿主（Electron 主进程）之外的独立进程，职责只有一件事：把一次执行的目标进程
 * 放进独立进程组，排空它的输出，并在需要结束时按组终止。
 *
 * 硬约束：
 * - **自包含**：只用 `node:` 内置模块与类型导入，不引入仓库内其他运行时模块。
 *   这样它既能在打包后作为独立入口运行，也能在测试里由 Node 直接执行本 TS 源文件。
 * - **控制通道与脚本输出分离**：本进程的 stdin/stdout 是与宿主的 NDJSON 控制通道，
 *   目标脚本的 stdout/stderr 是另外的管道；脚本文本永远不被当作控制消息解析。
 * - **只按进程组发信号**，不按进程名匹配，同名无关进程不受影响。
 * - **父通道断开即清理**：宿主崩溃或被强杀时 stdin 收到 EOF，guardian 终止整个组后退出。
 * - 不承诺拦截主动 `setsid` / daemonize 逃逸的进程：那已经不在本进程组内。
 */

const protocolVersion = 1;

/** pid 已分配却没有 error 事件时的兜底等待，避免宿主一直等不到握手结果。 */
const spawnFailureGraceMs = 2_000;

type OutputStreamName = 'stdout' | 'stderr';

type TerminationOrigin = 'natural' | 'cancel' | 'timeout' | 'parent-disconnect' | 'guardian-signal';

type FailurePhase = 'spawn' | 'execute' | 'cleanup' | 'protocol';

/** guardian 真正需要的目标字段；其余 JobSpec 字段属于宿主，与进程管理无关。 */
type TargetSpec = Pick<
  JobSpec,
  'executable' | 'argv' | 'cwd' | 'env' | 'timeoutMs' | 'maxLogBytes'
>;

interface LaunchCommand {
  nonce: string;
  graceMs: number;
  spec: TargetSpec;
}

interface CleanupReport {
  cleanupCompleted: boolean;
  /** ps 可用并确认组内没有存活成员；false 表示无法核验，不能当作已清理干净。 */
  groupVerified: boolean;
  residualPids: number[];
}

type GuardianEvent =
  | { type: 'started'; nonce: string; pid: number; pgid: number; startedAt: number }
  | { type: 'output'; nonce: string; stream: OutputStreamName; data: string; bytes: number }
  | {
      type: 'exit';
      nonce: string;
      exitCode: number | null;
      signal: string | null;
      durationMs: number;
    }
  | ({
      type: 'cleanup';
      nonce: string;
      origin: TerminationOrigin;
      exitCode: number | null;
      signal: string | null;
      durationMs: number;
      droppedBytes: Record<OutputStreamName, number>;
    } & CleanupReport)
  | {
      type: 'failure';
      nonce: string;
      phase: FailurePhase;
      code: string;
      summary: string;
      retryable: boolean;
    };

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface Job {
  readonly nonce: string;
  readonly spec: TargetSpec;
  readonly graceMs: number;
  readonly child: ChildProcess;
  readonly pgid: number;
  readonly startedAt: number;
  readonly settled: Deferred<void>;
  exitCode: number | null;
  signal: string | null;
  exitReceived: boolean;
  pipesClosed: Record<OutputStreamName, boolean>;
  forwardedBytes: number;
  droppedBytes: Record<OutputStreamName, number>;
  timeoutTimer: NodeJS.Timeout | null;
  cleanup: Promise<CleanupReport> | null;
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

let job: Job | null = null;
let shuttingDown = false;

/** 事件按写入回调串行：既保证顺序，也在宿主读取缓慢时形成背压而不是堆积内存。 */
let writeQueue: Promise<void> = Promise.resolve();

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeDiagnostic = (message: string): void => {
  process.stderr.write(`guardian: ${message}\n`);
};

const streamOf = (current: Job, name: OutputStreamName): Readable | null =>
  name === 'stdout' ? current.child.stdout : current.child.stderr;

const pauseStreams = (current: Job): void => {
  streamOf(current, 'stdout')?.pause();
  streamOf(current, 'stderr')?.pause();
};

const resumeStreams = (current: Job): void => {
  streamOf(current, 'stdout')?.resume();
  streamOf(current, 'stderr')?.resume();
};

const writeEvent = (event: GuardianEvent): void => {
  writeQueue = writeQueue
    .then(
      () =>
        new Promise<void>((resolve) => {
          const accepted = process.stdout.write(`${JSON.stringify(event)}\n`, () => {
            resolve();
          });
          if (accepted) return;
          const active = job;
          if (active) pauseStreams(active);
        }),
    )
    .catch((error: unknown) => {
      writeDiagnostic(`event write failed: ${describeError(error)}`);
    });
};

process.stdout.on('drain', () => {
  const active = job;
  if (active) resumeStreams(active);
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const pipesClosed = (current: Job): boolean =>
  current.pipesClosed.stdout && current.pipesClosed.stderr;

const isSettled = (current: Job): boolean => current.exitReceived && pipesClosed(current);

const noteSettled = (current: Job): void => {
  if (isSettled(current)) current.settled.resolve();
};

/** 等待目标在预算内 settle；预算耗尽返回 false，调用方据此升级信号。 */
const raceSettled = async (current: Job, budgetMs: number): Promise<boolean> => {
  if (isSettled(current)) return true;
  let timer: NodeJS.Timeout | undefined;
  try {
    const winner = await Promise.race([
      current.settled.promise.then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), budgetMs);
      }),
    ]);
    return winner === 'settled';
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const killGroup = (pgid: number, signal: NodeJS.Signals): void => {
  if (pgid === process.pid) {
    writeDiagnostic(`refusing to signal own process group ${pgid}`);
    return;
  }
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    // ESRCH 表示组内已无进程，这正是期望结果；其余错误只诊断，最终由组核验裁决。
    if (isErrnoException(error) && error.code === 'ESRCH') return;
    writeDiagnostic(`kill(-${pgid}, ${signal}) failed: ${describeError(error)}`);
  }
};

/**
 * 列出进程组内的存活成员。返回 null 表示无法核验（ps 不可用），此时不能把
 * 「查不到」当成「已清空」。僵尸进程不持有文件描述符，不计入残留。
 */
const listProcessGroup = (pgid: number): Promise<number[] | null> =>
  new Promise((resolve) => {
    let ps: ChildProcess;
    try {
      ps = spawn('/bin/ps', ['-axo', 'pid=,pgid=,state='], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      writeDiagnostic(`ps spawn failed: ${describeError(error)}`);
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
    ps.on('error', (error: Error) => {
      writeDiagnostic(`ps failed: ${describeError(error)}`);
      resolve(null);
    });
    ps.on('close', () => {
      const members: number[] = [];
      for (const line of raw.split('\n')) {
        const columns = line.trim().split(/\s+/u);
        if (columns.length < 3) continue;
        const pidText = columns[0];
        const groupText = columns[1];
        const state = columns[2];
        const pid = Number(pidText);
        if (!Number.isInteger(pid) || Number(groupText) !== pgid) continue;
        if (state?.startsWith('Z') === true) continue;
        members.push(pid);
      }
      resolve(members);
    });
  });

const reportFailure = (
  phase: FailurePhase,
  code: string,
  summary: string,
  retryable: boolean,
): void => {
  writeEvent({ type: 'failure', nonce: job?.nonce ?? '', phase, code, summary, retryable });
};

/**
 * 组级终止：TERM → 宽限 → KILL，然后核验组内是否还有存活成员。
 * 正常结束也走这里，因为后代可能比目标活得更久并继续持有输出管道。
 */
const runCleanup = async (current: Job, origin: TerminationOrigin): Promise<CleanupReport> => {
  if (current.timeoutTimer) {
    clearTimeout(current.timeoutTimer);
    current.timeoutTimer = null;
  }
  // 背压暂停过的管道必须恢复读取，否则永远观察不到 EOF。
  resumeStreams(current);

  if (!isSettled(current)) {
    killGroup(current.pgid, 'SIGTERM');
    if (!(await raceSettled(current, current.graceMs))) {
      killGroup(current.pgid, 'SIGKILL');
      await raceSettled(current, current.graceMs);
    }
  }

  let groupVerified = false;
  let residualPids: number[] = [];
  // 残留后代（比目标活得更久的子孙）也要清掉。预算刻意压在宿主取消兜底之内：
  // 超过兜底时宿主会直接按组终止并自行核验，不会把未核验的结果当成已清理。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const listed = await listProcessGroup(current.pgid);
    if (listed === null) break;
    groupVerified = true;
    residualPids = listed;
    if (residualPids.length === 0) break;
    killGroup(current.pgid, 'SIGTERM');
    await delay(250);
    killGroup(current.pgid, 'SIGKILL');
    await raceSettled(current, 500);
  }

  const report: CleanupReport = {
    cleanupCompleted:
      current.exitReceived && pipesClosed(current) && groupVerified && residualPids.length === 0,
    groupVerified,
    residualPids,
  };
  writeEvent({
    type: 'cleanup',
    nonce: current.nonce,
    origin,
    exitCode: current.exitCode,
    signal: current.signal,
    durationMs: Date.now() - current.startedAt,
    droppedBytes: current.droppedBytes,
    ...report,
  });
  if (!report.cleanupCompleted) {
    writeDiagnostic(
      `cleanup incomplete (origin=${origin} groupVerified=${String(report.groupVerified)} residual=${report.residualPids.join(',')})`,
    );
  }
  return report;
};

const terminate = (origin: TerminationOrigin): Promise<CleanupReport> => {
  const current = job;
  if (!current) {
    return Promise.resolve({ cleanupCompleted: true, groupVerified: false, residualPids: [] });
  }
  // 幂等：首次终止原因胜出，取消与超时并发时不会互相改写。
  const existing = current.cleanup;
  if (existing) return existing;
  const started = runCleanup(current, origin).catch((error: unknown) => {
    writeDiagnostic(`cleanup failed: ${describeError(error)}`);
    return { cleanupCompleted: false, groupVerified: false, residualPids: [] };
  });
  current.cleanup = started;
  return started;
};

const shutdown = async (exitCode: number): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const current = job;
  if (current?.timeoutTimer) clearTimeout(current.timeoutTimer);
  process.stdin.destroy();
  // 有界等待事件写出：宿主已崩溃时管道可能永远收不下，不能因此挂死。
  await Promise.race([writeQueue, delay(1_000)]);
  process.exit(exitCode);
};

/** 终止并退出；所有调用点都必须收口失败，不允许 `void` 丢弃。 */
const terminateAndExit = (origin: TerminationOrigin, exitCode: number): void => {
  terminate(origin)
    .then(() => shutdown(exitCode))
    .catch((error: unknown) => {
      writeDiagnostic(`shutdown after ${origin} failed: ${describeError(error)}`);
      process.exit(exitCode);
    });
};

const attachOutputStream = (current: Job, name: OutputStreamName): void => {
  const stream = streamOf(current, name);
  if (!stream) {
    current.pipesClosed[name] = true;
    noteSettled(current);
    return;
  }
  stream.on('data', (chunk: Buffer) => {
    const budget = current.spec.maxLogBytes - current.forwardedBytes;
    if (budget <= 0) {
      current.droppedBytes[name] += chunk.byteLength;
      return;
    }
    // 超出预算的部分继续排空但不再转发：目标不会阻塞在满管道上，日志也不会无限增长。
    const forwarded = chunk.byteLength > budget ? chunk.subarray(0, budget) : chunk;
    current.forwardedBytes += forwarded.byteLength;
    current.droppedBytes[name] += chunk.byteLength - forwarded.byteLength;
    writeEvent({
      type: 'output',
      nonce: current.nonce,
      stream: name,
      data: forwarded.toString('base64'),
      bytes: forwarded.byteLength,
    });
  });
  stream.on('end', () => {
    current.pipesClosed[name] = true;
    noteSettled(current);
  });
  stream.on('error', (error: Error) => {
    writeDiagnostic(`${name} stream error: ${describeError(error)}`);
    current.pipesClosed[name] = true;
    noteSettled(current);
  });
};

const startTarget = (command: LaunchCommand): void => {
  if (job) {
    reportFailure('protocol', 'already-launched', 'guardian is already running a job', false);
    terminateAndExit('natural', 1);
    return;
  }
  const { spec } = command;
  let child: ChildProcess;
  try {
    // shell=false + argv：目标不经 shell 解析，参数里的空格与引号不会被重新切分。
    child = spawn(spec.executable, spec.argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // detached 让目标成为新会话与新进程组的组长，guardian 留在组外监控控制通道。
      detached: true,
    });
  } catch (error) {
    reportFailure('spawn', 'spawn-threw', describeError(error), false);
    terminateAndExit('natural', 1);
    return;
  }

  const pid = child.pid;
  if (pid === undefined) {
    // 典型是 ENOENT / EACCES：错误通过异步 error 事件到达，这里等它带来真实原因。
    let reported = false;
    const report = (code: string, summary: string, retryable: boolean): void => {
      if (reported) return;
      reported = true;
      reportFailure('spawn', code, summary, retryable);
      terminateAndExit('natural', 1);
    };
    child.on('error', (error: Error) => {
      const code = isErrnoException(error) ? (error.code ?? 'spawn-failed') : 'spawn-failed';
      report(code, describeError(error), code !== 'ENOENT' && code !== 'EACCES');
    });
    child.stdout?.destroy();
    child.stderr?.destroy();
    setTimeout(
      () => report('no-pid', 'target process was not assigned a pid', false),
      spawnFailureGraceMs,
    );
    return;
  }

  const current: Job = {
    nonce: command.nonce,
    spec,
    graceMs: command.graceMs,
    child,
    pgid: pid,
    startedAt: Date.now(),
    settled: createDeferred<void>(),
    exitCode: null,
    signal: null,
    exitReceived: false,
    pipesClosed: { stdout: false, stderr: false },
    forwardedBytes: 0,
    droppedBytes: { stdout: 0, stderr: 0 },
    timeoutTimer: null,
    cleanup: null,
  };
  job = current;

  child.on('error', (error: Error) => {
    // 目标已启动后仍可能出错（例如管道失败）；按执行阶段失败上报，不静默吞掉。
    const code = isErrnoException(error) ? (error.code ?? 'execute-failed') : 'execute-failed';
    writeDiagnostic(`target error after start: ${describeError(error)}`);
    reportFailure('execute', code, describeError(error), true);
  });
  child.on('exit', (exitCode: number | null, signal: NodeJS.Signals | null) => {
    current.exitReceived = true;
    current.exitCode = exitCode;
    current.signal = signal;
    writeEvent({
      type: 'exit',
      nonce: current.nonce,
      exitCode,
      signal,
      durationMs: Date.now() - current.startedAt,
    });
    noteSettled(current);
    terminateAndExit('natural', exitCode === 0 ? 0 : 1);
  });

  attachOutputStream(current, 'stdout');
  attachOutputStream(current, 'stderr');

  current.timeoutTimer = setTimeout(() => {
    current.timeoutTimer = null;
    terminateAndExit('timeout', 1);
  }, spec.timeoutMs);

  writeEvent({
    type: 'started',
    nonce: current.nonce,
    pid,
    pgid: current.pgid,
    startedAt: current.startedAt,
  });
};

const isTextRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** 控制通道只接受宿主发来的结构化指令；形状不对一律按协议失败拒绝，不猜测。 */
const readLaunchCommand = (parsed: Record<string, unknown>): LaunchCommand | null => {
  if (parsed['protocolVersion'] !== protocolVersion) return null;
  const nonce = parsed['nonce'];
  const graceMs = parsed['graceMs'];
  if (typeof nonce !== 'string' || nonce === '') return null;
  if (!isPositiveInteger(graceMs)) return null;
  const spec = parsed['spec'];
  if (typeof spec !== 'object' || spec === null) return null;
  const fields = spec as Record<string, unknown>;
  const executable = fields['executable'];
  const argv = fields['argv'];
  const cwd = fields['cwd'];
  const env = fields['env'];
  const timeoutMs = fields['timeoutMs'];
  const maxLogBytes = fields['maxLogBytes'];
  if (typeof executable !== 'string' || executable === '') return null;
  if (!isStringArray(argv)) return null;
  if (typeof cwd !== 'string' || cwd === '') return null;
  if (!isTextRecord(env)) return null;
  if (!isPositiveInteger(timeoutMs)) return null;
  if (!isPositiveInteger(maxLogBytes)) return null;
  return {
    nonce,
    graceMs,
    spec: { executable, argv, cwd, env, timeoutMs, maxLogBytes },
  };
};

const handleCommand = (line: string): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    reportFailure('protocol', 'malformed-command', describeError(error), false);
    terminateAndExit('natural', 1);
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    reportFailure('protocol', 'malformed-command', 'command must be an object', false);
    terminateAndExit('natural', 1);
    return;
  }
  const fields = parsed as Record<string, unknown>;
  const type = fields['type'];
  if (type === 'launch') {
    const command = readLaunchCommand(fields);
    if (!command) {
      reportFailure(
        'protocol',
        'malformed-launch',
        'launch command does not match protocol 1',
        false,
      );
      terminateAndExit('natural', 1);
      return;
    }
    startTarget(command);
    return;
  }
  if (type === 'cancel') {
    const current = job;
    if (!current) return;
    // nonce 不匹配的指令直接忽略：串台的控制消息不能终止本次执行。
    if (fields['nonce'] !== current.nonce) {
      writeDiagnostic('ignored cancel with mismatched nonce');
      return;
    }
    terminateAndExit('cancel', 0);
  }
};

/** 宿主崩溃或被强杀：管道 EOF 是唯一可靠信号，必须清理目标组后退出。 */
const onParentGone = (): void => {
  terminateAndExit(job ? 'parent-disconnect' : 'natural', 0);
};

const onSignal = (): void => {
  terminateAndExit('guardian-signal', 0);
};

const main = (): void => {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      handleCommand(line);
    }
  });
  process.stdin.on('end', onParentGone);
  process.stdin.on('error', (error: Error) => {
    writeDiagnostic(`control channel error: ${describeError(error)}`);
    onParentGone();
  });
  // 宿主侧写端关闭后 stdout 会 EPIPE：同样按父通道断开处理。
  process.stdout.on('error', (error: Error) => {
    writeDiagnostic(`event channel error: ${describeError(error)}`);
    onParentGone();
  });
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
};

main();
