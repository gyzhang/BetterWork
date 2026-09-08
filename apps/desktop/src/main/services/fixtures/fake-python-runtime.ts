import path from 'node:path';

import type {
  DependencyDirectoryEntry,
  DependencyDownloader,
  DependencyFileSystem,
  DependencyProcessHandle,
  DependencyProcessRequest,
  DependencyProcessResult,
  DependencyProcessRunner,
} from '../../infrastructure/dependency-adapters';
import { pythonDistributions } from '../../infrastructure/python-distribution';

/**
 * 依赖准备的离线替身（测试专用）。
 *
 * 环境准备要跑真实解释器、pip 与文件系统，但自动测试必须全离线且不碰系统环境，
 * 因此这里提供一套行为可编排的替身：解释器探测、venv 创建、pip 安装与 import 探测
 * 都按 argv 识别，结果由 `PythonScenario` 控制。
 */

const encoder = new TextEncoder();

export class FakeFileSystem implements DependencyFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();
  readonly symlinks = new Set<string>();
  readonly specials = new Set<string>();

  write(target: string, content: string): this {
    this.files.set(target, encoder.encode(content));
    this.addDirectories(path.dirname(target));
    return this;
  }

  directory(target: string): this {
    this.addDirectories(target);
    return this;
  }

  symlink(target: string): this {
    this.symlinks.add(target);
    this.addDirectories(path.dirname(target));
    return this;
  }

  special(target: string): this {
    this.specials.add(target);
    this.addDirectories(path.dirname(target));
    return this;
  }

  private addDirectories(target: string): void {
    let current = target;
    while (!this.directories.has(current)) {
      this.directories.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  async exists(target: string): Promise<boolean> {
    return (
      this.files.has(target) ||
      this.directories.has(target) ||
      this.symlinks.has(target) ||
      this.specials.has(target)
    );
  }

  async mkdir(target: string): Promise<void> {
    this.addDirectories(target);
  }

  async remove(target: string): Promise<void> {
    const inside = (key: string): boolean => key === target || key.startsWith(`${target}/`);
    for (const set of [this.directories, this.symlinks, this.specials]) {
      for (const key of [...set]) {
        if (inside(key)) set.delete(key);
      }
    }
    for (const key of [...this.files.keys()]) {
      if (inside(key)) this.files.delete(key);
    }
  }

  async writeFile(target: string, content: string | Uint8Array): Promise<void> {
    this.files.set(target, typeof content === 'string' ? encoder.encode(content) : content);
    this.addDirectories(path.dirname(target));
  }

  async readFile(target: string): Promise<Uint8Array> {
    const bytes = this.files.get(target);
    if (!bytes) throw new Error(`ENOENT: ${target}`);
    return bytes;
  }

  async readdir(target: string): Promise<string[]> {
    return (await this.readdirEntries(target)).map((entry) => entry.name);
  }

  async readdirEntries(target: string): Promise<DependencyDirectoryEntry[]> {
    const prefix = `${target}/`;
    const names = new Map<string, DependencyDirectoryEntry>();
    const record = (key: string, kind: 'directory' | 'file' | 'symlink' | 'special'): void => {
      if (!key.startsWith(prefix)) return;
      const rest = key.slice(prefix.length);
      if (rest.includes('/')) {
        const first = rest.split('/')[0];
        if (first && !names.has(first)) {
          names.set(first, {
            name: first,
            isDirectory: true,
            isFile: false,
            isSymbolicLink: false,
          });
        }
        return;
      }
      if (rest === '' || names.has(rest)) return;
      names.set(rest, {
        name: rest,
        isDirectory: kind === 'directory',
        isFile: kind === 'file',
        isSymbolicLink: kind === 'symlink',
      });
    };
    for (const key of this.directories) record(key, 'directory');
    for (const key of this.files.keys()) record(key, 'file');
    for (const key of this.symlinks) record(key, 'symlink');
    for (const key of this.specials) record(key, 'special');
    return [...names.values()].sort((left, right) => (left.name < right.name ? -1 : 1));
  }

  async size(target: string): Promise<number> {
    const bytes = this.files.get(target);
    if (!bytes) throw new Error(`ENOENT: ${target}`);
    return bytes.byteLength;
  }

  async realpath(target: string): Promise<string> {
    return target;
  }
}

export interface PythonScenario {
  version: string;
  machine: string;
  system: string;
  venv: boolean;
  ensurepip: boolean;
  venvExitCode: number;
  venvStderr: string;
  installExitCode: number;
  installStderr: string;
  installDelayMs: number;
  missingModules: string[];
}

export const scenarioOf = (overrides: Partial<PythonScenario> = {}): PythonScenario => ({
  version: '3.12.14',
  machine: 'arm64',
  system: 'Darwin',
  venv: true,
  ensurepip: true,
  venvExitCode: 0,
  venvStderr: '',
  installExitCode: 0,
  installStderr: '',
  installDelayMs: 0,
  missingModules: [],
  ...overrides,
});

/** 替身解释器：按 argv 判断服务想干什么，并给出可配置结果。全程离线。 */
export class FakePythonRunner implements DependencyProcessRunner {
  readonly calls: DependencyProcessRequest[] = [];
  readonly killed: DependencyProcessRequest[] = [];

  constructor(
    private readonly scenario: PythonScenario,
    private readonly filesystem: FakeFileSystem,
  ) {}

  run(request: DependencyProcessRequest): DependencyProcessHandle {
    this.calls.push(request);
    let settle: ((result: DependencyProcessResult) => void) | undefined;
    const result = new Promise<DependencyProcessResult>((resolve) => {
      settle = resolve;
    });
    const deliver = (outcome: DependencyProcessResult): void => {
      settle?.(outcome);
    };
    const hangMs = request.argv.includes('pip') ? this.scenario.installDelayMs : 0;
    if (hangMs > 0) {
      setTimeout(() => deliver(this.outcomeFor(request)), hangMs);
    } else {
      deliver(this.outcomeFor(request));
    }
    return {
      result,
      kill: () => {
        this.killed.push(request);
        deliver({ exitCode: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: false });
      },
    };
  }

  callsMatching(...fragments: string[]): DependencyProcessRequest[] {
    return this.calls.filter((call) => fragments.every((fragment) => call.argv.includes(fragment)));
  }

  private outcomeFor(request: DependencyProcessRequest): DependencyProcessResult {
    const scenario = this.scenario;
    const argv = request.argv;
    const script = argv[0] === '-c' && typeof argv[1] === 'string' ? argv[1] : '';
    const ok = (stdout: string): DependencyProcessResult => ({
      exitCode: 0,
      signal: null,
      stdout,
      stderr: '',
      timedOut: false,
    });
    const failed = (exitCode: number, stderr: string): DependencyProcessResult => ({
      exitCode,
      signal: null,
      stdout: '',
      stderr,
      timedOut: false,
    });

    if (script.includes('importlib.util')) {
      return ok(
        JSON.stringify({
          version: scenario.version,
          machine: scenario.machine,
          system: scenario.system,
          executable: request.executable,
          venv: scenario.venv,
          ensurepip: scenario.ensurepip,
        }),
      );
    }
    if (script.includes('importlib.import_module')) {
      return ok(
        JSON.stringify({
          missing: scenario.missingModules.map((name) => `${name}: No module named '${name}'`),
        }),
      );
    }
    if (argv.includes('venv')) {
      if (scenario.venvExitCode !== 0) return failed(scenario.venvExitCode, scenario.venvStderr);
      const target = argv.at(-1);
      if (target) {
        this.filesystem.files.set(
          path.join(target, 'bin', 'python3'),
          encoder.encode('# venv interpreter\n'),
        );
      }
      return ok('');
    }
    if (argv.includes('pip')) {
      return scenario.installExitCode === 0
        ? ok('Successfully installed\n')
        : failed(scenario.installExitCode, scenario.installStderr);
    }
    if (argv.includes('-xzf')) {
      // 替身解压：把受管制品登记的入口路径写进替身文件系统。
      const archive = argv[2] ?? '';
      const target = argv[4];
      const distribution = pythonDistributions.find((entry) => archive.endsWith(entry.fileName));
      if (distribution && target) {
        this.filesystem.files.set(
          path.join(target, distribution.entryRelativePath),
          encoder.encode('# managed interpreter\n'),
        );
      }
      return ok('');
    }
    return ok('');
  }
}

export class FakeDownloader implements DependencyDownloader {
  readonly urls: string[] = [];
  payload: Uint8Array = encoder.encode('artifact');
  error: Error | null = null;

  async download(url: string): Promise<Uint8Array> {
    this.urls.push(url);
    if (this.error) throw this.error;
    return this.payload;
  }
}
