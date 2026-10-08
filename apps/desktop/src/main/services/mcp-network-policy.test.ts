import { describe, expect, it, vi } from 'vitest';

import {
  createMcpPolicyFetch,
  validateMcpAddress,
  validateMcpEndpoint,
} from './mcp-network-policy';

const grant = { origin: 'https://mcp.example', networkMode: 'public' as const };
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('MCP destination policy', () => {
  it('rejects private, mapped, metadata and mixed DNS destinations before fetching', async () => {
    for (const address of [
      '10.1.2.3',
      '127.0.0.1',
      '::ffff:127.0.0.1',
      '169.254.169.254',
      '::ffff:169.254.169.254',
      'fe80::1',
      '0.0.0.0',
    ])
      expect(() => validateMcpAddress(address, 'public')).toThrow();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const request = createMcpPolicyFetch([grant], {
      fetch,
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.2', family: 4 },
      ],
    });
    await expect(request('https://mcp.example/mcp')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(() => validateMcpEndpoint('http://localhost:3000', 'loopback', true)).toThrow();
    expect(() => validateMcpEndpoint('https://mcp.example', 'private', false)).toThrow();
    expect(() => validateMcpAddress('127.0.0.1', 'loopback')).not.toThrow();
  });

  it('rejects endpoint changes, redirects and oversized JSON and SSE events', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://other.example' } }),
      );
    const request = createMcpPolicyFetch([grant], { fetch, lookup: publicLookup });
    await expect(request('https://other.example/mcp')).rejects.toThrow();
    await expect(request('https://mcp.example/mcp')).rejects.toThrow(/重定向/u);
    fetch.mockImplementation(
      async () =>
        new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
    );
    await expect((await request('https://mcp.example/mcp')).text()).rejects.toThrow(/MiB/u);
    fetch.mockImplementation(
      async () =>
        new Response(`data: ${'x'.repeat(1_048_577)}\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    await expect((await request('https://mcp.example/mcp')).text()).rejects.toThrow(/MiB/u);
    fetch.mockImplementation(
      async () =>
        new Response('data: ok\n\n'.repeat(120_000), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    expect((await request('https://mcp.example/mcp')).body).toBeDefined();
  });

  it('aborts DNS waits and keeps a successful SSE stream alive beyond the header budget', async () => {
    const controller = new AbortController();
    const request = createMcpPolicyFetch(
      [grant],
      { lookup: () => new Promise(() => {}) },
      false,
      controller.signal,
    );
    const pending = request('https://mcp.example/mcp');
    controller.abort();
    await expect(pending).rejects.toThrow();
    vi.useFakeTimers();
    try {
      let passedSignal: AbortSignal | null | undefined;
      const fetch: typeof globalThis.fetch = async (_input, init) => {
        passedSignal = init?.signal;
        return new Response(new ReadableStream(), {
          headers: { 'content-type': 'text/event-stream' },
        });
      };
      const response = await createMcpPolicyFetch([grant], { fetch, lookup: publicLookup })(
        'https://mcp.example/mcp',
      );
      await vi.advanceTimersByTimeAsync(31_000);
      expect(passedSignal?.aborted).toBe(false);
      await response.body?.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});
