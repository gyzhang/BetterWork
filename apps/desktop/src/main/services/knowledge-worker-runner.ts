import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { abortError } from '@betterwork/agent-core';
import {
  KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES,
  KNOWLEDGE_WORKER_EXTRACT_TIMEOUT_MS,
  KNOWLEDGE_WORKER_REQUEST_MAX_BASE64_BYTES,
  KNOWLEDGE_WORKER_RESPONSE_MAX_BYTES,
  KNOWLEDGE_WORKER_SHUTDOWN_GRACE_MS,
  type KnowledgeExtractedDocument,
  type KnowledgeFormat,
  type KnowledgeWorkerJobContext,
  knowledgeWorkerResponseSchema,
  type KnowledgeWorkerScanEntry,
} from '@betterwork/agent-protocol';

import { KnowledgeServiceError } from './knowledge-errors';
import type { DocumentExtractor, ExtractedDocument } from './knowledge-extract';

/**
 * 提取/扫描 Worker 运行器（知识契约 §8.2）。
 *
 * Main 独占数据库写入与凭据；Worker 只收「给定字节/给定向量批」并回结果。
 * 一个作业登记一个子进程：换作业先收口旧进程再启动新的；
 * 取消后 1 秒宽限未退出只终止这个已登记的 pid，不做宽泛进程匹配。
 * 请求带本次启动 nonce；nonce 或对不上号的响应直接丢弃，
 * 旧进程的迟到响应不可能被当作当前结果。
 */

export interface KnowledgeWorkerRuntime {
  readonly executable: string;
  readonly scriptPath: string;
  readonly env: NodeJS.ProcessEnv;
}

/** 入口定位与 skill-guardian 同法：Electron 跑构建 JS，测试由 Node 直接跑 TS 源。 */
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

export interface WorkerScanRequest {
  readonly spaceId: string;
  readonly dimension: number;
  readonly query: Float32Array;
  readonly entries: ReadonlyArray<{ chunkId: string; vector: Float32Array }>;
}

interface PendingRequest {
  readonly handleKey: string;
  readonly resolve: (value: WorkerReply) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: NodeJS.Timeout;
}

type WorkerReply =
  | { kind: 'document'; document: ExtractedDocument }
  | { kind: 'scores'; scores: Array<{ chunkId: string; score: number }> };

interface WorkerHandle {
  readonly key: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly nonce: string;
  chunks: Buffer[];
  bufferedBytes: number;
  exited: boolean;
}

const workerError = (code: WorkerErrorCodeInput, message: string): KnowledgeServiceError =>
  new KnowledgeServiceError(code, message);

type WorkerErrorCodeInput = 'WORKER_TIMEOUT' | 'WORKER_UNAVAILABLE' | 'WORKER_EXTRACT_FAILED';

const float32Base64 = (vector: Float32Array): string =>
  Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');

export class KnowledgeWorkerRunner {
  private readonly runtime: KnowledgeWorkerRuntime;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handles = new Map<string, WorkerHandle>();

  constructor(deps: { runtime: KnowledgeWorkerRuntime }) {
    this.runtime = deps.runtime;
  }

  /** 注入给 KnowledgeVault 的提取入口；作业上下文随条目传递。 */
  readonly extractor: DocumentExtractor = async (format, bytes, context) =>
    this.extract(format, bytes, context);

  /** 当前登记的子进程 pid（按作业键）；只用于验证「终止只针对已登记 pid」。 */
  activePid(jobKey: string): number | undefined {
    return this.handles.get(jobKey)?.child.pid;
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
    const reply = await this.request(`extract:${job.jobId}`, KNOWLEDGE_WORKER_EXTRACT_TIMEOUT_MS, {
      op: 'extract',
      job,
      format,
      dataBase64,
    });
    if (reply.kind !== 'document') {
      throw workerError('WORKER_UNAVAILABLE', '提取响应类型不符。');
    }
    return reply.document;
  }

  /** 单批向量点积；载荷批上限由调用方按契约 §2.2 的 1 MiB 切分保证。 */
  async scan(request: WorkerScanRequest): Promise<Array<{ chunkId: string; score: number }>> {
    const payloadBytes =
      request.entries.length * request.dimension * Float32Array.BYTES_PER_ELEMENT;
    if (payloadBytes > KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES) {
      throw workerError('WORKER_UNAVAILABLE', '向量批超过单批载荷上限。');
    }
    const entries: KnowledgeWorkerScanEntry[] = request.entries.map((entry) => ({
      chunkId: entry.chunkId,
      vectorBase64: float32Base64(entry.vector),
    }));
    const reply = await this.request('scan', KNOWLEDGE_WORKER_EXTRACT_TIMEOUT_MS, {
      op: 'scan',
      spaceId: request.spaceId,
      dimension: request.dimension,
      queryBase64: float32Base64(request.query),
      entries,
    });
    if (reply.kind !== 'scores') {
      throw workerError('WORKER_UNAVAILABLE', '扫描响应类型不符。');
    }
    return reply.scores;
  }

  /** 作业取消：在途提取以取消收口（不是失败），该作业登记的子进程按宽限时间收口。 */
  cancelJob(jobId: string): void {
    const key = `extract:${jobId}`;
    for (const [id, request] of [...this.pending]) {
      if (request.handleKey !== key) continue;
      this.pending.delete(id);
      clearTimeout(request.timeout);
      request.reject(abortError());
    }
    const handle = this.handles.get(key);
    if (handle) {
      this.stopHandle(handle).catch(() => undefined);
    }
  }

  async shutdown(): Promise<void> {
    this.failPending(workerError('WORKER_UNAVAILABLE', '应用退出，提取进程已收口。'));
    const handles = [...this.handles.values()];
    await Promise.all(handles.map((handle) => this.stopHandle(handle)));
  }

  private failPending(error: KnowledgeServiceError): void {
    for (const [, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private request(
    handleKey: string,
    timeoutMs: number,
    payload: Record<string, unknown>,
  ): Promise<WorkerReply> {
    const handle = this.ensureHandle(handleKey);
    const id = randomUUID();
    return new Promise<WorkerReply>((resolve, reject) => {
      void handle.then(
        (settled) => {
          if (settled.exited || this.handles.get(handleKey) !== settled) {
            reject(workerError('WORKER_UNAVAILABLE', '提取进程已被替换或退出。'));
            return;
          }
          const timeout = setTimeout(() => {
            this.pending.delete(id);
            reject(workerError('WORKER_TIMEOUT', '提取超时，作业条目失败。'));
            this.stopHandle(settled).catch(() => undefined);
          }, timeoutMs);
          this.pending.set(id, { handleKey, resolve, reject, timeout });
          settled.child.stdin.write(
            `${JSON.stringify({ id, nonce: settled.nonce, ...payload })}\n`,
            (error) => {
              if (!error) return;
              const pending = this.pending.get(id);
              if (!pending) return;
              this.pending.delete(id);
              clearTimeout(pending.timeout);
              pending.reject(workerError('WORKER_UNAVAILABLE', '提取进程输入通道已断开。'));
            },
          );
        },
        (error: unknown) =>
          reject(
            error instanceof Error
              ? error
              : workerError('WORKER_UNAVAILABLE', '提取进程启动失败。'),
          ),
      );
    });
  }

  private async ensureHandle(key: string): Promise<WorkerHandle> {
    const existing = this.handles.get(key);
    if (existing && !existing.exited) return existing;
    const nonce = randomUUID();
    const child = spawn(this.runtime.executable, [this.runtime.scriptPath], {
      env: { ...this.runtime.env, BETTERWORK_KNOWLEDGE_WORKER_NONCE: nonce },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const handle: WorkerHandle = {
      key,
      child,
      nonce,
      chunks: [],
      bufferedBytes: 0,
      exited: false,
    };
    this.handles.set(key, handle);
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
    if (!parsed.success) return;
    const request = this.pending.get(parsed.data.id);
    if (!request) return;
    const handle = this.handles.get(request.handleKey);
    if (!handle || handle.nonce !== parsed.data.nonce) return;
    this.pending.delete(parsed.data.id);
    clearTimeout(request.timeout);
    if (parsed.data.kind === 'result') {
      request.resolve({ kind: 'document', document: toExtracted(parsed.data.document) });
    } else if (parsed.data.kind === 'scores') {
      request.resolve({ kind: 'scores', scores: parsed.data.scores });
    } else if (parsed.data.kind === 'error') {
      request.reject(
        workerError('WORKER_EXTRACT_FAILED', `${parsed.data.code}：${parsed.data.message}`),
      );
    }
  }

  /** 异常收口：只对这个句柄登记的进程发 SIGKILL，不做宽泛匹配。 */
  private teardown(handle: WorkerHandle, error: KnowledgeServiceError): void {
    if (handle.exited) return;
    handle.exited = true;
    if (this.handles.get(handle.key) === handle) this.handles.delete(handle.key);
    for (const [id, request] of [...this.pending]) {
      if (request.handleKey !== handle.key) continue;
      this.pending.delete(id);
      clearTimeout(request.timeout);
      request.reject(error);
    }
    try {
      handle.child.kill('SIGKILL');
    } catch {
      // 进程已消失：等待方已被拒绝，无需处理。
    }
  }

  /** 正常收口：先请求 shutdown，宽限期未退出才终止这个已登记的 pid。 */
  private async stopHandle(handle: WorkerHandle): Promise<void> {
    if (handle.exited) return;
    if (this.handles.get(handle.key) === handle) this.handles.delete(handle.key);
    const exited = new Promise<void>((resolve) => {
      const finish = (): void => {
        handle.exited = true;
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
      handle.child.once('exit', finish);
    });
    try {
      handle.child.stdin.write(
        `${JSON.stringify({ id: randomUUID(), nonce: handle.nonce, op: 'shutdown' })}\n`,
      );
      handle.child.stdin.end();
    } catch {
      handle.child.kill('SIGKILL');
    }
    await exited;
  }
}

function toExtracted(document: KnowledgeExtractedDocument): ExtractedDocument {
  return {
    format: document.format,
    content: document.content,
    ...(document.pageCount === undefined ? {} : { pageCount: document.pageCount }),
    ...(document.warnings === undefined ? {} : { warnings: document.warnings }),
    sections: document.sections,
  };
}
