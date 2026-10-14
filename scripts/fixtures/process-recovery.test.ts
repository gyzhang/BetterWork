import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

const runnerUrl = new URL('./process-recovery.mjs', import.meta.url).href;

function run(mode: string): ReturnType<typeof spawnSync> {
  const output = mkdtempSync(path.join(os.tmpdir(), 'betterwork-recovery-control-'));
  try {
    writeFileSync(
      path.join(output, 'recovery.cjs'),
      `
const fs = require('node:fs');
const path = require('node:path');
const [, , , directory, phase] = process.argv;
if (phase === 'prepare') {
  if (process.env.RECOVERY_CONTROL_MODE === 'early') process.exit(7);
  if (process.env.RECOVERY_CONTROL_MODE === 'timeout') { setInterval(() => {}, 1000); return; }
  fs.writeFileSync(path.join(directory, 'ready.json'), JSON.stringify({ pid: process.pid }));
  setInterval(() => {}, 1000);
} else {
  const prior = JSON.parse(fs.readFileSync(path.join(directory, 'ready.json'), 'utf8'));
  fs.writeFileSync(path.join(directory, 'recovered.json'), JSON.stringify({ previousPid: prior.pid, recoveredPid: process.pid, requests: 0, checks: Array.from({ length: 10 }, (_, i) => i) }));
}
`,
    );
    const parent = `
import { runProcessRecovery } from ${JSON.stringify(runnerUrl)};
import fs from 'node:fs';
import path from 'node:path';
const originalKill = process.kill;
let calls = 0;
process.kill = (pid, signal) => {
  calls += 1;
  if (${JSON.stringify(mode)} === 'repeat' && calls > 1) throw Object.assign(new Error('repeat EPERM'), { code: 'EPERM' });
  if (${JSON.stringify(mode)} === 'permission' && calls === 1) throw Object.assign(new Error('first EPERM'), { code: 'EPERM' });
  return originalKill(pid, signal);
};
try {
  const result = await runProcessRecovery({ electron: process.execPath, output: ${JSON.stringify(output)}, root: ${JSON.stringify(output)}, environment: { ...process.env, RECOVERY_CONTROL_MODE: ${JSON.stringify(mode)} }, ...(${JSON.stringify(mode)} === 'timeout' ? { timeoutMs: 40 } : {}) });
  process.stdout.write(JSON.stringify({ calls, interruption: result.interruption }));
} catch (error) {
  process.stderr.write(String(error) + '\\n');
  if (error.errors) for (const cause of error.errors) process.stderr.write(String(cause) + '\\n');
  process.exitCode = 1;
}
`;
    return spawnSync(process.execPath, ['--input-type=module', '-e', parent], {
      encoding: 'utf8',
      timeout: 10_000,
    });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

describe('owned process recovery lifecycle without an Electron window', () => {
  it('signals the running prepare group once and never signals a reaped leader again', () => {
    const result = run('repeat');
    expect(result.status, String(result.stderr)).toBe(0);
    expect(JSON.parse(String(result.stdout))).toEqual({
      calls: 1,
      interruption: 'SIGKILL-owned-process-group',
    });
  });

  it('does not treat a denied first SIGKILL as successful recovery', () => {
    const result = run('permission');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('first EPERM');
  });

  it('reports an early exit before readiness without signalling a finished process', () => {
    const result = run('early');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('就绪前退出');
  });

  it('routes timeout failure through the awaited promise instead of an uncaught timer', () => {
    const result = run('timeout');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('超时');
  });
});
