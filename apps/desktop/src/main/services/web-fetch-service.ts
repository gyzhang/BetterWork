import { abortError } from '@betterwork/agent-core';
import type { WebFetchResponse } from '@betterwork/tool-runtime';

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

const isPrivateHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local'))
    return true;
  if (
    lower === '::1' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  )
    return true;
  const parts = lower.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 0
  );
};

const validateUrl = (raw: string): URL => {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('仅支持 http(s) 网页地址');
  if (url.username || url.password || isPrivateHostname(url.hostname))
    throw new Error('网页地址指向了不允许访问的主机');
  return url;
};

const readBody = async (
  response: Response,
  signal: AbortSignal,
): Promise<{ text: string; truncated: boolean }> => {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, MAX_BYTES), truncated: text.length > MAX_BYTES };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
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
    await reader.cancel().catch(() => undefined);
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
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetch(url: string, signal: AbortSignal): Promise<WebFetchResponse> {
    let current = validateUrl(url);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (signal.aborted) throw abortError();
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
      const onAbort = (): void => timeout.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await this.fetchImpl(current, {
          redirect: 'manual',
          signal: timeout.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || redirects === MAX_REDIRECTS)
            throw new Error('网页重定向次数过多或缺少目标');
          current = validateUrl(new URL(location, current).toString());
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
        const body = await readBody(response, timeout.signal);
        const readable = contentType.includes('html')
          ? toReadableText(body.text)
          : { title: '', content: body.text.trim() };
        if (!readable.content) throw new Error('网页没有可读取正文');
        return {
          url: current.toString(),
          title: readable.title || current.hostname,
          content: readable.content,
          contentType,
          status: response.status,
          retrievedAt: Date.now(),
          truncated: body.truncated,
        };
      } catch (error) {
        if (signal.aborted || timeout.signal.aborted) throw abortError();
        throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    }
    throw new Error('网页重定向失败');
  }
}
