import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BuiltinMcpRuntimeService } from './builtin-mcp-runtime-service';
import type { SkillDependencyService } from './skill-dependency-service';

const resourcesRoot = path.resolve('resources');
const appRoot = path.resolve('apps/desktop');

describe('BuiltinMcpRuntimeService', () => {
  it('resolves a Node package entry and launches it through the Electron executable', async () => {
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: path.resolve('apps/desktop/build/mcp-runtime-assets'),
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

  it('prepares fetch with the pinned arm64 lock and the bundled wheelhouse', async () => {
    const prepareEnvironmentAndWait = vi.fn(async () => ({ id: 'environment-fetch' }));
    const resolveEnvironmentPython = vi.fn(() => '/user-data/environments/fetch/bin/python3');
    const dependencies = {
      prepareEnvironmentAndWait,
      resolveEnvironmentPython,
    } as unknown as SkillDependencyService;
    const runtimeAssetsRoot = path.resolve('apps/desktop/build/mcp-runtime-assets');
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot,
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
      path.join(runtimeAssetsRoot, 'wheelhouse'),
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
      runtimeAssetsRoot: path.resolve('apps/desktop/build/mcp-runtime-assets'),
      dependencies,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(service.resolve('fetch', [], controller.signal)).rejects.toThrow();
    expect(prepareEnvironmentAndWait).not.toHaveBeenCalled();
  });
});
