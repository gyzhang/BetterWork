import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { createExecutionLog } from './execution-log';

it('retains bounded execution logs after close', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-log-'));
  try {
    const log = createExecutionLog(root, 'execution', 64);
    log.write('stdout', '正常输出\n');
    log.write('stderr', 'x'.repeat(1024));
    await log.close();
    const file = path.join(root, 'execution/console.log');
    expect(statSync(file).size).toBe(64);
    expect(readFileSync(file, 'utf8')).toContain('正常输出');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
