import { abortError, type AgentTool, type ToolExecutionContext } from '@betterwork/agent-core';
import {
  type KnowledgeReadRequest,
  knowledgeReadRequestSchema,
  type KnowledgeTextPage,
} from '@betterwork/agent-protocol';

export interface KnowledgeReadOutput extends KnowledgeTextPage {
  remainingRunCodePoints: number;
  parts: Array<KnowledgeTextPage['parts'][number] & { evidenceId: string }>;
}

export type KnowledgeRunRead = (
  request: KnowledgeReadRequest,
  context: ToolExecutionContext,
) => KnowledgeReadOutput | Promise<KnowledgeReadOutput>;

/** 分页读取运行内固定知识修订的正文；范围与审计由宿主（Main）完成。 */
export const createKnowledgeReadTool = (read: KnowledgeRunRead): AgentTool => ({
  name: 'read_knowledge',
  description:
    'Read the saved text of one fixed knowledge revision selected for this run, in code-point pages. Pass the exact reference from the material list or knowledge_search results; continue with nextCursor. Read again with the same cursor to re-receive already audited content; it will not be counted twice.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: {
        type: 'object',
        description:
          'The knowledge-revision material reference exactly as provided by the run snapshot or a search result.',
        properties: {
          kind: { type: 'string', enum: ['knowledge-revision'] },
          knowledgeDocumentId: { type: 'string' },
          knowledgeRevisionId: { type: 'string' },
          contentHash: { type: 'string' },
          sourcePath: { type: 'string' },
        },
        required: [
          'kind',
          'knowledgeDocumentId',
          'knowledgeRevisionId',
          'contentHash',
          'sourcePath',
        ],
        additionalProperties: false,
      },
      cursor: {
        type: 'object',
        description: 'Opaque continuation cursor returned as nextCursor by a previous page.',
        properties: {
          revisionId: { type: 'string' },
          textHash: { type: 'string' },
          sectionOrdinal: { type: 'number' },
          offset: { type: 'number' },
        },
        required: ['revisionId', 'textHash', 'sectionOrdinal', 'offset'],
        additionalProperties: false,
      },
      maxCodePoints: {
        type: 'number',
        description: 'Maximum Unicode code points for this page (1-8000, default 4000).',
      },
    },
    required: ['reference'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const request = knowledgeReadRequestSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(
      `正在读取资料正文：${request.reference.sourcePath.split(/[\\/]/u).pop() ?? '知识资料'}`,
    );
    const output = await read(request, context);
    if (context.signal.aborted) throw abortError();
    return output;
  },
});
