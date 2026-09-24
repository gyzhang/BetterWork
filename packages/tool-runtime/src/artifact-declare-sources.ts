import { abortError, type AgentTool, type ToolExecutionContext } from '@betterwork/agent-core';
import {
  type ArtifactInputRelationInput,
  artifactInputRelationInputSchema,
  declareArtifactSourcesRequestSchema,
} from '@betterwork/agent-protocol';
import { z } from 'zod';

// 模型只能交来源；runId 由宿主注入，出现在模型输入里就是越界。
const modelInputSchema = z
  .object({ inputRelations: artifactInputRelationInputSchema.array().max(50) })
  .strict();

export interface ArtifactDeclareSourcesOutput {
  declaredCount: number;
  message: string;
}

export type ArtifactSourceDeclarator = (
  inputs: readonly ArtifactInputRelationInput[],
  context: ToolExecutionContext,
) => Promise<void> | void;

const RELATION_JSON_SCHEMA = {
  type: 'array',
  description:
    'Exact sources this run adopted for the artifact. Knowledge revisions require an actual read (search summaries alone are not enough); evidence entries must be exact knowledge evidence ids returned to this run in this same conversation. An empty array clears the declaration.',
  items: {
    type: 'object',
    properties: {
      input: {
        oneOf: [
          {
            type: 'object',
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
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['artifact-version'] },
              artifactId: { type: 'string' },
              artifactVersionId: { type: 'string' },
              contentHash: { type: 'string' },
              originWorkspaceId: { type: 'string' },
            },
            required: [
              'kind',
              'artifactId',
              'artifactVersionId',
              'contentHash',
              'originWorkspaceId',
            ],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['workspace-input-snapshot'] },
              snapshotId: { type: 'string' },
              workspaceId: { type: 'string' },
              contentHash: { type: 'string' },
              format: { type: 'string' },
              fileKey: { type: 'string' },
            },
            required: ['kind', 'snapshotId', 'workspaceId', 'contentHash', 'format', 'fileKey'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['evidence'] },
              evidenceId: { type: 'string' },
            },
            required: ['kind', 'evidenceId'],
            additionalProperties: false,
          },
        ],
      },
      relation: {
        type: 'string',
        enum: ['data', 'rule', 'comparison', 'structure', 'template', 'background', 'other'],
      },
    },
    required: ['input', 'relation'],
    additionalProperties: false,
  },
} as const;

/**
 * 成果采用声明（知识契约 §6.1）：只作用于当前 Run 的最终 Markdown，
 * 最后一次成功声明替换前一次；归属校验全部由宿主完成。
 */
export const createArtifactDeclareSourcesTool = (declare: ArtifactSourceDeclarator): AgentTool => ({
  name: 'artifact_declare_sources',
  description:
    'Declare which sources this run actually adopted for the artifact it is producing. Only sources you read (or exact knowledge evidence you searched) may be declared; declaring a whole document requires having read it. The last successful declaration in the run wins; pass an empty list to clear.',
  inputSchema: {
    type: 'object',
    properties: { inputRelations: RELATION_JSON_SCHEMA },
    required: ['inputRelations'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const modelInput = modelInputSchema.parse(rawInput);
    const parsed = declareArtifactSourcesRequestSchema.parse({
      runId: context.runId,
      inputRelations: modelInput.inputRelations,
    });
    if (context.signal.aborted) throw abortError();
    context.reportProgress(
      parsed.inputRelations.length > 0
        ? `正在声明采用来源：${parsed.inputRelations.length} 项`
        : '正在清除采用来源声明',
    );
    await declare(parsed.inputRelations, context);
    if (context.signal.aborted) throw abortError();
    return {
      declaredCount: parsed.inputRelations.length,
      message:
        parsed.inputRelations.length > 0
          ? `已记录 ${parsed.inputRelations.length} 项采用来源。`
          : '已清除采用来源声明。',
    } satisfies ArtifactDeclareSourcesOutput;
  },
});
