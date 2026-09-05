import { describe, expect, it, vi } from 'vitest';

import { probeModelConnection, resolveEndpoint } from './model-connectivity';

type FetchMock = ReturnType<typeof vi.fn>;

const stubFetch = (responder: () => Response | Promise<Response>): FetchMock => {
  const fetchMock = vi.fn(async () => responder());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const initOf = (fetchMock: FetchMock): RequestInit => {
  const call = fetchMock.mock.calls[0] as unknown[] | undefined;
  if (!call) throw new Error('fetch was never called');
  return call[1] as RequestInit;
};

const target = (overrides?: {
  role?: 'language' | 'vision' | 'embedding';
  apiKey?: string;
  baseUrl?: string;
}): {
  baseUrl: string;
  model: string;
  role: 'language' | 'vision' | 'embedding';
  apiKey: string;
} => ({
  baseUrl: 'https://host/v1',
  model: 'test-model',
  role: 'language',
  apiKey: 'secret-key',
  ...overrides,
});

describe('resolveEndpoint', () => {
  it('appends the path matching the model role', () => {
    expect(resolveEndpoint('https://host/v1', 'language')).toBe('https://host/v1/chat/completions');
    expect(resolveEndpoint('https://host/v1', 'vision')).toBe('https://host/v1/chat/completions');
    expect(resolveEndpoint('https://host/v1', 'embedding')).toBe('https://host/v1/embeddings');
  });

  it('keeps an endpoint the user already wrote out in full', () => {
    expect(resolveEndpoint('https://host/v1/chat/completions', 'language')).toBe(
      'https://host/v1/chat/completions',
    );
    expect(resolveEndpoint('https://host/v1/embeddings/', 'embedding')).toBe(
      'https://host/v1/embeddings',
    );
  });

  it('rejects schemes that must never be fetched', () => {
    expect(() => resolveEndpoint('file:///etc/passwd', 'language')).toThrow(
      '模型 API 地址必须是 http 或 https',
    );
  });
});

describe('probeModelConnection', () => {
  it('reports success for a chat model and sends the bearer header', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    const result = await probeModelConnection(target());
    expect(result).toEqual({ ok: true, message: '模型连接成功' });
    expect((initOf(fetchMock).headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-key',
    );
    expect(initOf(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the embedding wording and body for embedding models', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    const result = await probeModelConnection(target({ role: 'embedding' }));
    expect(result).toEqual({ ok: true, message: 'Embedding 模型连接成功' });
    const body = JSON.parse(String(initOf(fetchMock).body)) as Record<string, unknown>;
    expect(body.input).toBe('算台连接测试');
    expect(body.messages).toBeUndefined();
  });

  it('omits the authorization header when no key is configured', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    await probeModelConnection(target({ apiKey: '' }));
    expect('Authorization' in (initOf(fetchMock).headers as Record<string, string>)).toBe(false);
  });

  it('reports the http status without leaking the api key', async () => {
    stubFetch(() => new Response('denied', { status: 401 }));
    const result = await probeModelConnection(target());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('连接失败（HTTP 401）');
    expect(result.message).not.toContain('secret-key');
  });

  it('reports a timeout distinctly from other network failures', async () => {
    stubFetch(() => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    });
    const result = await probeModelConnection(target());
    expect(result).toEqual({ ok: false, message: '连接超时（超过 15 秒）' });
  });

  it('surfaces the network error message without the api key', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED https://host/v1');
    });
    const result = await probeModelConnection(target());
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
    expect(result.message).not.toContain('secret-key');
  });

  it('turns an invalid base url into a failed probe instead of throwing', async () => {
    const result = await probeModelConnection(target({ baseUrl: 'file:///etc/passwd' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('http 或 https');
  });
});
