/**
 * KM07b 提取 Worker（知识契约 §8.2）。
 *
 * 由 Main 以受管子进程启动（Electron 打包产物走 `ELECTRON_RUN_AS_NODE`，
 * 测试直接由 Node 运行同一份源文件，见 `electron.vite.config.ts` 构建入口）。
 * 协议是逐行 JSON：请求必须带本次启动的 nonce；身份不符一律拒绝。
 * 这里不读文件路径、不访问网络、不写数据库——只处理 Main 交来的字节。
 */
import { createInterface } from 'node:readline';

import {
  type KnowledgeWorkerRequest,
  knowledgeWorkerRequestSchema,
  type KnowledgeWorkerResponse,
} from '@betterwork/agent-protocol';

import { extractDocument } from '../services/knowledge-extract.ts';

const nonce = process.env.BETTERWORK_KNOWLEDGE_WORKER_NONCE ?? '';

const writeLine = (response: KnowledgeWorkerResponse): void => {
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

const failure = (id: string, requestNonce: string, code: string, message: string): void => {
  writeLine({ id, nonce: requestNonce, kind: 'error', code, message: message.slice(0, 500) });
};

async function handleLine(line: string): Promise<void> {
  if (!line.trim()) return;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    failure('invalid', 'unknown', 'WORKER_REQUEST_INVALID', '请求不是合法 JSON。');
    return;
  }
  const request = knowledgeWorkerRequestSchema.safeParse(raw);
  if (!request.success) {
    const candidate = raw as Partial<KnowledgeWorkerRequest> | null;
    failure(
      candidate?.id ?? 'invalid',
      candidate?.nonce ?? 'unknown',
      'WORKER_REQUEST_INVALID',
      request.error.issues[0]?.message ?? '请求不符合 Worker 线协议。',
    );
    return;
  }
  if (request.data.nonce !== nonce) {
    failure(
      request.data.id,
      request.data.nonce,
      'WORKER_NONCE_MISMATCH',
      '请求身份与本次启动不符。',
    );
    return;
  }
  if (request.data.op === 'shutdown') {
    writeLine({ id: request.data.id, nonce, kind: 'shutdown' });
    process.exit(0);
  }
  try {
    const document = await extractDocument(
      request.data.format,
      Buffer.from(request.data.dataBase64, 'base64'),
    );
    writeLine({ id: request.data.id, nonce, kind: 'result', document });
  } catch (error) {
    failure(
      request.data.id,
      nonce,
      'WORKER_EXTRACT_FAILED',
      error instanceof Error ? error.message : '提取失败。',
    );
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  handleLine(line).catch(() => undefined);
});
lines.on('close', () => {
  process.exit(0);
});
