import { abortError } from '@betterwork/agent-core';
import type { WebFetchResponse } from '@betterwork/tool-runtime';

import {
  awaitWebFetchOperation,
  requestWebFetch,
  validateWebFetchUrl,
  webFetchAbortReason,
  type WebFetchNetworkOptions,
} from './web-fetch-network-policy';

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

const readBody = async (
  response: Response,
  signal: AbortSignal,
): Promise<{ text: string; truncated: boolean }> => {
  if (!response.body) {
    return { text: '', truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal.aborted) throw webFetchAbortReason(signal);
      const { done, value } = await awaitWebFetchOperation(reader.read(), signal);
      if (done) break;
      if (!value) continue;
      const remaining = MAX_BYTES - total;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, Math.max(remaining, 0)));
        total = MAX_BYTES;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel().catch(() => {
        // Preserve the original read failure; the owning Agent is destroyed by the caller.
      });
    } finally {
      reader.releaseLock();
    }
  }
  const text = new TextDecoder().decode(concat(chunks, total));
  return { text, truncated };
};

const concat = (chunks: Uint8Array[], total: number): Uint8Array => {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const toReadableText = (html: string): { title: string; content: string } => {
  const title =
    html
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim() ?? '';
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, content: body };
};

export class WebFetchService {
  constructor(private readonly options: WebFetchNetworkOptions = {}) {}

  async fetch(url: string, signal: AbortSignal): Promise<WebFetchResponse> {
    if (signal.aborted) throw abortError();
    let current = validateWebFetchUrl(url);
    const operation = new AbortController();
    const timer = setTimeout(() => operation.abort(new Error('网页读取超时（15 秒）')), TIMEOUT_MS);
    const onAbort = (): void => operation.abort(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const connection = await requestWebFetch(current, operation.signal, this.options);
        let result: WebFetchResponse;
        try {
          const { response } = connection;
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location || redirects === MAX_REDIRECTS)
              throw new Error('网页重定向次数过多或缺少目标');
            // requestWebFetch validates the next hop after this connection is released.
            current = new URL(location, current);
            continue;
          }
          if (!response.ok) throw new Error(`网页返回 HTTP ${response.status}`);
          const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
          if (!(
            contentType.startsWith('text/') ||
            contentType.includes('html') ||
            contentType.includes('json')
          ))
            throw new Error('网页返回的不是可读取正文');
          const body = await readBody(response, operation.signal);
          if (operation.signal.aborted) throw webFetchAbortReason(operation.signal);
          const readable = contentType.includes('html')
            ? toReadableText(body.text)
            : { title: '', content: body.text.trim() };
          if (!readable.content) throw new Error('网页没有可读取正文');
          result = {
            url: current.toString(),
            title: readable.title || current.hostname,
            content: readable.content,
            contentType,
            status: response.status,
            retrievedAt: Date.now(),
            truncated: body.truncated,
          };
        } finally {
          await connection.release();
        }
        if (operation.signal.aborted) throw webFetchAbortReason(operation.signal);
        return result;
      }
      throw new Error('网页重定向失败');
    } catch (error) {
      if (operation.signal.aborted) throw webFetchAbortReason(operation.signal);
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
