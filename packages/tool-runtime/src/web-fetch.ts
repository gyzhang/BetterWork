import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z.object({ url: z.string().trim().url().max(4_000) });

export interface WebFetchResponse {
  url: string;
  title: string;
  content: string;
  contentType: string;
  status: number;
  retrievedAt: number;
  truncated: boolean;
}

export type WebFetch = (url: string, signal: AbortSignal) => Promise<WebFetchResponse>;

export const createWebFetchTool = (fetchPage: WebFetch): AgentTool => ({
  name: 'web_fetch',
  description:
    'Fetch the readable text of one public web page. Use a URL from web_search when a source needs verification or detailed reading.',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'An http(s) public web page URL.' } },
    required: ['url'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const { url } = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(`正在读取网页：${url}`);
    const result = await fetchPage(url, context.signal);
    if (context.signal.aborted) throw abortError();
    return {
      ...result,
      message: result.truncated ? '已读取网页正文（内容较长，已截断）。' : '已读取网页正文。',
    };
  },
});
