import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ExecutionLogSink, ExecutionLogStream } from './mac-process-supervisor';

export function createExecutionLog(
  root: string,
  executionId: string,
  maxBytes = 10 * 1024 * 1024,
): ExecutionLogSink {
  const directory = path.join(root, executionId);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'console.log');
  writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  let bytesWritten = 0;
  let failure: unknown;
  return {
    key: path.join('execution-logs', executionId, 'console.log'),
    write(stream: ExecutionLogStream, text: string) {
      if (failure || bytesWritten >= maxBytes) return;
      const bytes = Buffer.from(`[${stream}] ${text}`).subarray(0, maxBytes - bytesWritten);
      try {
        appendFileSync(file, bytes);
        bytesWritten += bytes.length;
      } catch (error) {
        failure = error;
      }
    },
    async close() {
      if (failure) throw new Error('执行日志写入失败', { cause: failure });
    },
  };
}
