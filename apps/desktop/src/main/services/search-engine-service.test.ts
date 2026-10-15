import { inspect } from 'node:util';

import { isAbortError, type ModelProvider, ReActAgentEngine } from '@betterwork/agent-core';
import { type AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { createWebSearchTool } from '@betterwork/tool-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQianfanSearchClient } from './search-engine-service';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createQianfanSearchClient', () => {
  it('posts a web_summary request with bearer auth and maps references', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request_id: 'req-1',
            summary: '答案是……',
            references: [
              {
                id: 1,
                title: '第一条',
                url: 'https://example.com/1',
                content: '片段一',
                site: 'example.com',
                date: '2026-09-05',
                type: 'web',
              },
              { id: 2, title: '无地址', content: '片段二' },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 5 });
    const response = await client.search('市场动态');
    expect(response.summary).toBe('答案是……');
    expect(response.results).toEqual([
      {
        title: '第一条',
        url: 'https://example.com/1',
        snippet: '片段一',
        site: 'example.com',
        date: '2026-09-05',
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qianfan.baidubce.com/v2/ai_search/web_summary');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
      resource_type_filter: Array<{ type: string; top_k: number }>;
    };
    expect(body.messages).toEqual([{ role: 'user', content: '市场动态' }]);
    expect(body.resource_type_filter).toEqual([
      { type: 'web', top_k: 5 },
      { type: 'video', top_k: 0 },
      { type: 'image', top_k: 0 },
    ]);
  });

  it('reports http failures without leaking the api key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 401, message: 'Invalid API key' }), { status: 401 }),
      ),
    );
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 10 });
    const result = await client.test();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(result.message).toContain('Invalid API key');
    expect(result.message).not.toContain('secret-key');
  });

  it('treats network errors as connection failures without the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 10 });
    const error = await client.search('任意查询').then(
      () => undefined,
      (reason: unknown) => reason as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('ECONNREFUSED');
    expect(error?.message).not.toContain('secret-key');
  });

  it('cancels the HTTP request when the Run signal aborts', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal as AbortSignal;
        requestSignal.addEventListener('abort', () => {
          reject(new Error('request interrupted'));
        });
      });
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 10 }, fetchImpl);
    const controller = new AbortController();
    const search = client.search('取消测试', controller.signal);
    controller.abort();

    await expect(search).rejects.toThrow('Run cancelled');
    expect(requestSignal?.aborted).toBe(true);
  });

  it('redacts repeated credential echoes and bounds remote error details', async () => {
    const apiKey = 'audit-key.[with]+symbols';
    const client = createQianfanSearchClient(
      { apiKey, webTopK: 1 },
      async () =>
        new Response(JSON.stringify({ message: `${apiKey} ${apiKey} ${'x'.repeat(5_000)}` }), {
          status: 401,
        }),
    );
    const result = await client.test();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(result.message).not.toContain(apiKey);
    expect(result.message.length).toBeLessThan(600);
  });

  it('does not retain credential-bearing network exceptions or nested causes', async () => {
    const apiKey = 'audit-network-key';
    const failure = new Error(`ECONNREFUSED ${apiKey}`, {
      cause: new Error(`request headers contained ${apiKey}`),
    });
    const client = createQianfanSearchClient({ apiKey, webTopK: 1 }, async () => {
      throw failure;
    });
    const error = await client.search('audit').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(inspect(error, { depth: 10 })).not.toContain(apiKey);
    expect(inspect(error, { depth: 10 })).toContain('ECONNREFUSED');
  });

  it('keeps search credentials out of tool failure events and the next model request', async () => {
    const apiKey = 'audit-tool-key';
    const client = createQianfanSearchClient(
      { apiKey, webTopK: 1 },
      async () =>
        new Response(JSON.stringify({ message: `Invalid key ${apiKey}` }), { status: 401 }),
    );
    const modelInputs: string[] = [];
    let round = 0;
    const model: ModelProvider = {
      id: 'audit-provider',
      async *stream(request) {
        modelInputs.push(JSON.stringify(request.messages));
        if (round++ === 0) {
          yield {
            type: 'tool-call',
            toolCall: { id: 'search-1', name: 'web_search', input: { query: 'audit' } },
          };
        } else yield { type: 'text-delta', delta: 'Search unavailable.' };
        yield { type: 'done' };
      },
    };
    const events: AgentRuntimeEvent[] = [];
    for await (const event of new ReActAgentEngine().run({
      runId: 'audit-run',
      taskId: 'audit-task',
      sessionId: 'audit-session',
      prompt: 'audit',
      workspacePath: '/tmp',
      signal: new AbortController().signal,
      model,
      tools: [createWebSearchTool((query, signal) => client.search(query, signal))],
    }))
      events.push(event);
    expect(events.some((event) => event.type === 'tool.failed')).toBe(true);
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(modelInputs).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(apiKey);
    expect(modelInputs.join('\n')).not.toContain(apiKey);
  });

  it('characterizes timeout classification and sanitizes its nested network cause', async () => {
    const apiKey = 'audit-timeout-key';
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
    const client = createQianfanSearchClient(
      { apiKey, webTopK: 1 },
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error(`interrupted ${apiKey}`, { cause: new Error(apiKey) }));
          });
        }),
    );
    const pending = client.search('audit');
    timeout.abort();
    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('搜索服务响应超时');
    expect(isAbortError(error)).toBe(false);
    expect(inspect(error, { depth: 10 })).not.toContain(apiKey);
  });
});
