import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ManagedNodeRuntimeSummary } from '@betterwork/agent-protocol';

import type { DependencyProcessRunner } from '../infrastructure/dependency-adapters';
import { findNodeDistributionForPlatform } from '../infrastructure/node-distribution';
import { managedNodeBin, managedNodeTool } from '../infrastructure/node-runtime';

const probeTimeoutMs = 5_000;
const probeEnvironment = {
  PATH: '/usr/bin:/bin',
  npm_config_userconfig: '/dev/null',
  npm_config_logs_max: '0',
  npm_config_offline: 'true',
  npm_config_update_notifier: 'false',
  npm_config_loglevel: 'silent',
};

const reportedVersion = (output: string): string | undefined => {
  const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(output.trim());
  return match?.[1];
};

export interface ManagedNodeRuntimeServiceOptions {
  readonly nodeRuntimeRoot: string;
  readonly runner: DependencyProcessRunner;
}

/** 检查安装包内 Node.js/npm 资源，并返回设置页可展示的实际版本。 */
export class ManagedNodeRuntimeService {
  constructor(private readonly options: ManagedNodeRuntimeServiceOptions) {}

  async inspect(): Promise<ManagedNodeRuntimeSummary> {
    const distribution = findNodeDistributionForPlatform({ os: 'darwin', arch: 'arm64' });
    if (!distribution) throw new Error('找不到 macOS arm64 随包 Node.js 发行候选。');

    const base = {
      id: distribution.id,
      version: distribution.version,
      npmVersion: distribution.npmVersion,
      platform: distribution.platform,
    };
    const nodeBin = managedNodeBin(this.options.nodeRuntimeRoot);
    const npmBin = managedNodeTool(this.options.nodeRuntimeRoot, 'npm');
    const npxBin = managedNodeTool(this.options.nodeRuntimeRoot, 'npx');
    const npmCli = path.join(
      this.options.nodeRuntimeRoot,
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    if (!nodeBin || !npmBin || !npxBin || !existsSync(npmCli))
      return { ...base, status: 'missing' };

    const nodeResult = await this.options.runner.run({
      executable: nodeBin,
      argv: ['--version'],
      env: probeEnvironment,
      timeoutMs: probeTimeoutMs,
    }).result;
    const actualVersion =
      nodeResult.exitCode === 0 && !nodeResult.timedOut
        ? reportedVersion(nodeResult.stdout)
        : undefined;
    if (!actualVersion)
      return {
        ...base,
        status: 'check-failed',
      };
    if (actualVersion !== distribution.version)
      return { ...base, status: 'mismatch', detectedVersion: actualVersion };

    const npmResult = await this.options.runner.run({
      executable: nodeBin,
      argv: [npmCli, '--version'],
      env: probeEnvironment,
      timeoutMs: probeTimeoutMs,
    }).result;
    const actualNpmVersion =
      npmResult.exitCode === 0 && !npmResult.timedOut
        ? reportedVersion(npmResult.stdout)
        : undefined;
    if (!actualNpmVersion)
      return { ...base, status: 'check-failed', detectedVersion: actualVersion };
    if (actualNpmVersion !== distribution.npmVersion)
      return {
        ...base,
        status: 'mismatch',
        detectedVersion: actualVersion,
        detectedNpmVersion: actualNpmVersion,
      };

    return {
      ...base,
      status: 'installed',
      detectedVersion: actualVersion,
      detectedNpmVersion: actualNpmVersion,
    };
  }
}
