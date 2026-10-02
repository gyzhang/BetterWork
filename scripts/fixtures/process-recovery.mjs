import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

function killOwnedGroup(child) {
  if (!child.pid) return;
  try {
    // detached 子进程是新进程组的组长；只清理本次测试创建的 Electron 与它的辅助进程。
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function runProcessRecovery({ electron, output, root, environment, probe }) {
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
    const timeout = setTimeout(() => killOwnedGroup(child), 30_000);
    try {
      if (phase === 'prepare') {
        let ready;
        for (let attempt = 0; attempt < 1500; attempt += 1) {
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
        killOwnedGroup(child);
        const result = await exited;
        if (result.signal !== 'SIGKILL')
          throw new Error('未真正强杀测试进程', { cause: result.error });
      } else {
        const result = await exited;
        if (result.error || result.code !== 0 || result.signal)
          throw new Error('新进程恢复没有通过', { cause: result.error });
      }
    } finally {
      clearTimeout(timeout);
      killOwnedGroup(child);
    }
  }
  const result = JSON.parse(await readFile(path.join(directory, 'recovered.json'), 'utf8'));
  if (
    result.previousPid === result.recoveredPid ||
    result.requests !== 0 ||
    result.checks?.length !== 8
  )
    throw new Error('进程恢复缺完整新进程证据');
  return { ...result, interruption: 'SIGKILL-owned-process-group' };
}
