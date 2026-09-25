import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { isAbortError } from '@betterwork/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeWorkerRunner, resolveKnowledgeWorkerRuntime } from './knowledge-worker-runner';

/**
 * 提取 Worker 运行器（KM07b，契约 §8.2）。
 * 真实子进程：测试用 Node 直接跑同一份 TS 入口（与 skill-guardian 同法），
 * 取消与溢出用替身脚本，绝不用假进程糊弄。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '../infrastructure/fixtures', name);

const realRuntime = resolveKnowledgeWorkerRuntime(path.join(here, '../infrastructure'));
const hangRuntime = {
  executable: process.execPath,
  scriptPath: fixture('knowledge-worker-hang.ts'),
  env: { ...process.env },
};
const overflowRuntime = {
  executable: process.execPath,
  scriptPath: fixture('knowledge-worker-overflow.ts'),
  env: { ...process.env },
};

const runners: KnowledgeWorkerRunner[] = [];

const waitForPid = async (runner: KnowledgeWorkerRunner, jobKey: string): Promise<number> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const pid = runner.activePid(jobKey);
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('提取 Worker 进程未被登记');
};

const createRunner = (runtime = realRuntime): KnowledgeWorkerRunner => {
  const runner = new KnowledgeWorkerRunner({ runtime });
  runners.push(runner);
  return runner;
};

afterEach(async () => {
  for (const runner of runners.splice(0)) {
    try {
      await runner.shutdown();
    } catch {
      // 收口失败不掩盖断言：残留进程会被 exit 事件清掉。
    }
  }
});

describe('KnowledgeWorkerRunner', () => {
  it('用真实子进程提取 Markdown 与文本，同作业复用同一登记进程', async () => {
    const runner = createRunner();
    const job = { jobId: 'job-a', attempt: 1 };
    const markdown = await runner.extract(
      'markdown',
      Buffer.from('# 标题\n\n正文内容。', 'utf8'),
      job,
    );
    expect(markdown.content).toContain('正文内容。');
    expect(markdown.sections[0]?.locator).toBe('全文');
    const pid = runner.activePid('extract:job-a');
    expect(pid).toBeTypeOf('number');

    const text = await runner.extract('text', Buffer.from('plain\r\nbody', 'utf8'), job);
    expect(text.content).toBe('plain\r\nbody');
    // 同一作业复用进程，不是每条请求起一个。
    expect(runner.activePid('extract:job-a')).toBe(pid);

    // KM13：Office 字节核心进 Worker 图后，真实子进程与 Main 共用同一份解析器。
    const csv = await runner.extract('csv', Buffer.from('月份,收入\n2026-08,120\n', 'utf8'), job);
    expect(csv.sections[0]).toMatchObject({ locator: 'rows:1-1' });
    expect(csv.sections[1]?.locator).toBe('rows:2-2');
    expect(runner.activePid('extract:job-a')).toBe(pid);
  }, 30_000);

  it('坏 docx 以 WORKER_EXTRACT_FAILED 收口为条目错误，进程存活可继续下一条目', async () => {
    const runner = createRunner();
    const job = { jobId: 'job-bad', attempt: 1 };
    await expect(runner.extract('docx', Buffer.from('not-a-docx', 'utf8'), job)).rejects.toThrow(
      KnowledgeServiceError,
    );
    expect(runner.activePid('extract:job-bad')).toBeTypeOf('number');
    const next = await runner.extract('text', Buffer.from('后续条目', 'utf8'), job);
    expect(next.content).toBe('后续条目');
  }, 30_000);

  it('超过提取上限的字节直接拒绝，不启动子进程', async () => {
    const runner = createRunner();
    const huge = Buffer.alloc(33 * 1024 * 1024, 0x61);
    await expect(
      runner.extract('text', huge, { jobId: 'job-oversize', attempt: 1 }),
    ).rejects.toThrow('文件超过提取上限');
    expect(runner.activePid('extract:job-oversize')).toBeUndefined();
  }, 30_000);

  it('取消在途提取以取消收口而非失败，宽限后只终止已登记的 pid', async () => {
    const runner = createRunner(hangRuntime);
    const pending = runner.extract('text', Buffer.from('卡住的提取', 'utf8'), {
      jobId: 'job-cancel',
      attempt: 1,
    });
    const pid = await waitForPid(runner, 'extract:job-cancel');
    // 等请求登记完成再取消：spawn 与 pending 写入之间只差一个微任务。
    await new Promise((resolve) => setTimeout(resolve, 25));
    runner.cancelJob('job-cancel');
    await expect(pending).rejects.toSatisfy(isAbortError);
    const deadline = Date.now() + 5_000;
    while (runner.activePid('extract:job-cancel') !== undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(runner.activePid('extract:job-cancel')).toBeUndefined();
    expect(pid).toBeTypeOf('number');
  }, 30_000);

  it('不相关作业的取消请求不动当前登记进程', async () => {
    const runner = createRunner(hangRuntime);
    const pending = runner.extract('text', Buffer.from('仍在进行', 'utf8'), {
      jobId: 'job-keep',
      attempt: 1,
    });
    const pid = await waitForPid(runner, 'extract:job-keep');
    await new Promise((resolve) => setTimeout(resolve, 25));
    runner.cancelJob('another-job');
    expect(runner.activePid('extract:job-keep')).toBe(pid);
    // 收口由 afterEach 的 shutdown 完成；这里先让在途请求落到终态避免未处理拒绝。
    runner.cancelJob('job-keep');
    await expect(pending).rejects.toSatisfy(isAbortError);
  }, 30_000);

  it('响应单行超过上限时判定不可信并收口进程', async () => {
    const runner = createRunner(overflowRuntime);
    await expect(
      runner.extract('text', Buffer.from('触发溢出的请求', 'utf8'), {
        jobId: 'job-overflow',
        attempt: 1,
      }),
    ).rejects.toThrow('提取响应超过大小上限');
    // 超限响应来自不可信进程：登记句柄被清掉，只终止了这个 pid。
    expect(runner.activePid('extract:job-overflow')).toBeUndefined();
  }, 60_000);

  it('Worker 线协议拒绝伪造身份与非法请求：nonce 不符与坏 JSON 都是错误响应', async () => {
    const nonce = randomUUID();
    const child = spawn(realRuntime.executable, [realRuntime.scriptPath], {
      env: { ...realRuntime.env, BETTERWORK_KNOWLEDGE_WORKER_NONCE: nonce },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const responses: Array<Record<string, unknown>> = [];
    lines.on('line', (line) => {
      responses.push(JSON.parse(line) as Record<string, unknown>);
    });
    child.stdin.write('这不是 JSON\n');
    child.stdin.write(
      `${JSON.stringify({
        id: 'x-1',
        nonce: '别的进程的 nonce',
        op: 'extract',
        job: { jobId: 'job-x', attempt: 1 },
        format: 'text',
        dataBase64: Buffer.from('伪造请求', 'utf8').toString('base64'),
      })}\n`,
    );
    const deadline = Date.now() + 15_000;
    while (responses.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(responses[0]).toMatchObject({
      kind: 'error',
      code: 'WORKER_REQUEST_INVALID',
    });
    expect(responses[1]).toMatchObject({
      id: 'x-1',
      kind: 'error',
      code: 'WORKER_NONCE_MISMATCH',
    });
    child.stdin.write(`${JSON.stringify({ id: 'x-2', nonce, op: 'shutdown' })}\n`);
    const exitCode = await new Promise((resolve) => {
      child.once('exit', (code) => resolve(code));
    });
    expect(exitCode).toBe(0);
  }, 30_000);

  describe('向量扫描批（KM08）', () => {
    it('真实 Worker 逐批点积并按分数降序返回', async () => {
      const runner = createRunner();
      const scores = await runner.scan({
        spaceId: 'space-1',
        dimension: 3,
        query: Float32Array.from([0, 1, 0]),
        entries: [
          { chunkId: 'c-low', vector: Float32Array.from([1, 0, 0]) },
          { chunkId: 'c-high', vector: Float32Array.from([0, 1, 0]) },
          { chunkId: 'c-mid', vector: Float32Array.from([0, 0.5, 0]) },
        ],
      });
      expect(scores.map((entry) => entry.chunkId)).toEqual(['c-high', 'c-mid', 'c-low']);
      expect(scores[0]?.score).toBeCloseTo(1);
      expect(scores[2]?.score).toBeCloseTo(0);
    }, 30_000);

    it('批内向量维度与声明不符按扫描失败收口，不返回部分分数', async () => {
      const runner = createRunner();
      await expect(
        runner.scan({
          spaceId: 'space-1',
          dimension: 3,
          query: Float32Array.from([0, 1, 0]),
          entries: [{ chunkId: 'c-bad', vector: Float32Array.from([0, 1]) }],
        }),
      ).rejects.toThrow('WORKER_SCAN_FAILED');
    }, 30_000);

    it('载荷批超上限直接拒绝，不向进程发送', async () => {
      const runner = createRunner();
      const entries = Array.from({ length: 65_537 }, (_, index) => ({
        chunkId: `c-${index}`,
        vector: Float32Array.from([1, 0, 0, 0]),
      }));
      await expect(
        runner.scan({
          spaceId: 'space-1',
          dimension: 4,
          query: Float32Array.from([1, 0, 0, 0]),
          entries,
        }),
      ).rejects.toThrow('向量批超过单批载荷上限');
      expect(runner.activePid('scan')).toBeUndefined();
    }, 30_000);
  });
});
