import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  DependencyProcessHandle,
  DependencyProcessRequest,
  DependencyProcessResult,
  DependencyProcessRunner,
} from '../infrastructure/dependency-adapters';
import { ManagedNodeRuntimeService } from './managed-node-runtime-service';

const temporaryRoots: string[] = [];

const createFixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-managed-node-'));
  temporaryRoots.push(root);
  const bin = path.join(root, 'bin');
  const npmCli = path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.dirname(npmCli), { recursive: true });
  for (const name of ['node', 'npm', 'npx']) writeFileSync(path.join(bin, name), 'fixture');
  writeFileSync(npmCli, 'fixture');

  const requests: DependencyProcessRequest[] = [];
  let nodeOutcome: Partial<DependencyProcessResult> = { stdout: 'v24.21.0\n' };
  let npmOutcome: Partial<DependencyProcessResult> = { stdout: '11.19.0\n' };
  const runner: DependencyProcessRunner = {
    run(request): DependencyProcessHandle {
      requests.push(request);
      const outcome = request.argv.length === 1 ? nodeOutcome : npmOutcome;
      return {
        result: Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          ...outcome,
        }),
        kill: () => undefined,
      };
    },
  };

  return {
    root,
    npmCli,
    requests,
    runner,
    service: new ManagedNodeRuntimeService({ nodeRuntimeRoot: root, runner }),
    setNodeOutcome(outcome: Partial<DependencyProcessResult>): void {
      nodeOutcome = outcome;
    },
    setNpmOutcome(outcome: Partial<DependencyProcessResult>): void {
      npmOutcome = outcome;
    },
  };
};

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  temporaryRoots.length = 0;
});

describe('ManagedNodeRuntimeService', () => {
  it('runs the bundled Node and npm and reports their detected versions', async () => {
    const fixture = createFixture();

    await expect(fixture.service.inspect()).resolves.toEqual({
      id: 'node-24.21.0-darwin-arm64',
      version: '24.21.0',
      npmVersion: '11.19.0',
      platform: { os: 'darwin', arch: 'arm64' },
      status: 'installed',
      detectedVersion: '24.21.0',
      detectedNpmVersion: '11.19.0',
    });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[0]?.argv).toEqual(['--version']);
    expect(fixture.requests[1]?.argv).toEqual([fixture.npmCli, '--version']);
    expect(fixture.requests[0]?.env).not.toHaveProperty('NODE_OPTIONS');
  });

  it('reports missing assets without spawning a probe', async () => {
    const fixture = createFixture();
    rmSync(path.join(fixture.root, 'bin', 'npx'));

    await expect(fixture.service.inspect()).resolves.toMatchObject({
      id: 'node-24.21.0-darwin-arm64',
      status: 'missing',
    });
    expect(fixture.requests).toHaveLength(0);
  });

  it('reports a version mismatch with the detected version', async () => {
    const fixture = createFixture();
    fixture.setNpmOutcome({ stdout: '11.18.0\n' });

    await expect(fixture.service.inspect()).resolves.toMatchObject({
      status: 'mismatch',
      detectedVersion: '24.21.0',
      detectedNpmVersion: '11.18.0',
    });
  });

  it('reports failed or timed out probes as check failures', async () => {
    const fixture = createFixture();
    fixture.setNodeOutcome({ exitCode: null, timedOut: true });

    await expect(fixture.service.inspect()).resolves.toMatchObject({ status: 'check-failed' });
    expect(fixture.requests).toHaveLength(1);
  });
});
