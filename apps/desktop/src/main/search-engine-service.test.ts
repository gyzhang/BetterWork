import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQianfanSearchClient } from './search-engine-service';

afterEach(() => vi.unstubAllGlobals());

describe('createQianfanSearchClient', () => {
  it('posts a web_summary request with bearer auth and maps references', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      request_id: 'req-1',
      summary: '答案是……',
      references: [
        { id: 1, title: '第一条', url: 'https://example.com/1', content: '片段一', site: 'example.com', date: '2026-09-05', type: 'web' },
        { id: 2, title: '无地址', content: '片段二' },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 5 });
    const response = await client.search('市场动态');
    expect(response.summary).toBe('答案是……');
    expect(response.results).toEqual([{ title: '第一条', url: 'https://example.com/1', snippet: '片段一', site: 'example.com', date: '2026-09-05' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qianfan.baidubce.com/v2/ai_search/web_summary');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }>; resource_type_filter: Array<{ type: string; top_k: number }> };
    expect(body.messages).toEqual([{ role: 'user', content: '市场动态' }]);
    expect(body.resource_type_filter).toEqual([{ type: 'web', top_k: 5 }, { type: 'video', top_k: 0 }, { type: 'image', top_k: 0 }]);
  });

  it('reports http failures without leaking the api key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 401, message: 'Invalid API key' }), { status: 401 })));
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 10 });
    const result = await client.test();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(result.message).toContain('Invalid API key');
    expect(result.message).not.toContain('secret-key');
  });

  it('treats network errors as connection failures without the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    const client = createQianfanSearchClient({ apiKey: 'secret-key', webTopK: 10 });
    const error = await client.search('任意查询').then(() => undefined, (reason: unknown) => reason as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('ECONNREFUSED');
    expect(error?.message).not.toContain('secret-key');
  });
});
