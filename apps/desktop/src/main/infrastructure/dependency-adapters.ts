import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 依赖准备的可注入根（设计 §4、docs/12 §9）。
 *
 * 环境准备要跑真实解释器、真实 pip 与真实文件系统，但自动测试必须全离线：
 * 因此进程、文件系统与下载都从这里注入。生产用下面的 Node 实现，测试用替身，
 * 服务本身不直接 import `node:child_process` 或 `fetch`。
 */

export interface DependencyProcessRequest {
  executable: string;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface DependencyProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface DependencyProcessHandle {
  readonly result: Promise<DependencyProcessResult>;
  /** 取消作业时调用；实现必须幂等。 */
  kill(): void;
}

export interface DependencyProcessRunner {
  run(request: DependencyProcessRequest): DependencyProcessHandle;
}

export interface DependencyDirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

export interface DependencyFileSystem {
  exists(target: string): Promise<boolean>;
  mkdir(target: string): Promise<void>;
  remove(target: string): Promise<void>;
  writeFile(target: string, content: string | Uint8Array): Promise<void>;
  readFile(target: string): Promise<Uint8Array>;
  readdir(target: string): Promise<string[]>;
  /** 带类型的目录项：工具链快照必须能区分普通文件、目录与符号链接。 */
  readdirEntries(target: string): Promise<DependencyDirectoryEntry[]>;
  size(target: string): Promise<number>;
  realpath(target: string): Promise<string>;
}

export interface DependencyDownloader {
  /** 只允许已批准来源；实现必须带超时，错误信息不得包含凭据。 */
  download(url: string): Promise<Uint8Array>;
}

/** 安装/探测输出的保留上限：够诊断，又不会把整段 pip 日志塞进操作记录。 */
const maxCapturedBytes = 256 * 1024;

export const createNodeProcessRunner = (): DependencyProcessRunner => ({
  run(request: DependencyProcessRequest): DependencyProcessHandle {
    // shell=false + argv：解释器与 pip 参数都不经 shell 解析。
    const child = spawn(request.executable, request.argv, {
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.env ? { env: request.env } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collectors: Record<
      'stdout' | 'stderr',
      { chunks: string[]; received: number; kept: number }
    > = {
      stdout: { chunks: [], received: 0, kept: 0 },
      stderr: { chunks: [], received: 0, kept: 0 },
    };
    const attach = (name: 'stdout' | 'stderr'): void => {
      const stream = child[name];
      if (!stream) return;
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const collector = collectors[name];
        collector.received += chunk.length;
        if (collector.kept >= maxCapturedBytes) return;
        collector.kept += chunk.length;
        collector.chunks.push(chunk);
      });
    };
    attach('stdout');
    attach('stderr');

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);

    const result = new Promise<DependencyProcessResult>((resolve) => {
      child.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: error.message,
          timedOut: false,
        });
      });
      child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer);
        const render = (name: 'stdout' | 'stderr'): string => {
          const collector = collectors[name];
          const text = collector.chunks.join('');
          const dropped = collector.received - collector.kept;
          return dropped > 0 ? `${text}\n[输出已截断，丢弃 ${dropped} 字节]` : text;
        };
        resolve({
          exitCode,
          signal,
          stdout: render('stdout'),
          stderr: render('stderr'),
          timedOut,
        });
      });
    });

    let killed = false;
    return {
      result,
      kill: () => {
        if (killed) return;
        killed = true;
        child.kill('SIGKILL');
      },
    };
  },
});

export const createNodeFileSystem = (): DependencyFileSystem => ({
  async exists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(target: string): Promise<void> {
    await mkdir(target, { recursive: true });
  },
  async remove(target: string): Promise<void> {
    await rm(target, { recursive: true, force: true });
  },
  async writeFile(target: string, content: string | Uint8Array): Promise<void> {
    // 受管副本的目录结构是逐文件写出来的，父目录必须先存在。
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  },
  async readFile(target: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(target));
  },
  async readdir(target: string): Promise<string[]> {
    return readdir(target);
  },
  async readdirEntries(target: string): Promise<DependencyDirectoryEntry[]> {
    const entries = await readdir(target, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  },
  async size(target: string): Promise<number> {
    const info = await stat(target);
    return info.size;
  },
  async realpath(target: string): Promise<string> {
    return realpath(target);
  },
});

const downloadTimeoutMs = 10 * 60_000;

/** 生产下载器：只接受 https，带超时，错误信息只含状态码与主机名，不含查询串或凭据。 */
export const createFetchDownloader = (fetchImpl: typeof fetch = fetch): DependencyDownloader => ({
  async download(url: string): Promise<Uint8Array> {
    if (!url.startsWith('https://')) {
      throw new Error('依赖制品只允许通过 https 下载');
    }
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
    if (!response.ok) {
      throw new Error(`下载失败（HTTP ${response.status}，主机 ${new URL(url).host}）`);
    }
    return new Uint8Array(await response.arrayBuffer());
  },
});
