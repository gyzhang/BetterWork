import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JobSpec } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createMacProcessSupervisor,
  type ExecutionLogSink,
  type ExecutionLogStream,
  type GuardianRuntime,
  type MacProcessSupervisorOptions,
} from './mac-process-supervisor';
import type { ProcessSupervisor, SupervisorHandle } from './process-supervisor';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, 'fixtures', name);
const guardianScript = path.join(here, 'skill-guardian.ts');

/** 真机进程测试：统一放宽单测默认 5 秒，取消与清理本身就有秒级预算。 */
const processTimeout = 40_000;

const strays: ChildProcess[] = [];

afterEach(() => {
  for (const child of strays.splice(0)) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    // 按组终止：fixture 可能已经派生了自己的子孙。
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * 测试自己解析进程组，不复用实现的 helper：核验必须独立于被核验的代码。
 * 僵尸进程不计入存活成员。
 */
const listProcessGroup = (pgid: number): Promise<number[]> =>
  new Promise((resolve, reject) => {
    const ps = spawn('/bin/ps', ['-axo', 'pid=,pgid=,state='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    strays.push(ps);
    let raw = '';
    ps.stdout?.setEncoding('utf8');
    ps.stdout?.on('data', (chunk: string) => {
      raw += chunk;
    });
    ps.on('error', reject);
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

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  label: string,
  budgetMs = 15_000,
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await delay(50);
  }
};

class MemoryLogSink implements ExecutionLogSink {
  readonly entries: Array<{ stream: ExecutionLogStream; text: string }> = [];
  closed = false;

  constructor(readonly key: string) {}

  write(stream: ExecutionLogStream, text: string): void {
    this.entries.push({ stream, text });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  textOf(stream: ExecutionLogStream): string {
    return this.entries
      .filter((entry) => entry.stream === stream)
      .map((entry) => entry.text)
      .join('');
  }

  bytesOf(stream: ExecutionLogStream): number {
    return Buffer.byteLength(this.textOf(stream));
  }
}

interface Harness {
  supervisor: ProcessSupervisor;
  sinks: MemoryLogSink[];
}

const nodeRuntime = (scriptPath: string, scriptArgs: readonly string[] = []): GuardianRuntime => ({
  executable: process.execPath,
  scriptPath,
  scriptArgs,
  env: { ...process.env },
});

const openSupervisor = (overrides: Partial<MacProcessSupervisorOptions> = {}): Harness => {
  const sinks: MemoryLogSink[] = [];
  const supervisor = createMacProcessSupervisor({
    guardian: nodeRuntime(guardianScript),
    createLogSink: (executionId: string) => {
      const sink = new MemoryLogSink(`execution-logs/${executionId}/console.log`);
      sinks.push(sink);
      return sink;
    },
    ...overrides,
  });
  return { supervisor, sinks };
};

const specOf = (overrides: Partial<JobSpec> = {}): JobSpec => ({
  protocolVersion: 1,
  executionId: randomUUID(),
  runId: 'run-fixture',
  toolCallId: 'tool-fixture',
  bindingId: 'binding-fixture',
  commandId: 'command-fixture',
  executable: process.execPath,
  argv: [fixture('silent-work.ts'), '300'],
  cwd: tmpdir(),
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  timeoutMs: 20_000,
  maxOutputBytes: 32 * 1024,
  maxLogBytes: 1024 * 1024,
  expectedOutputs: [],
  ...overrides,
});

/** 宿主把 guardian 报告的 pid 写进执行日志，这里按同一格式取回，用来核验进程身份。 */
const startedPidOf = (sink: MemoryLogSink): number => {
  const match = /pid=(\d+)/u.exec(sink.textOf('supervisor'));
  if (!match?.[1]) throw new Error(`日志里没有启动记录：${sink.textOf('supervisor')}`);
  return Number(match[1]);
};

const firstJsonLine = (text: string): any => {
  const line = text.split('\n').find((entry) => entry.trim() !== '');
  if (!line) throw new Error(`没有可读的输出：${text}`);
  return JSON.parse(line);
};

const captureText = (handle: SupervisorHandle): string => handle.capture().stdout;

describe('macOS 进程组 supervisor', () => {
  it(
    '正常结束：中文与空格参数原样送达，环境只包含宿主下发的变量',
    async () => {
      const { supervisor, sinks } = openSupervisor();
      const cwd = realpathSync(tmpdir());
      const args = ['生成 演示文稿', '--title=年度 总结 "引号"', '中文参数'];
      const handle = await supervisor.launch(
        specOf({
          argv: [fixture('report-argv.ts'), ...args],
          cwd,
          env: { PATH: '/usr/bin:/bin', FIXTURE_MARKER: '标记值' },
        }),
      );
      const result = await handle.result;

      expect(result).toMatchObject({ kind: 'succeeded', exitCode: 0, outputIds: [] });
      if (result.kind !== 'succeeded') throw new Error('结果类型不是 succeeded');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      const capture = handle.capture();
      const report = firstJsonLine(capture.stdout);
      expect(report.argv).toEqual(args);
      expect(report.cwd).toBe(cwd);
      expect(report.env.FIXTURE_MARKER).toBe('标记值');
      // 宿主没有注入 PYTHONPATH，目标就不该看到它（设计 §7.2）。
      expect(report.env.PYTHONPATH).toBe('');
      expect(capture.stderr).toContain('fixture stderr line');
      expect(capture.truncated).toBe(false);

      const sink = sinks[0]!;
      expect(sink.closed).toBe(true);
      expect(sink.textOf('stdout')).toContain('生成 演示文稿');
      expect(sink.textOf('stderr')).toContain('fixture stderr line');
      expect(sink.textOf('supervisor')).toContain('目标进程已启动');
    },
    processTimeout,
  );

  it(
    '非零退出：按 execute 阶段失败上报，退出码进入错误码，日志键可回溯',
    async () => {
      const { supervisor, sinks } = openSupervisor();
      const handle = await supervisor.launch(specOf({ argv: [fixture('exit-code.ts'), '3'] }));
      const result = await handle.result;

      expect(result).toMatchObject({
        kind: 'failed',
        phase: 'execute',
        code: 'exit-3',
        retryable: true,
      });
      if (result.kind !== 'failed') throw new Error('结果类型不是 failed');
      expect(result.logKey).toBe(sinks[0]!.key);
      expect(result.summary).toContain('exit-3');
      expect(handle.capture().stdout).toContain('exiting with 3');
    },
    processTimeout,
  );

  it(
    'spawn 失败：可执行文件不存在时 launch 抛出真实原因，日志已收尾',
    async () => {
      const { supervisor, sinks } = openSupervisor();
      await expect(
        supervisor.launch(specOf({ executable: '/nonexistent/betterwork-missing-runtime' })),
      ).rejects.toThrow(/ENOENT/u);
      await waitFor(() => sinks[0]?.closed === true, '日志关闭');
    },
    processTimeout,
  );

  it(
    '超时：到点终止整个组，上报 timed-out 且清理已核验',
    async () => {
      const { supervisor, sinks } = openSupervisor({ terminateGraceMs: 500 });
      const startedAt = Date.now();
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('sleep.ts'), '30000'], timeoutMs: 800 }),
      );
      const result = await handle.result;

      expect(result).toMatchObject({ kind: 'timed-out', cleanupCompleted: true });
      expect(Date.now() - startedAt).toBeLessThan(15_000);
      const pid = startedPidOf(sinks[0]!);
      expect(isAlive(pid)).toBe(false);
      expect(await listProcessGroup(pid)).toEqual([]);
    },
    processTimeout,
  );

  it(
    '子孙进程：取消时整组一起终止，父进程与后代都不留下',
    async () => {
      const { supervisor, sinks } = openSupervisor({ terminateGraceMs: 500 });
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('spawn-descendants.ts'), '3', '30000', '30000'] }),
      );
      await waitFor(() => captureText(handle).includes('descendants'), '子孙 pid 输出');
      const payload = firstJsonLine(captureText(handle));
      const descendants: number[] = payload.descendants;
      expect(descendants).toHaveLength(3);
      const group = [payload.pid as number, ...descendants];
      await waitFor(
        async () => (await listProcessGroup(payload.pid as number)).length === group.length,
        '父子进入同一进程组',
      );

      const cleanup = await handle.cancel();
      const result = await handle.result;

      expect(cleanup.cleanupCompleted).toBe(true);
      expect(result).toMatchObject({ kind: 'cancelled', cleanupCompleted: true });
      expect(await listProcessGroup(payload.pid as number)).toEqual([]);
      for (const pid of group) expect(isAlive(pid)).toBe(false);
      // 管道全部关闭后 guardian 才会退出，日志因此一定是收尾过的。
      expect(sinks[0]!.closed).toBe(true);
    },
    processTimeout,
  );

  it(
    '正常结束也清残留：脚本退出后留下的后台后代不会继续占用进程组',
    async () => {
      const { supervisor } = openSupervisor({ terminateGraceMs: 500 });
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('spawn-descendants.ts'), '2', '30000'] }),
      );
      await waitFor(() => captureText(handle).includes('descendants'), '子孙 pid 输出');
      const payload = firstJsonLine(captureText(handle));
      const descendants: number[] = payload.descendants;
      expect(descendants).toHaveLength(2);

      const result = await handle.result;

      // 脚本自己成功退出，但它留下的后台后代必须一起结束（设计 §8）。
      expect(result).toMatchObject({ kind: 'succeeded', exitCode: 0 });
      await waitFor(
        async () => (await listProcessGroup(payload.pid as number)).length === 0,
        '残留后代清空',
      );
      for (const pid of descendants) expect(isAlive(pid)).toBe(false);
    },
    processTimeout,
  );

  it(
    'exec 重执行：execve 之后进程身份不变，取消仍然能收掉它',
    async () => {
      const { supervisor, sinks } = openSupervisor({ terminateGraceMs: 500 });
      const handle = await supervisor.launch(
        specOf({
          executable: '/bin/sh',
          argv: ['-c', `exec "${process.execPath}" "${fixture('sleep.ts')}" 30000`],
        }),
      );
      await waitFor(() => captureText(handle).includes('pid='), '目标 pid 输出');
      const printedPid = Number(/pid=(\d+)/u.exec(captureText(handle))![1]);
      const startedPid = startedPidOf(sinks[0]!);
      // shell 用 execve 换成 node，PID 不变：这正是样本里脚本重执行的形状。
      expect(printedPid).toBe(startedPid);
      expect(isAlive(printedPid)).toBe(true);

      const cleanup = await handle.cancel();

      expect(cleanup.cleanupCompleted).toBe(true);
      expect(isAlive(printedPid)).toBe(false);
      expect(await listProcessGroup(startedPid)).toEqual([]);
    },
    processTimeout,
  );

  it(
    '重复取消：并发与终态后的取消都幂等，结果只 settle 一次',
    async () => {
      const { supervisor } = openSupervisor({ terminateGraceMs: 500 });
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('silent-work.ts'), '30000'] }),
      );

      const [first, second] = await Promise.all([handle.cancel(), handle.cancel()]);
      const result = await handle.result;
      const afterSettle = await handle.cancel();

      expect(first).toEqual(second);
      expect(afterSettle).toEqual(first);
      expect(result).toMatchObject({ kind: 'cancelled', cleanupCompleted: true });
    },
    processTimeout,
  );

  it(
    '输出淹没：日志与模型可见输出各自限额，目标进程仍被持续排空并正常结束',
    async () => {
      const { supervisor, sinks } = openSupervisor();
      const maxLogBytes = 64 * 1024;
      const maxOutputBytes = 8 * 1024;
      const startedAt = Date.now();
      const handle = await supervisor.launch(
        specOf({
          argv: [fixture('flood-output.ts'), String(4 * 1024 * 1024)],
          maxLogBytes,
          maxOutputBytes,
          timeoutMs: 60_000,
        }),
      );
      const result = await handle.result;
      const capture = handle.capture();

      expect(result).toMatchObject({ kind: 'succeeded', exitCode: 0 });
      expect(Date.now() - startedAt).toBeLessThan(30_000);
      expect(capture.receivedBytes).toBeLessThanOrEqual(maxLogBytes);
      expect(Buffer.byteLength(capture.stdout)).toBeLessThanOrEqual(maxOutputBytes);
      expect(capture.truncated).toBe(true);
      expect(capture.droppedBytes).toBeGreaterThan(0);
      expect(sinks[0]!.bytesOf('stdout')).toBeLessThanOrEqual(maxLogBytes + 1024);
      expect(sinks[0]!.textOf('supervisor')).toContain('已丢弃');
    },
    processTimeout,
  );

  it(
    '无 stdout 的长操作：安静运行不会被判定为失败',
    async () => {
      const { supervisor } = openSupervisor();
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('silent-work.ts'), '1500'], timeoutMs: 20_000 }),
      );
      const result = await handle.result;

      expect(result).toMatchObject({ kind: 'succeeded', exitCode: 0 });
      expect(handle.capture().stdout).toBe('');
      expect(handle.capture().truncated).toBe(false);
    },
    processTimeout,
  );

  it(
    '同名无关进程不受影响：只按进程组发信号，绝不按名字匹配',
    async () => {
      const unrelated = spawn(process.execPath, [fixture('silent-work.ts'), '30000'], {
        stdio: 'ignore',
        detached: true,
      });
      strays.push(unrelated);
      const unrelatedPid = unrelated.pid!;
      await waitFor(() => isAlive(unrelatedPid), '无关进程启动');

      const { supervisor } = openSupervisor({ terminateGraceMs: 500 });
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('silent-work.ts'), '30000'] }),
      );
      const cleanup = await handle.cancel();

      expect(cleanup.cleanupCompleted).toBe(true);
      expect(isAlive(unrelatedPid)).toBe(true);
      process.kill(-unrelatedPid, 'SIGKILL');
    },
    processTimeout,
  );

  it(
    '父通道断开：宿主消失后 guardian 仍然清理整个进程组并退出',
    async () => {
      const nonce = randomUUID();
      const guardian = spawn(process.execPath, [guardianScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });
      strays.push(guardian);
      const events: any[] = [];
      let buffer = '';
      guardian.stdout?.setEncoding('utf8');
      guardian.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          events.push(JSON.parse(line));
        }
      });

      const spec = specOf({ argv: [fixture('spawn-descendants.ts'), '2', '30000', '30000'] });
      guardian.stdin?.write(
        `${JSON.stringify({ type: 'launch', protocolVersion: 1, nonce, graceMs: 500, spec })}\n`,
      );
      await waitFor(() => events.some((event) => event.type === 'started'), 'started 事件');
      const started = events.find((event) => event.type === 'started')!;
      expect(started.nonce).toBe(nonce);
      await waitFor(() => events.some((event) => event.type === 'output'), '子孙 pid 输出');
      const payload = firstJsonLine(
        events
          .filter((event) => event.type === 'output')
          .map((event) => Buffer.from(event.data as string, 'base64').toString('utf8'))
          .join(''),
      );
      // 父进程与两个后代都活着，并且同属一个进程组、共享同一条输出管道。
      const descendants: number[] = payload.descendants;
      expect(descendants).toHaveLength(2);
      const group = [payload.pid as number, ...descendants];
      for (const pid of group) expect(isAlive(pid)).toBe(true);
      const ascending = (values: number[]): number[] => values.slice().sort((a, b) => a - b);
      expect(ascending(await listProcessGroup(started.pgid as number))).toEqual(ascending(group));

      // 模拟宿主被强杀：写端消失，guardian 只能看到 EOF。
      guardian.stdin?.destroy();

      await waitFor(() => guardian.exitCode !== null, 'guardian 退出');
      await waitFor(
        async () => (await listProcessGroup(started.pgid as number)).length === 0,
        '进程组清空',
      );
      for (const pid of group) expect(isAlive(pid)).toBe(false);
      const cleanupEvent = events.find((event) => event.type === 'cleanup');
      expect(cleanupEvent?.origin).toBe('parent-disconnect');
      expect(cleanupEvent?.cleanupCompleted).toBe(true);
    },
    processTimeout,
  );

  it(
    'guardian 忽略取消：宿主按进程组兜底终止并核验，不谎报已清理',
    async () => {
      const { supervisor, sinks } = openSupervisor({
        guardian: nodeRuntime(fixture('fake-guardian.ts'), ['stubborn']),
        escalationTimeoutMs: 800,
      });
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('silent-work.ts'), '30000'] }),
      );
      const pid = startedPidOf(sinks[0]!);
      await waitFor(() => isAlive(pid), '目标启动');

      const cleanup = await handle.cancel();
      const result = await handle.result;

      expect(cleanup.cleanupCompleted).toBe(true);
      expect(result).toMatchObject({ kind: 'cancelled', cleanupCompleted: true });
      expect(isAlive(pid)).toBe(false);
      expect(await listProcessGroup(pid)).toEqual([]);
      expect(sinks[0]!.textOf('supervisor')).toContain('宿主直接按进程组终止');
    },
    processTimeout,
  );

  it(
    'guardian 中途消失：宿主接管清理，并按 execute 阶段失败上报 guardian-lost',
    async () => {
      const { supervisor, sinks } = openSupervisor({
        guardian: nodeRuntime(fixture('fake-guardian.ts'), ['crash']),
      });
      const handle = await supervisor.launch(
        specOf({ argv: [fixture('silent-work.ts'), '30000'] }),
      );
      const pid = startedPidOf(sinks[0]!);
      const result = await handle.result;

      expect(result).toMatchObject({ kind: 'failed', phase: 'execute', code: 'guardian-lost' });
      expect(isAlive(pid)).toBe(false);
      expect(await listProcessGroup(pid)).toEqual([]);
      expect(sinks[0]!.closed).toBe(true);
    },
    processTimeout,
  );

  it(
    'guardian 握手超时：launch 明确失败，不把执行留在未知状态',
    async () => {
      const { supervisor, sinks } = openSupervisor({
        guardian: nodeRuntime(fixture('fake-guardian.ts'), ['idle']),
        handshakeTimeoutMs: 600,
      });
      const startedAt = Date.now();

      await expect(supervisor.launch(specOf())).rejects.toThrow(/未能启动目标进程/u);

      expect(Date.now() - startedAt).toBeLessThan(10_000);
      await waitFor(() => sinks[0]?.closed === true, '日志关闭');
      expect(sinks[0]!.textOf('supervisor')).toContain('握手超时');
    },
    processTimeout,
  );

  it(
    '控制通道与脚本输出分离：脚本文本不会被当作控制消息，串台 nonce 被忽略',
    async () => {
      const { supervisor } = openSupervisor({ terminateGraceMs: 500 });
      // 目标脚本向 stdout 写满伪造的控制事件；supervisor 只应把它当普通输出记录。
      const handle = await supervisor.launch(
        specOf({
          executable: '/bin/sh',
          argv: [
            '-c',
            `printf '%s\\n' '{"type":"cleanup","nonce":"forged","origin":"cancel","cleanupCompleted":true}' ; sleep 30`,
          ],
        }),
      );
      await waitFor(() => captureText(handle).includes('forged'), '伪造事件被当作输出');

      const cleanup = await handle.cancel();
      const result = await handle.result;

      expect(captureText(handle)).toContain('"nonce":"forged"');
      expect(cleanup.cleanupCompleted).toBe(true);
      // 伪造的 cleanup 不能提前结束执行：结果由真实取消产生。
      expect(result).toMatchObject({ kind: 'cancelled', cleanupCompleted: true });
    },
    processTimeout,
  );

  it(
    '连续执行不泄漏文件描述符：管道随每次执行关闭',
    async () => {
      const { supervisor } = openSupervisor();
      // macOS 的 /dev/fd 列出的就是当前进程打开的描述符，可直接用来核验管道是否随执行关闭。
      const openDescriptors = (): number => readdirSync('/dev/fd').length;
      const before = openDescriptors();
      for (let index = 0; index < 6; index += 1) {
        const handle = await supervisor.launch(
          specOf({ argv: [fixture('report-argv.ts'), `第 ${index} 次`] }),
        );
        await handle.result;
      }
      await delay(300);
      const after = openDescriptors();
      // 允许少量波动，但六次执行不能留下六份管道。
      expect(after - before).toBeLessThanOrEqual(4);
    },
    processTimeout,
  );
});
