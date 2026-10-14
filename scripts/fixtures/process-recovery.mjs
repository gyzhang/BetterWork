import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

export async function runProcessRecovery({
  electron,
  output,
  root,
  environment,
  probe,
  timeoutMs = 30_000,
}) {
  const directory = await mkdtemp(path.join(output, 'process-recovery-'));
  for (const phase of ['prepare', 'recover']) {
    const child = spawn(
      electron,
      [
        path.join(output, 'recovery.cjs'),
        output,
        directory,
        phase,
        ...(probe ? ['--probe-crash-recovery'] : []),
      ],
      {
        cwd: root,
        env: environment,
        detached: true,
        stdio: 'inherit',
      },
    );
    let outcome;
    let signalRequested = false;
    const failures = [];
    const stop = () => {
      // exit/error 后不再持有原进程组身份；成功 SIGKILL 后不重复发信号。
      if (outcome || signalRequested || !child.pid) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
        signalRequested = true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const exited = new Promise((resolve) => {
      child.once('error', (error) => {
        outcome = { error };
        resolve(outcome);
      });
      child.once('exit', (code, signal) => {
        outcome = { code, signal };
        resolve(outcome);
      });
    });
    // 启动/IPC 挂住必须停止自己的测试进程；这不是产品性能预算。
    let timedOut = false;
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          stop();
          reject(new Error(`进程恢复 ${phase} 超时`));
        } catch (error) {
          reject(new Error(`进程恢复 ${phase} 超时清理失败`, { cause: error }));
        }
      }, timeoutMs);
    });
    const perform = async () => {
      if (phase === 'prepare') {
        let ready;
        for (let attempt = 0; attempt < 1500; attempt += 1) {
          if (timedOut) throw new Error('进程恢复准备已超时');
          if (outcome) throw new Error('进程恢复准备在就绪前退出', { cause: outcome.error });
          try {
            ready = JSON.parse(await readFile(path.join(directory, 'ready.json'), 'utf8'));
            break;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          await delay(20);
        }
        if (!ready || ready.pid !== child.pid) throw new Error('进程恢复缺真实落库就绪标记');
        stop();
        const result = await exited;
        if (result.signal !== 'SIGKILL')
          throw new Error('未真正强杀测试进程', { cause: result.error });
      } else {
        const result = await exited;
        if (result.error || result.code !== 0 || result.signal)
          throw new Error('新进程恢复没有通过', { cause: result.error });
      }
    };
    try {
      await Promise.race([perform(), deadline]);
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(timeout);
      try {
        stop();
        if (signalRequested) await exited;
      } catch (error) {
        failures.push(error);
      }
      try {
        await writeFile(
          path.join(directory, `${phase}-status.json`),
          JSON.stringify(
            {
              phase,
              pid: child.pid,
              signalRequested,
              timedOut,
              outcome: outcome
                ? { code: outcome.code, signal: outcome.signal, error: outcome.error?.message }
                : null,
              failures: failures.map((error) => ({
                message: error.message,
                code: error.code,
                cause: error.cause?.message,
              })),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `进程恢复 ${phase} 与清理失败`);
  }
  const result = JSON.parse(await readFile(path.join(directory, 'recovered.json'), 'utf8'));
  if (
    result.previousPid === result.recoveredPid ||
    result.requests !== 0 ||
    result.checks?.length !== 10
  )
    throw new Error('进程恢复缺完整新进程证据');
  return { ...result, interruption: 'SIGKILL-owned-process-group' };
}
