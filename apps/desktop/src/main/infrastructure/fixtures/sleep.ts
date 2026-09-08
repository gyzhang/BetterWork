/**
 * 合成进程 fixture：先报出自己的 pid，再安静地等待指定毫秒数。
 *
 * 同时覆盖两件事：无 stdout 的长操作不能被判定为失败；pid 可与 guardian 报告的
 * `started.pid` 对比，用来验证 execve 之后进程身份未变。
 */
const ms = Number(process.argv[2] ?? '1000');
const wait = Number.isFinite(ms) && ms > 0 ? ms : 1_000;

process.stdout.write(`pid=${process.pid}\n`);

setTimeout(() => {
  process.stdout.write('slept\n');
}, wait);

// 让本文件成为 ES 模块：fixture 由 Node 直接执行，同时避免顶层常量进入全局作用域。
export {};
