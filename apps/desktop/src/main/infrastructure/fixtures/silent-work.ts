/**
 * 合成进程 fixture：安静地占用进程一段时间，不产生任何 stdout / stderr。
 *
 * 用于验证「没有输出的长操作不能被判定为失败」，也用于替身 guardian 场景——
 * 那里目标的输出会直接落在控制通道上，必须保持安静。
 */
const requested = Number(process.argv[2] ?? '1000');
const wait = Number.isFinite(requested) && requested > 0 ? requested : 1_000;

setTimeout(() => undefined, wait);

// 让本文件成为 ES 模块：fixture 由 Node 直接执行，同时避免顶层常量进入全局作用域。
export {};
