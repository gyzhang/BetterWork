import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  BaseInterpreter,
  DependencyLock,
  DependencyOperation,
  DependencyOperationKind,
  DependencyOperationStep,
  RuntimeEnvironment,
  TargetPlatform,
} from '@betterwork/agent-protocol';

import type {
  DependencyDownloader,
  DependencyFileSystem,
  DependencyProcessHandle,
  DependencyProcessRunner,
} from '../infrastructure/dependency-adapters';
import {
  abiTagOf,
  findDistribution,
  type PythonDistribution,
} from '../infrastructure/python-distribution';
import type { AppStore } from '../persistence';

/**
 * Python 环境准备作业（设计 §4、任务 A10）。
 *
 * 三条不可协商的边界：
 * - **只在最终目录准备**：venv 直接建在 `environments/<key>/<instance>`，不从临时目录
 *   rename，也不随安装包复制；准备完成前没有 ready 标记，任务不能用它。
 * - **不碰用户的全局环境**：pip 只由 venv 内的解释器执行，基础解释器只用来
 *   `python -m venv`；探测发生在用户选择/准备之后，不在 Skill 导入时偷偷跑。
 * - **不联网装包**：安装一律 `--no-index --require-hashes`，需要联网的包先由下载器取回
 *   并逐一校验 sha256；凭据不进入 pip 参数、操作记录或日志。
 */

export interface DependencyPaths {
  readonly userDataRoot: string;
  readonly pythonRoot: string;
  readonly environmentsRoot: string;
  readonly wheelhouseRoot: string;
}

export interface SkillDependencyRoots {
  readonly store: AppStore;
  readonly paths: DependencyPaths;
  readonly filesystem: DependencyFileSystem;
  readonly process: DependencyProcessRunner;
  readonly download: DependencyDownloader;
  readonly clock?: () => number;
}

export type BaseInterpreterRequest =
  { kind: 'managed'; distributionId: string } | { kind: 'local'; path: string };

export interface DependencyPlan {
  readonly environmentKey: string;
  readonly base: BaseInterpreter;
  readonly platform: TargetPlatform;
  readonly lockHash: string;
  readonly environment?: RuntimeEnvironment;
  readonly openOperationId?: string;
  /** 随包 wheelhouse 里缺的包名；补齐它们必须走显式批准的联网准备。 */
  readonly missingWheels: string[];
  readonly requiresDownload: boolean;
}

export interface PrepareReceipt {
  readonly operationId: string;
  readonly environmentId: string;
  readonly environmentKey: string;
  /** true 表示已有同键作业或已就绪环境，本次没有启动第二个作业。 */
  readonly reused: boolean;
}

export interface CancelReceipt {
  readonly applied: boolean;
  readonly status: DependencyOperation['status'];
}

export type DependencyFailureCode =
  | 'distribution-not-cataloged'
  | 'distribution-download-failed'
  | 'distribution-checksum-mismatch'
  | 'distribution-extract-failed'
  | 'interpreter-not-found'
  | 'interpreter-probe-failed'
  | 'interpreter-version-mismatch'
  | 'interpreter-platform-mismatch'
  | 'interpreter-missing-venv'
  | 'venv-create-failed'
  | 'wheel-missing'
  | 'wheel-checksum-mismatch'
  | 'install-failed'
  | 'import-probe-failed'
  | 'cancelled'
  | 'preparation-failed';

/** 准备失败一律带稳定错误码与可展示原因，UI 据此区分「缺环境 / 装不上 / 探测不过」。 */
export class DependencyPreparationError extends Error {
  constructor(
    readonly code: DependencyFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DependencyPreparationError';
  }
}

interface InterpreterProbe {
  readonly version: string;
  readonly machine: string;
  readonly system: string;
  readonly executable: string;
  readonly venv: boolean;
  readonly ensurepip: boolean;
}

interface ActiveJob {
  readonly operationId: string;
  readonly environmentId: string;
  readonly environmentKey: string;
  completion: Promise<void>;
  cancelRequested: boolean;
  activeHandle: DependencyProcessHandle | null;
}

interface ProcessOutcome {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const probeTimeoutMs = 60_000;
const venvTimeoutMs = 5 * 60_000;
const installTimeoutMs = 15 * 60_000;
const extractTimeoutMs = 5 * 60_000;
const cancelJoinTimeoutMs = 15_000;

/** 只读一次解释器身份；不执行 Skill 里的任何脚本，也不安装任何东西。 */
const interpreterProbeScript = [
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

const importProbeScript = (modulesJson: string): string =>
  [
    'import importlib, json',
    `modules = json.loads(${JSON.stringify(modulesJson)})`,
    'missing = []',
    'for name in modules:',
    '    try:',
    '        importlib.import_module(name)',
    '    except BaseException as error:',
    '        missing.append(name + ": " + str(error))',
    'print(json.dumps({"missing": missing}))',
  ].join('\n');

/** 依赖锁的规范 hash：字段顺序固定，同一份锁在任何机器上得到同一个 key 输入。 */
export const computeDependencyLockHash = (lock: DependencyLock): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        lockVersion: lock.lockVersion,
        platform: lock.platform,
        pythonRequirement: lock.pythonRequirement,
        packages: lock.packages.map((entry) => ({
          name: entry.name,
          version: entry.version,
          wheel: entry.wheel,
          sha256: entry.sha256,
          source: entry.source,
          ...(entry.origin ? { origin: entry.origin } : {}),
        })),
        importProbes: lock.importProbes,
      }),
    )
    .digest('hex');

/** 基础解释器指纹：受管制品用真实校验值，本机解释器用解析后的真实路径与自报版本。 */
const baseFingerprint = (base: BaseInterpreter): Record<string, string> =>
  base.kind === 'managed'
    ? { kind: 'managed', id: base.distributionId, version: base.version, sha256: base.sha256 }
    : { kind: 'local', path: base.path, version: base.version };

export const computeEnvironmentKey = (
  base: BaseInterpreter,
  platform: TargetPlatform,
  lockHash: string,
): string =>
  createHash('sha256')
    .update(JSON.stringify({ base: baseFingerprint(base), platform, lockHash }))
    .digest('hex');

/** 代理或索引凭据绝不能进入操作记录：落库与展示前统一脱敏。 */
export const redactCredentials = (text: string): string =>
  text.replace(/\/\/[^/\s:@]+:[^/\s@]+@/gu, '//***:***@');

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const lastJsonObject = (stdout: string): Record<string, unknown> | null => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line?.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // 不是 JSON 的行（例如解释器警告）跳过，继续往前找。
    }
  }
  return null;
};

const architectureOf = (machine: string): TargetPlatform['arch'] | null => {
  const value = machine.toLowerCase();
  if (value === 'arm64' || value === 'aarch64') return 'arm64';
  if (value === 'x86_64' || value === 'amd64') return 'x64';
  return null;
};

const operatingSystemOf = (system: string): TargetPlatform['os'] | null => {
  const value = system.toLowerCase();
  if (value === 'darwin') return 'darwin';
  if (value === 'windows') return 'win32';
  if (value === 'linux') return 'linux';
  return null;
};

const satisfiesRequirement = (version: string, requirement: string): boolean => {
  const wanted = requirement.split('.').map((part) => Number(part));
  const actual = version.split('.').map((part) => Number(part));
  for (const [index, expected] of wanted.entries()) {
    if (!Number.isInteger(expected)) return false;
    if (actual[index] !== expected) return false;
  }
  return true;
};

export class SkillDependencyService {
  private readonly active = new Map<string, ActiveJob>();

  constructor(private readonly roots: SkillDependencyRoots) {}

  private get store(): AppStore {
    return this.roots.store;
  }

  private now(): number {
    return this.roots.clock ? this.roots.clock() : Date.now();
  }

  listEnvironments(): RuntimeEnvironment[] {
    return this.store.environments.listEnvironments();
  }

  getEnvironment(environmentId: string): RuntimeEnvironment | undefined {
    return this.store.environments.getEnvironment(environmentId);
  }

  getEnvironmentByKey(environmentKey: string): RuntimeEnvironment | undefined {
    return this.store.environments.findByKey(environmentKey);
  }

  getOperation(operationId: string): DependencyOperation | undefined {
    return this.store.dependencyOperations.getOperation(operationId);
  }

  listOperations(environmentKey: string): DependencyOperation[] {
    const environment = this.store.environments.findByKey(environmentKey);
    if (!environment) return [];
    return this.store.dependencyOperations.listOperationsByEnvironment(environment.id);
  }

  /**
   * 依赖计划：探测基础解释器、算出环境键、检查 wheelhouse 缺项。
   * 只读，不写数据库；A12 的准备界面用它列出「要装什么、从哪来、缺什么」。
   */
  async inspectPlan(base: BaseInterpreterRequest, lock: DependencyLock): Promise<DependencyPlan> {
    const resolved = await this.resolveBaseIdentity(base);
    const lockHash = computeDependencyLockHash(lock);
    const environmentKey = computeEnvironmentKey(resolved.base, resolved.platform, lockHash);
    const environment = this.store.environments.findByKey(environmentKey);
    const openOperation = this.store.dependencyOperations.findOpenOperation(environmentKey);

    const missingWheels: string[] = [];
    for (const entry of lock.packages) {
      const present = await this.roots.filesystem.exists(
        path.join(this.roots.paths.wheelhouseRoot, entry.wheel),
      );
      if (!present) missingWheels.push(entry.name);
    }
    const requiresDownload =
      missingWheels.length > 0 ||
      (resolved.distribution !== undefined &&
        !(await this.distributionPresent(resolved.distribution)));

    return {
      environmentKey,
      base: resolved.base,
      platform: resolved.platform,
      lockHash,
      ...(environment ? { environment } : {}),
      ...(openOperation ? { openOperationId: openOperation.id } : {}),
      missingWheels,
      requiresDownload,
    };
  }

  /**
   * 启动（或复用）一次准备作业，立刻返回 operationId 供进度查询与取消，
   * 不占用一个长等待：下载、建 venv、装包都在后台作业里进行。
   */
  async prepareEnvironment(
    base: BaseInterpreterRequest,
    lock: DependencyLock,
    kind: DependencyOperationKind = 'prepare',
  ): Promise<PrepareReceipt> {
    const plan = await this.inspectPlan(base, lock);
    const existing = plan.environment;

    if (existing?.status === 'ready' && !plan.openOperationId) {
      const last = this.store.dependencyOperations.listOperationsByEnvironment(existing.id)[0];
      if (last) {
        return {
          operationId: last.id,
          environmentId: existing.id,
          environmentKey: plan.environmentKey,
          reused: true,
        };
      }
      // 已就绪但没有作业记录（历史数据）：登记一个立刻完成的作业作为审计轨迹，
      // 不重新准备一个可用环境。
      const recorded = this.store.dependencyOperations.createOperation({
        environmentId: existing.id,
        environmentKey: plan.environmentKey,
        kind,
      });
      this.store.dependencyOperations.finishOperation(recorded.id, 'succeeded', {
        step: 'finalize',
        message: '环境已就绪，无需重复准备',
        finishedAt: this.now(),
      });
      return {
        operationId: recorded.id,
        environmentId: existing.id,
        environmentKey: plan.environmentKey,
        reused: true,
      };
    }
    // 独占锁：同一环境键同时只跑一个作业，后来者观察已有作业而不是再起一个。
    if (plan.openOperationId) {
      const inFlight = this.active.get(plan.openOperationId);
      const environmentId = existing?.id ?? inFlight?.environmentId;
      if (environmentId) {
        return {
          operationId: plan.openOperationId,
          environmentId,
          environmentKey: plan.environmentKey,
          reused: true,
        };
      }
    }

    const environment =
      existing ??
      this.store.environments.createEnvironment({
        environmentKey: plan.environmentKey,
        base: plan.base,
        platform: plan.platform,
        lockHash: plan.lockHash,
        lock,
        // 目录键带实例段：同一环境键的失败重试不会复用上一次留下的目录。
        pathKey: path.join('environments', plan.environmentKey, randomUUID()),
      });
    this.store.environments.updateStatus(environment.id, 'preparing', {
      expectedStatuses: ['unprepared', 'failed', 'cancelled', 'invalid'],
    });
    const operation = this.store.dependencyOperations.createOperation({
      environmentId: environment.id,
      environmentKey: plan.environmentKey,
      kind,
    });

    const job: ActiveJob = {
      operationId: operation.id,
      environmentId: environment.id,
      environmentKey: plan.environmentKey,
      completion: Promise.resolve(),
      cancelRequested: false,
      activeHandle: null,
    };
    job.completion = this.runPreparation(job, plan, lock).catch((error: unknown) => {
      console.error(`[skill-dependency] preparation ${operation.id} crashed`, error);
    });
    this.active.set(operation.id, job);
    return {
      operationId: operation.id,
      environmentId: environment.id,
      environmentKey: plan.environmentKey,
      reused: false,
    };
  }

  /** 取消准备作业：终止当前子进程、清理本作业目录、把作业与环境落到取消态。 */
  async cancelPreparation(operationId: string): Promise<CancelReceipt> {
    const job = this.active.get(operationId);
    if (!job) {
      const operation = this.store.dependencyOperations.getOperation(operationId);
      return { applied: false, status: operation?.status ?? 'interrupted' };
    }
    job.cancelRequested = true;
    job.activeHandle?.kill();
    await Promise.race([
      job.completion,
      new Promise<void>((resolve) => {
        setTimeout(resolve, cancelJoinTimeoutMs);
      }),
    ]);
    const finished = this.store.dependencyOperations.getOperation(operationId);
    return { applied: true, status: finished?.status ?? 'cancelled' };
  }

  /**
   * 已准备环境的健康检查：重新跑 import 探测。
   * 探测不过说明环境已不可用（被外部改动、解释器被卸载），标为 invalid 而不是 ready。
   */
  async verifyEnvironment(environmentId: string): Promise<RuntimeEnvironment> {
    const environment = this.store.environments.getEnvironment(environmentId);
    if (!environment) throw new Error(`Environment ${environmentId} does not exist`);
    if (environment.status !== 'ready') return environment;
    try {
      await this.probeImports(this.venvPythonOf(environment), environment.lock.importProbes);
      return environment;
    } catch (error) {
      const summary = redactCredentials(messageOf(error)).slice(0, 600);
      this.store.environments.markInvalid(environmentId, 'environment-unhealthy', summary);
      const updated = this.store.environments.getEnvironment(environmentId);
      if (!updated) {
        throw new Error(`Environment ${environmentId} disappeared during verification`, {
          cause: error,
        });
      }
      return updated;
    }
  }

  /** 启动恢复：上次被强杀留下的作业与环境收口，并清掉半成品目录。 */
  async recoverInterruptedPreparations(): Promise<{ operations: number; environments: number }> {
    const now = this.now();
    const operations = this.store.dependencyOperations.failInterruptedOperations(now);
    const environments = this.store.environments.failInterruptedEnvironments(
      '算台在准备过程中退出，环境需要重新准备',
      now,
    );
    for (const environment of this.store.environments.listEnvironments()) {
      if (environment.status === 'ready') continue;
      // 未就绪的目录都是半成品：留着只会让下一次准备误判为可复用。
      await this.roots.filesystem
        .remove(this.absolutePathOf(environment.pathKey))
        .catch((error: unknown) => {
          console.error(`[skill-dependency] could not remove ${environment.pathKey}`, error);
        });
    }
    return { operations, environments };
  }

  private absolutePathOf(pathKey: string): string {
    return path.join(this.roots.paths.userDataRoot, pathKey);
  }

  private venvPythonOf(environment: RuntimeEnvironment): string {
    const root = this.absolutePathOf(environment.pathKey);
    return environment.platform.os === 'win32'
      ? path.join(root, 'Scripts', 'python.exe')
      : path.join(root, 'bin', 'python3');
  }

  private async resolveBaseIdentity(request: BaseInterpreterRequest): Promise<{
    base: BaseInterpreter;
    platform: TargetPlatform;
    distribution?: PythonDistribution;
  }> {
    if (request.kind === 'managed') {
      const distribution = findDistribution(request.distributionId);
      if (!distribution) {
        throw new DependencyPreparationError(
          'distribution-not-cataloged',
          `没有登记为 ${request.distributionId} 的受管 Python 制品`,
        );
      }
      return {
        base: {
          kind: 'managed',
          distributionId: distribution.id,
          version: distribution.version,
          sha256: distribution.sha256,
        },
        platform: distribution.platform,
        distribution,
      };
    }

    if (!(await this.roots.filesystem.exists(request.path))) {
      throw new DependencyPreparationError('interpreter-not-found', `找不到解释器 ${request.path}`);
    }
    const resolvedPath = await this.roots.filesystem.realpath(request.path);
    const probe = await this.probeInterpreter(resolvedPath);
    const arch = architectureOf(probe.machine);
    const os = operatingSystemOf(probe.system);
    const abi = abiTagOf(probe.version);
    if (!arch || !os || !abi) {
      throw new DependencyPreparationError(
        'interpreter-platform-mismatch',
        `无法识别解释器平台（machine=${probe.machine} system=${probe.system} version=${probe.version}）`,
      );
    }
    if (!probe.venv || !probe.ensurepip) {
      throw new DependencyPreparationError(
        'interpreter-missing-venv',
        `${resolvedPath} 缺少 venv 或 ensurepip，无法创建算台专属环境`,
      );
    }
    return {
      base: { kind: 'local', path: resolvedPath, version: probe.version },
      platform: { os, arch, abi },
    };
  }

  private async probeInterpreter(executable: string): Promise<InterpreterProbe> {
    const result = await this.runProcess({
      executable,
      argv: ['-c', interpreterProbeScript],
      env: this.isolatedEnvironment(),
      timeoutMs: probeTimeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new DependencyPreparationError(
        'interpreter-probe-failed',
        `解释器探测失败（exit=${result.exitCode ?? result.signal ?? 'unknown'}）：${redactCredentials(result.stderr).slice(0, 400)}`,
      );
    }
    const parsed = lastJsonObject(result.stdout);
    if (!parsed) {
      throw new DependencyPreparationError(
        'interpreter-probe-failed',
        '解释器探测没有返回可解析的结果',
      );
    }
    const version = parsed['version'];
    const machine = parsed['machine'];
    const system = parsed['system'];
    const probeExecutable = parsed['executable'];
    if (
      typeof version !== 'string' ||
      typeof machine !== 'string' ||
      typeof system !== 'string' ||
      typeof probeExecutable !== 'string'
    ) {
      throw new DependencyPreparationError('interpreter-probe-failed', '解释器探测结果字段不完整');
    }
    return {
      version,
      machine,
      system,
      executable: probeExecutable,
      venv: parsed['venv'] === true,
      ensurepip: parsed['ensurepip'] === true,
    };
  }

  /** 探测与安装都不继承宿主环境：去掉 PYTHONPATH / PYTHONHOME 与用户 site 注入。 */
  private isolatedEnvironment(): Record<string, string> {
    return {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      PYTHONNOUSERSITE: '1',
      PYTHONUNBUFFERED: '1',
      LC_ALL: 'en_US.UTF-8',
    };
  }

  private installationEnvironment(venvRoot: string, venvPython: string): Record<string, string> {
    const tempDirectory = path.join(venvRoot, 'tmp');
    return {
      PATH: `${path.dirname(venvPython)}${path.delimiter}${process.env['PATH'] ?? '/usr/bin:/bin'}`,
      VIRTUAL_ENV: venvRoot,
      PYTHONNOUSERSITE: '1',
      PYTHONUNBUFFERED: '1',
      LC_ALL: 'en_US.UTF-8',
      TMPDIR: tempDirectory,
      TEMP: tempDirectory,
      TMP: tempDirectory,
    };
  }

  private async runProcess(request: {
    executable: string;
    argv: string[];
    env: Record<string, string>;
    timeoutMs: number;
    job?: ActiveJob;
  }): Promise<ProcessOutcome> {
    const handle = this.roots.process.run({
      executable: request.executable,
      argv: request.argv,
      env: request.env,
      timeoutMs: request.timeoutMs,
    });
    const job = request.job;
    if (job) job.activeHandle = handle;
    try {
      return await handle.result;
    } finally {
      if (job) job.activeHandle = null;
    }
  }

  private distributionDirectory(distribution: PythonDistribution): string {
    return path.join(this.roots.paths.pythonRoot, distribution.sha256);
  }

  private async distributionPresent(distribution: PythonDistribution): Promise<boolean> {
    return this.roots.filesystem.exists(
      path.join(this.distributionDirectory(distribution), distribution.entryRelativePath),
    );
  }

  /** 受管制品：已落地就直接用，否则下载→校验→解压；校验不过一律拒绝使用并清掉半成品。 */
  private async ensureManagedDistribution(
    distribution: PythonDistribution,
    job: ActiveJob,
  ): Promise<string> {
    const directory = this.distributionDirectory(distribution);
    const entry = path.join(directory, distribution.entryRelativePath);
    if (await this.roots.filesystem.exists(entry)) return entry;

    await this.roots.filesystem.mkdir(directory);
    this.reportProgress(job, 'resolve-interpreter', `下载受管 Python ${distribution.version}`);
    let bytes: Uint8Array;
    try {
      bytes = await this.roots.download.download(distribution.url);
    } catch (error) {
      await this.roots.filesystem.remove(directory);
      throw new DependencyPreparationError(
        'distribution-download-failed',
        `下载 ${distribution.fileName} 失败：${redactCredentials(messageOf(error))}`,
        { cause: error },
      );
    }
    const actual = sha256Of(bytes);
    if (actual !== distribution.sha256) {
      await this.roots.filesystem.remove(directory);
      throw new DependencyPreparationError(
        'distribution-checksum-mismatch',
        `${distribution.fileName} 的 SHA-256 与登记值不符，已拒绝使用`,
      );
    }
    const archive = path.join(directory, distribution.fileName);
    await this.roots.filesystem.writeFile(archive, bytes);
    this.reportProgress(job, 'resolve-interpreter', `解压受管 Python ${distribution.version}`);
    const extracted = await this.runProcess({
      executable: '/usr/bin/tar',
      argv: ['-xzf', archive, '-C', directory],
      env: this.isolatedEnvironment(),
      timeoutMs: extractTimeoutMs,
      job,
    });
    if (extracted.exitCode !== 0 || !(await this.roots.filesystem.exists(entry))) {
      await this.roots.filesystem.remove(directory);
      throw new DependencyPreparationError(
        'distribution-extract-failed',
        `解压 ${distribution.fileName} 失败（exit=${extracted.exitCode ?? extracted.signal ?? 'unknown'}）`,
      );
    }
    await this.roots.filesystem.remove(archive);
    return entry;
  }

  /** 分配本次作业专属目录：已存在就换实例，绝不复用上一次可能残缺的目录。 */
  private async allocateInstancePath(environment: RuntimeEnvironment): Promise<string> {
    const stored = environment.pathKey;
    if (!(await this.roots.filesystem.exists(this.absolutePathOf(stored)))) return stored;
    return path.join('environments', environment.environmentKey, randomUUID());
  }

  /** venv 直接建在最终目录；不加 --system-site-packages，避免复用随时会变的系统包集合。 */
  private async createVirtualEnvironment(
    baseExecutable: string,
    venvRoot: string,
    platform: TargetPlatform,
    job: ActiveJob,
  ): Promise<string> {
    await this.roots.filesystem.mkdir(path.dirname(venvRoot));
    this.reportProgress(job, 'create-environment', '创建专属 venv');
    const created = await this.runProcess({
      executable: baseExecutable,
      argv: ['-m', 'venv', venvRoot],
      env: this.isolatedEnvironment(),
      timeoutMs: venvTimeoutMs,
      job,
    });
    const venvPython =
      platform.os === 'win32'
        ? path.join(venvRoot, 'Scripts', 'python.exe')
        : path.join(venvRoot, 'bin', 'python3');
    if (created.exitCode !== 0 || !(await this.roots.filesystem.exists(venvPython))) {
      throw new DependencyPreparationError(
        'venv-create-failed',
        `创建 venv 失败（exit=${created.exitCode ?? created.signal ?? 'unknown'}）：${redactCredentials(created.stderr).slice(0, 400)}`,
      );
    }
    await this.roots.filesystem.mkdir(path.join(venvRoot, 'tmp'));
    return venvPython;
  }

  /** 安装前逐个校验 wheel 的 sha256：失配就在装之前失败，而不是让 pip 半途报错。 */
  private async stageWheels(
    lock: DependencyLock,
    instanceRoot: string,
    job: ActiveJob,
  ): Promise<{ findLinks: string[]; requirementsFile: string }> {
    const findLinks = [this.roots.paths.wheelhouseRoot];
    const downloadDirectory = path.join(instanceRoot, 'downloads');
    if (lock.packages.some((entry) => entry.source === 'approved-index')) {
      await this.roots.filesystem.mkdir(downloadDirectory);
      findLinks.push(downloadDirectory);
    }

    for (const entry of lock.packages) {
      const bundled = path.join(this.roots.paths.wheelhouseRoot, entry.wheel);
      if (await this.roots.filesystem.exists(bundled)) {
        const actual = sha256Of(await this.roots.filesystem.readFile(bundled));
        if (actual !== entry.sha256) {
          throw new DependencyPreparationError(
            'wheel-checksum-mismatch',
            `${entry.wheel} 的 SHA-256 与包锁不符，已拒绝安装`,
          );
        }
        continue;
      }
      if (entry.source !== 'approved-index' || !entry.origin) {
        throw new DependencyPreparationError(
          'wheel-missing',
          `随包 wheelhouse 缺少 ${entry.name}==${entry.version}（${entry.wheel}），且未批准联网来源`,
        );
      }
      this.reportProgress(job, 'install-packages', `下载 ${entry.name}==${entry.version}`);
      let bytes: Uint8Array;
      try {
        bytes = await this.roots.download.download(
          `${entry.origin.replace(/\/$/u, '')}/${entry.wheel}`,
        );
      } catch (error) {
        throw new DependencyPreparationError(
          'wheel-missing',
          `下载 ${entry.wheel} 失败：${redactCredentials(messageOf(error))}`,
          { cause: error },
        );
      }
      const actual = sha256Of(bytes);
      if (actual !== entry.sha256) {
        throw new DependencyPreparationError(
          'wheel-checksum-mismatch',
          `${entry.wheel} 下载结果的 SHA-256 与包锁不符，已拒绝安装`,
        );
      }
      await this.roots.filesystem.writeFile(path.join(downloadDirectory, entry.wheel), bytes);
    }

    const requirementsFile = path.join(instanceRoot, 'betterwork-lock.txt');
    const lines = lock.packages.map(
      (entry) => `${entry.name}==${entry.version} --hash=sha256:${entry.sha256}`,
    );
    await this.roots.filesystem.writeFile(requirementsFile, `${lines.join('\n')}\n`);
    return { findLinks, requirementsFile };
  }

  private async installPackages(
    venvPython: string,
    venvRoot: string,
    lock: DependencyLock,
    job: ActiveJob,
  ): Promise<void> {
    // 空包锁是合法计划（只依赖标准库）：空 requirements 会让 pip 报「至少需要一个依赖」。
    if (lock.packages.length === 0) return;
    const { findLinks, requirementsFile } = await this.stageWheels(lock, venvRoot, job);
    this.reportProgress(job, 'install-packages', `安装 ${lock.packages.length} 个锁定包`);
    const argv = ['-m', 'pip', 'install', '--no-index'];
    for (const link of findLinks) argv.push('--find-links', link);
    argv.push(
      '--only-binary=:all:',
      '--require-hashes',
      '--no-cache-dir',
      '--disable-pip-version-check',
      '-r',
      requirementsFile,
    );
    const result = await this.runProcess({
      executable: venvPython,
      argv,
      env: this.installationEnvironment(venvRoot, venvPython),
      timeoutMs: installTimeoutMs,
      job,
    });
    if (result.timedOut) {
      throw new DependencyPreparationError(
        'install-failed',
        `依赖安装超时（${installTimeoutMs}ms）`,
      );
    }
    if (result.exitCode !== 0) {
      const detail = redactCredentials(`${result.stdout}\n${result.stderr}`).slice(-1200);
      throw new DependencyPreparationError(
        'install-failed',
        `依赖安装失败（exit=${result.exitCode ?? result.signal ?? 'unknown'}）：${detail}`,
      );
    }
  }

  private async probeImports(venvPython: string, modules: readonly string[]): Promise<void> {
    if (modules.length === 0) return;
    const result = await this.runProcess({
      executable: venvPython,
      argv: ['-c', importProbeScript(JSON.stringify(modules))],
      env: this.isolatedEnvironment(),
      timeoutMs: probeTimeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new DependencyPreparationError(
        'import-probe-failed',
        `import 探测未能运行（exit=${result.exitCode ?? result.signal ?? 'unknown'}）：${redactCredentials(result.stderr).slice(0, 400)}`,
      );
    }
    const missing = lastJsonObject(result.stdout)?.['missing'];
    if (!Array.isArray(missing)) {
      throw new DependencyPreparationError('import-probe-failed', 'import 探测结果不可解析');
    }
    if (missing.length > 0) {
      const detail = missing.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
      throw new DependencyPreparationError(
        'import-probe-failed',
        `环境缺少必需模块：${detail.join('；')}`,
      );
    }
  }

  private reportProgress(job: ActiveJob, step: DependencyOperationStep, message: string): void {
    this.store.dependencyOperations.updateProgress(job.operationId, { step, message });
  }

  private throwIfCancelled(job: ActiveJob): void {
    if (!job.cancelRequested) return;
    throw new DependencyPreparationError('cancelled', '准备作业已被取消');
  }

  /** 解释器与包锁必须匹配；不匹配就如实拒绝，不降低标准去凑一个「看起来能跑」的环境。 */
  private assertProbeMatchesPlan(probe: InterpreterProbe, plan: DependencyPlan): void {
    const arch = architectureOf(probe.machine);
    const os = operatingSystemOf(probe.system);
    const abi = abiTagOf(probe.version);
    if (arch !== plan.platform.arch || os !== plan.platform.os || abi !== plan.platform.abi) {
      throw new DependencyPreparationError(
        'interpreter-platform-mismatch',
        `解释器实际平台 ${os ?? probe.system}/${arch ?? probe.machine}/${abi ?? 'unknown'} 与环境键登记的 ${plan.platform.os}/${plan.platform.arch}/${plan.platform.abi} 不一致`,
      );
    }
    if (!satisfiesRequirement(probe.version, plan.base.version)) {
      throw new DependencyPreparationError(
        'interpreter-version-mismatch',
        `解释器实际版本 ${probe.version} 与登记的 ${plan.base.version} 不一致`,
      );
    }
    if (!probe.venv || !probe.ensurepip) {
      throw new DependencyPreparationError(
        'interpreter-missing-venv',
        `${probe.executable} 缺少 venv 或 ensurepip，无法创建算台专属环境`,
      );
    }
  }

  private assertLockCompatibility(plan: DependencyPlan, lock: DependencyLock): void {
    const target = plan.platform;
    const wanted = lock.platform;
    if (target.os !== wanted.os || target.arch !== wanted.arch || target.abi !== wanted.abi) {
      throw new DependencyPreparationError(
        'interpreter-platform-mismatch',
        `解释器平台 ${target.os}/${target.arch}/${target.abi} 与包锁 ${wanted.os}/${wanted.arch}/${wanted.abi} 不一致`,
      );
    }
    if (!satisfiesRequirement(plan.base.version, lock.pythonRequirement)) {
      throw new DependencyPreparationError(
        'interpreter-version-mismatch',
        `解释器版本 ${plan.base.version} 不满足包锁要求的 ${lock.pythonRequirement}`,
      );
    }
  }

  private async runPreparation(
    job: ActiveJob,
    plan: DependencyPlan,
    lock: DependencyLock,
  ): Promise<void> {
    let instanceRoot: string | null = null;
    try {
      const marked = this.store.dependencyOperations.markRunning(
        job.operationId,
        { step: 'resolve-interpreter', message: '解析基础解释器' },
        this.now(),
      );
      if (!marked) {
        throw new DependencyPreparationError(
          'preparation-failed',
          `作业 ${job.operationId} 已不在可启动状态`,
        );
      }
      const baseExecutable = await this.resolveBaseExecutable(plan, job);
      this.assertLockCompatibility(plan, lock);

      const environment = this.store.environments.getEnvironment(job.environmentId);
      if (!environment) {
        throw new DependencyPreparationError('preparation-failed', '环境记录已消失');
      }
      const pathKey = await this.allocateInstancePath(environment);
      if (pathKey !== environment.pathKey) {
        this.store.environments.updatePathKey(environment.id, pathKey);
      }
      instanceRoot = this.absolutePathOf(pathKey);
      this.throwIfCancelled(job);

      const venvPython = await this.createVirtualEnvironment(
        baseExecutable,
        instanceRoot,
        plan.platform,
        job,
      );
      this.throwIfCancelled(job);

      await this.installPackages(venvPython, instanceRoot, lock, job);
      this.throwIfCancelled(job);

      this.reportProgress(job, 'probe-imports', `探测 ${lock.importProbes.length} 个必需模块`);
      await this.probeImports(venvPython, lock.importProbes);

      this.reportProgress(job, 'finalize', '环境就绪');
      this.store.environments.updateStatus(job.environmentId, 'ready', {
        expectedStatuses: ['preparing'],
        readyAt: this.now(),
      });
      this.store.dependencyOperations.finishOperation(job.operationId, 'succeeded', {
        step: 'finalize',
        message: '环境已就绪',
        finishedAt: this.now(),
      });
    } catch (error) {
      await this.failPreparation(job, instanceRoot, error);
    } finally {
      this.active.delete(job.operationId);
    }
  }

  private async resolveBaseExecutable(plan: DependencyPlan, job: ActiveJob): Promise<string> {
    if (plan.base.kind === 'local') {
      const probe = await this.probeInterpreter(plan.base.path);
      this.assertProbeMatchesPlan(probe, plan);
      return probe.executable;
    }
    const distribution = findDistribution(plan.base.distributionId);
    if (!distribution) {
      throw new DependencyPreparationError(
        'distribution-not-cataloged',
        `没有登记为 ${plan.base.distributionId} 的受管 Python 制品`,
      );
    }
    const entry = await this.ensureManagedDistribution(distribution, job);
    const probe = await this.probeInterpreter(entry);
    this.assertProbeMatchesPlan(probe, plan);
    return probe.executable;
  }

  /** 失败与取消只清理本作业自己的目录，已 ready 的旧环境不受影响。 */
  private async failPreparation(
    job: ActiveJob,
    instanceRoot: string | null,
    error: unknown,
  ): Promise<void> {
    const cancelled = job.cancelRequested;
    const code = error instanceof DependencyPreparationError ? error.code : 'preparation-failed';
    const summary = cancelled
      ? '准备作业已取消'
      : redactCredentials(messageOf(error)).slice(0, 1200);

    if (instanceRoot) {
      await this.roots.filesystem.remove(instanceRoot).catch((cleanupError: unknown) => {
        console.error(`[skill-dependency] cleanup failed for ${instanceRoot}`, cleanupError);
      });
    }

    this.store.dependencyOperations.finishOperation(
      job.operationId,
      cancelled ? 'cancelled' : 'failed',
      {
        ...(cancelled ? {} : { failureCode: code }),
        message: summary,
        finishedAt: this.now(),
      },
    );
    this.store.environments.updateStatus(job.environmentId, cancelled ? 'cancelled' : 'failed', {
      expectedStatuses: ['preparing', 'unprepared'],
      ...(cancelled ? {} : { failureCode: code }),
      failureSummary: summary,
    });
    if (!cancelled) {
      console.error(
        `[skill-dependency] preparation ${job.operationId} failed (${code}): ${summary}`,
      );
    }
  }
}
