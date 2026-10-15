import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./expert-release-preflight.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const temporaryRoots: string[] = [];

const packagedResources = (skills: unknown, experts: unknown): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-release-preflight-'));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, 'skills'));
  mkdirSync(path.join(root, 'experts'));
  writeFileSync(path.join(root, 'skills/release-manifest.json'), JSON.stringify(skills));
  writeFileSync(path.join(root, 'experts/release-manifest.json'), JSON.stringify(experts));
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const runPreflight = (...args: string[]) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

describe('expert release preflight CLI', () => {
  it('accepts empty release lists for a clean installation package', () => {
    const root = packagedResources(
      { formatVersion: 1, skills: [] },
      { formatVersion: 1, experts: [] },
    );
    const result = runPreflight('--packaged-root', root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Packaged Resources verified');
  });

  it.each(['skills', 'experts'])('rejects a missing %s list', (missingList) => {
    const root = packagedResources(
      missingList === 'skills' ? { formatVersion: 1 } : { formatVersion: 1, skills: [] },
      missingList === 'experts' ? { formatVersion: 1 } : { formatVersion: 1, experts: [] },
    );
    const result = runPreflight('--packaged-root', root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('release manifest');
  });

  it.each(['skills', 'experts'])('rejects leftover %s resources in an empty release', (kind) => {
    const root = packagedResources(
      { formatVersion: 1, skills: [] },
      { formatVersion: 1, experts: [] },
    );
    mkdirSync(path.join(root, kind, 'leftover-test-resource'));
    const result = runPreflight('--packaged-root', root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('leftover-test-resource');
  });

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
