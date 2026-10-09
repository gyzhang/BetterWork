import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { abortError } from '@betterwork/agent-core';
import { Agent, fetch as nativeFetch } from 'undici';

// ADR-0046 deliberately excludes protocol, documentation and transition ranges too.
const forbiddenV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  forbiddenV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const forbiddenV6 = new BlockList();
forbiddenV6.addSubnet('2001::', 23, 'ipv6');
forbiddenV6.addSubnet('2001:db8::', 32, 'ipv6');
forbiddenV6.addSubnet('2002::', 16, 'ipv6');
forbiddenV6.addSubnet('3fff::', 20, 'ipv6');

export function validateWebFetchAddress(address: string): void {
  const family = isIP(address);
  if (
    !family ||
    address.includes('%') ||
    (family === 4 && forbiddenV4.check(address, 'ipv4')) ||
    (family === 6 && (!globalV6.check(address, 'ipv6') || forbiddenV6.check(address, 'ipv6')))
  )
    throw new Error('网页地址指向了不允许访问的主机');
}

export function validateWebFetchUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('仅支持 http(s) 网页地址');
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (
    url.username ||
    url.password ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  )
    throw new Error('网页地址指向了不允许访问的主机');
  if (isIP(hostname)) validateWebFetchAddress(hostname);
  return url;
}

export function webFetchAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : abortError();
}

/** DNS cannot be cancelled; discard late completions without dispatching work. */
export async function awaitWebFetchOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort);
      reject(webFetchAbortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(webFetchAbortReason(signal));
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(
          signal.aborted
            ? webFetchAbortReason(signal)
            : error instanceof Error
              ? error
              : new Error('网页请求失败', { cause: error }),
        );
      },
    );
    if (signal.aborted) abort();
  });
}

export interface WebFetchNetworkOptions {
  lookup?: (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>;
  fetch?: (
    url: URL,
    init: { redirect: 'manual'; signal: AbortSignal; dispatcher: Agent },
  ) => Promise<Response>;
  createAgent?: (options: Agent.Options) => Agent;
}

export interface WebFetchConnection {
  response: Response;
  release: () => Promise<void>;
}

const cancelBody = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch(() => {
    // The body may already have failed or been cancelled; Agent destruction still follows.
  });
};

export async function requestWebFetch(
  url: URL,
  signal: AbortSignal,
  options: WebFetchNetworkOptions,
): Promise<WebFetchConnection> {
  if (signal.aborted) throw webFetchAbortReason(signal);
  validateWebFetchUrl(url.toString());
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  const answers = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await awaitWebFetchOperation(
        (options.lookup ?? lookup)(hostname, { all: true, verbatim: true }),
        signal,
      );
  if (signal.aborted) throw webFetchAbortReason(signal);
  for (const answer of answers) {
    validateWebFetchAddress(answer.address);
    if (answer.family !== isIP(answer.address)) throw new Error('网页主机解析返回了无效地址类型');
  }
  const first = answers[0];
  if (!first) throw new Error('网页主机没有可用网络地址');
  const pinned = { address: first.address, family: first.family };
  const agent = (options.createAgent ?? ((agentOptions) => new Agent(agentOptions)))({
    connect: {
      rejectUnauthorized: true,
      lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ ...pinned }]);
        else callback(null, pinned.address, pinned.family);
      },
    },
  });
  const fetchPage =
    options.fetch ??
    (async (input, init) => (await nativeFetch(input, init)) as unknown as Response);
  try {
    const response = await awaitWebFetchOperation(
      fetchPage(url, { redirect: 'manual', signal, dispatcher: agent }).then(async (result) => {
        if (signal.aborted) {
          await cancelBody(result);
          throw webFetchAbortReason(signal);
        }
        return result;
      }),
      signal,
    );
    return {
      response,
      async release() {
        try {
          await cancelBody(response);
        } finally {
          await agent.destroy();
        }
      },
    };
  } catch (error) {
    await agent.destroy();
    throw error;
  }
}
