/**
 * 合成进程 fixture：把 argv / cwd / pid / 选定环境变量原样回报。
 *
 * 用来验证 supervisor 走的是 `shell=false` + argv：中文、空格、引号都不应被重新切分，
 * 宿主没有注入的变量（例如 PYTHONPATH）也不应出现在目标环境里。
 */
const report = {
  pid: process.pid,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    FIXTURE_MARKER: process.env['FIXTURE_MARKER'] ?? '',
    PYTHONPATH: process.env['PYTHONPATH'] ?? '',
    PATH: process.env['PATH'] ?? '',
  },
};

process.stdout.write(`${JSON.stringify(report)}\n`);
process.stderr.write('fixture stderr line\n');

// 让本文件成为 ES 模块：fixture 由 Node 直接执行，同时避免顶层常量进入全局作用域。
export {};
