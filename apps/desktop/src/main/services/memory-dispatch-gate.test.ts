import type { ModelProvider, ModelRequest, ModelStreamChunk } from '@betterwork/agent-core';
import { describe, expect, it } from 'vitest';

import {
  assertMemoryBlockMatches,
  MemoryBlockMismatchError,
  modelRequestHash,
  withRunMemoryAudit,
} from './memory-dispatch-gate';
import { MEMORY_BLOCK_HEADER } from './memory-recall-service';

const providerCalls: string[] = [];

const fakeProvider = (): ModelProvider => ({
  id: 'fake',
  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk> {
    providerCalls.push(request.messages.at(-1)?.content ?? '');
    yield { type: 'text-delta', delta: '好' };
    yield { type: 'done' };
  },
});

const request = (prompt: string): ModelRequest => ({
  messages: [{ id: 'msg-1', role: 'user', content: prompt }],
  tools: [],
  signal: new AbortController().signal,
});

const drain = async (provider: ModelProvider, prompt: string): Promise<string> => {
  let text = '';
  for await (const chunk of provider.stream(request(prompt))) {
    text += chunk.type === 'text-delta' ? chunk.delta : '';
  }
  return text;
};

interface AuditCall {
  phase: 'prepared' | 'dispatched';
  requestHash?: string;
  runId?: string;
}

class AuditSinkStub {
  public readonly calls: AuditCall[] = [];

  constructor(private readonly failOnPrepared = false) {}

  markRequestPrepared(input: { runId: string; requestHash: string }): void {
    this.calls.push({ phase: 'prepared', runId: input.runId, requestHash: input.requestHash });
    if (this.failOnPrepared) throw new Error('审计写入失败。');
  }

  markDispatchAttempted(input: { runId: string }): void {
    this.calls.push({ phase: 'dispatched', runId: input.runId });
  }
}

describe('memory dispatch gate', () => {
  it('fingerprints the request body only, ignoring signal and credential-free metadata', () => {
    const prompt = '准备本月经营分析。';
    const hash = modelRequestHash(request(prompt));
    expect(hash).toBe(
      modelRequestHash({ ...request(prompt), signal: new AbortController().signal }),
    );
    expect(hash).not.toBe(modelRequestHash(request('换一个问句。')));
    expect(hash).not.toBe(modelRequestHash({ ...request(prompt), maxOutputTokens: 1_024 }));
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('writes request-prepared before dispatch-attempted, exactly once per run', async () => {
    providerCalls.length = 0;
    const sink = new AuditSinkStub();
    const gated = withRunMemoryAudit(fakeProvider(), {
      runId: 'run-1',
      sink,
      modelSnapshot: { displayName: '测试模型' },
      memoryBlock: '',
    });
    expect(await drain(gated, '第一次调用')).toBe('好');
    expect(await drain(gated, '第二次调用')).toBe('好');
    expect(sink.calls.map((call) => call.phase)).toEqual(['prepared', 'dispatched']);
    expect(sink.calls[0]?.requestHash).toBe(modelRequestHash(request('第一次调用')));
    expect(providerCalls).toEqual(['第一次调用', '第二次调用']);
  });

  it('never reaches the provider when the audit write fails', async () => {
    providerCalls.length = 0;
    const sink = new AuditSinkStub(true);
    const gated = withRunMemoryAudit(fakeProvider(), {
      runId: 'run-2',
      sink,
      modelSnapshot: {},
      memoryBlock: '',
    });
    await expect(drain(gated, '审计失败也不发包')).rejects.toThrow('审计写入失败。');
    expect(sink.calls.map((call) => call.phase)).toEqual(['prepared']);
    expect(providerCalls).toEqual([]);
  });

  it('派发前核对记忆块：与装配阶段那份一致才落审计', async () => {
    providerCalls.length = 0;
    const block = `${MEMORY_BLOCK_HEADER}\n\n1. [fact/workspace] 收入按回款金额统计。`;
    const sink = new AuditSinkStub();
    const gated = withRunMemoryAudit(fakeProvider(), {
      runId: 'run-3',
      sink,
      modelSnapshot: {},
      memoryBlock: block,
    });
    const withBlock = (prompt: string): ModelRequest => ({
      messages: [
        { id: 'msg-0', role: 'system', content: block },
        { id: 'msg-1', role: 'user', content: prompt },
      ],
      tools: [],
      signal: new AbortController().signal,
    });
    let text = '';
    for await (const chunk of gated.stream(withBlock('带记忆的请求'))) {
      text += chunk.type === 'text-delta' ? chunk.delta : '';
    }
    expect(text).toBe('好');
    expect(sink.calls.map((call) => call.phase)).toEqual(['prepared', 'dispatched']);
  });

  it('记忆块被换掉时不落审计也不发包', async () => {
    providerCalls.length = 0;
    const block = `${MEMORY_BLOCK_HEADER}\n\n1. [fact/workspace] 收入按回款金额统计。`;
    const stale = `${MEMORY_BLOCK_HEADER}\n\n1. [fact/workspace] 收入按签约金额统计。`;
    const sink = new AuditSinkStub();
    const gated = withRunMemoryAudit(fakeProvider(), {
      runId: 'run-4',
      sink,
      modelSnapshot: {},
      memoryBlock: block,
    });
    const requestWith = (content: string): ModelRequest => ({
      messages: [
        { id: 'msg-0', role: 'system', content },
        { id: 'msg-1', role: 'user', content: '问题' },
      ],
      tools: [],
      signal: new AbortController().signal,
    });
    expect(() => gated.stream(requestWith(stale))).toThrow(MemoryBlockMismatchError);
    expect(sink.calls).toEqual([]);
    expect(providerCalls).toEqual([]);
  });

  it('没有选择记忆时，请求里冒出记忆块同样算不符', () => {
    const block = `${MEMORY_BLOCK_HEADER}\n\n1. [fact/workspace] 不该出现的记忆。`;
    const injected: ModelRequest = {
      messages: [{ id: 'msg-0', role: 'system', content: block }],
      tools: [],
      signal: new AbortController().signal,
    };
    expect(() => assertMemoryBlockMatches(injected, '')).toThrow(MemoryBlockMismatchError);
    expect(() =>
      assertMemoryBlockMatches(
        {
          messages: [{ id: 'msg-1', role: 'user', content: '只有问题' }],
          tools: [],
          signal: new AbortController().signal,
        },
        '',
      ),
    ).not.toThrow();
  });
});
