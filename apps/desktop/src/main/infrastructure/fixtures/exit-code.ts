/** 合成进程 fixture：以指定退出码结束，用于验证非零退出的失败阶段与错误码。 */
const requested = Number(process.argv[2] ?? '0');
const code = Number.isInteger(requested) && requested >= 0 && requested <= 255 ? requested : 1;

process.stdout.write(`exiting with ${code}\n`);
process.exitCode = code;

// 让本文件成为 ES 模块：fixture 由 Node 直接执行，同时避免顶层常量进入全局作用域。
export {};
