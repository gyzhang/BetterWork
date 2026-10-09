import net, { type TcpNetConnectOpts } from 'node:net';
import tls, { type ConnectionOptions } from 'node:tls';

import { abortError, isAbortError } from '@betterwork/agent-core';
import { Agent } from 'undici';
import { describe, expect, it, vi } from 'vitest';

import {
  requestWebFetch,
  validateWebFetchAddress,
  validateWebFetchUrl,
} from './web-fetch-network-policy';

const publicAnswer = { address: '93.184.216.34', family: 4 };

describe('web destination policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.170',
    '192.0.2.1',
    '192.88.99.2',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:93.184.216.34',
    '0:0:0:0:0:ffff:c0a8:1',
    'fe80::1',
    'febf:ffff::1',
    'fec0::1',
    'fc00::1',
    'fdff::1',
    'ff02::1',
    '64:ff9b::a00:1',
    '64:ff9b:1::1',
    '100::1',
    '2001::1',
    '2001:2::1',
    '2001:db8::1',
    '2002:a00:1::1',
    '3fff::1',
    '5f00::1',
    'not-an-ip',
    '2606:4700::1%en0',
  ])('rejects forbidden or invalid address %s', (address) => {
    expect(() => validateWebFetchAddress(address)).toThrow('不允许访问');
  });

  it.each([
    '93.184.216.34',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ])('allows public address %s', (address) => {
    expect(() => validateWebFetchAddress(address)).not.toThrow();
  });

  it.each([
    'ftp://example.com/a',
    'https://user:password@example.com/',
    'http://localhost./',
    'http://a.localhost./',
    'http://a.local./',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://[::ffff:7f00:1]/',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validateWebFetchUrl(url)).toThrow();
  });

  it.each(
    [
      [],
      [publicAnswer, { address: '192.168.0.1', family: 4 }],
      [{ address: 'fd00::1', family: 6 }, publicAnswer],
      [{ address: '::ffff:169.254.169.254', family: 6 }],
      [{ address: 'garbage', family: 4 }],
      [{ address: publicAnswer.address, family: 6 }],
    ].map((answers) => ({ answers })),
  )(
    'rejects an empty, mixed, forbidden or malformed DNS answer before dispatch %#',
    async ({ answers }) => {
      const fetch = vi.fn();
      const createAgent = vi.fn();
      await expect(
        requestWebFetch(new URL('https://example.com'), new AbortController().signal, {
          lookup: async () => answers,
          fetch,
          createAgent,
        }),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(createAgent).not.toHaveBeenCalled();
    },
  );

  it('does not resolve literal IPs and cancels unread bodies on release', async () => {
    const lookup = vi.fn();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const fetch = vi.fn(async () => response);
    const connection = await requestWebFetch(
      new URL('https://93.184.216.34/a'),
      new AbortController().signal,
      { lookup, fetch },
    );
    expect(lookup).not.toHaveBeenCalled();
    await connection.release();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toBeDefined();
  });

  it('aborts a DNS wait and discards a late successful resolution', async () => {
    let resolveDns: ((answers: (typeof publicAnswer)[]) => void) | undefined;
    const lookup = vi.fn(
      () =>
        new Promise<(typeof publicAnswer)[]>((resolve) => {
          resolveDns = resolve;
        }),
    );
    const controller = new AbortController();
    const fetch = vi.fn();
    const createAgent = vi.fn();
    const pending = requestWebFetch(new URL('https://example.com'), controller.signal, {
      lookup,
      fetch,
      createAgent,
    }).catch((error: unknown) => error);
    controller.abort(abortError());
    expect(isAbortError(await pending)).toBe(true);
    resolveDns?.([publicAnswer]);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('pins a copy of the validated first answer for single and all socket lookups', async () => {
    const answer = { ...publicAnswer };
    const lookup = vi.fn(async () => [answer, { address: '2606:4700::1111', family: 6 }]);
    let options: Agent.Options | undefined;
    const createAgent = (value: Agent.Options): Agent => {
      options = value;
      return new Agent(value);
    };
    const connection = await requestWebFetch(
      new URL('https://example.com/page'),
      new AbortController().signal,
      { lookup, createAgent, fetch: async () => new Response(null) },
    );
    try {
      answer.address = '127.0.0.1';
      const connect = options?.connect as (TcpNetConnectOpts & ConnectionOptions) | undefined;
      expect(typeof connect).toBe('object');
      if (!connect?.lookup) throw new Error('Missing pinned lookup');
      const single = vi.fn();
      const all = vi.fn();
      connect.lookup('example.com', {}, single);
      connect.lookup('example.com', { all: true }, all);
      expect(single).toHaveBeenCalledWith(null, publicAnswer.address, 4);
      expect(all).toHaveBeenCalledWith(null, [publicAnswer]);
      expect(lookup).toHaveBeenCalledOnce();
      expect(connect.rejectUnauthorized).toBe(true);
    } finally {
      await connection.release();
    }
  });

  it.each(['http:', 'https:'] as const)(
    'passes the pin into the real Undici → Node %s connector without network I/O',
    async (protocol) => {
      const lookup = vi.fn(async () => [publicAnswer]);
      let socketOptions: (TcpNetConnectOpts & ConnectionOptions) | undefined;
      const connect = (options: TcpNetConnectOpts & ConnectionOptions): net.Socket => {
        socketOptions = options;
        const socket = new net.Socket();
        queueMicrotask(() => socket.destroy(new Error('offline socket boundary reached')));
        return socket;
      };
      const spy =
        protocol === 'https:'
          ? vi.spyOn(tls, 'connect').mockImplementation(connect as typeof tls.connect)
          : vi.spyOn(net, 'connect').mockImplementation(connect as typeof net.connect);
      try {
        await expect(
          requestWebFetch(
            new URL(`${protocol}//example.com/report`),
            new AbortController().signal,
            { lookup },
          ),
        ).rejects.toThrow('fetch failed');
        expect(socketOptions?.host).toBe('example.com');
        expect(socketOptions?.lookup).toBeTypeOf('function');
        const single = vi.fn();
        socketOptions?.lookup?.('example.com', {}, single);
        expect(single).toHaveBeenCalledWith(null, publicAnswer.address, 4);
        expect(lookup).toHaveBeenCalledOnce();
        if (protocol === 'https:') {
          expect(socketOptions?.servername).toBe('example.com');
          expect(socketOptions?.rejectUnauthorized).toBe(true);
        }
      } finally {
        spy.mockRestore();
      }
    },
  );
});
