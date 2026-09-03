import type { AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z.object({ query: z.string().trim().min(1).max(500) });

export interface KnowledgeSearchItem {
  id: string;
  title: string;
  sourcePath: string;
  format: 'markdown' | 'text';
  excerpt: string;
}

export type KnowledgeSearch = (query: string) => KnowledgeSearchItem[];

/** Creates a read-only tool around the application-owned Knowledge Vault. */
export const createKnowledgeSearchTool = (search: KnowledgeSearch): AgentTool => ({
  name: 'knowledge_search',
  description: 'Search the user’s local knowledge vault. Returns source titles, paths, formats, and short excerpts for citing or further work.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Keywords to search in the local knowledge vault.' } },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const { query } = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw Object.assign(new Error('Run cancelled'), { name: 'AbortError' });
    context.reportProgress(`正在检索个人资料库：${query}`);
    const results = search(query).slice(0, 8);
    return {
      query,
      results,
      message: results.length === 0 ? '没有找到相关资料。' : `找到 ${results.length} 份相关资料。`,
    };
  },
});
