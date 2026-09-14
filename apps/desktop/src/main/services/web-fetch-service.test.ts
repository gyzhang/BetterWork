import { describe, expect, it, vi } from 'vitest';

import { WebFetchService } from './web-fetch-service';

describe('WebFetchService', () => {
  it('extracts readable HTML text and records the final URL', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          '<html><title>财务公告</title><script>secret()</script><body>收入 <b>增长</b></body></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        ),
    );
    const result = await new WebFetchService(fetchImpl).fetch(
      'https://example.com/report',
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      url: 'https://example.com/report',
      title: '财务公告',
      content: '收入 增长',
      contentType: 'text/html',
      status: 200,
      truncated: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects private hosts, binary responses and unsafe redirects', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    );
    await expect(
      new WebFetchService(fetchImpl).fetch(
        'https://example.com/redirect',
        new AbortController().signal,
      ),
    ).rejects.toThrow('不允许访问');
    await expect(
      new WebFetchService(fetchImpl).fetch('http://localhost:8080', new AbortController().signal),
    ).rejects.toThrow('不允许访问');
    await expect(
      new WebFetchService(fetchImpl).fetch('http://[::1]/private', new AbortController().signal),
    ).rejects.toThrow('不允许访问');
    await expect(
      new WebFetchService(fetchImpl).fetch(
        'http://[::ffff:127.0.0.1]/private',
        new AbortController().signal,
      ),
    ).rejects.toThrow('不允许访问');
    await expect(
      new WebFetchService(
        async () =>
          new Response('binary', {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          }),
      ).fetch('https://example.com/file', new AbortController().signal),
    ).rejects.toThrow('不是可读取正文');
  });

  it('stops before network when the run is already cancelled', async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new WebFetchService(fetchImpl).fetch('https://example.com', controller.signal),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('limits redirects and truncates oversized response bodies', async () => {
    const redirectFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/next' },
        }),
    );
    await expect(
      new WebFetchService(redirectFetch).fetch(
        'https://example.com/start',
        new AbortController().signal,
      ),
    ).rejects.toThrow('重定向次数过多');
    expect(redirectFetch).toHaveBeenCalledTimes(4);

    const result = await new WebFetchService(
      async () =>
        new Response('x'.repeat(1_000_001), {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    ).fetch('https://example.com/large', new AbortController().signal);
    expect(result).toMatchObject({ truncated: true, content: 'x'.repeat(1_000_000) });
  });
});
