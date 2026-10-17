import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubMcpDistribution } from '../infrastructure/github-mcp-distribution';
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
  it('pins the official macOS arm64 GitHub MCP distribution metadata', () => {
    expect(githubMcpDistribution).toMatchObject({
      version: '2.0.2',
      fileName: 'github-mcp-server_Darwin_arm64.tar.gz',
      license: 'MIT',
      entryRelativePath: 'github-mcp-server',
    });
    expect(githubMcpDistribution.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('launches GitHub with the bundled executable and forces read-only mode', async () => {
    const githubMcpRuntimeRoot = mkdtempSync(path.join(tmpdir(), 'bw-github-mcp-test-'));
    tempRoots.push(githubMcpRuntimeRoot);
    const executable = path.join(githubMcpRuntimeRoot, 'github-mcp-server');
    writeFileSync(executable, 'fixture executable');
    chmodSync(executable, 0o755);
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: pythonRuntimeAssetsRoot,
      nodeRuntimeRoot: makeNodeRuntimeRoot(false),
      githubMcpRuntimeRoot,
      dependencies: {} as SkillDependencyService,
    });

    const launch = await service.resolve(
      'github',
      ['--repo', 'example/repo', '--read-only', '--read-only=false', '--', '--verbose'],
      new AbortController().signal,
    );

    expect(launch).toEqual({
      command: executable,
      args: ['stdio', '--repo', 'example/repo', '--verbose', '--read-only'],
    });
  });

  it('reports an actionable error when the bundled GitHub executable is missing', async () => {
    const githubMcpRuntimeRoot = mkdtempSync(path.join(tmpdir(), 'bw-github-mcp-missing-'));
    tempRoots.push(githubMcpRuntimeRoot);
    const service = new BuiltinMcpRuntimeService({
      appRoot,
      resourcesRoot,
      runtimeAssetsRoot: pythonRuntimeAssetsRoot,
      nodeRuntimeRoot: makeNodeRuntimeRoot(false),
      githubMcpRuntimeRoot,
      dependencies: {} as SkillDependencyService,
    });

    await expect(service.resolve('github', [], new AbortController().signal)).rejects.toThrow(
      'GitHub MCP 随包运行时缺失或不可执行',
    );
  });

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
        distributionId: 'python-build-standalone-3.12.15-darwin-arm64',
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
