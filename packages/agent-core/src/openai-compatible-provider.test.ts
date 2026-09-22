import type { AgentMessage } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleProvider } from './openai-compatible-provider';
import type { ModelFinishReason, ModelRequest, ModelStreamChunk } from './types';

/**
 * OpenAICompatibleProvider 是真实模型链路里最容易出错的一段：手工解析 SSE、
 * 跨包拼接被切断的行、把分片下发的 tool_calls 增量合并成一次完整调用。
 * 这些路径此前完全没有测试覆盖。
 *
 * 所有用例都通过 stubGlobal 替换 fetch，绝不触网。
 */

type FetchMock = ReturnType<typeof vi.fn>;

const stubFetch = (responder: () => Response | Promise<Response>): FetchMock => {
  const fetchMock = vi.fn(async () => responder());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => vi.unstubAllGlobals());

const sse = (...payloads: string[]): Response => {
  const text = payloads.map((payload) => `data: ${payload}\n\n`).join('') + 'data: [DONE]\n\n';
  return streamOf([text]);
};

const delta = (fields: Record<string, unknown>): string =>
  JSON.stringify({ choices: [{ delta: fields }] });

const wireFinish = (finishReason: unknown, usage?: unknown): string =>
  JSON.stringify({
    choices: [{ finish_reason: finishReason }],
    ...(usage === undefined ? {} : { usage }),
  });

const wireUsageOnly = (usage: unknown): string => JSON.stringify({ choices: [], usage });

type DoneChunk = Extract<ModelStreamChunk, { type: 'done' }>;

const doneOf = (chunks: ModelStreamChunk[]): DoneChunk => {
  const done = chunks.at(-1);
  if (!done || done.type !== 'done') throw new Error('流没有以 done 结束');
  return done;
};

/** 按给定的字节边界分段下发，用于验证跨包缓冲。 */
const streamOf = (chunks: string[], init?: ResponseInit): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, init);
};

const provider = (overrides?: {
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): OpenAICompatibleProvider =>
  new OpenAICompatibleProvider({
    id: 'model-1',
    baseUrl: 'https://host/v1',
    apiKey: '',
    model: 'test-model',
    ...overrides,
  });

const request = (overrides?: Partial<ModelRequest>): ModelRequest => ({
  messages: [{ id: 'm-1', role: 'user', content: '你好' } satisfies AgentMessage],
  tools: [],
  signal: new AbortController().signal,
  ...overrides,
});

/** 单独构造带输出上限的请求，避免用 `...overrides` 展开时把 undefined 写成显式属性。 */
const requestWithCeiling = (maxOutputTokens: number | undefined): ModelRequest => ({
  messages: [{ id: 'm-1', role: 'user', content: '你好' } satisfies AgentMessage],
  tools: [],
  signal: new AbortController().signal,
  ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
});

const collect = async (chunks: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> => {
  const out: ModelStreamChunk[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
};

const callAt = (fetchMock: FetchMock, index = 0): [string, RequestInit] => {
  const call = fetchMock.mock.calls[index] as unknown[] | undefined;
  if (!call) throw new Error('fetch was never called');
  return [String(call[0]), call[1] as RequestInit];
};

const urlOf = (fetchMock: FetchMock): string => callAt(fetchMock)[0];
const bodyOf = (fetchMock: FetchMock): Record<string, unknown> =>
  JSON.parse(String(callAt(fetchMock)[1].body)) as Record<string, unknown>;
const headersOf = (fetchMock: FetchMock): Record<string, string> =>
  callAt(fetchMock)[1].headers as Record<string, string>;

describe('OpenAICompatibleProvider endpoint resolution', () => {
  const cases: Array<[string, string]> = [
    ['https://host/v1', 'https://host/v1/chat/completions'],
    ['https://host/v1/', 'https://host/v1/chat/completions'],
    ['https://host/v1///', 'https://host/v1/chat/completions'],
    ['https://host/v1/chat/completions', 'https://host/v1/chat/completions'],
    ['https://host/v1/chat/completions/', 'https://host/v1/chat/completions'],
    ['https://host/v1?tenant=acme', 'https://host/v1/chat/completions?tenant=acme'],
  ];

  it.each(cases)('resolves %s to %s', async (baseUrl, expected) => {
    const fetchMock = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ baseUrl }).stream(request()));
    expect(urlOf(fetchMock)).toBe(expected);
  });
});

describe('OpenAICompatibleProvider streaming', () => {
  it('emits text deltas in order and finishes with done', async () => {
    stubFetch(() => sse(delta({ content: '你好' }), delta({ content: '，世界' })));
    expect(await collect(provider().stream(request()))).toEqual([
      { type: 'text-delta', delta: '你好' },
      { type: 'text-delta', delta: '，世界' },
      { type: 'done' },
    ]);
  });

  it('reassembles a data line split across network chunks', async () => {
    const text = sse(delta({ content: '被切断的一行' })).clone();
    const full = await text.text();
    const cut = Math.floor(full.length / 2);
    stubFetch(() => streamOf([full.slice(0, cut), full.slice(cut)]));

    expect(await collect(provider().stream(request()))).toEqual([
      { type: 'text-delta', delta: '被切断的一行' },
      { type: 'done' },
    ]);
  });

  it('surfaces reasoning deltas separately from answer text', async () => {
    stubFetch(() => sse(delta({ reasoning_content: '先算再答' }), delta({ content: '答案是 60' })));
    expect(await collect(provider().stream(request()))).toEqual([
      { type: 'reasoning-delta', delta: '先算再答' },
      { type: 'text-delta', delta: '答案是 60' },
      { type: 'done' },
    ]);
  });

  it('merges tool call fragments delivered across several deltas', async () => {
    const fragment = (call: Record<string, unknown>): string =>
      JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] });
    stubFetch(() =>
      sse(
        fragment({ index: 0, id: 'call-1', function: { name: 'cal' } }),
        fragment({ index: 0, function: { name: 'culator' } }),
        fragment({ index: 0, function: { arguments: '{"expr' } }),
        fragment({ index: 0, function: { arguments: 'ession":"1+1"}' } }),
      ),
    );

    expect(await collect(provider().stream(request()))).toEqual([
      {
        type: 'tool-call',
        toolCall: { id: 'call-1', name: 'calculator', input: { expression: '1+1' } },
      },
      { type: 'done' },
    ]);
  });

  it('keeps parallel tool calls separate by index and tolerates missing arguments', async () => {
    stubFetch(() =>
      sse(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-a',
                    function: { name: 'knowledge_search', arguments: '{"query":"市场"}' },
                  },
                  { index: 1, id: 'call-b', function: { name: 'calculator' } },
                ],
              },
            },
          ],
        }),
      ),
    );

    expect(await collect(provider().stream(request()))).toEqual([
      {
        type: 'tool-call',
        toolCall: { id: 'call-a', name: 'knowledge_search', input: { query: '市场' } },
      },
      { type: 'tool-call', toolCall: { id: 'call-b', name: 'calculator', input: {} } },
      { type: 'done' },
    ]);
  });

  it('ignores keep-alive comments and empty data lines', async () => {
    stubFetch(() =>
      streamOf([
        `: keep-alive\n\ndata:\n\n${'data: '}${delta({ content: '有效' })}\n\ndata: [DONE]\n\n`,
      ]),
    );

    expect(await collect(provider().stream(request()))).toEqual([
      { type: 'text-delta', delta: '有效' },
      { type: 'done' },
    ]);
  });
});

describe('OpenAICompatibleProvider completion signals', () => {
  const cases: Array<[unknown, ModelFinishReason | undefined]> = [
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool_calls', 'tool-calls'],
    ['tool-calls', 'tool-calls'],
    ['content_filter', 'content-filter'],
    ['content-filter', 'content-filter'],
    ['eos_token', 'unknown'],
    [null, undefined],
  ];

  it.each(cases)('maps the upstream finish_reason %s into %s', async (wire, expected) => {
    stubFetch(() => sse(delta({ content: '好' }), wireFinish(wire)));
    const done = doneOf(await collect(provider().stream(request())));

    expect(done.finishReason).toBe(expected);
    expect('finishReason' in done).toBe(expected !== undefined);
  });

  it('leaves finishReason absent when the stream only sends [DONE]', async () => {
    stubFetch(() => sse(delta({ content: '好' })));
    const done = doneOf(await collect(provider().stream(request())));

    expect(Object.keys(done)).toEqual(['type']);
  });

  it('keeps a length truncation distinguishable from an early end of stream', async () => {
    stubFetch(() => sse(delta({ content: '截断的内容' }), wireFinish('length')));
    await expect(collect(provider().stream(request()))).resolves.toEqual([
      { type: 'text-delta', delta: '截断的内容' },
      { type: 'done', finishReason: 'length' },
    ]);

    stubFetch(() => streamOf([`data: ${delta({ content: '断流' })}\n\n`]));
    await expect(collect(provider().stream(request()))).rejects.toThrow(
      '模型流在收到完成信号前结束',
    );
  });

  it('passes usage numbers through exactly as the upstream returned them', async () => {
    stubFetch(() =>
      sse(
        delta({ content: '好' }),
        wireFinish('stop', { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 }),
      ),
    );
    const done = doneOf(await collect(provider().stream(request())));

    expect(done.usage).toEqual({ promptTokens: 12, completionTokens: 7, totalTokens: 19 });
  });

  it('reads usage from the trailing usage-only chunk some services send', async () => {
    stubFetch(() =>
      sse(
        delta({ content: '好' }),
        wireFinish('stop'),
        wireUsageOnly({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
      ),
    );
    const done = doneOf(await collect(provider().stream(request())));

    expect(done).toEqual({
      type: 'done',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  });

  it('omits usage when the response carries none', async () => {
    stubFetch(() => sse(delta({ content: '好' }), wireFinish('stop')));
    const done = doneOf(await collect(provider().stream(request())));

    expect('usage' in done).toBe(false);
  });

  it('drops usage fields that are not real returned numbers', async () => {
    stubFetch(() =>
      sse(
        delta({ content: '好' }),
        wireFinish('stop', {
          prompt_tokens: 12,
          completion_tokens: 'estimated',
          total_tokens: null,
        }),
      ),
    );
    const done = doneOf(await collect(provider().stream(request())));

    expect(done.usage).toEqual({ promptTokens: 12 });

    stubFetch(() => sse(delta({ content: '好' }), wireFinish('stop', { completion_tokens: '9' })));
    const withoutNumbers = doneOf(await collect(provider().stream(request())));
    expect('usage' in withoutNumbers).toBe(false);
  });
});

describe('OpenAICompatibleProvider request shape', () => {
  it('sends the bearer header only when a key is configured', async () => {
    const withKey = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ apiKey: 'secret' }).stream(request()));
    expect(headersOf(withKey).Authorization).toBe('Bearer secret');

    const withoutKey = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ apiKey: '' }).stream(request()));
    expect('Authorization' in headersOf(withoutKey)).toBe(false);
  });

  it('maps tool results and assistant tool calls onto the wire format', async () => {
    const fetchMock = stubFetch(() => sse(delta({ content: '好' })));
    await collect(
      provider({ temperature: 0.2, maxOutputTokens: 512 }).stream(
        request({
          messages: [
            { id: '1', role: 'user', content: '算一下' },
            {
              id: '2',
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call-1', name: 'calculator', input: { expression: '1+1' } }],
            },
            {
              id: '3',
              role: 'tool',
              toolCallId: 'call-1',
              toolName: 'calculator',
              content: '{"result":2}',
            },
          ],
          tools: [{ name: 'calculator', description: '算术', inputSchema: { type: 'object' } }],
        }),
      ),
    );

    const body = bodyOf(fetchMock);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(512);
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: 'user', content: '算一下' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
          },
        ],
      },
      { role: 'tool', content: '{"result":2}', tool_call_id: 'call-1', name: 'calculator' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'calculator', description: '算术', parameters: { type: 'object' } },
      },
    ]);
  });

  it('omits the tools field when no tool is available', async () => {
    const fetchMock = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider().stream(request()));
    expect('tools' in bodyOf(fetchMock)).toBe(false);
  });

  it('sends the lower of the profile ceiling and the request ceiling', async () => {
    const profileWins = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ maxOutputTokens: 512 }).stream(requestWithCeiling(2_048)));
    expect(bodyOf(profileWins).max_tokens).toBe(512);

    const requestWins = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ maxOutputTokens: 4_096 }).stream(requestWithCeiling(2_048)));
    expect(bodyOf(requestWins).max_tokens).toBe(2_048);

    const defaultProfile = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider().stream(requestWithCeiling(2_048)));
    expect(bodyOf(defaultProfile).max_tokens).toBe(2_048);
  });

  it('keeps the existing max_tokens when the request sets no ceiling', async () => {
    const withoutProfileCeiling = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider().stream(request()));
    expect(bodyOf(withoutProfileCeiling).max_tokens).toBe(8_192);

    const withProfileCeiling = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ maxOutputTokens: 1_024 }).stream(request()));
    expect(bodyOf(withProfileCeiling).max_tokens).toBe(1_024);

    const withUndefinedRequestCeiling = stubFetch(() => sse(delta({ content: '好' })));
    await collect(provider({ maxOutputTokens: 1_024 }).stream(requestWithCeiling(undefined)));
    expect(bodyOf(withUndefinedRequestCeiling).max_tokens).toBe(1_024);
  });

  it('never sends a non-positive or non-finite request ceiling', async () => {
    for (const ceiling of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fetchMock = stubFetch(() => sse(delta({ content: '好' })));
      await collect(provider({ maxOutputTokens: 4_096 }).stream(requestWithCeiling(ceiling)));
      expect(bodyOf(fetchMock).max_tokens).toBe(4_096);
    }
  });

  it('combines the caller cancellation signal with the stream timeout', async () => {
    const fetchMock = stubFetch(() => sse(delta({ content: '好' })));
    const controller = new AbortController();
    await collect(provider().stream(request({ signal: controller.signal })));
    const signal = callAt(fetchMock)[1].signal as AbortSignal;
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe('OpenAICompatibleProvider failures', () => {
  it('reports a non-2xx response with its status', async () => {
    stubFetch(() => new Response('nope', { status: 503 }));
    await expect(collect(provider().stream(request()))).rejects.toThrow('模型请求失败（HTTP 503）');
  });

  it('complains when the service returns no stream body', async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    await expect(collect(provider().stream(request()))).rejects.toThrow('模型服务没有返回流式响应');
  });

  it('surfaces the model endpoint when the initial request cannot connect', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(collect(provider().stream(request()))).rejects.toThrow(
      '无法连接模型服务（https://host/v1）：ECONNREFUSED',
    );
  });

  it('does not expose the API key in a connection diagnostic', async () => {
    stubFetch(() => {
      throw new Error('fetch failed');
    });
    const error = await collect(provider({ apiKey: 'secret-api-key' }).stream(request())).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain('无法连接模型服务');
      expect(error.message).not.toContain('secret-api-key');
    }
  });

  it('does not expose credentials embedded in the base URL', async () => {
    stubFetch(() => {
      throw new Error('fetch failed');
    });
    const error = await collect(
      provider({ baseUrl: 'https://user:secret@host/v1?api_key=query-secret' }).stream(request()),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain('无法连接模型服务（https://host/v1）');
      expect(error.message).not.toContain('secret');
      expect(error.message).not.toContain('query-secret');
    }
  });

  it('rejects a malformed data line instead of silently dropping it', async () => {
    stubFetch(() => streamOf(['data: {not json}\n\n']));
    await expect(collect(provider().stream(request()))).rejects.toThrow();
  });

  it('rejects a stream that ends before an explicit completion signal', async () => {
    stubFetch(() => streamOf([`data: ${delta({ content: '部分内容' })}\n\n`]));
    await expect(collect(provider().stream(request()))).rejects.toThrow(
      '模型流在收到完成信号前结束',
    );
  });

  it('accepts a provider finish reason when it does not send [DONE]', async () => {
    stubFetch(() =>
      streamOf([
        `${`data: ${delta({ content: '完整内容' })}\n\n`}data: {"choices":[{"finish_reason":"stop"}]}\n\n`,
      ]),
    );
    await expect(collect(provider().stream(request()))).resolves.toEqual([
      { type: 'text-delta', delta: '完整内容' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('turns a user cancellation during the model request into the shared abort error', async () => {
    let startRequest: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startRequest = resolve;
    });
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        (init?.signal as AbortSignal).addEventListener('abort', () => {
          reject(new Error('request interrupted'));
        });
        startRequest?.();
      });
    const controller = new AbortController();
    const requestPromise = collect(
      new OpenAICompatibleProvider(
        { id: 'model-1', baseUrl: 'https://host/v1', apiKey: '', model: 'test-model' },
        { fetchImpl },
      ).stream(request({ signal: controller.signal })),
    );
    await started;
    controller.abort();

    await expect(requestPromise).rejects.toThrow('Run cancelled');
  });

  it('reports a bounded timeout for a model request', async () => {
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        (init?.signal as AbortSignal).addEventListener('abort', () => {
          reject(new Error('request timed out'));
        });
      });

    await expect(
      collect(
        new OpenAICompatibleProvider(
          { id: 'model-1', baseUrl: 'https://host/v1', apiKey: '', model: 'test-model' },
          { fetchImpl, streamTimeoutMs: 1 },
        ).stream(request()),
      ),
    ).rejects.toThrow('模型流响应超时（超过 0.001 秒）');
  });
});
