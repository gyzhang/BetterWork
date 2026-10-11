import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuiltinMcpRuntimeService } from './builtin-mcp-runtime-service';
import type { SkillDependencyService } from './skill-dependency-service';

const resourcesRoot = path.resolve('resources');
const appRoot = path.resolve('apps/desktop');
const pythonRuntimeAssetsRoot = path.resolve('apps/desktop/build/python-runtime-assets');

const tempRoots: string[] = [];
/** 造一个随包 Node 运行时目录替身；withNode=false 时不含 bin/node，用于验证回退 Electron。 */
const makeNodeRuntimeRoot = (withNode: boolean): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'bw-node-runtime-test-'));
  tempRoots.push(root);
  if (withNode) {
    mkdirSync(path.join(root, 'bin'), { recursive: true });
    writeFileSync(path.join(root, 'bin', 'node'), '');
  }
  return root;
};

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('BuiltinMcpRuntimeService', () => {
  it('falls back to the Electron executable when no managed Node runtime is bundled', async () => {
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: pythonRuntimeAssetsRoot,
      nodeRuntimeRoot: makeNodeRuntimeRoot(false),
      dependencies: {} as SkillDependencyService,
    });

    const launch = await service.resolve(
      'filesystem',
      ['/Users/test/Documents'],
      new AbortController().signal,
    );

    expect(launch.command).toBe(process.execPath);
    expect(launch.args[0]).toContain('@modelcontextprotocol/server-filesystem/dist/index.js');
    expect(launch.args.slice(1)).toEqual(['/Users/test/Documents']);
    expect(launch.runAsNode).toBe(false);
  });

  it('launches a Node package through the bundled managed Node when present', async () => {
    const nodeRuntimeRoot = makeNodeRuntimeRoot(true);
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: pythonRuntimeAssetsRoot,
      nodeRuntimeRoot,
      dependencies: {} as SkillDependencyService,
    });

    const launch = await service.resolve('memory', [], new AbortController().signal);

    expect(launch.command).toBe(path.join(nodeRuntimeRoot, 'bin', 'node'));
    expect(launch.args[0]).toContain('@modelcontextprotocol/server-memory');
    expect(launch.runAsNode).toBe(false);
  });

  it('prepares fetch with the pinned arm64 lock and the bundled wheelhouse', async () => {
    const prepareEnvironmentAndWait = vi.fn(async () => ({ id: 'environment-fetch' }));
    const resolveEnvironmentPython = vi.fn(() => '/user-data/environments/fetch/bin/python3');
    const dependencies = {
      prepareEnvironmentAndWait,
      resolveEnvironmentPython,
    } as unknown as SkillDependencyService;
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: pythonRuntimeAssetsRoot,
      nodeRuntimeRoot: makeNodeRuntimeRoot(false),
      dependencies,
    });

    const launch = await service.resolve(
      'fetch',
      ['--ignore-robots-txt'],
      new AbortController().signal,
    );

    expect(prepareEnvironmentAndWait).toHaveBeenCalledOnce();
    expect(prepareEnvironmentAndWait).toHaveBeenCalledWith(
      {
        kind: 'managed',
        distributionId: 'python-build-standalone-3.12.14-darwin-arm64',
      },
      expect.objectContaining({
        platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
        packages: expect.arrayContaining([
          expect.objectContaining({ name: 'mcp-server-fetch', version: '2026.8.18' }),
        ]),
        importProbes: expect.arrayContaining(['mcp_server_fetch']),
      }),
      expect.any(AbortSignal),
      'prepare',
      path.join(pythonRuntimeAssetsRoot, 'wheelhouse'),
    );
    expect(resolveEnvironmentPython).toHaveBeenCalledWith('environment-fetch');
    expect(launch).toEqual({
      command: '/user-data/environments/fetch/bin/python3',
      args: ['-m', 'mcp_server_fetch', '--ignore-robots-txt'],
    });
  });

  it('does not begin a preparation after cancellation', async () => {
    const prepareEnvironmentAndWait = vi.fn();
    const dependencies = { prepareEnvironmentAndWait } as unknown as SkillDependencyService;
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: pythonRuntimeAssetsRoot,
      nodeRuntimeRoot: makeNodeRuntimeRoot(false),
      dependencies,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(service.resolve('fetch', [], controller.signal)).rejects.toThrow();
    expect(prepareEnvironmentAndWait).not.toHaveBeenCalled();
  });
});
