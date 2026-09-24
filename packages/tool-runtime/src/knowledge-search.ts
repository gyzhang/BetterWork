import { abortError, type AgentTool, type ToolExecutionContext } from '@betterwork/agent-core';
import {
  KNOWLEDGE_SEARCH_TOOL_MAX_RESULTS,
  type KnowledgeMaterialReference,
  type KnowledgeSpan,
} from '@betterwork/agent-protocol';
import { z } from 'zod';

const inputSchema = z.object({ query: z.string().trim().min(1).max(500) });

export interface KnowledgeSearchItem {
  id: string;
  title: string;
  sourcePath: string;
  format: 'markdown' | 'text' | 'pdf' | 'docx';
  locator: string;
  /** 命中来自哪一路（KM08）：keyword/vector/both。 */
  matchedBy?: 'keyword' | 'vector' | 'both';
  excerpt: string;
  contentHash: string;
  /** Run 审计后的精确身份（KM02）；管理路径缺省。 */
  reference?: KnowledgeMaterialReference;
  textHash?: string;
  span?: KnowledgeSpan;
  excerptHash?: string;
  evidenceId?: string;
}

export interface KnowledgeSearchOutcome {
  results: KnowledgeSearchItem[];
  notice?: string;
}

export type KnowledgeSearch = (
  query: string,
  context: ToolExecutionContext,
) => Promise<KnowledgeSearchOutcome | KnowledgeSearchItem[]>;

/** Creates a read-only tool around the application-owned Knowledge Vault. */
export const createKnowledgeSearchTool = (search: KnowledgeSearch): AgentTool => ({
  name: 'knowledge_search',
  description:
    'Search the knowledge revisions selected for this run. Returns source titles, formats, exact locators, short excerpts and evidenceIds. Use read_knowledge with a returned reference to read the saved text of that fixed revision; results never include material outside the run scope.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to search in the selected knowledge.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const { query } = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(`正在检索个人资料库：${query}`);
    const outcome = await search(query, context);
    const resolved = Array.isArray(outcome) ? { results: outcome } : outcome;
    const results = resolved.results.slice(0, KNOWLEDGE_SEARCH_TOOL_MAX_RESULTS);
    return {
      query,
      results,
      ...(resolved.notice ? { notice: resolved.notice } : {}),
      message:
        results.length === 0
          ? (resolved.notice ?? '所选资料中没有找到相关内容。')
          : `找到 ${results.length} 条相关资料摘要。`,
    };
  },
});
