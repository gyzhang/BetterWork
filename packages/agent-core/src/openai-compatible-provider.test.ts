import type { AgentMessage } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleProvider } from './openai-compatible-provider';
import type { ModelRequest, ModelStreamChunk } from './types';

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

  it('passes the abort signal through to fetch', async () => {
    const fetchMock = stubFetch(() => sse(delta({ content: '好' })));
    const controller = new AbortController();
    await collect(provider().stream(request({ signal: controller.signal })));
    expect(callAt(fetchMock)[1].signal).toBe(controller.signal);
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

  it('surfaces a network error from fetch', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(collect(provider().stream(request()))).rejects.toThrow('ECONNREFUSED');
  });

  it('rejects a malformed data line instead of silently dropping it', async () => {
    stubFetch(() => streamOf(['data: {not json}\n\n']));
    await expect(collect(provider().stream(request()))).rejects.toThrow();
  });
});
