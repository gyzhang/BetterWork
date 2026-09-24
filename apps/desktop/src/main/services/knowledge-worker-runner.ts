import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { abortError } from '@betterwork/agent-core';
import {
  KNOWLEDGE_WORKER_EXTRACT_TIMEOUT_MS,
  KNOWLEDGE_WORKER_REQUEST_MAX_BASE64_BYTES,
  KNOWLEDGE_WORKER_RESPONSE_MAX_BYTES,
  KNOWLEDGE_WORKER_SHUTDOWN_GRACE_MS,
  type KnowledgeFormat,
  type KnowledgeWorkerJobContext,
  knowledgeWorkerResponseSchema,
} from '@betterwork/agent-protocol';

import type { KnowledgeErrorCode } from './knowledge-errors';
import { KnowledgeServiceError } from './knowledge-errors';
import type { DocumentExtractor, ExtractedDocument } from './knowledge-extract';

/**
 * 提取 Worker 运行器（知识契约 §8.2）。
 *
 * Main 独占数据库写入与凭据；Worker 只收「给定字节」并返回提取结果。
 * 一个作业对应一个已登记子进程：换作业先收口旧进程再启动新的，
 * 取消后 1 秒未退出只终止这个已登记的 pid，不做宽泛进程匹配。
 * 请求带本次启动 nonce 与作业 attempt；nonce 或 id 对不上的响应直接丢弃，
 * 旧进程的迟到响应不可能被当作当前结果。
 */

export interface KnowledgeWorkerRuntime {
  readonly executable: string;
  readonly scriptPath: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * 入口定位与 skill-guardian 同法：Electron 下跑 electron-vite 单独构建的
 * `knowledge-worker.js`，测试由 Node 直接执行同一份 TS 源文件。
 */
export function resolveKnowledgeWorkerRuntime(mainDirectory: string): KnowledgeWorkerRuntime {
  const underElectron = process.versions.electron !== undefined;
  return {
    executable: process.execPath,
    scriptPath: path.join(
      mainDirectory,
      underElectron ? 'knowledge-worker.js' : 'knowledge-worker.ts',
    ),
    env: underElectron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : { ...process.env },
  };
}

interface PendingRequest {
  readonly resolve: (document: ExtractedDocument) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: NodeJS.Timeout;
}

interface WorkerHandle {
  readonly child: ChildProcessWithoutNullStreams;
  readonly nonce: string;
  readonly jobId: string;
  chunks: Buffer[];
  bufferedBytes: number;
  exited: boolean;
}

const workerError = (code: KnowledgeErrorCode, message: string): KnowledgeServiceError =>
  new KnowledgeServiceError(code, message);

export class KnowledgeWorkerRunner {
  private readonly runtime: KnowledgeWorkerRuntime;
  private readonly pending = new Map<string, PendingRequest>();
  private handle: WorkerHandle | undefined;
  private stopping: Promise<void> | undefined;

  constructor(deps: { runtime: KnowledgeWorkerRuntime }) {
    this.runtime = deps.runtime;
  }

  /** 注入给 KnowledgeVault 的提取入口；作业上下文随条目传递。 */
  readonly extractor: DocumentExtractor = async (format, bytes, context) =>
    this.extract(format, bytes, context);

  /** 当前登记子进程对应的作业（测试与取消判定用）。 */
  get activeJobId(): string | undefined {
    return this.handle?.jobId;
  }

  /** 当前登记的子进程 pid：只用于验证「终止只针对这个 pid」，不做宽泛匹配。 */
  get activePid(): number | undefined {
    return this.handle?.child.pid;
  }

  async extract(
    format: KnowledgeFormat,
    bytes: Buffer,
    context?: KnowledgeWorkerJobContext,
  ): Promise<ExtractedDocument> {
    const dataBase64 = bytes.toString('base64');
    if (dataBase64.length > KNOWLEDGE_WORKER_REQUEST_MAX_BASE64_BYTES) {
      throw new KnowledgeServiceError('EXTRACTION_LIMIT_EXCEEDED', '文件超过提取上限，暂不导入。');
    }
    const job = context ?? { jobId: 'standalone', attempt: 1 };
    const handle = await this.ensureHandle(job);
    const id = randomUUID();
    const document = await new Promise<ExtractedDocument>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(workerError('WORKER_TIMEOUT', '提取超时，作业条目失败。'));
        this.stopHandle(handle).catch(() => undefined);
      }, KNOWLEDGE_WORKER_EXTRACT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      handle.child.stdin.write(
        `${JSON.stringify({
          id,
          nonce: handle.nonce,
          op: 'extract',
          job,
          format,
          dataBase64,
        })}\n`,
      );
    });
    return document;
  }

  /** 作业取消：在途提取以取消收口（不是失败），子进程按宽限时间收口。 */
  cancelJob(jobId: string): void {
    if (this.handle && this.handle.jobId !== jobId) return;
    this.failPending(abortError());
    if (this.handle) this.stopHandle(this.handle).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    this.failPending(workerError('WORKER_UNAVAILABLE', '应用退出，提取进程已收口。'));
    if (this.handle) await this.stopHandle(this.handle);
  }

  private failPending(error: unknown): void {
    for (const [, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private async ensureHandle(job: KnowledgeWorkerJobContext): Promise<WorkerHandle> {
    await this.stopping;
    if (this.handle && !this.handle.exited && this.handle.jobId === job.jobId) {
      return this.handle;
    }
    if (this.handle) await this.stopHandle(this.handle);
    const nonce = randomUUID();
    const child = spawn(this.runtime.executable, [this.runtime.scriptPath], {
      env: { ...this.runtime.env, BETTERWORK_KNOWLEDGE_WORKER_NONCE: nonce },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const handle: WorkerHandle = {
      child,
      nonce,
      jobId: job.jobId,
      chunks: [],
      bufferedBytes: 0,
      exited: false,
    };
    this.handle = handle;
    child.stdout.on('data', (chunk: Buffer) => this.consume(handle, chunk));
    child.on('error', () =>
      this.teardown(handle, workerError('WORKER_UNAVAILABLE', '提取进程启动失败。')),
    );
    child.on('exit', () =>
      this.teardown(handle, workerError('WORKER_UNAVAILABLE', '提取进程已退出。')),
    );
    return handle;
  }

  /** 逐行消费响应；单行超过上限立即判定溢出并收口该进程。 */
  private consume(handle: WorkerHandle, chunk: Buffer): void {
    handle.chunks.push(chunk);
    handle.bufferedBytes += chunk.length;
    if (chunk.indexOf(0x0a) >= 0) {
      let rest = Buffer.concat(handle.chunks);
      handle.chunks = [];
      handle.bufferedBytes = 0;
      let newline = rest.indexOf(0x0a);
      while (newline >= 0) {
        this.acceptLine(rest.subarray(0, newline).toString('utf8'));
        rest = rest.subarray(newline + 1);
        newline = rest.indexOf(0x0a);
      }
      if (rest.length > 0) {
        handle.chunks = [rest];
        handle.bufferedBytes = rest.length;
      }
    }
    if (handle.bufferedBytes > KNOWLEDGE_WORKER_RESPONSE_MAX_BYTES) {
      this.teardown(handle, workerError('WORKER_UNAVAILABLE', '提取响应超过大小上限。'));
    }
  }

  private acceptLine(line: string): void {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = knowledgeWorkerResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.nonce !== this.handle?.nonce) return;
    const request = this.pending.get(parsed.data.id);
    if (!request) return;
    this.pending.delete(parsed.data.id);
    clearTimeout(request.timeout);
    if (parsed.data.kind === 'result') {
      const document: ExtractedDocument = {
        format: parsed.data.document.format,
        content: parsed.data.document.content,
        ...(parsed.data.document.pageCount ? { pageCount: parsed.data.document.pageCount } : {}),
        ...(parsed.data.document.warnings ? { warnings: parsed.data.document.warnings } : {}),
        sections: parsed.data.document.sections,
      };
      request.resolve(document);
    } else if (parsed.data.kind === 'error') {
      request.reject(
        workerError('WORKER_EXTRACT_FAILED', `${parsed.data.code}：${parsed.data.message}`),
      );
    }
  }

  /** 异常收口：只针对这个句柄的进程发 SIGKILL，不做宽泛匹配。 */
  private teardown(handle: WorkerHandle, error: KnowledgeServiceError): void {
    if (handle.exited) return;
    handle.exited = true;
    if (this.handle === handle) this.handle = undefined;
    this.failPending(error);
    try {
      handle.child.kill('SIGKILL');
    } catch {
      // 进程已消失：等待方已被拒绝，无需处理。
    }
  }

  /** 正常收口：先请求 shutdown，宽限期未退出只终止这个已登记的 pid。 */
  private async stopHandle(handle: WorkerHandle): Promise<void> {
    if (handle.exited) return;
    if (this.stopping) {
      await this.stopping;
      return;
    }
    const exited = new Promise<void>((resolve) => {
      const finish = (): void => {
        handle.exited = true;
        if (this.handle === handle) this.handle = undefined;
        clearTimeout(killer);
        resolve();
      };
      const killer = setTimeout(() => {
        try {
          handle.child.kill('SIGKILL');
        } catch {
          finish();
        }
      }, KNOWLEDGE_WORKER_SHUTDOWN_GRACE_MS);
      handle.child.once('exit', () => {
        finish();
      });
    });
    this.stopping = exited;
    try {
      handle.child.stdin.write(
        `${JSON.stringify({ id: randomUUID(), nonce: handle.nonce, op: 'shutdown' })}\n`,
      );
      handle.child.stdin.end();
    } catch {
      handle.child.kill('SIGKILL');
    }
    await exited;
    this.stopping = undefined;
  }
}
