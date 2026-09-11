import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DependencyLock, TargetPlatform } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeFileSystem,
  createNodeProcessRunner,
  type DependencyDownloader,
} from '../infrastructure/dependency-adapters';
import { pythonDistributions } from '../infrastructure/python-distribution';
import { AppStore } from '../persistence';
import {
  FakeDownloader,
  FakeFileSystem,
  FakePythonRunner,
  type PythonScenario,
  scenarioOf,
} from './fixtures/fake-python-runtime';
import {
  computeDependencyLockHash,
  computeEnvironmentKey,
  DependencyPreparationError,
  redactCredentials,
  SkillDependencyService,
} from './skill-dependency-service';

const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-dependency-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const sha256Of = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

interface Harness {
  service: SkillDependencyService;
  store: AppStore;
  filesystem: FakeFileSystem;
  process: FakePythonRunner;
  download: FakeDownloader;
  paths: {
    userDataRoot: string;
    pythonRoot: string;
    environmentsRoot: string;
    wheelhouseRoot: string;
  };
}

const localBase = { kind: 'local', path: '/usr/local/bin/python3.12' } as const;

const openService = (scenario: Partial<PythonScenario> = {}): Harness => {
  const userDataRoot = temporaryDirectory();
  const store = AppStore.open(path.join(userDataRoot, 'app.sqlite'));
  const filesystem = new FakeFileSystem();
  // 用户选择的本机解释器必须真实存在，服务才会继续探测。
  filesystem.files.set(localBase.path, encoder.encode('#!/bin/sh\n# fake interpreter\n'));
  const runner = new FakePythonRunner(scenarioOf(scenario), filesystem);
  const download = new FakeDownloader();
  const paths = {
    userDataRoot,
    pythonRoot: path.join(userDataRoot, 'python'),
    environmentsRoot: path.join(userDataRoot, 'environments'),
    wheelhouseRoot: path.join(userDataRoot, 'wheelhouse'),
  };
  return {
    service: new SkillDependencyService({ store, paths, filesystem, process: runner, download }),
    store,
    filesystem,
    process: runner,
    download,
    paths,
  };
};

const wheelBytes = encoder.encode('fake wheel payload');
const wheelName = 'python_pptx-1.0.2-py3-none-any.whl';

const lockOf = (overrides: Partial<DependencyLock> = {}): DependencyLock => ({
  lockVersion: 1,
  platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
  pythonRequirement: '3.12',
  packages: [
    {
      name: 'python-pptx',
      version: '1.0.2',
      wheel: wheelName,
      sha256: sha256Of(wheelBytes),
      source: 'wheelhouse',
    },
  ],
  importProbes: ['pptx'],
  ...overrides,
});

const seedWheelhouse = async (harness: Harness, bytes: Uint8Array = wheelBytes): Promise<void> => {
  await harness.filesystem.writeFile(path.join(harness.paths.wheelhouseRoot, wheelName), bytes);
};

const finishOperation = async (
  harness: Harness,
  operationId: string,
  budgetMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const operation = harness.service.getOperation(operationId);
    const status = operation?.status;
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return;
    if (Date.now() > deadline)
      throw new Error(`作业未在预算内结束，当前状态 ${status ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('Python 环境准备作业', () => {
  it('完整准备：venv 建在最终目录，pip 只由 venv 解释器离线执行', async () => {
    const harness = openService();
    await seedWheelhouse(harness);

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);

    const environment = harness.service.getEnvironment(receipt.environmentId);
    const operation = harness.service.getOperation(receipt.operationId);
    expect(environment?.status).toBe('ready');
    expect(environment?.readyAt).toBeGreaterThan(0);
    expect(operation?.status).toBe('succeeded');
    expect(receipt.reused).toBe(false);

    // venv 由基础解释器创建，且没有 --system-site-packages（不复用随时会变的系统包集合）
    const venvCalls = harness.process.callsMatching('venv');
    expect(venvCalls).toHaveLength(1);
    expect(venvCalls[0]?.executable).toBe(localBase.path);
    expect(venvCalls[0]?.argv).not.toContain('--system-site-packages');

    // pip 只由 venv 内的解释器执行：基础解释器的全局 site-packages 不会被写入
    const pipCalls = harness.process.callsMatching('pip', 'install');
    expect(pipCalls).toHaveLength(1);
    const pipExecutable = pipCalls[0]?.executable ?? '';
    expect(pipExecutable.startsWith(harness.paths.environmentsRoot)).toBe(true);
    expect(pipExecutable).not.toBe(localBase.path);
    const pipArgv = pipCalls[0]?.argv ?? [];
    for (const required of [
      '--no-index',
      '--only-binary=:all:',
      '--require-hashes',
      '--no-cache-dir',
      '-r',
    ]) {
      expect(pipArgv).toContain(required);
    }
    expect(pipArgv).toContain('--find-links');
    expect(harness.download.urls).toEqual([]);

    // 目录键就是最终位置，不是先建临时目录再改名
    expect(environment?.pathKey.startsWith('environments/')).toBe(true);
    const venvRoot = path.join(harness.paths.userDataRoot, environment?.pathKey ?? '');
    expect(await harness.filesystem.exists(path.join(venvRoot, 'bin', 'python3'))).toBe(true);

    // 安装用的 requirements 带完整 hash
    const lockFile = await harness.filesystem.readFile(path.join(venvRoot, 'betterwork-lock.txt'));
    expect(new TextDecoder().decode(lockFile)).toContain(
      `python-pptx==1.0.2 --hash=sha256:${sha256Of(wheelBytes)}`,
    );
  });

  it('同键重复准备：第二次只观察已有作业，不会跑第二遍安装', async () => {
    const harness = openService({ installDelayMs: 200 });
    await seedWheelhouse(harness);

    const first = await harness.service.prepareEnvironment(localBase, lockOf());
    const second = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, first.operationId);

    expect(second.reused).toBe(true);
    expect(second.operationId).toBe(first.operationId);
    expect(second.environmentId).toBe(first.environmentId);
    expect(harness.process.callsMatching('pip', 'install')).toHaveLength(1);

    // 已就绪后再准备同样不重启作业，只返回同一个环境
    const third = await harness.service.prepareEnvironment(localBase, lockOf());
    expect(third.reused).toBe(true);
    expect(third.environmentId).toBe(first.environmentId);
    expect(harness.process.callsMatching('pip', 'install')).toHaveLength(1);
    expect(harness.service.getEnvironment(first.environmentId)?.status).toBe('ready');
  });

  it('环境键由解释器指纹、平台与包锁共同决定', async () => {
    const harness = openService();
    await seedWheelhouse(harness);
    const lock = lockOf();

    const first = await harness.service.prepareEnvironment(localBase, lock);
    await finishOperation(harness, first.operationId);
    const differentLock = await harness.service.prepareEnvironment(
      localBase,
      lockOf({ importProbes: ['pptx', 'lxml'] }),
    );
    await finishOperation(harness, differentLock.operationId);

    expect(differentLock.environmentKey).not.toBe(first.environmentKey);
    expect(differentLock.environmentId).not.toBe(first.environmentId);
    expect(harness.service.listEnvironments()).toHaveLength(2);
    expect(
      computeEnvironmentKey(
        { kind: 'local', path: localBase.path, version: '3.12.14' },
        { os: 'darwin', arch: 'arm64', abi: 'cp312' },
        computeDependencyLockHash(lock),
      ),
    ).toBe(first.environmentKey);
    // 换一个解释器路径就是另一个环境，即使锁完全相同
    expect(
      computeEnvironmentKey(
        { kind: 'local', path: '/opt/other/python3.12', version: '3.12.14' },
        { os: 'darwin', arch: 'arm64', abi: 'cp312' },
        computeDependencyLockHash(lock),
      ),
    ).not.toBe(first.environmentKey);
  });

  it('部分安装失败：作业与环境都落失败态，只清理本次目录，旧 ready 环境保留', async () => {
    const harness = openService();
    await seedWheelhouse(harness);
    const healthy = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, healthy.operationId);
    expect(harness.service.getEnvironment(healthy.environmentId)?.status).toBe('ready');

    harness.process.calls.length = 0;
    const brokenScenario = openService({
      installExitCode: 1,
      installStderr: 'ERROR: No matching distribution found for lxml',
    });
    await seedWheelhouse(brokenScenario);
    const brokenLock = lockOf({ importProbes: ['pptx', 'lxml'] });
    const broken = await brokenScenario.service.prepareEnvironment(localBase, brokenLock);
    await finishOperation(brokenScenario, broken.operationId);

    const operation = brokenScenario.service.getOperation(broken.operationId);
    const environment = brokenScenario.service.getEnvironment(broken.environmentId);
    expect(operation?.status).toBe('failed');
    expect(operation?.failureCode).toBe('install-failed');
    expect(operation?.message).toContain('No matching distribution found');
    expect(environment?.status).toBe('failed');
    expect(environment?.failureCode).toBe('install-failed');
    // 本作业目录被清掉，不留下部分包集冒充可用环境
    const instanceRoot = path.join(
      brokenScenario.paths.userDataRoot,
      environment?.pathKey ?? 'missing',
    );
    expect(await brokenScenario.filesystem.exists(instanceRoot)).toBe(false);
    expect(harness).toBeDefined();
  });

  it('取消准备：终止安装子进程，作业与环境落取消态并清理目录', async () => {
    const harness = openService({ installDelayMs: 5_000 });
    await seedWheelhouse(harness);

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await new Promise((resolve) => setTimeout(resolve, 60));
    const cancel = await harness.service.cancelPreparation(receipt.operationId);
    await finishOperation(harness, receipt.operationId);

    expect(cancel.applied).toBe(true);
    expect(cancel.status).toBe('cancelled');
    expect(harness.process.killed.some((call) => call.argv.includes('pip'))).toBe(true);
    expect(harness.service.getOperation(receipt.operationId)?.status).toBe('cancelled');
    const environment = harness.service.getEnvironment(receipt.environmentId);
    expect(environment?.status).toBe('cancelled');
    expect(
      await harness.filesystem.exists(
        path.join(harness.paths.userDataRoot, environment?.pathKey ?? 'missing'),
      ),
    ).toBe(false);

    // 重复取消幂等，且不会把已终态的作业改写
    const again = await harness.service.cancelPreparation(receipt.operationId);
    expect(again.status).toBe('cancelled');
  });

  it('重启恢复：上次留下的 preparing 作业与环境收口为中断，半成品目录被清掉', async () => {
    const harness = openService();
    const lock = lockOf();
    const plan = await harness.service.inspectPlan(localBase, lock);
    const environment = harness.store.environments.createEnvironment({
      environmentKey: plan.environmentKey,
      base: plan.base,
      platform: plan.platform,
      lockHash: plan.lockHash,
      lock,
      pathKey: path.join('environments', plan.environmentKey, 'instance-crashed'),
    });
    harness.store.environments.updateStatus(environment.id, 'preparing');
    const operation = harness.store.dependencyOperations.createOperation({
      environmentId: environment.id,
      environmentKey: plan.environmentKey,
      kind: 'prepare',
    });
    harness.store.dependencyOperations.markRunning(operation.id, { step: 'install-packages' }, 1);
    const instanceRoot = path.join(harness.paths.userDataRoot, environment.pathKey);
    await harness.filesystem.mkdir(path.join(instanceRoot, 'lib'));
    await harness.filesystem.writeFile(path.join(instanceRoot, 'partial.txt'), 'half installed');

    const recovered = await harness.service.recoverInterruptedPreparations();

    expect(recovered).toEqual({ operations: 1, environments: 1 });
    expect(harness.service.getOperation(operation.id)?.status).toBe('interrupted');
    const updated = harness.service.getEnvironment(environment.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.failureCode).toBe('interrupted');
    expect(await harness.filesystem.exists(instanceRoot)).toBe(false);
  });

  it('hash 不匹配：装之前就拒绝，pip 一次都不跑', async () => {
    const harness = openService();
    await seedWheelhouse(harness, encoder.encode('被替换过的 wheel'));

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);

    expect(harness.service.getOperation(receipt.operationId)?.failureCode).toBe(
      'wheel-checksum-mismatch',
    );
    expect(harness.service.getEnvironment(receipt.environmentId)?.status).toBe('failed');
    expect(harness.process.callsMatching('pip', 'install')).toHaveLength(0);
  });

  it('缺 wheel：随包来源缺件就明确失败，计划里列出缺项', async () => {
    const harness = openService();
    const plan = await harness.service.inspectPlan(localBase, lockOf());
    expect(plan.missingWheels).toEqual(['python-pptx']);
    expect(plan.requiresDownload).toBe(true);

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);

    const operation = harness.service.getOperation(receipt.operationId);
    expect(operation?.failureCode).toBe('wheel-missing');
    expect(operation?.message).toContain('python-pptx==1.0.2');
    expect(harness.process.callsMatching('pip', 'install')).toHaveLength(0);
  });

  it('凭据不落库：下载或安装错误里的代理凭据被脱敏后才进入记录', async () => {
    const harness = openService();
    harness.download.error = new Error(
      '无法连接 https://deploy:super-secret-token@proxy.internal:8443/simple/',
    );
    const lock = lockOf({
      packages: [
        {
          name: 'python-pptx',
          version: '1.0.2',
          wheel: wheelName,
          sha256: sha256Of(wheelBytes),
          source: 'approved-index',
          origin: 'https://pypi.internal/simple',
        },
      ],
    });

    const receipt = await harness.service.prepareEnvironment(localBase, lock);
    await finishOperation(harness, receipt.operationId);

    const operation = harness.service.getOperation(receipt.operationId);
    const environment = harness.service.getEnvironment(receipt.environmentId);
    const recorded = `${operation?.message ?? ''}${environment?.failureSummary ?? ''}`;
    expect(recorded).not.toContain('super-secret-token');
    expect(recorded).toContain('***');
    expect(redactCredentials('https://user:pass@host/path')).toBe('https://***:***@host/path');
  });

  it('解释器缺 venv：如实拒绝，不建半个环境', async () => {
    const harness = openService({ venv: false });
    await seedWheelhouse(harness);

    await expect(harness.service.inspectPlan(localBase, lockOf())).rejects.toMatchObject({
      code: 'interpreter-missing-venv',
    });
    expect(harness.service.listEnvironments()).toHaveLength(0);
    expect(harness.process.callsMatching('venv')).toHaveLength(0);
  });

  it('非目标架构：解释器与包锁平台不一致时失败并说明差异', async () => {
    const harness = openService({ machine: 'arm64' });
    await seedWheelhouse(harness);
    const lock = lockOf({ platform: { os: 'darwin', arch: 'x64', abi: 'cp312' } });

    const receipt = await harness.service.prepareEnvironment(localBase, lock);
    await finishOperation(harness, receipt.operationId);

    const operation = harness.service.getOperation(receipt.operationId);
    expect(operation?.status).toBe('failed');
    expect(operation?.failureCode).toBe('interpreter-platform-mismatch');
    expect(operation?.message).toContain('arm64');
    expect(harness.process.callsMatching('venv')).toHaveLength(0);
  });

  it('版本不满足包锁要求时拒绝，不静默降级', async () => {
    const harness = openService({ version: '3.11.6' });
    await seedWheelhouse(harness);
    const lock = lockOf({ platform: { os: 'darwin', arch: 'arm64', abi: 'cp311' } });

    const receipt = await harness.service.prepareEnvironment(localBase, lock);
    await finishOperation(harness, receipt.operationId);

    expect(harness.service.getOperation(receipt.operationId)?.failureCode).toBe(
      'interpreter-version-mismatch',
    );
  });

  it('import 探测不过就不能 ready', async () => {
    const harness = openService({ missingModules: ['pptx'] });
    await seedWheelhouse(harness);

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);

    expect(harness.service.getOperation(receipt.operationId)?.failureCode).toBe(
      'import-probe-failed',
    );
    expect(harness.service.getOperation(receipt.operationId)?.message).toContain('pptx');
    expect(harness.service.getEnvironment(receipt.environmentId)?.status).toBe('failed');
  });

  it('venv 创建失败：错误原因回到作业记录', async () => {
    const harness = openService({
      venvExitCode: 1,
      venvStderr:
        'The virtual environment was not created successfully because ensurepip is not available.',
    });
    await seedWheelhouse(harness);

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);

    const operation = harness.service.getOperation(receipt.operationId);
    expect(operation?.failureCode).toBe('venv-create-failed');
    expect(operation?.message).toContain('ensurepip');
  });

  it('无网络也能准备：wheelhouse 完整时下载器一次都不被调用', async () => {
    const harness = openService();
    await seedWheelhouse(harness);
    harness.download.error = new Error('准备作业不应该联网');

    const plan = await harness.service.inspectPlan(localBase, lockOf());
    expect(plan.missingWheels).toEqual([]);
    expect(plan.requiresDownload).toBe(false);

    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);

    expect(harness.service.getEnvironment(receipt.environmentId)?.status).toBe('ready');
    expect(harness.download.urls).toEqual([]);
  });

  it('受管制品：校验值不符就拒绝使用并清掉半成品', async () => {
    const harness = openService();
    await seedWheelhouse(harness);
    const distribution = pythonDistributions[0];
    if (!distribution) throw new Error('缺少受管 Python 候选');
    harness.download.payload = encoder.encode('这不是上游制品');

    const receipt = await harness.service.prepareEnvironment(
      { kind: 'managed', distributionId: distribution.id },
      lockOf(),
    );
    await finishOperation(harness, receipt.operationId);

    expect(harness.download.urls).toEqual([distribution.url]);
    expect(harness.service.getOperation(receipt.operationId)?.failureCode).toBe(
      'distribution-checksum-mismatch',
    );
    expect(
      await harness.filesystem.exists(path.join(harness.paths.pythonRoot, distribution.sha256)),
    ).toBe(false);
  });

  it('受管制品已落地：不重复下载，直接用它建 venv', async () => {
    const harness = openService();
    await seedWheelhouse(harness);
    const distribution = pythonDistributions[0];
    if (!distribution) throw new Error('缺少受管 Python 候选');
    const entry = path.join(
      harness.paths.pythonRoot,
      distribution.sha256,
      distribution.entryRelativePath,
    );
    await harness.filesystem.writeFile(entry, encoder.encode('# managed interpreter\n'));

    const receipt = await harness.service.prepareEnvironment(
      { kind: 'managed', distributionId: distribution.id },
      lockOf(),
    );
    await finishOperation(harness, receipt.operationId);

    expect(harness.download.urls).toEqual([]);
    expect(harness.service.getEnvironment(receipt.environmentId)?.status).toBe('ready');
    const venvCall = harness.process.callsMatching('venv')[0];
    expect(venvCall?.executable).toBe(entry);
  });

  it('健康检查失败的环境标为 invalid，不是悄悄回到 ready', async () => {
    const harness = openService();
    await seedWheelhouse(harness);
    const receipt = await harness.service.prepareEnvironment(localBase, lockOf());
    await finishOperation(harness, receipt.operationId);
    expect(harness.service.getEnvironment(receipt.environmentId)?.status).toBe('ready');

    harness.process.calls.length = 0;
    const degraded = openService({ missingModules: ['pptx'] });
    // 用同一份库模拟环境被外部改动：健康检查重新跑 import 探测
    const degradedService = new SkillDependencyService({
      store: harness.store,
      paths: harness.paths,
      filesystem: harness.filesystem,
      process: degraded.process,
      download: harness.download,
    });
    const verified = await degradedService.verifyEnvironment(receipt.environmentId);

    expect(verified.status).toBe('invalid');
    expect(verified.failureCode).toBe('environment-unhealthy');
  });

  it('未登记的受管制品与不存在的解释器都被明确拒绝', async () => {
    const harness = openService();
    await expect(
      harness.service.inspectPlan({ kind: 'managed', distributionId: 'not-cataloged' }, lockOf()),
    ).rejects.toBeInstanceOf(DependencyPreparationError);
    await expect(
      harness.service.inspectPlan({ kind: 'local', path: '/nonexistent/python3' }, lockOf()),
    ).rejects.toMatchObject({ code: 'interpreter-not-found' });
  });
});

/** 真实解释器验收：在授权临时目录建真 venv 并做 import 探测，全程离线、不碰系统环境。 */
const discoveryScript = [
  'import importlib.util, json, platform, sys',
  'print(json.dumps({',
  '  "version": "%d.%d.%d" % sys.version_info[:3],',
  '  "machine": platform.machine(),',
  '  "system": platform.system(),',
  '  "executable": sys.executable,',
  '  "venv": importlib.util.find_spec("venv") is not None,',
  '  "ensurepip": importlib.util.find_spec("ensurepip") is not None,',
  '}))',
].join('\n');

interface RealInterpreter {
  path: string;
  version: string;
  platform: TargetPlatform;
}

const discoverRealInterpreter = async (): Promise<RealInterpreter | null> => {
  const runner = createNodeProcessRunner();
  const candidates = ['python3', '/usr/bin/python3', '/opt/homebrew/bin/python3'];
  for (const candidate of candidates) {
    const result = await runner.run({
      executable: candidate,
      argv: ['-c', discoveryScript],
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
      timeoutMs: 30_000,
    }).result;
    if (result.exitCode !== 0) continue;
    const line = result.stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('{'))
      .at(-1);
    if (!line) continue;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const machine = String(parsed['machine'] ?? '').toLowerCase();
    const system = String(parsed['system'] ?? '').toLowerCase();
    const version = String(parsed['version'] ?? '');
    const arch =
      machine === 'arm64' || machine === 'aarch64'
        ? 'arm64'
        : machine === 'x86_64' || machine === 'amd64'
          ? 'x64'
          : null;
    const osName =
      system === 'darwin'
        ? 'darwin'
        : system === 'linux'
          ? 'linux'
          : system === 'windows'
            ? 'win32'
            : null;
    const abiMatch = /^(\d+)\.(\d+)/u.exec(version);
    if (!arch || !osName || !abiMatch?.[1] || !abiMatch[2]) continue;
    if (parsed['venv'] !== true || parsed['ensurepip'] !== true) continue;
    const executable = String(parsed['executable'] ?? '');
    if (executable === '') continue;
    return {
      path: executable,
      version,
      platform: { os: osName, arch, abi: `cp${abiMatch[1]}${abiMatch[2]}` },
    };
  }
  return null;
};

const realInterpreter = await discoverRealInterpreter();
const describeReal = realInterpreter ? describe : describe.skip;

describeReal('真实解释器验收（离线、临时目录）', () => {
  it('真实 venv 与 import 探测：环境就绪，且基础解释器的全局包没有被修改', async () => {
    if (!realInterpreter) throw new Error('缺少可用解释器');
    const userDataRoot = temporaryDirectory();
    const store = AppStore.open(path.join(userDataRoot, 'app.sqlite'));
    const paths = {
      userDataRoot,
      pythonRoot: path.join(userDataRoot, 'python'),
      environmentsRoot: path.join(userDataRoot, 'environments'),
      wheelhouseRoot: path.join(userDataRoot, 'wheelhouse'),
    };
    const filesystem = createNodeFileSystem();
    const runner = createNodeProcessRunner();
    const offline: DependencyDownloader = {
      async download(url: string): Promise<Uint8Array> {
        throw new Error(`真实验收必须离线，却请求了 ${url}`);
      },
    };
    const service = new SkillDependencyService({
      store,
      paths,
      filesystem,
      process: runner,
      download: offline,
    });
    const lock: DependencyLock = {
      lockVersion: 1,
      platform: realInterpreter.platform,
      pythonRequirement: realInterpreter.version.split('.').slice(0, 2).join('.'),
      packages: [],
      importProbes: ['json', 'sys', 'venv', 'zipfile'],
    };

    const receipt = await service.prepareEnvironment(
      { kind: 'local', path: realInterpreter.path },
      lock,
    );
    const deadline = Date.now() + 180_000;
    for (;;) {
      const status = service.getOperation(receipt.operationId)?.status;
      if (status === 'succeeded' || status === 'failed' || status === 'cancelled') break;
      if (Date.now() > deadline) throw new Error('真实 venv 准备超时');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const operation = service.getOperation(receipt.operationId);
    const environment = service.getEnvironment(receipt.environmentId);
    expect(operation?.status).toBe('succeeded');
    expect(operation?.message).toContain('就绪');
    expect(environment?.status).toBe('ready');
    if (!environment) throw new Error('环境记录缺失');

    const venvRoot = path.join(userDataRoot, environment.pathKey);
    const venvPython = path.join(venvRoot, 'bin', 'python3');
    expect(await filesystem.exists(venvPython)).toBe(true);

    // venv 是独立环境：只存在于其中的模块，基础解释器导入不到。
    const purelib = await runner.run({
      executable: venvPython,
      argv: ['-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])'],
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
      timeoutMs: 60_000,
    }).result;
    expect(purelib.exitCode).toBe(0);
    const sitePackages = purelib.stdout.trim();
    const canonicalRoot = await realpath(venvRoot);
    const canonicalPackages = await realpath(sitePackages);
    const relativePackages = path.relative(canonicalRoot, canonicalPackages);
    expect(relativePackages).not.toBe('');
    expect(relativePackages).not.toBe('..');
    expect(relativePackages.startsWith(`..${path.sep}`)).toBe(false);
    expect(path.isAbsolute(relativePackages)).toBe(false);
    await filesystem.writeFile(
      path.join(sitePackages, 'betterwork_probe_marker.py'),
      'MARKER = "betterwork-isolated"\n',
    );

    const insideVenv = await runner.run({
      executable: venvPython,
      argv: ['-c', 'import betterwork_probe_marker; print(betterwork_probe_marker.MARKER)'],
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
      timeoutMs: 60_000,
    }).result;
    expect(insideVenv.exitCode).toBe(0);
    expect(insideVenv.stdout).toContain('betterwork-isolated');

    const outsideVenv = await runner.run({
      executable: realInterpreter.path,
      argv: ['-c', 'import betterwork_probe_marker'],
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', PYTHONNOUSERSITE: '1' },
      timeoutMs: 60_000,
    }).result;
    expect(outsideVenv.exitCode).not.toBe(0);

    // 健康检查用同一份真实解释器复跑 import 探测
    const verified = await service.verifyEnvironment(receipt.environmentId);
    expect(verified.status).toBe('ready');
    store.close();
  }, 240_000);
});
