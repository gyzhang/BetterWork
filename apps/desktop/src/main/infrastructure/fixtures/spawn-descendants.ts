import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 合成进程 fixture：派生若干比父进程活得更久的子孙，然后自己立刻退出。
 *
 * 子孙用 `stdio: 'inherit'`，因此既留在同一进程组，也继续持有父进程的输出管道——
 * 这正是真实脚本（Python 起子进程、shell 起后台任务）的形状。只杀父 PID 会留下
 * 这些子孙继续占用任务目录，A08 的组级清理必须把它们一起收掉。
 */
const requestedCount = Number(process.argv[2] ?? '2');
const requestedChildMs = Number(process.argv[3] ?? '20000');
const requestedParentMs = Number(process.argv[4] ?? '0');
const count = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : 2;
const childMs =
  Number.isInteger(requestedChildMs) && requestedChildMs > 0 ? requestedChildMs : 20_000;
const parentMs =
  Number.isInteger(requestedParentMs) && requestedParentMs > 0 ? requestedParentMs : 0;

const sleeper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sleep.ts');
const descendants: number[] = [];

for (let index = 0; index < count; index += 1) {
  const child = spawn(process.execPath, [sleeper, String(childMs)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // unref 让父进程可以在子孙仍存活时退出，模拟「脚本已结束、后台子进程还在」。
  child.unref();
  if (child.pid !== undefined) descendants.push(child.pid);
}

process.stdout.write(`${JSON.stringify({ pid: process.pid, descendants })}\n`);

// parentMs 为 0 时父进程立刻退出，留下比它活得久的后代；大于 0 时父子同时存活。
if (parentMs > 0) {
  setTimeout(() => {
    process.stdout.write('parent finished\n');
  }, parentMs);
}
