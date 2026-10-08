import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import type { McpNetworkMode } from '@betterwork/agent-protocol';
import { Agent, fetch as nativeFetch, type RequestInit as UndiciRequestInit } from 'undici';

export class McpNetworkError extends Error {}

const MAX_MESSAGE_BYTES = 1_048_576;
const forbidden = new BlockList();
forbidden.addSubnet('0.0.0.0', 8, 'ipv4');
forbidden.addSubnet('169.254.0.0', 16, 'ipv4');
forbidden.addSubnet('224.0.0.0', 3, 'ipv4');
forbidden.addSubnet('100.64.0.0', 10, 'ipv4');
forbidden.addAddress('::', 'ipv6');
forbidden.addSubnet('fe80::', 10, 'ipv6');
forbidden.addSubnet('ff00::', 8, 'ipv6');
const privateAddresses = new BlockList();
privateAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
privateAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
privateAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
privateAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
privateAddresses.addAddress('::1', 'ipv6');
privateAddresses.addSubnet('fc00::', 7, 'ipv6');

export interface McpNetworkGrant {
  origin: string;
  networkMode: McpNetworkMode;
}
export interface McpNetworkOptions {
  fetch?: typeof fetch;
  lookup?: (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>;
}

export const validateMcpAddress = (address: string, mode: McpNetworkMode): void => {
  const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
  if (!isIP(address) || forbidden.check(address, family))
    throw new McpNetworkError('MCP 目的地是禁止访问的特殊网络地址。');
  const loopback = address === '::1' || address.startsWith('127.');
  if (mode === 'loopback' && !loopback)
    throw new McpNetworkError('本机 HTTP 仅允许字面 loopback 地址。');
  if (mode === 'public' && privateAddresses.check(address, family))
    throw new McpNetworkError('MCP 公网连接不能访问私网地址，请显式授权目的地。');
};

export const validateMcpEndpoint = (raw: string, mode: McpNetworkMode, approved: boolean): URL => {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new McpNetworkError('MCP 地址无效。');
  if (mode !== 'public' && !approved) throw new McpNetworkError('请明确授权此 MCP 主机与端口。');
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'https:' && mode !== 'loopback')
    throw new McpNetworkError('远程 MCP 服务必须使用 HTTPS。');
  if (mode === 'loopback' && !isIP(hostname))
    throw new McpNetworkError('本机地址请使用 127.0.0.1 或 [::1]。');
  if (isIP(hostname)) validateMcpAddress(hostname, mode);
  return url;
};

/** Resolve once and reject mixed DNS answers before either socket or browser handoff. */
export async function resolveMcpDestination(
  url: URL,
  mode: McpNetworkMode,
  options: McpNetworkOptions,
  signal: AbortSignal,
): Promise<Array<{ address: string; family: number }>> {
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  signal.throwIfAborted();
  const answers = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        const abort = (): void =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new McpNetworkError('MCP 请求已取消。'),
          );
        signal.addEventListener('abort', abort, { once: true });
        (options.lookup ?? lookup)(hostname, { all: true, verbatim: true }).then(
          (result) => {
            signal.removeEventListener('abort', abort);
            resolve(result);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', abort);
            reject(error instanceof Error ? error : new McpNetworkError('MCP 主机解析失败。'));
          },
        );
        if (signal.aborted) abort();
      });
  signal.throwIfAborted();
  if (!answers.length) throw new McpNetworkError('MCP 主机没有可用网络地址。');
  for (const answer of answers) validateMcpAddress(answer.address, mode);
  return answers;
}

/** Restrict every SDK request, pin DNS in the actual socket lookup, bound decoded messages. */
export function createMcpPolicyFetch(
  grants: readonly McpNetworkGrant[],
  options: McpNetworkOptions = {},
  allowPublicDiscovery = false,
  operationSignal?: AbortSignal,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const grant = grants.find((item) => new URL(item.origin).origin === url.origin);
    if (!grant && !allowPublicDiscovery) throw new McpNetworkError('MCP 请求超出了已授权目的地。');
    const mode = grant?.networkMode ?? 'public';
    validateMcpEndpoint(url.toString(), mode, !!grant);
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const headerController = new AbortController();
    const headerTimer = setTimeout(() => headerController.abort(), 30_000);
    const signal = AbortSignal.any([
      ...(requestSignal ? [requestSignal] : []),
      ...(operationSignal ? [operationSignal] : []),
      headerController.signal,
    ]);
    let answers: Awaited<ReturnType<typeof resolveMcpDestination>>;
    try {
      answers = await resolveMcpDestination(url, mode, options, signal);
    } catch (error) {
      clearTimeout(headerTimer);
      throw error;
    }
    const pinned = answers[0];
    if (!pinned) {
      clearTimeout(headerTimer);
      throw new McpNetworkError('MCP 主机解析失败。');
    }
    const dispatcher = options.fetch
      ? undefined
      : new Agent({
          headersTimeout: 30_000,
          bodyTimeout: 0,
          connect: {
            lookup: (_host, lookupOptions, callback) => {
              if (lookupOptions.all) callback(null, [pinned]);
              else callback(null, pinned.address, pinned.family);
            },
          },
        });
    try {
      const response = options.fetch
        ? await options.fetch(input, { ...init, redirect: 'manual', signal })
        : ((await nativeFetch(url, {
            ...(input instanceof Request
              ? { method: input.method, headers: input.headers, body: input.body, duplex: 'half' }
              : {}),
            ...init,
            redirect: 'manual',
            signal,
            ...(dispatcher ? { dispatcher } : {}),
          } as UndiciRequestInit)) as unknown as Response);
      clearTimeout(headerTimer);
      if (response.status >= 300 && response.status < 400)
        throw new McpNetworkError('MCP 重定向不在本次授权范围内。');
      if (!response.body) {
        await dispatcher?.close();
        return response;
      }
      const reader = response.body.getReader();
      const isSse = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
      let bytes = 0;
      let lineBytes = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              controller.close();
              await dispatcher?.close();
              return;
            }
            if (isSse) {
              for (const byte of chunk.value) {
                bytes += 1;
                if (bytes > MAX_MESSAGE_BYTES)
                  throw new McpNetworkError('MCP SSE event 超过 1 MiB 上限。');
                if (byte === 10) {
                  if (lineBytes === 0) bytes = 0;
                  lineBytes = 0;
                } else if (byte !== 13) lineBytes += 1;
              }
            } else {
              bytes += chunk.value.byteLength;
              if (bytes > MAX_MESSAGE_BYTES) throw new McpNetworkError('MCP 消息超过 1 MiB 上限。');
            }
            controller.enqueue(chunk.value);
          } catch (error) {
            controller.error(error);
            await reader.cancel().catch(() => {
              /* The stream has already failed; preserve the original error. */
            });
            await dispatcher?.destroy();
          }
        },
        async cancel(reason: unknown) {
          await reader.cancel(reason);
          await dispatcher?.destroy();
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      clearTimeout(headerTimer);
      await dispatcher?.destroy();
      throw error;
    }
  };
}
