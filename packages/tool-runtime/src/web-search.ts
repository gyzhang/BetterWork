import type { AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z.object({ query: z.string().trim().min(1).max(500) });

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
  site?: string;
  date?: string;
}

export interface WebSearchResponse {
  summary?: string;
  results: WebSearchItem[];
}

export type WebSearch = (query: string) => Promise<WebSearchResponse>;

/** Creates a web search tool around an application-injected search function. */
export const createWebSearchTool = (search: WebSearch): AgentTool => ({
  name: 'web_search',
  description: 'Search the public internet with the workspace’s configured search engine. Returns a short answer summary and web page results with titles, URLs, and snippets for citing or further work.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search keywords or a question to look up on the web.' } },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const { query } = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw Object.assign(new Error('Run cancelled'), { name: 'AbortError' });
    context.reportProgress(`正在搜索网页：${query}`);
    const response = await search(query);
    const results = response.results.slice(0, 8);
    return {
      query,
      ...(response.summary ? { summary: response.summary } : {}),
      results,
      message: results.length === 0 ? '没有搜索到相关网页。' : `搜索到 ${results.length} 条网页结果。`,
    };
  },
});
