import { writeSync } from 'node:fs';

/**
 * 合成进程 fixture：以 64 KiB 为块把指定字节量写进 stdout。
 *
 * 用同步写而不是 `process.stdout.write`，是为了在管道被 guardian 暂停时真实地阻塞，
 * 从而验证「有界输出但持续排空」：日志与模型可见输出都被限额截断，但目标进程不会
 * 因为管道写满而卡死或失败。
 */
const requested = Number(process.argv[2] ?? '1048576');
const total = Number.isInteger(requested) && requested > 0 ? requested : 1_048_576;
const block = Buffer.alloc(64 * 1024, 0x61);

let written = 0;
while (written < total) {
  const size = Math.min(block.byteLength, total - written);
  writeSync(1, size === block.byteLength ? block : block.subarray(0, size));
  written += size;
}

writeSync(1, Buffer.from(`flooded ${written}\n`, 'utf8'));
