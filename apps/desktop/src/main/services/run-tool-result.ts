import { materialReferenceSchema } from '@betterwork/agent-protocol';
import { z } from 'zod';

const readTextFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  scope: z.literal('run-work-file').optional(),
  material: materialReferenceSchema.optional(),
  format: z.string().optional(),
  contentHash: z.string().optional(),
  truncated: z.boolean().optional(),
  sections: z.array(z.object({ locator: z.string(), content: z.string() })).optional(),
});

const readArtifactResultSchema = z.object({
  artifactId: z.string(),
  versionId: z.string(),
  contentHash: z.string(),
  content: z.string(),
});

const readOfficeMaterialResultSchema = z.object({
  material: materialReferenceSchema,
  format: z.enum(['pptx', 'xlsx', 'csv']),
  sections: z.array(
    z
      .object({ locator: z.string(), content: z.unknown() })
      .refine((section) => 'content' in section, {
        path: ['content'],
      }),
  ),
  contentHash: z.string(),
});

const knowledgeSearchResultSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      sourcePath: z.string(),
      locator: z.string(),
      excerpt: z.string(),
      contentHash: z.string(),
      evidenceId: z.string().optional(),
    }),
  ),
});

const knowledgeReadResultSchema = z.object({
  parts: z.array(z.object({ evidenceId: z.string(), text: z.string() })),
});

const webSearchResultSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      site: z.string().optional(),
    }),
  ),
});

const webFetchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  contentType: z.string(),
  status: z.number(),
});

const taskFileWriteResultSchema = z.object({ path: z.string(), contentHash: z.string() });

// 不改变确定性工具的数值语义（极值算术可能产生非有限结果）；序列化仍使用原结果。
const metricNumberSchema = z.custom<number>((value) => typeof value === 'number');
const businessMetricsResultSchema = z.object({
  period: z.string(),
  metrics: z.array(
    z.object({
      metric: z.string(),
      current: metricNumberSchema,
      previous: metricNumberSchema.optional(),
      budget: metricNumberSchema.optional(),
      change: metricNumberSchema.optional(),
      changeRate: metricNumberSchema.optional(),
      budgetVariance: metricNumberSchema.optional(),
      budgetVarianceRate: metricNumberSchema.optional(),
      warnings: z.array(z.string()),
    }),
  ),
  message: z.string(),
});

export type RunToolResult =
  | { kind: 'read_text_file'; output: z.infer<typeof readTextFileResultSchema> }
  | { kind: 'read_artifact'; output: z.infer<typeof readArtifactResultSchema> }
  | { kind: 'read_office_material'; output: z.infer<typeof readOfficeMaterialResultSchema> }
  | { kind: 'knowledge_search'; output: z.infer<typeof knowledgeSearchResultSchema> }
  | { kind: 'read_knowledge'; output: z.infer<typeof knowledgeReadResultSchema> }
  | { kind: 'web_search'; output: z.infer<typeof webSearchResultSchema> }
  | { kind: 'web_fetch'; output: z.infer<typeof webFetchResultSchema> }
  | { kind: 'task_write_file'; output: z.infer<typeof taskFileWriteResultSchema> }
  | { kind: 'analyze_business_metrics'; output: unknown }
  | { kind: 'mcp'; toolName: string; output: unknown }
  | { kind: 'no-additional-effects' };

const checkedOutput = <T>(schema: z.ZodType<T>, toolName: string, output: unknown): T => {
  const result = schema.safeParse(output);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'output'))];
  throw new Error(`工具结果契约错误：${toolName}；字段 ${fields.join('、')}`);
};

/** 宿主消费契约只解析一次；原始 tool.completed / Provider 消息不被改写。 */
export const parseRunToolResult = (
  toolName: string | undefined,
  output: unknown,
): RunToolResult => {
  switch (toolName) {
    case 'read_text_file':
      return { kind: toolName, output: checkedOutput(readTextFileResultSchema, toolName, output) };
    case 'read_artifact':
      return { kind: toolName, output: checkedOutput(readArtifactResultSchema, toolName, output) };
    case 'read_office_material':
      return {
        kind: toolName,
        output: checkedOutput(readOfficeMaterialResultSchema, toolName, output),
      };
    case 'knowledge_search':
      return {
        kind: toolName,
        output: checkedOutput(knowledgeSearchResultSchema, toolName, output),
      };
    case 'read_knowledge':
      return { kind: toolName, output: checkedOutput(knowledgeReadResultSchema, toolName, output) };
    case 'web_search':
      return { kind: toolName, output: checkedOutput(webSearchResultSchema, toolName, output) };
    case 'web_fetch':
      return { kind: toolName, output: checkedOutput(webFetchResultSchema, toolName, output) };
    case 'task_write_file':
      return { kind: toolName, output: checkedOutput(taskFileWriteResultSchema, toolName, output) };
    case 'analyze_business_metrics':
      checkedOutput(businessMetricsResultSchema, toolName, output);
      return { kind: toolName, output };
    case 'calculator':
    case 'skill_execute':
    case 'skill_read_resource':
    case 'artifact_register_file':
    case 'artifact_declare_sources':
      return { kind: 'no-additional-effects' };
    default:
      if (toolName?.startsWith('mcp_')) return { kind: 'mcp', toolName, output };
      throw new Error(`工具结果契约错误：${toolName ?? '缺失工具名'}；没有对应的结果适配`);
  }
};
