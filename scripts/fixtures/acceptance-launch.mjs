import console from 'node:console';
import { spawn } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

/** 仅管理本次新建的宿主；交接后由窗口关闭退出，不接触产品开发进程。 */
export async function launchAcceptance({
  electron,
  output,
  root,
  environment,
  reopen,
  smoke = false,
}) {
  await assertAcceptanceDestination(output, reopen);
  const log = await open(path.join(output, 'acceptance-host.log'), 'a');
  const child = spawn(
    electron,
    [
      path.join(output, 'acceptance.cjs'),
      output,
      ...(reopen ? ['--reopen-acceptance'] : []),
      ...(smoke ? ['--acceptance-smoke'] : []),
    ],
    { cwd: root, env: environment, detached: true, stdio: ['ignore', log.fd, log.fd] },
  );
  let failure;
  const exited = new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code));
  });
  child.once('error', (error) => {
    failure = error;
  });
  child.once('exit', (code, signal) => {
    failure = new Error(
      `验收宿主提前退出：${code ?? signal}；日志 ${path.join(output, 'acceptance-host.log')}`,
    );
  });
  try {
    for (let attempt = 0; attempt < 3600; attempt += 1) {
      try {
        const marker = JSON.parse(
          await readFile(path.join(output, 'acceptance-ready.json'), 'utf8'),
        );
        if (marker.pid === child.pid && marker.status === 'prepared-not-accepted') {
          if (smoke) {
            if ((await exited) !== 0) throw new Error('验收冒烟宿主关闭失败');
          } else child.unref();
          return marker;
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (failure) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('离线验收准备超时；请查看 acceptance-host.log');
  } catch (error) {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (terminationError) {
        if (terminationError.code !== 'ESRCH') console.error('合成宿主清理失败', terminationError);
      }
    }
    throw error;
  } finally {
    await log.close();
  }
}

export async function assertAcceptanceDestination(output, reopen) {
  try {
    await readFile(path.join(output, 'acceptance-ready.json'), 'utf8');
    if (!reopen) throw new Error('该输出目录已有合成环境，请使用 --reopen-acceptance 或新目录');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (reopen) {
    const marker = JSON.parse(await readFile(path.join(output, 'acceptance-ready.json'), 'utf8'));
    if (Number.isInteger(marker.pid) && marker.pid > 0) {
      try {
        process.kill(marker.pid, 0);
        throw new Error('该合成窗口仍在运行，请先关闭它再重开');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}
