import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./expert-release-preflight.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

const runPreflight = (...args: string[]) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

describe('expert release preflight CLI', () => {
  it('keeps resource verification available without a signing identity', () => {
    const result = runPreflight();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Expert release preflight passed');
  });

  it('requires an application bundle for signed verification', () => {
    const result = runPreflight('--signed-app');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--signed-app requires an application bundle');
  });

  it('rejects a non-app path before invoking codesign', () => {
    const result = runPreflight('--signed-app', 'resources');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--signed-app 必须指向存在的 .app 目录');
  });
});
