import {
  abortError,
  FakeModelProvider,
  isAbortError,
  ReActAgentEngine,
} from '@betterwork/agent-core';
import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { createWebFetchTool } from '@betterwork/tool-runtime';
import { Agent } from 'undici';
import { describe, expect, it, vi } from 'vitest';

import type { WebFetchNetworkOptions } from './web-fetch-network-policy';
import { WebFetchService } from './web-fetch-service';

const createService = (fetchImpl: typeof fetch): WebFetchService =>
  new WebFetchService({
    fetch: fetchImpl,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });

describe('WebFetchService', () => {
  it.each(['timeout', 'cancel'] as const)(
    'aborts DNS on %s without a late dispatch',
    async (reason) => {
      vi.useFakeTimers();
      try {
        let resolveDns: ((answers: Array<{ address: string; family: number }>) => void) | undefined;
        const fetch = vi.fn();
        const createAgent = vi.fn();
        const controller = new AbortController();
        const service = new WebFetchService({
          fetch,
          createAgent,
          lookup: () =>
            new Promise((resolve) => {
              resolveDns = resolve;
            }),
        });
        const completion = service
          .fetch('https://example.com', controller.signal)
          .catch((error: unknown) => error);
        if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
        else controller.abort();
        const error = await completion;
        expect(isAbortError(error)).toBe(reason === 'cancel');
        if (reason === 'timeout')
          expect(error).toMatchObject({ message: expect.stringContaining('超时') });
        resolveDns?.([{ address: '93.184.216.34', family: 4 }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(createAgent).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['same', 'other'] as const)(
    'rechecks %s host redirect DNS after releasing the previous hop',
    async (host) => {
      const cancel = vi.fn();
      const agents: Agent[] = [];
      const lookup = vi
        .fn<NonNullable<WebFetchNetworkOptions['lookup']>>()
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
        .mockImplementationOnce(async () => {
          expect(cancel).toHaveBeenCalledOnce();
          expect(agents[0]).toHaveProperty('destroyed', true);
          return [{ address: '127.0.0.1', family: 4 }];
        });
      const fetch = vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            status: 302,
            headers: { location: host === 'same' ? '/next' : 'https://other.example.com/next' },
          }),
      );
      const service = new WebFetchService({
        lookup,
        fetch,
        createAgent: (options) => {
          const agent = new Agent(options);
          agents.push(agent);
          return agent;
        },
      });
      await expect(
        service.fetch('https://example.com/start', new AbortController().signal),
      ).rejects.toThrow('不允许访问');
      expect(fetch).toHaveBeenCalledOnce();
      expect(lookup.mock.calls.map(([hostname]) => hostname)).toEqual([
        'example.com',
        host === 'same' ? 'example.com' : 'other.example.com',
      ]);
      expect(agents).toHaveLength(1);
    },
  );

  it('follows a relative public redirect and releases each distinct Agent', async () => {
    const agents: Agent[] = [];
    const urls: string[] = [];
    const cancel = vi.fn();
    const result = await new WebFetchService({
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      createAgent: (options) => {
        const agent = new Agent(options);
        agents.push(agent);
        return agent;
      },
      fetch: async (url, init) => {
        urls.push(url.toString());
        expect(init.redirect).toBe('manual');
        if (urls.length === 1)
          return new Response(new ReadableStream({ cancel }), {
            status: 302,
            headers: { location: '../final' },
          });
        expect(agents[0]).toHaveProperty('destroyed', true);
        return new Response('正文', { headers: { 'content-type': 'text/plain' } });
      },
    }).fetch('https://example.com/folder/start', new AbortController().signal);
    expect(urls).toEqual(['https://example.com/folder/start', 'https://example.com/final']);
    expect(result.url).toBe('https://example.com/final');
    expect(cancel).toHaveBeenCalledOnce();
    expect(agents).toHaveLength(2);
    expect(agents[0]).not.toBe(agents[1]);
    for (const agent of agents) expect(agent).toHaveProperty('destroyed', true);
  });

  it('uses one deadline across redirect and body stages', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi
        .fn()
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return new Response(null, { status: 302, headers: { location: '/next' } });
        })
        .mockImplementationOnce(
          async () =>
            new Response(new ReadableStream(), { headers: { 'content-type': 'text/plain' } }),
        );
      const completion = createService(fetch)
        .fetch('https://example.com', new AbortController().signal)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(15_000);
      const error = await completion;
      expect(isAbortError(error)).toBe(false);
      expect(error).toMatchObject({ message: expect.stringContaining('超时') });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['timeout', 'cancel'] as const)(
    'preserves the first %s reason if the other reason follows',
    async (first) => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const fetch = vi.fn(async () => new Promise<Response>(() => {}));
        const completion = createService(fetch)
          .fetch('https://example.com', controller.signal)
          .catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(0);
        if (first === 'cancel') controller.abort();
        await vi.advanceTimersByTimeAsync(15_000);
        if (first === 'timeout') controller.abort();
        expect(isAbortError(await completion)).toBe(first === 'cancel');
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('destroys the Agent on cancelled headers and discards/cancels a late response', async () => {
    let finish: ((response: Response) => void) | undefined;
    let agent: Agent | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const service = new WebFetchService({
      fetch,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      createAgent: (options) => {
        agent = new Agent(options);
        return agent;
      },
    });
    const completion = service
      .fetch('https://example.com', controller.signal)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    expect(isAbortError(await completion)).toBe(true);
    expect(agent).toHaveProperty('destroyed', true);
    const cancel = vi.fn();
    finish?.(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['http', 'binary', 'empty', 'read-error', 'truncated'] as const)(
    'releases resources after %s result',
    async (outcome) => {
      let agent: Agent | undefined;
      const cancel = vi.fn();
      const service = new WebFetchService({
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        createAgent: (options) => {
          agent = new Agent(options);
          return agent;
        },
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                if (outcome === 'read-error') controller.error(new Error('body failed'));
                else if (outcome === 'empty') controller.close();
                else if (outcome === 'truncated')
                  controller.enqueue(new Uint8Array(1_000_001).fill(120));
              },
              cancel,
            }),
            {
              status: outcome === 'http' ? 502 : 200,
              headers: {
                'content-type': outcome === 'binary' ? 'application/octet-stream' : 'text/plain',
              },
            },
          ),
      });
      const completion = service.fetch('https://example.com', new AbortController().signal);
      if (outcome === 'truncated') expect(await completion).toMatchObject({ truncated: true });
      else await expect(completion).rejects.toThrow();
      expect(agent).toHaveProperty('destroyed', true);
      if (outcome === 'http' || outcome === 'binary' || outcome === 'truncated')
        expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each(['timeout', 'cancel'] as const)(
    'preserves tool failure versus Run cancellation for %s without tool completion',
    async (reason) => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const fetch = vi.fn(async () => new Promise<Response>(() => {}));
        const service = createService(fetch);
        const collect = async (): Promise<AgentRuntimeEvent[]> => {
          const events: AgentRuntimeEvent[] = [];
          for await (const event of new ReActAgentEngine().run({
            runId: 'web-run',
            taskId: 'web-task',
            sessionId: 'web-session',
            prompt: '抓取网页: https://example.com',
            workspacePath: '.',
            model: new FakeModelProvider(0),
            signal: controller.signal,
            tools: [createWebFetchTool((url, signal) => service.fetch(url, signal))],
          }))
            events.push(event);
          return events;
        };
        const completion = collect();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledOnce();
        if (reason === 'cancel') controller.abort();
        else await vi.advanceTimersByTimeAsync(15_000);
        await vi.runAllTimersAsync();
        const events = await completion;
        expect(events.at(-1)?.type).toBe(reason === 'cancel' ? 'run.cancelled' : 'run.completed');
        expect(events.map((event) => event.type)).not.toContain('tool.completed');
        if (reason === 'timeout') {
          expect(events).toContainEqual(
            expect.objectContaining({
              type: 'tool.failed',
              error: expect.stringContaining('超时'),
            }),
          );
          expect(events.map((event) => event.type)).not.toContain('run.cancelled');
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['fca.example.com', 'fda.example.com', 'FC.example.com', 'fd.example.com'])(
    'allows ordinary domain %s without treating its prefix as IPv6',
    async (hostname) => {
      const fetchImpl = vi.fn(
        async () =>
          new Response('正文', {
            headers: { 'content-type': 'text/plain' },
          }),
      );
      const result = await createService(fetchImpl).fetch(
        `https://${hostname}/page`,
        new AbortController().signal,
      );
      expect(result.content).toBe('正文');
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([
    'http://169.254.169.254/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://localhost./',
    'http://foo.local./',
    'http://[fe90::1]/',
    'http://[febf::1]/',
    'http://[fec0::1]/',
    'http://[ff02::1]/',
    'http://[0:0:0:0:0:ffff:a00:1]/',
    'http://0x7f000001/',
    'http://127.1/',
  ])('rejects special or local literal destination %s before fetching', async (url) => {
    const fetchImpl = vi.fn();
    await expect(createService(fetchImpl).fetch(url, new AbortController().signal)).rejects.toThrow(
      '不允许访问',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['https://93.184.216.34/', 'https://[2606:4700:4700::1111]/'])(
    'allows public literal destination %s',
    async (url) => {
      const result = await createService(
        async () =>
          new Response('public', {
            headers: { 'content-type': 'text/plain' },
          }),
      ).fetch(url, new AbortController().signal);
      expect(result.content).toBe('public');
    },
  );

  it.each(['timeout', 'cancel'] as const)(
    'distinguishes %s while waiting for headers',
    async (reason) => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const service = createService(
          async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(abortError()), {
                once: true,
              });
            }),
        );
        const result = service
          .fetch('https://example.com', controller.signal)
          .catch((error: unknown) => error);
        if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
        else controller.abort();
        const error = await result;
        expect(isAbortError(error)).toBe(reason === 'cancel');
        if (reason === 'timeout')
          expect(error).toMatchObject({ message: expect.stringContaining('超时') });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['timeout', 'cancel'] as const)(
    'interrupts a stalled body on %s and cancels its reader',
    async (reason) => {
      vi.useFakeTimers();
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel,
      });
      const controller = new AbortController();
      const pending = createService(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'text/plain' },
          }),
      ).fetch('https://example.com', controller.signal);
      let failure: unknown;
      const completion = pending.catch((error: unknown) => {
        failure = error;
      });
      try {
        await vi.advanceTimersByTimeAsync(0);
        if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
        else {
          controller.abort();
          await vi.advanceTimersByTimeAsync(0);
        }
        expect(failure).toBeInstanceOf(Error);
        expect(isAbortError(failure)).toBe(reason === 'cancel');
        expect(cancel).toHaveBeenCalledOnce();
      } finally {
        // Close only the old implementation's still-pending fixture after the assertion fails.
        if (!cancel.mock.calls.length) streamController?.close();
        await completion;
        vi.useRealTimers();
      }
    },
  );

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
    const result = await createService(fetchImpl).fetch(
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
      createService(fetchImpl).fetch('https://example.com/redirect', new AbortController().signal),
    ).rejects.toThrow('不允许访问');
    await expect(
      createService(fetchImpl).fetch('http://localhost:8080', new AbortController().signal),
    ).rejects.toThrow('不允许访问');
    await expect(
      createService(fetchImpl).fetch('http://[::1]/private', new AbortController().signal),
    ).rejects.toThrow('不允许访问');
    await expect(
      createService(fetchImpl).fetch(
        'http://[::ffff:127.0.0.1]/private',
        new AbortController().signal,
      ),
    ).rejects.toThrow('不允许访问');
    await expect(
      createService(
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
      createService(fetchImpl).fetch('https://example.com', controller.signal),
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
      createService(redirectFetch).fetch('https://example.com/start', new AbortController().signal),
    ).rejects.toThrow('重定向次数过多');
    expect(redirectFetch).toHaveBeenCalledTimes(4);

    const result = await createService(
      async () =>
        new Response('x'.repeat(1_000_001), {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    ).fetch('https://example.com/large', new AbortController().signal);
    expect(result).toMatchObject({ truncated: true, content: 'x'.repeat(1_000_000) });
  });
});
