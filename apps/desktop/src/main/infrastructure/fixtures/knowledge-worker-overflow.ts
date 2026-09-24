/**
 * 测试替身：对任何请求都只灌出一条超过响应上限的行，永不返回可配对响应。
 * 用于验证运行器的响应大小守卫与进程收口（知识契约 §8.2）。
 * 上限与协议 KNOWLEDGE_WORKER_RESPONSE_MAX_BYTES（64 MiB）保持一致；
 * 这里不导入协议，避免替身自身依赖构建别名。
 */
import { createInterface } from 'node:readline';

const RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

const lines = createInterface({ input: process.stdin });
lines.on('line', () => {
  const megabyte = 'x'.repeat(1024 * 1024);
  for (let written = 0; written <= RESPONSE_MAX_BYTES; written += megabyte.length) {
    process.stdout.write(megabyte);
  }
  process.stdout.write('\n');
});
