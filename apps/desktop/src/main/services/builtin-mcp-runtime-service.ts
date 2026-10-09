import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  type DependencyLock,
  dependencyLockSchema,
  type McpBundledServerId,
} from '@betterwork/agent-protocol';

import type { McpStdioLaunch } from '../infrastructure/mcp-stdio-launch';
import { type SkillDependencyService } from './skill-dependency-service';

const nodeServerPackages: Record<Exclude<McpBundledServerId, 'fetch'>, string> = {
  filesystem: '@modelcontextprotocol/server-filesystem',
  memory: '@modelcontextprotocol/server-memory',
  'sequential-thinking': '@modelcontextprotocol/server-sequential-thinking',
};

interface BuiltinMcpRuntimeOptions {
  readonly appRoot: string;
  readonly resourcesRoot: string;
  readonly runtimeAssetsRoot: string;
  readonly dependencies: SkillDependencyService;
}

const packageBinPath = async (appRoot: string, packageName: string): Promise<string> => {
  const appRequire = createRequire(path.join(appRoot, 'package.json'));
  const manifestPath = appRequire.resolve(`${packageName}/package.json`);
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !('bin' in manifest))
    throw new Error(`内置 MCP 包 ${packageName} 没有可执行入口。`);
  const bin = manifest.bin;
  const entry =
    typeof bin === 'string'
      ? bin
      : bin && typeof bin === 'object'
        ? Object.values(bin).find((value): value is string => typeof value === 'string')
        : undefined;
  if (!entry || path.isAbsolute(entry)) throw new Error(`内置 MCP 包 ${packageName} 入口无效。`);
  const entryPath = path.resolve(path.dirname(manifestPath), entry);
  if (!entryPath.startsWith(`${path.dirname(manifestPath)}${path.sep}`))
    throw new Error(`内置 MCP 包 ${packageName} 入口超出包目录。`);
  return entryPath;
};

export class BuiltinMcpRuntimeService {
  constructor(private readonly options: BuiltinMcpRuntimeOptions) {}

  async resolve(
    serverId: McpBundledServerId,
    serverArgs: readonly string[],
    signal: AbortSignal,
  ): Promise<McpStdioLaunch> {
    signal.throwIfAborted();
    if (serverId !== 'fetch') {
      const scriptPath = await packageBinPath(this.options.appRoot, nodeServerPackages[serverId]);
      return {
        command: process.execPath,
        args: [scriptPath, ...serverArgs],
        runAsNode: process.versions.electron !== undefined,
      };
    }

    const lockPath = path.join(
      this.options.resourcesRoot,
      'dependency-locks',
      'mcp-server-fetch-darwin-arm64-cp312.json',
    );
    const lock = dependencyLockSchema.parse(
      JSON.parse(await readFile(lockPath, 'utf8')) as DependencyLock,
    );
    const environment = await this.options.dependencies.prepareEnvironmentAndWait(
      {
        kind: 'managed',
        distributionId: 'python-build-standalone-3.12.14-darwin-arm64',
      },
      lock,
      signal,
      'prepare',
      path.join(this.options.runtimeAssetsRoot, 'wheelhouse'),
    );
    signal.throwIfAborted();
    return {
      command: this.options.dependencies.resolveEnvironmentPython(environment.id),
      args: ['-m', 'mcp_server_fetch', ...serverArgs],
    };
  }
}
