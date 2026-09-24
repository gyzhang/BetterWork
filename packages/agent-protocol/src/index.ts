import { z } from 'zod';

export const messageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

const eventBaseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});

export const agentRuntimeEventSchema = z.discriminatedUnion('type', [
  eventBaseSchema.extend({
    type: z.literal('run.started'),
    taskId: z.string(),
    sessionId: z.string(),
  }),
  eventBaseSchema.extend({ type: z.literal('message.started'), messageId: z.string() }),
  eventBaseSchema.extend({
    type: z.literal('message.delta'),
    messageId: z.string(),
    delta: z.string(),
  }),
  eventBaseSchema.extend({
    type: z.literal('message.completed'),
    messageId: z.string(),
    content: z.string(),
  }),
  eventBaseSchema.extend({ type: z.literal('reasoning.delta'), delta: z.string() }),
  eventBaseSchema.extend({ type: z.literal('tool.requested'), toolCall: toolCallSchema }),
  eventBaseSchema.extend({ type: z.literal('tool.started'), toolCall: toolCallSchema }),
  eventBaseSchema.extend({
    type: z.literal('tool.progress'),
    toolCallId: z.string(),
    message: z.string(),
  }),
  eventBaseSchema.extend({
    type: z.literal('tool.completed'),
    toolCallId: z.string(),
    output: z.unknown(),
  }),
  eventBaseSchema.extend({
    type: z.literal('tool.failed'),
    toolCallId: z.string(),
    error: z.string(),
  }),
  eventBaseSchema.extend({ type: z.literal('run.completed'), finalContent: z.string() }),
  eventBaseSchema.extend({ type: z.literal('run.failed'), error: z.string() }),
  eventBaseSchema.extend({ type: z.literal('run.cancelled'), reason: z.string().optional() }),
]);
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
type WithoutEventEnvelope<T> = T extends unknown
  ? Omit<T, 'id' | 'runId' | 'sequence' | 'createdAt'>
  : never;
export type AgentRuntimeEventInput = WithoutEventEnvelope<AgentRuntimeEvent>;

export const skillBindingSchema = z
  .object({
    skillId: z.string().min(1),
    revisionId: z.string().min(1).optional(),
  })
  .strict();
export type SkillBinding = z.infer<typeof skillBindingSchema>;

/**
 * 一次 Run 可绑定的 Skill 上限（ADR-0012 决策 3）。
 * 取值受两个约束：Skill 指令注入共用 `SKILL_INSTRUCTION_BUDGET`，
 * 以及 Composer chip 条的可读性；不是技术极限。
 */
export const MAX_RUN_SKILL_BINDINGS = 6;

/**
 * 一次 Run 的能力绑定集合。顺序即指令注入顺序，同一 skillId 不得重复——
 * 重复会让同一份指令注入两次，且绑定快照无法去重回溯（ADR-0012 决策 3）。
 */
const runSkillBindingsSchema = z
  .array(skillBindingSchema)
  .min(1)
  .max(MAX_RUN_SKILL_BINDINGS)
  .refine(
    (bindings) => new Set(bindings.map((binding) => binding.skillId)).size === bindings.length,
    {
      message: 'skillBindings 中存在重复的 skillId',
    },
  );

export const startRunRequestSchema = z
  .object({
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
    prompt: z.string().trim().min(1),
    /** 缺失表示本次 Run 不携带任何 Skill——不延续同 Task 的历史绑定。 */
    skillBindings: runSkillBindingsSchema.optional(),
    /** E12 起可显式提交 TaskContextRevision；缺失保持旧通用助手路径。 */
    taskContextRevisionId: z.string().min(1).optional(),
    expectedTaskContextRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.taskContextRevisionId && input.expectedTaskContextRevision === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedTaskContextRevision'],
        message: '提交 TaskContextRevision 时必须带 expectedTaskContextRevision',
      });
    }
  });
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export const skillSourceKindSchema = z.enum(['builtin', 'user']);
export type SkillSourceKind = z.infer<typeof skillSourceKindSchema>;

export const skillTrustStatusSchema = z.enum(['untrusted', 'trusted', 'needs-review', 'revoked']);
export type SkillTrustStatus = z.infer<typeof skillTrustStatusSchema>;

export const skillEnvironmentStatusSchema = z.enum([
  'unprepared',
  'preparing',
  'ready',
  'failed',
  'cancelled',
  'invalid',
]);
export type SkillEnvironmentStatus = z.infer<typeof skillEnvironmentStatusSchema>;

export const skillBlockedReasonSchema = z.enum([
  'disabled',
  'untrusted',
  'trust-needs-review',
  'trust-revoked',
  'environment-unprepared',
  'environment-preparing',
  'environment-failed',
  'environment-cancelled',
  'environment-invalid',
  'missing-runtime-profile',
]);
export type SkillBlockedReason = z.infer<typeof skillBlockedReasonSchema>;

const skillIdSchema = z.string().min(1);
const skillRevisionIdSchema = z.string().min(1);

export const skillRevisionSummarySchema = z
  .object({
    id: skillRevisionIdSchema,
    skillId: skillIdSchema,
    contentHash: z.string().min(1),
    originalVersion: z.string().min(1).optional(),
    resourceKey: z.string().min(1),
    frontmatter: z.record(z.string(), z.unknown()),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type SkillRevisionSummary = z.infer<typeof skillRevisionSummarySchema>;

export const runtimeProfileCommandSchema = z
  .object({
    commandId: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(160),
    executableKey: z.string().trim().min(1).max(160),
    argumentSchema: z.record(z.string(), z.unknown()),
    timeoutMs: z.number().int().positive().max(1_800_000),
    expectedOutputs: z.array(z.string().trim().min(1)).max(100),
    validatorId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export type RuntimeProfileCommand = z.infer<typeof runtimeProfileCommandSchema>;

export const runtimeProfileDraftSchema = z
  .object({
    commands: z.array(runtimeProfileCommandSchema).max(100),
    environmentRequirements: z.array(z.string().trim().min(1).max(200)).max(100),
    outputContract: z
      .object({
        reportPath: z.string().trim().min(1).optional(),
        outputPaths: z.array(z.string().trim().min(1)).max(100),
      })
      .strict(),
  })
  .strict();
export type RuntimeProfileDraft = z.infer<typeof runtimeProfileDraftSchema>;

export const runtimeProfileRevisionSchema = z
  .object({
    id: z.string().min(1),
    skillId: skillIdSchema,
    profileHash: z.string().min(1),
    profile: runtimeProfileDraftSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type RuntimeProfileRevision = z.infer<typeof runtimeProfileRevisionSchema>;

export const skillSummarySchema = z
  .object({
    id: skillIdSchema,
    name: z.string().min(1),
    description: z.string(),
    sourceKind: skillSourceKindSchema,
    enabled: z.boolean(),
    currentRevisionId: skillRevisionIdSchema,
    trustStatus: skillTrustStatusSchema,
    environmentStatus: skillEnvironmentStatusSchema,
    blockedReasons: z.array(skillBlockedReasonSchema),
  })
  .strict();
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export const skillDetailSchema = skillSummarySchema
  .extend({
    revision: skillRevisionSummarySchema,
    runtimeProfile: runtimeProfileRevisionSchema.optional(),
  })
  .strict();
export type SkillDetail = z.infer<typeof skillDetailSchema>;

export const expertSourceKindSchema = z.enum(['builtin', 'user']);
export type ExpertSourceKind = z.infer<typeof expertSourceKindSchema>;

export const expertLifecycleSchema = z.enum(['active', 'disabled', 'archived']);
export type ExpertLifecycle = z.infer<typeof expertLifecycleSchema>;

export const expertBlockedReasonSchema = z.enum([
  'missing-skill',
  'skill-blocked',
  'missing-model',
  'model-disabled',
  'invalid-tool',
  'mcp-unavailable',
]);
export type ExpertBlockedReason = z.infer<typeof expertBlockedReasonSchema>;

export const materialPurposeSchema = z.enum([
  'rule',
  'current-input',
  'historical-comparison',
  'structure-reference',
  'template',
  'background',
  'other',
]);
export type MaterialPurpose = z.infer<typeof materialPurposeSchema>;

export const knowledgeMaterialReferenceSchema = z
  .object({
    kind: z.literal('knowledge-revision'),
    knowledgeDocumentId: z.string().min(1),
    knowledgeRevisionId: z.string().min(1),
    contentHash: z.string().min(1),
    sourcePath: z.string().min(1),
    originWorkspaceId: z.string().min(1).optional(),
  })
  .strict();
export type KnowledgeMaterialReference = z.infer<typeof knowledgeMaterialReferenceSchema>;

/** 修订完整身份（不含 originWorkspaceId）：材料、足迹与声明共用同一比较口径。 */
export function sameKnowledgeReference(
  left: KnowledgeMaterialReference,
  right: KnowledgeMaterialReference,
): boolean {
  return (
    left.knowledgeDocumentId === right.knowledgeDocumentId &&
    left.knowledgeRevisionId === right.knowledgeRevisionId &&
    left.contentHash === right.contentHash &&
    left.sourcePath === right.sourcePath
  );
}
const artifactMaterialReferenceSchema = z
  .object({
    kind: z.literal('artifact-version'),
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1),
    contentHash: z.string().min(1),
    originWorkspaceId: z.string().min(1),
  })
  .strict();
const inputSnapshotMaterialReferenceSchema = z
  .object({
    kind: z.literal('workspace-input-snapshot'),
    snapshotId: z.string().min(1),
    workspaceId: z.string().min(1),
    contentHash: z.string().min(1),
    format: z.string().min(1),
    fileKey: z.string().min(1),
    /** 原始文件路径；由后端读取时填充，写入时可不传。 */
    sourcePath: z.string().min(1).optional(),
  })
  .strict();
export const materialReferenceSchema = z.discriminatedUnion('kind', [
  knowledgeMaterialReferenceSchema,
  artifactMaterialReferenceSchema,
  inputSnapshotMaterialReferenceSchema,
]);
export type MaterialReference = z.infer<typeof materialReferenceSchema>;

/** section 内容上的码点半开区间 [start, end)，见知识契约 §2.3。 */
export const knowledgeSpanSchema = z
  .object({
    sectionOrdinal: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict();
export type KnowledgeSpan = z.infer<typeof knowledgeSpanSchema>;

/** 仅定位已保存文本，不是授权 token；服务必须独立验证修订与调用域（契约 §3.1）。 */
export const knowledgeCursorSchema = z
  .object({
    revisionId: z.string().min(1),
    textHash: z.string().min(1),
    sectionOrdinal: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export type KnowledgeCursor = z.infer<typeof knowledgeCursorSchema>;

/** 知识 Evidence 的精确来源（契约 §5.1）：固定修订 + 实际返回范围 + 访问类型。 */
export const knowledgeEvidenceSourceSchema = z
  .object({
    reference: knowledgeMaterialReferenceSchema,
    textHash: z.string().min(1),
    span: knowledgeSpanSchema,
    operation: z.enum(['search', 'read']),
  })
  .strict();
export type KnowledgeEvidenceSource = z.infer<typeof knowledgeEvidenceSourceSchema>;

export const expertReferenceMaterialSchema = z
  .object({
    reference: materialReferenceSchema,
    purpose: materialPurposeSchema,
    note: z.string().trim().max(1_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.reference.kind === 'workspace-input-snapshot') {
      context.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Expert 常用参考只能保存 Knowledge 修订或成果版本。',
      });
    }
  })
  .strict();
export type ExpertReferenceMaterial = z.infer<typeof expertReferenceMaterialSchema>;

export const expertSkillPresetSchema = z
  .array(z.object({ skillId: skillIdSchema, revisionId: skillRevisionIdSchema }).strict())
  .max(MAX_RUN_SKILL_BINDINGS)
  .refine(
    (bindings) => new Set(bindings.map((binding) => binding.skillId)).size === bindings.length,
    {
      message: 'skillPreset 中存在重复的 skillId',
    },
  );
export type ExpertSkillPreset = z.infer<typeof expertSkillPresetSchema>[number];

export const builtinToolPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('application-defaults') }).strict(),
  z
    .object({
      mode: z.literal('allow-list'),
      toolNames: z.array(z.string().trim().min(1).max(100)).max(50),
    })
    .strict(),
]);
export type BuiltinToolPolicy = z.infer<typeof builtinToolPolicySchema>;

export const expertModelReferenceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('application-default') }).strict(),
  z.object({ mode: z.literal('profile'), modelProfileId: z.string().min(1) }).strict(),
]);
export type ExpertModelReference = z.infer<typeof expertModelReferenceSchema>;

export const mcpToolBindingSchema = z
  .object({ connectionId: z.string().min(1), toolId: z.string().min(1) })
  .strict();
export type McpToolBinding = z.infer<typeof mcpToolBindingSchema>;

export const expertRevisionDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(2_000),
    avatarKey: z.string().trim().min(1).max(160).optional(),
    identity: z.string().trim().min(1).max(20_000),
    principles: z.array(z.string().trim().min(1).max(2_000)).max(100),
    inputRequirements: z.array(z.string().trim().min(1).max(2_000)).max(100),
    deliveryRequirements: z.array(z.string().trim().min(1).max(2_000)).max(100),
    skillPreset: expertSkillPresetSchema,
    builtinToolPolicy: builtinToolPolicySchema,
    modelReference: expertModelReferenceSchema,
    mcpToolBindings: z.array(mcpToolBindingSchema).max(50).optional(),
    referenceMaterials: z.array(expertReferenceMaterialSchema).max(50).optional(),
  })
  .strict();
export type ExpertRevisionDraft = z.infer<typeof expertRevisionDraftSchema>;

export const expertRevisionSchema = expertRevisionDraftSchema
  .extend({
    id: z.string().min(1),
    expertId: z.string().min(1),
    revision: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type ExpertRevision = z.infer<typeof expertRevisionSchema>;

export const expertSummarySchema = z
  .object({
    id: z.string().min(1),
    sourceKind: expertSourceKindSchema,
    lifecycle: expertLifecycleSchema,
    name: z.string(),
    summary: z.string(),
    currentRevision: z.number().int().positive(),
    blockedReasons: z.array(expertBlockedReasonSchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ExpertSummary = z.infer<typeof expertSummarySchema>;

export const expertDetailSchema = expertSummarySchema
  .extend({
    revision: expertRevisionSchema,
  })
  .strict();
export type ExpertDetail = z.infer<typeof expertDetailSchema>;

export const listExpertsRequestSchema = z
  .object({ includeArchived: z.boolean().optional().default(false) })
  .strict();
export type ListExpertsRequest = z.infer<typeof listExpertsRequestSchema>;

export const getExpertRequestSchema = z.object({ id: z.string().min(1) }).strict();
export type GetExpertRequest = z.infer<typeof getExpertRequestSchema>;

export const createExpertRequestSchema = expertRevisionDraftSchema;
export type CreateExpertRequest = z.infer<typeof createExpertRequestSchema>;

export const saveExpertRevisionRequestSchema = z
  .object({
    expertId: z.string().min(1),
    expectedRevision: z.number().int().positive(),
    revision: expertRevisionDraftSchema,
  })
  .strict();
export type SaveExpertRevisionRequest = z.infer<typeof saveExpertRevisionRequestSchema>;

export const copyExpertRequestSchema = z
  .object({ expertId: z.string().min(1), name: z.string().trim().min(1).max(160).optional() })
  .strict();
export type CopyExpertRequest = z.infer<typeof copyExpertRequestSchema>;

export const setExpertLifecycleRequestSchema = z
  .object({
    expertId: z.string().min(1),
    lifecycle: expertLifecycleSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type SetExpertLifecycleRequest = z.infer<typeof setExpertLifecycleRequestSchema>;

export const expertMutationResultSchema = z.object({ expert: expertDetailSchema }).strict();
export type ExpertMutationResult = z.infer<typeof expertMutationResultSchema>;

export const taskContextExecutorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general') }).strict(),
  z
    .object({
      kind: z.literal('expert'),
      expertId: z.string().min(1),
      expertRevisionId: z.string().min(1),
    })
    .strict(),
]);
export type TaskContextExecutor = z.infer<typeof taskContextExecutorSchema>;

export const taskContextSkillBindingSchema = z
  .object({
    skillId: z.string().min(1),
    revisionId: z.string().min(1),
    source: z.enum(['expert-preset', 'task-selection']),
  })
  .strict();
export type TaskContextSkillBinding = z.infer<typeof taskContextSkillBindingSchema>;

export const taskMaterialSelectionSchema = z
  .object({
    reference: materialReferenceSchema,
    purpose: materialPurposeSchema,
    note: z.string().trim().max(1_000).optional(),
    addedFrom: z.enum(['workspace-candidate', 'global-search', 'expert-reference', 'user-input']),
  })
  .strict();
export type TaskMaterialSelection = z.infer<typeof taskMaterialSelectionSchema>;

export const materialCandidateSchema = z
  .object({
    reference: materialReferenceSchema,
    title: z.string().min(1),
    sourceLabel: z.string().min(1),
    status: z.enum(['ready', 'unavailable']),
    detail: z.string().optional(),
  })
  .strict();
export type MaterialCandidate = z.infer<typeof materialCandidateSchema>;

export const runMaterialReadOperationSchema = z.enum(['preview', 'search', 'read', 'parse']);
export type RunMaterialReadOperation = z.infer<typeof runMaterialReadOperationSchema>;
export const runMaterialReadSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    material: materialReferenceSchema,
    operation: runMaterialReadOperationSchema,
    locator: z.string().min(1).optional(),
    contentHash: z.string().min(1),
    excerptHash: z.string().min(1).optional(),
    capturedAt: z.number().int().nonnegative(),
    // 知识契约 §5.1：新知识足迹要求这组字段全部存在；旧行保留原形状。
    toolCallId: z.string().min(1).optional(),
    knowledgePartIndex: z.number().int().nonnegative().optional(),
    knowledgeSpan: knowledgeSpanSchema.optional(),
    textHash: z.string().min(1).optional(),
    evidenceId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((read, context) => {
    const group = [
      read.toolCallId,
      read.knowledgePartIndex,
      read.knowledgeSpan,
      read.textHash,
      read.evidenceId,
    ];
    const present = group.filter((value) => value !== undefined).length;
    if (present > 0 && present < group.length) {
      context.addIssue({
        code: 'custom',
        message: 'Knowledge footprint fields must all be present together',
      });
    }
    if (present === group.length && read.operation !== 'search' && read.operation !== 'read') {
      context.addIssue({
        code: 'custom',
        message: 'Knowledge footprints only record search or read operations',
      });
    }
  });
export type RunMaterialRead = z.infer<typeof runMaterialReadSchema>;

/** §5.1：正文、摘录与预算都按 Unicode code point 计数；Zod 的 max() 数的是 UTF-16 单元。 */
export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export const MEMORY_CONTENT_MAX_CODE_POINTS = 2_000;
export const MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS = 500;
export const MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS = 500;
export const MEMORY_TOPIC_KEY_MAX_CODE_POINTS = 80;
export const MEMORY_APPLICABILITY_NOTE_MIN_CODE_POINTS = 1;
export const MEMORY_APPLICABILITY_NOTE_MAX_CODE_POINTS = 300;
export const MEMORY_REFERENCE_LABEL_MAX_CODE_POINTS = 120;
export const MEMORY_SOURCE_MAX = 3;
export const MEMORY_MATERIAL_DEPENDENCY_MAX = 200;
export const MEMORY_MEMORY_DEPENDENCY_MAX = 100;
export const MEMORY_COMMITTED_REVISION_MAX = 20;
export const LIST_PAGE_DEFAULT_LIMIT = 50;
export const LIST_PAGE_MAX_LIMIT = 100;

/** contentHash、normalizedHash、excerptHash 等摘要字段的统一形状；散列由 Main 计算。 */
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const memoryOperationIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    'operationId 必须是 UUID',
  );

function boundedTextSchema(label: string, min: number, max: number, trim: boolean) {
  const base = trim ? z.string().trim() : z.string();
  return base.superRefine((value, context) => {
    const codePoints = countCodePoints(value);
    if (codePoints >= min && codePoints <= max) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label}长度必须为 ${min}–${max} 个字符，当前 ${codePoints} 个`,
    });
  });
}

function trimmedTextSchema(label: string, min: number, max: number) {
  return boundedTextSchema(label, min, max, true);
}

/** 摘录与片段是原文的切片：不能修剪，否则切片与 start/end 区间不再对应。 */
function exactTextSchema(label: string, min: number, max: number) {
  return boundedTextSchema(label, min, max, false);
}

function compareStableKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stringifyStableValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return `[${items.map((item) => stringifyStableValue(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && typeof item !== 'function')
      .sort(([left], [right]) => compareStableKeys(left, right));
    const body = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stringifyStableValue(item)}`)
      .join(',');
    return `{${body}}`;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  return 'null';
}

/** §5.1：对象键排序、语义有序数组保留顺序；请求哈希与幂等判定只能用它。 */
export function stableStringifyJson(value: unknown): string {
  return stringifyStableValue(value);
}

/** §5.1：日期 patch 只有 set 与 clear 两种互斥动作，省略表示保留；不用 undefined 猜清空。 */
export const datePatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), value: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
]);
export type DatePatch = z.infer<typeof datePatchSchema>;

export const topicKeyPatchSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set'),
      value: trimmedTextSchema('议题标识', 1, MEMORY_TOPIC_KEY_MAX_CODE_POINTS),
    })
    .strict(),
  z.object({ action: z.literal('clear') }).strict(),
]);
export type TopicKeyPatch = z.infer<typeof topicKeyPatchSchema>;

/** §9.1：游标是 updatedAt＋id 的版本化结构，不是任意 SQL 游标。 */
export const listCursorSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.number().int().nonnegative(),
    id: z.string().min(1),
  })
  .strict();
export type ListCursor = z.infer<typeof listCursorSchema>;

export interface ListPage<TItem> {
  items: TItem[];
  nextCursor?: ListCursor | undefined;
}

function buildListPageSchema<TSchema extends z.ZodType>(itemSchema: TSchema) {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: listCursorSchema.optional(),
    })
    .strict();
}

/** §9.1：ListPage 的 items 顺序由对应通道定义，游标只定位边界。 */
export function listPageSchema<TSchema extends z.ZodType>(
  itemSchema: TSchema,
): ReturnType<typeof buildListPageSchema<TSchema>> {
  return buildListPageSchema(itemSchema);
}

export const memoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('expert'), expertId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('expert-workspace'),
      expertId: z.string().min(1),
      workspaceId: z.string().min(1),
    })
    .strict(),
]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export const memoryKindSchema = z.enum(['semantic', 'episodic', 'procedural', 'preference']);
export type MemoryKind = z.infer<typeof memoryKindSchema>;
export const memorySourceTypeSchema = z.enum([
  'user-explicit',
  'conversation',
  'artifact',
  'reflection',
]);
export type MemorySourceType = z.infer<typeof memorySourceTypeSchema>;
export const memoryStatusSchema = z.enum([
  'candidate',
  'confirmed',
  'superseded',
  'expired',
  'deleted',
]);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
/** §5.2：candidateDisposition 只存在于 candidate 记录；rejected 可恢复为 pending 或删除。 */
export const memoryCandidateDispositionSchema = z.enum(['pending', 'rejected']);
export type MemoryCandidateDisposition = z.infer<typeof memoryCandidateDispositionSchema>;
export const memoryProvenanceStateSchema = z.enum(['known', 'legacy_unknown']);
export type MemoryProvenanceState = z.infer<typeof memoryProvenanceStateSchema>;
/** §5.2：细分类由用户选择，kind 由宿主按本表推导，客户端不提交两者组合。 */
export const memoryFacetSchema = z.enum([
  'goal',
  'constraint',
  'decision',
  'fact',
  'method',
  'preference',
  'experience',
]);
export type MemoryFacet = z.infer<typeof memoryFacetSchema>;
export const facetToKind = {
  goal: 'semantic',
  constraint: 'semantic',
  decision: 'semantic',
  fact: 'semantic',
  method: 'procedural',
  preference: 'preference',
  experience: 'episodic',
} as const satisfies Record<MemoryFacet, MemoryKind>;

/** §5.3：讨论节点来源只锚定人工字段内容，节点被替代不伪造内容变化，不取 status/updatedAt。 */
export const memoryCheckpointFieldSchema = z.enum(['feedback', 'summary']);
export type MemoryCheckpointField = z.infer<typeof memoryCheckpointFieldSchema>;

const memorySourceExcerptFields = {
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  excerpt: exactTextSchema('来源摘录', 1, MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS),
  excerptHash: sha256HexSchema,
  locator: z.string().min(1).max(2_000).optional(),
};
const manualMemorySourceSchema = z
  .object({
    kind: z.literal('manual'),
    operationId: memoryOperationIdSchema,
    contentHash: sha256HexSchema,
    ...memorySourceExcerptFields,
  })
  .strict();
const runUserMemorySourceSchema = z
  .object({
    kind: z.literal('run-user'),
    runId: z.string().min(1),
    promptHash: sha256HexSchema,
    ...memorySourceExcerptFields,
  })
  .strict();
const runAssistantMemorySourceSchema = z
  .object({
    kind: z.literal('run-assistant'),
    runId: z.string().min(1),
    eventId: z.string().min(1),
    contentHash: sha256HexSchema,
    ...memorySourceExcerptFields,
  })
  .strict();
const checkpointMemorySourceSchema = z
  .object({
    kind: z.literal('checkpoint'),
    checkpointId: z.string().min(1),
    field: memoryCheckpointFieldSchema,
    contentHash: sha256HexSchema,
    ...memorySourceExcerptFields,
  })
  .strict();
const artifactVersionMemorySourceSchema = z
  .object({
    kind: z.literal('artifact-version'),
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1),
    contentHash: sha256HexSchema,
    ...memorySourceExcerptFields,
  })
  .strict();
/** §5.3：SourceRef 只由 Main 读已登记实体后生成；Renderer 提交的是 memorySourceSelectorSchema。 */
export const memorySourceRefSchema = z
  .discriminatedUnion('kind', [
    manualMemorySourceSchema,
    runUserMemorySourceSchema,
    runAssistantMemorySourceSchema,
    checkpointMemorySourceSchema,
    artifactVersionMemorySourceSchema,
  ])
  .superRefine((source, context) => {
    if (source.end < source.start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: '摘录区间为左闭右开，end 不得小于 start',
      });
      return;
    }
    if (countCodePoints(source.excerpt) !== source.end - source.start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['excerpt'],
        message: '摘录字符数必须与 start/end 区间一致',
      });
    }
  });
export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;

/** §5.3：依赖记忆按精确修订与哈希检查，不按稳定 id。 */
export const memoryDependencySchema = z
  .object({
    memoryId: z.string().min(1),
    revisionId: z.string().min(1),
    contentHash: sha256HexSchema,
  })
  .strict();
export type MemoryDependency = z.infer<typeof memoryDependencySchema>;

const legacyMemoryProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    verification: z.literal('legacy-unverified'),
    sourceType: memorySourceTypeSchema,
    sourceId: z.string().min(1).optional(),
    sourceLocator: z.string().min(1).optional(),
  })
  .strict();
const verifiedMemoryProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    verification: z.literal('verified'),
    authority: z.enum(['user-instruction', 'derived']),
    capturedAt: z.number().int().nonnegative(),
    sources: z.array(memorySourceRefSchema).min(1).max(MEMORY_SOURCE_MAX),
    materialDependencies: z.array(materialReferenceSchema).max(MEMORY_MATERIAL_DEPENDENCY_MAX),
    memoryDependencies: z.array(memoryDependencySchema).max(MEMORY_MEMORY_DEPENDENCY_MAX),
    originWorkspaceId: z.string().min(1).optional(),
    genericDeclaration: z.boolean().optional(),
  })
  .strict();
/** §5.3：scope 与 authority 的组合规则由 Main 判定并回领域错误，不在协议里猜测。 */
export const memoryProvenanceSchema = z.discriminatedUnion('verification', [
  legacyMemoryProvenanceSchema,
  verifiedMemoryProvenanceSchema,
]);
export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;

export const memoryRecordSchema = z
  .object({
    id: z.string().min(1),
    revisionId: z.string().min(1),
    revision: z.number().int().positive(),
    scope: memoryScopeSchema,
    kind: memoryKindSchema,
    content: trimmedTextSchema('记忆正文', 1, MEMORY_CONTENT_MAX_CODE_POINTS),
    sourceType: memorySourceTypeSchema,
    sourceId: z.string().min(1).optional(),
    sourceLocator: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    status: memoryStatusSchema,
    validFrom: z.number().int().nonnegative().optional(),
    validUntil: z.number().int().nonnegative().optional(),
    supersedesId: z.string().min(1).optional(),
    contentHash: sha256HexSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    facet: memoryFacetSchema,
    topicKey: trimmedTextSchema('议题标识', 1, MEMORY_TOPIC_KEY_MAX_CODE_POINTS).optional(),
    normalizedHash: sha256HexSchema,
    provenance: memoryProvenanceSchema,
    candidateDisposition: memoryCandidateDispositionSchema.optional(),
    replacesRevisionId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.validUntil !== undefined &&
      value.validFrom !== undefined &&
      value.validUntil <= value.validFrom
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validUntil 必须晚于 validFrom',
        path: ['validUntil'],
      });
    }
    if (value.kind !== facetToKind[value.facet]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kind 必须由 facet 推导，不接受矛盾组合',
        path: ['kind'],
      });
    }
    if (value.status !== 'candidate' && value.candidateDisposition !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'candidateDisposition 只存在于 candidate 记录',
        path: ['candidateDisposition'],
      });
    }
  });
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

/** §5.5：议题相同的潜在冲突只并列呈现，不认定真假。 */
export const memoryConflictDecisionSchema = z.enum(['keep-both', 'replace']);
export type MemoryConflictDecision = z.infer<typeof memoryConflictDecisionSchema>;
export const memoryConflictStateSchema = z.enum(['unresolved', 'keep-both', 'replaced']);
export type MemoryConflictState = z.infer<typeof memoryConflictStateSchema>;
export const memoryConflictPairSchema = z
  .object({
    leftRevisionId: z.string().min(1),
    rightRevisionId: z.string().min(1),
    state: memoryConflictStateSchema,
  })
  .strict();
export type MemoryConflictPair = z.infer<typeof memoryConflictPairSchema>;

export const memoryConflictDecisionRecordSchema = z
  .object({
    id: z.string().min(1),
    operationId: memoryOperationIdSchema,
    leftRevisionId: z.string().min(1),
    rightRevisionId: z.string().min(1),
    decision: memoryConflictDecisionSchema,
    winnerRevisionId: z.string().min(1).optional(),
    applicabilityNote: trimmedTextSchema(
      '适用条件说明',
      MEMORY_APPLICABILITY_NOTE_MIN_CODE_POINTS,
      MEMORY_APPLICABILITY_NOTE_MAX_CODE_POINTS,
    ).optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === 'replace' && value.winnerRevisionId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['winnerRevisionId'],
        message: 'replace 必须指明胜出的精确修订',
      });
    }
    if (value.decision === 'keep-both' && value.applicabilityNote === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicabilityNote'],
        message: 'keep-both 必须写明适用条件',
      });
    }
  });
export type MemoryConflictDecisionRecord = z.infer<typeof memoryConflictDecisionRecordSchema>;

export const memoryGovernanceActionSchema = z.enum([
  'confirm',
  'reject',
  'restore-candidate',
  'expire',
  'delete',
  'reconfirm',
]);
export type MemoryGovernanceAction = z.infer<typeof memoryGovernanceActionSchema>;

export interface MemoryGovernanceTransition {
  readonly fromStatuses: readonly MemoryStatus[];
  readonly toStatus: MemoryStatus;
  readonly fromCandidateDispositions?: readonly MemoryCandidateDisposition[];
  readonly toCandidateDisposition?: MemoryCandidateDisposition;
  readonly requiresConfirmPatch?: boolean;
}

/** §5.4：转移表是唯一判据；deleted/superseded 是终态，不接受编辑、确认、续期或恢复。 */
export const memoryGovernanceTransitions = {
  confirm: {
    fromStatuses: ['candidate'],
    fromCandidateDispositions: ['pending'],
    toStatus: 'confirmed',
  },
  reject: {
    fromStatuses: ['candidate'],
    fromCandidateDispositions: ['pending'],
    toStatus: 'candidate',
    toCandidateDisposition: 'rejected',
  },
  'restore-candidate': {
    fromStatuses: ['candidate'],
    fromCandidateDispositions: ['rejected'],
    toStatus: 'candidate',
    toCandidateDisposition: 'pending',
  },
  expire: { fromStatuses: ['confirmed'], toStatus: 'expired' },
  reconfirm: {
    fromStatuses: ['expired'],
    toStatus: 'confirmed',
    requiresConfirmPatch: true,
  },
  delete: { fromStatuses: ['candidate', 'confirmed', 'expired'], toStatus: 'deleted' },
} as const satisfies Record<MemoryGovernanceAction, MemoryGovernanceTransition>;

export const terminalMemoryStatuses: readonly MemoryStatus[] = ['deleted', 'superseded'];

/** §9.1：编辑走 patch；来源不是可编辑 JSON，只能经 verified 选择器或人工重新表述构造。 */
export const memoryEditPatchSchema = z
  .object({
    content: trimmedTextSchema('记忆正文', 1, MEMORY_CONTENT_MAX_CODE_POINTS).optional(),
    facet: memoryFacetSchema.optional(),
    topicKey: topicKeyPatchSchema.optional(),
    scope: memoryScopeSchema.optional(),
    validFrom: datePatchSchema.optional(),
    validUntil: datePatchSchema.optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    const touched = [
      patch.content,
      patch.facet,
      patch.topicKey,
      patch.scope,
      patch.validFrom,
      patch.validUntil,
    ].filter((field) => field !== undefined);
    if (touched.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patch 至少提交一个字段',
      });
    }
    const from = patch.validFrom;
    const until = patch.validUntil;
    if (from?.action === 'set' && until?.action === 'set' && until.value <= from.value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'validUntil 必须晚于 validFrom',
      });
    }
  });
export type MemoryEditPatch = z.infer<typeof memoryEditPatchSchema>;

/** §9.2：Renderer 只提交选择器，不自报来源真实性；缺省表示人工表单正文即来源。 */
const memorySourceSelectorUnion = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('run-user'),
      runId: z.string().min(1),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('run-assistant'),
      runId: z.string().min(1),
      eventId: z.string().min(1),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('checkpoint'),
      checkpointId: z.string().min(1),
      field: memoryCheckpointFieldSchema,
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact-version'),
      artifactVersionId: z.string().min(1),
      locator: z.string().min(1).max(2_000),
      selectedText: exactTextSchema('选中文本', 1, MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS),
    })
    .strict(),
]);
export const memorySourceSelectorSchema = memorySourceSelectorUnion.superRefine(
  (selector, context) => {
    if (selector.kind === 'artifact-version') return;
    if (selector.end < selector.start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: '选择区间为左闭右开，end 不得小于 start',
      });
    }
  },
);
export type MemorySourceSelector = z.infer<typeof memorySourceSelectorSchema>;

/** §9.2：legacy 复核要么补齐完整选择器，要么按人工声明重新表述。 */
export const memoryLegacySourceReviewSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('selector'), selector: memorySourceSelectorSchema }).strict(),
  z
    .object({
      mode: z.literal('user-instruction'),
      genericDeclaration: z.boolean().optional(),
    })
    .strict(),
]);
export type MemoryLegacySourceReview = z.infer<typeof memoryLegacySourceReviewSchema>;

export const createMemoryRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    content: trimmedTextSchema('记忆正文', 1, MEMORY_CONTENT_MAX_CODE_POINTS),
    facet: memoryFacetSchema,
    scope: memoryScopeSchema,
    topicKey: trimmedTextSchema('议题标识', 1, MEMORY_TOPIC_KEY_MAX_CODE_POINTS).optional(),
    validFrom: z.number().int().nonnegative().optional(),
    validUntil: z.number().int().nonnegative().optional(),
    sourceSelector: memorySourceSelectorSchema.optional(),
    asUserInstruction: z.boolean(),
    genericDeclaration: z.boolean().optional(),
    /** §5.3：「作为我的工作口径重新保存」指向被重新表述的精确修订，只用于审计，不解除资料依赖。 */
    fromMemoryRevisionId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.validUntil !== undefined &&
      value.validFrom !== undefined &&
      value.validUntil <= value.validFrom
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validUntil 必须晚于 validFrom',
        path: ['validUntil'],
      });
    }
  });
export type CreateMemoryRequest = z.input<typeof createMemoryRequestSchema>;

export const updateMemoryRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    id: z.string().min(1),
    expectedRevision: z.number().int().positive(),
    patch: memoryEditPatchSchema,
    legacySourceReview: memoryLegacySourceReviewSchema.optional(),
  })
  .strict();
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;

/** §5.4：状态改由动作驱动，不接受任意 status。confirmPatch 只在 confirm/reconfirm 合法。 */
export const setMemoryStatusRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    id: z.string().min(1),
    expectedRevision: z.number().int().positive(),
    action: memoryGovernanceActionSchema,
    confirmPatch: memoryEditPatchSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.confirmPatch === undefined) return;
    if (value.action !== 'confirm' && value.action !== 'reconfirm') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPatch'],
        message: 'confirmPatch 只随 confirm 或 reconfirm 提交',
      });
    }
  });
export type SetMemoryStatusRequest = z.infer<typeof setMemoryStatusRequestSchema>;

export const resolveMemoryConflictRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    left: z
      .object({ id: z.string().min(1), expectedRevision: z.number().int().positive() })
      .strict(),
    right: z
      .object({ id: z.string().min(1), expectedRevision: z.number().int().positive() })
      .strict(),
    decision: memoryConflictDecisionSchema,
    winnerId: z.string().min(1).optional(),
    applicabilityNote: trimmedTextSchema(
      '适用条件说明',
      MEMORY_APPLICABILITY_NOTE_MIN_CODE_POINTS,
      MEMORY_APPLICABILITY_NOTE_MAX_CODE_POINTS,
    ).optional(),
  })
  .strict();
/**
 * 条件必填（replace 要有胜出方、keep-both 要有适用条件、两条必须是不同记录）属于治理裁决，
 * 由 MemoryService 用错误码回答；写在这里只会让 IPC 边界抛出渲染层无法呈现的 ZodError。
 */
export type ResolveMemoryConflictRequest = z.infer<typeof resolveMemoryConflictRequestSchema>;

export const listMemoriesRequestSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    expertId: z.string().min(1).optional(),
    statuses: z.array(memoryStatusSchema).max(memoryStatusSchema.options.length).optional(),
    includeCandidates: z.boolean().default(true),
    cursor: listCursorSchema.optional(),
    limit: z.number().int().positive().max(LIST_PAGE_MAX_LIMIT).optional(),
  })
  .strict();
export type ListMemoriesRequest = z.input<typeof listMemoriesRequestSchema>;

export const getMemoryRequestSchema = z
  .object({ id: z.string().min(1), revisionId: z.string().min(1).optional() })
  .strict();
export type GetMemoryRequest = z.infer<typeof getMemoryRequestSchema>;

const memoryIdentityErrorCodes = [
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONTEXT_REVISION_REQUIRED',
] as const;
const memoryGovernanceErrorCodes = [
  'INVALID_TRANSITION',
  'TERMINAL_MEMORY',
  'INVALID_VALIDITY',
  'CONFLICT_REVIEW_REQUIRED',
] as const;
const memorySourceErrorCodes = [
  'SCOPE_MISMATCH',
  'GLOBAL_SCOPE_REQUIRES_DECLARATION',
  'WORKSPACE_FACT_CANNOT_BE_GLOBAL',
  'SOURCE_UNAVAILABLE',
  'SOURCE_MISMATCH',
  'SOURCE_REVIEW_REQUIRED',
  'SOURCE_DEPENDENCY_LIMIT',
  'SOURCE_DEPENDENCY_CYCLE',
  'MATERIAL_NOT_ALLOWED',
  'MATERIAL_HASH_MISMATCH',
  'SENSITIVE_CONTENT',
] as const;
const memoryJobErrorCodes = [
  'MODEL_UNAVAILABLE',
  'MODEL_PROFILE_CHANGED',
  'CREDENTIAL_UNAVAILABLE',
  'CONSENT_REQUIRED',
  'QUEUE_FULL',
  'JOB_STATE_CONFLICT',
  'INPUT_LIMIT',
  'OUTPUT_LIMIT',
  'TIMEOUT',
  'CANCELLED',
  'INTERRUPTED',
  'INVALID_MODEL_OUTPUT',
  'MODEL_OUTPUT_TRUNCATED',
  'MODEL_TOOL_CALL_REJECTED',
  'MODEL_FINISH_UNKNOWN',
  'MODEL_REQUEST_FAILED',
  'SENSITIVE_CONTENT',
] as const;
const memoryReferenceErrorCodes = [
  'REFERENCE_WORKSPACE_MISMATCH',
  'REFERENCE_LIMIT',
  'REFERENCE_UNAVAILABLE',
  'HISTORY_REFERENCE_BLOCKS_DELETE',
  'STORAGE_ERROR',
  'INTERNAL_ERROR',
] as const;

/** §9.3：五组错误码的全集；message 用可操作中文，不带完整内容或凭据。 */
export const memoryErrorCodeSchema = z.enum([
  ...memoryIdentityErrorCodes,
  ...memoryGovernanceErrorCodes,
  ...memorySourceErrorCodes,
  ...memoryJobErrorCodes,
  ...memoryReferenceErrorCodes,
]);
export type MemoryErrorCode = z.infer<typeof memoryErrorCodeSchema>;
/** §7.2/§7.3：作业失败只保存安全错误码与摘要。 */
export const memoryJobErrorCodeSchema = z.enum(memoryJobErrorCodes);
export type MemoryJobErrorCode = z.infer<typeof memoryJobErrorCodeSchema>;
export const memoryWarningCodeSchema = z.enum([
  'PROJECTION_PENDING',
  'SOURCE_NEEDS_REVIEW',
  'HISTORY_TRUNCATED',
]);
export type MemoryWarningCode = z.infer<typeof memoryWarningCodeSchema>;

export const memoryWarningSchema = z
  .object({
    code: memoryWarningCodeSchema,
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type MemoryWarning = z.infer<typeof memoryWarningSchema>;

export const memoryErrorSchema = z
  .object({
    code: memoryErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    retryable: z.boolean(),
    currentRevision: z.number().int().positive().optional(),
  })
  .strict();
export type MemoryError = z.infer<typeof memoryErrorSchema>;

/** §9.1：只有记忆/简报/参考家族用 Result 收口领域失败；投影失败是已提交＋警告而非失败。 */
export type Result<TData> =
  { ok: true; data: TData; warnings: MemoryWarning[] } | { ok: false; error: MemoryError };

function buildResultSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.union([
    z
      .object({
        ok: z.literal(true),
        data: dataSchema,
        warnings: z.array(memoryWarningSchema),
      })
      .strict(),
    z.object({ ok: z.literal(false), error: memoryErrorSchema }).strict(),
  ]);
}

export function resultSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
): ReturnType<typeof buildResultSchema<TSchema>> {
  return buildResultSchema(dataSchema);
}

export const memoryProjectionStateSchema = z.enum(['synced', 'pending', 'failed']);
export type MemoryProjectionState = z.infer<typeof memoryProjectionStateSchema>;

/** 有效期与候选处置由查询派生；「来源待复核」走 sourceAvailability，不另造状态。 */
export const memoryEffectiveStatusSchema = z.enum([
  'candidate',
  'rejected',
  'confirmed',
  'superseded',
  'expired',
  'deleted',
]);
export type MemoryEffectiveStatus = z.infer<typeof memoryEffectiveStatusSchema>;
export const memorySourceAvailabilitySchema = z.enum([
  'available',
  'unavailable',
  'review-required',
]);
export type MemorySourceAvailability = z.infer<typeof memorySourceAvailabilitySchema>;

export const memoryViewItemSchema = memoryRecordSchema
  .extend({
    effectiveStatus: memoryEffectiveStatusSchema,
    sourceAvailability: memorySourceAvailabilitySchema,
    requiresMaterialSelection: z.boolean(),
    /** §5.5 的潜在冲突对：未裁决的一方也算待澄清，界面据此给出可裁决的并列视图。 */
    conflicts: z.array(memoryConflictPairSchema),
    /** §5.6：候选与已确认记忆同规范范围同规范化哈希时指向那条已确认记录。 */
    duplicatesConfirmedMemoryId: z.string().min(1).optional(),
  })
  .strict();
export type MemoryViewItem = z.infer<typeof memoryViewItemSchema>;

export const memoryListPageDataSchema = listPageSchema(memoryViewItemSchema);
export type MemoryListPageData = z.infer<typeof memoryListPageDataSchema>;

export const memoryWriteEffectSchema = z.enum([
  'created',
  'updated',
  'unchanged',
  'deduplicated',
  'suppressed',
]);
export type MemoryWriteEffect = z.infer<typeof memoryWriteEffectSchema>;

/** §9.1：写命令回执；投影失败表现为 projectionState＋警告，不回滚已提交修订。 */
export const memoryWriteReceiptSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    commit: z.literal('committed'),
    effect: memoryWriteEffectSchema,
    committedRevisionIds: z.array(z.string().min(1)).max(MEMORY_COMMITTED_REVISION_MAX),
    projectionState: memoryProjectionStateSchema,
    currentMemory: memoryViewItemSchema.optional(),
    fromMemoryRevisionId: z.string().min(1).optional(),
  })
  .strict();
export type MemoryWriteReceipt = z.infer<typeof memoryWriteReceiptSchema>;

/** §8.2：memory_operations 只存提交实体与修订，不复制全文。 */
export const memoryOperationKindSchema = z.enum([
  'create',
  'update',
  'set-status',
  'resolve-conflict',
  'set-settings',
  'set-reference',
  'remove-reference',
]);
export type MemoryOperationKind = z.infer<typeof memoryOperationKindSchema>;
export const memoryOperationRecordSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    operationKind: memoryOperationKindSchema,
    requestHash: sha256HexSchema,
    effect: memoryWriteEffectSchema,
    governanceAction: memoryGovernanceActionSchema.optional(),
    committedRevisionIds: z.array(z.string().min(1)).max(MEMORY_COMMITTED_REVISION_MAX),
    /** §5.3：自主口径重新保存留下被重新表述的修订，供审计回溯；除此之外不出现在回执里。 */
    fromMemoryRevisionId: z.string().min(1).optional(),
    committedAt: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryOperationRecord = z.infer<typeof memoryOperationRecordSchema>;

export const memoryConflictResolutionDataSchema = z
  .object({
    receipt: memoryWriteReceiptSchema,
    decision: memoryConflictDecisionRecordSchema,
  })
  .strict();
export type MemoryConflictResolutionData = z.infer<typeof memoryConflictResolutionDataSchema>;

export const workspaceMemorySettingsSchema = z
  .object({
    workspaceId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    autoSuggestEnabled: z.boolean(),
    consentVersion: z.number().int().positive().optional(),
    consentedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type WorkspaceMemorySettings = z.infer<typeof workspaceMemorySettingsSchema>;

export const memorySettingsWriteReceiptSchema = memoryWriteReceiptSchema.extend({
  currentSettings: workspaceMemorySettingsSchema,
});
export type MemorySettingsWriteReceipt = z.infer<typeof memorySettingsWriteReceiptSchema>;

/** §8.4/§10：参考标记只表示参考选择，不表示批准。 */
export const workspaceArtifactReferenceSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    artifactVersionId: z.string().min(1),
    contentHash: sha256HexSchema,
    label: trimmedTextSchema('参考成果标签', 1, MEMORY_REFERENCE_LABEL_MAX_CODE_POINTS).optional(),
    status: z.enum(['active', 'removed']),
    revision: z.number().int().positive(),
    selectedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type WorkspaceArtifactReference = z.infer<typeof workspaceArtifactReferenceSchema>;

export const workspaceReferenceListItemSchema = z
  .object({
    reference: workspaceArtifactReferenceSchema,
    artifactId: z.string().min(1),
    status: z.enum(['ready', 'unavailable']),
  })
  .strict();
export type WorkspaceReferenceListItem = z.infer<typeof workspaceReferenceListItemSchema>;

export const memoryReferenceWriteReceiptSchema = memoryWriteReceiptSchema.extend({
  currentReference: workspaceArtifactReferenceSchema,
});
export type MemoryReferenceWriteReceipt = z.infer<typeof memoryReferenceWriteReceiptSchema>;

export const MEMORY_RECALL_VERSION = 'memory-recall-v1';
export const MEMORY_RECALL_ALGORITHM_VERSION = 1;
export const MEMORY_RECALL_PREFERENCE_ITEM_LIMIT = 2;
export const MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET = 600;
export const MEMORY_RECALL_TOTAL_ITEM_LIMIT = 16;
export const MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET = 6_000;
export const MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET = 2_000;
export const MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET = 8_000;
export const MEMORY_RECALL_QUERY_CODE_POINT_LIMIT = 4_000;
export const MEMORY_RECALL_QUERY_EDGE_CODE_POINT_LIMIT = 2_000;
export const MEMORY_RECALL_TASK_TITLE_CODE_POINT_LIMIT = 200;
export const MEMORY_RECALL_MATERIAL_TITLE_CODE_POINT_LIMIT = 120;
export const MEMORY_RECALL_MATERIAL_TITLE_ITEM_LIMIT = 10;
export const MEMORY_RECALL_MIN_MATCHED_TOKENS = 2;
export const MEMORY_RECALL_SINGLE_TOKEN_MIN_MATCHED = 1;
export const MEMORY_RECALL_STRONG_TOKEN_WEIGHT = 3;
export const MEMORY_RECALL_SINGLE_HAN_WEIGHT = 1;
export const MEMORY_RECALL_SCORE_SCALE = 1_000;
export const MEMORY_REPLAY_PAIR_LIMIT = 8;
export const MEMORY_REPLAY_CODE_POINT_BUDGET = 12_000;
export const MEMORY_DECISION_SUMMARY_IDENTITY_LIMIT = 50;

/** §6.1 第 3 条：两份停用词表是算法版本的一部分，改动必须升版本并同步 fixtures。 */
export const MEMORY_RECALL_HAN_STOP_BIGRAMS = [
  '请帮',
  '帮我',
  '一下',
  '进行',
  '根据',
  '这个',
  '这次',
  '需要',
  '我们',
  '任务',
] as const;
export const MEMORY_RECALL_LATIN_STOP_WORDS = [
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'for',
  'in',
  'on',
  'is',
  'are',
  'please',
] as const;

export const memorySelectionReasonSchema = z.enum([
  'task-relevant',
  'general-preference',
  'conflict-pair',
  'replay-inherited',
]);
export type MemorySelectionReason = z.infer<typeof memorySelectionReasonSchema>;

/** §6.2/§8.1：只记录精确引用与顺序，不复制正文。 */
export const memorySelectedMemorySchema = z
  .object({
    memoryId: z.string().min(1),
    revisionId: z.string().min(1),
    contentHash: sha256HexSchema,
    order: z.number().int().positive(),
    score: z.number().int().min(0).max(MEMORY_RECALL_SCORE_SCALE),
    reason: memorySelectionReasonSchema,
  })
  .strict();
export type MemorySelectedMemory = z.infer<typeof memorySelectedMemorySchema>;

/** §6.3：历史轮次不可重放的边界理由。 */
export const memoryReplayBoundaryReasonSchema = z.enum([
  'memory-revised',
  'memory-excluded',
  'memory-inactive',
  'source-unavailable',
  'material-removed-or-replaced',
  'legacy-provenance-unknown',
  'history-budget',
]);
export type MemoryReplayBoundaryReason = z.infer<typeof memoryReplayBoundaryReasonSchema>;

const replayedRunSchema = z
  .object({
    replayed: z.literal(true),
    runId: z.string().min(1),
    finalEventId: z.string().min(1),
    promptHash: sha256HexSchema,
    contentCodePoints: z.number().int().nonnegative(),
  })
  .strict();
const skippedRunSchema = z
  .object({
    replayed: z.literal(false),
    runId: z.string().min(1),
    reason: memoryReplayBoundaryReasonSchema,
  })
  .strict();
export const memoryReplayEntrySchema = z.discriminatedUnion('replayed', [
  replayedRunSchema,
  skippedRunSchema,
]);
export type MemoryReplayEntry = z.infer<typeof memoryReplayEntrySchema>;

/** §6.1/§6.2 的过滤顺序逐一对应一个排除理由；预算落选不等于授权撤销。 */
export const memoryRecallExclusionReasonSchema = z.enum([
  'inactive',
  'scope',
  'task-excluded',
  'source-unavailable',
  'source-review-required',
  'dependency-unavailable',
  'conflict-unresolved',
  'not-relevant',
  'budget',
]);
export type MemoryRecallExclusionReason = z.infer<typeof memoryRecallExclusionReasonSchema>;

export const memoryRecallBudgetUsageSchema = z
  .object({
    totalItems: z.number().int().nonnegative(),
    preferenceItems: z.number().int().nonnegative(),
    contentCodePoints: z.number().int().nonnegative(),
    wrapperCodePoints: z.number().int().nonnegative(),
    blockCodePoints: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryRecallBudgetUsage = z.infer<typeof memoryRecallBudgetUsageSchema>;

export const memoryRecallExclusionSchema = z
  .object({
    reason: memoryRecallExclusionReasonSchema,
    count: z.number().int().nonnegative(),
    identities: z
      .array(
        z
          .object({
            memoryId: z.string().min(1),
            revisionId: z.string().min(1),
          })
          .strict(),
      )
      .max(MEMORY_DECISION_SUMMARY_IDENTITY_LIMIT),
  })
  .strict();
export type MemoryRecallExclusion = z.infer<typeof memoryRecallExclusionSchema>;

export const memoryDecisionSummarySchema = z
  .object({
    budget: memoryRecallBudgetUsageSchema,
    exclusions: z
      .array(memoryRecallExclusionSchema)
      .max(memoryRecallExclusionReasonSchema.options.length),
    queryTruncated: z.boolean(),
    conflictReviewRequired: z.boolean(),
  })
  .strict();
export type MemoryDecisionSummary = z.infer<typeof memoryDecisionSummarySchema>;

export const memoryPolicySnapshotSchema = z
  .object({
    recallVersion: z.literal(MEMORY_RECALL_VERSION),
    algorithmVersion: z.literal(MEMORY_RECALL_ALGORITHM_VERSION),
    preferenceItemLimit: z.literal(MEMORY_RECALL_PREFERENCE_ITEM_LIMIT),
    preferenceCodePointBudget: z.literal(MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET),
    totalItemLimit: z.literal(MEMORY_RECALL_TOTAL_ITEM_LIMIT),
    contentCodePointBudget: z.literal(MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET),
    wrapperCodePointBudget: z.literal(MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET),
    blockCodePointBudget: z.literal(MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET),
    queryCodePointLimit: z.literal(MEMORY_RECALL_QUERY_CODE_POINT_LIMIT),
    queryEdgeCodePointLimit: z.literal(MEMORY_RECALL_QUERY_EDGE_CODE_POINT_LIMIT),
    taskTitleCodePointLimit: z.literal(MEMORY_RECALL_TASK_TITLE_CODE_POINT_LIMIT),
    materialTitleCodePointLimit: z.literal(MEMORY_RECALL_MATERIAL_TITLE_CODE_POINT_LIMIT),
    materialTitleItemLimit: z.literal(MEMORY_RECALL_MATERIAL_TITLE_ITEM_LIMIT),
    minMatchedTokens: z.literal(MEMORY_RECALL_MIN_MATCHED_TOKENS),
    replayPairLimit: z.literal(MEMORY_REPLAY_PAIR_LIMIT),
    replayCodePointBudget: z.literal(MEMORY_REPLAY_CODE_POINT_BUDGET),
  })
  .strict();
export type MemoryPolicySnapshot = z.infer<typeof memoryPolicySnapshotSchema>;

export const memoryRecallPolicyV1 = {
  recallVersion: MEMORY_RECALL_VERSION,
  algorithmVersion: MEMORY_RECALL_ALGORITHM_VERSION,
  preferenceItemLimit: MEMORY_RECALL_PREFERENCE_ITEM_LIMIT,
  preferenceCodePointBudget: MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET,
  totalItemLimit: MEMORY_RECALL_TOTAL_ITEM_LIMIT,
  contentCodePointBudget: MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET,
  wrapperCodePointBudget: MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET,
  blockCodePointBudget: MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET,
  queryCodePointLimit: MEMORY_RECALL_QUERY_CODE_POINT_LIMIT,
  queryEdgeCodePointLimit: MEMORY_RECALL_QUERY_EDGE_CODE_POINT_LIMIT,
  taskTitleCodePointLimit: MEMORY_RECALL_TASK_TITLE_CODE_POINT_LIMIT,
  materialTitleCodePointLimit: MEMORY_RECALL_MATERIAL_TITLE_CODE_POINT_LIMIT,
  materialTitleItemLimit: MEMORY_RECALL_MATERIAL_TITLE_ITEM_LIMIT,
  minMatchedTokens: MEMORY_RECALL_MIN_MATCHED_TOKENS,
  replayPairLimit: MEMORY_REPLAY_PAIR_LIMIT,
  replayCodePointBudget: MEMORY_REPLAY_CODE_POINT_BUDGET,
} as const satisfies MemoryPolicySnapshot;

/** §6.1：由 Main 构造；preview 允许草稿 prompt，但不写读取足迹。 */
export const memoryQueryContextSchema = z
  .object({
    workspaceId: z.string().min(1),
    expertId: z.string().min(1).optional(),
    taskId: z.string().min(1),
    taskContextRevisionId: z.string().min(1),
    evaluatedAt: z.number().int().nonnegative(),
    prompt: z.string().trim().min(1),
    taskTitle: z.string().trim().min(1),
    materialTitles: z
      .array(
        z
          .object({
            reference: materialReferenceSchema,
            title: trimmedTextSchema('材料标题', 1, MEMORY_RECALL_MATERIAL_TITLE_CODE_POINT_LIMIT),
          })
          .strict(),
      )
      .max(50),
    excludedMemoryIds: z.array(z.string().min(1)).max(100),
  })
  .strict();
export type MemoryQueryContext = z.infer<typeof memoryQueryContextSchema>;

/** §6.4：阶段单调；legacy_unknown 只用于改造前的旧记录，不回填发送时间与请求哈希。 */
export const memoryRunPhaseSchema = z.enum([
  'selected',
  'request-prepared',
  'dispatch-attempted',
  'legacy_unknown',
]);
export type MemoryRunPhase = z.infer<typeof memoryRunPhaseSchema>;

export const memoryReadSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    memoryId: z.string().min(1),
    memoryRevisionId: z.string().min(1),
    contentHash: sha256HexSchema,
    capturedAt: z.number().int().nonnegative(),
    selectedForInjection: z.boolean(),
    replayedViaRunIds: z.array(z.string().min(1)).max(MEMORY_REPLAY_PAIR_LIMIT),
    provenanceState: memoryProvenanceStateSchema,
  })
  .strict();
export type MemoryRead = z.infer<typeof memoryReadSchema>;

/** §8.2：run_memory_contexts 一行；依赖 union 保存精确引用，不得只存摘要文本。 */
export const runMemoryContextSchema = z
  .object({
    runId: z.string().min(1),
    schemaVersion: z.literal(1),
    phase: memoryRunPhaseSchema,
    recallVersion: z.literal(MEMORY_RECALL_VERSION),
    evaluatedAt: z.number().int().nonnegative(),
    queryHash: sha256HexSchema,
    policySnapshot: memoryPolicySnapshotSchema,
    selectedItems: z.array(memorySelectedMemorySchema).max(MEMORY_RECALL_TOTAL_ITEM_LIMIT),
    replay: z.array(memoryReplayEntrySchema).max(MEMORY_REPLAY_PAIR_LIMIT * 2),
    materialDependencyUnion: z.array(materialReferenceSchema).max(MEMORY_MATERIAL_DEPENDENCY_MAX),
    memoryDependencyUnion: z.array(memoryDependencySchema).max(MEMORY_MEMORY_DEPENDENCY_MAX),
    decisionSummary: memoryDecisionSummarySchema,
    authorizationHash: sha256HexSchema,
    modelSnapshot: z.record(z.string(), z.unknown()).optional(),
    requestHash: sha256HexSchema.optional(),
    selectedAt: z.number().int().nonnegative(),
    requestPreparedAt: z.number().int().nonnegative().optional(),
    dispatchAttemptedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((context, ctx) => {
    const orders = context.selectedItems.map((item) => item.order);
    const expected = orders.map((_, index) => index + 1);
    const contiguous = [...orders]
      .sort((a, b) => a - b)
      .every((value, index) => value === expected[index]);
    if (!contiguous) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedItems'],
        message: 'selectedItems 的 order 必须是从 1 开始的连续序列',
      });
    }
    const phases: MemoryRunPhase[] = ['selected', 'request-prepared', 'dispatch-attempted'];
    const reached = phases.indexOf(context.phase);
    if (context.requestPreparedAt !== undefined && reached < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestPreparedAt'],
        message: '未到 request-prepared 阶段不得写入该时间',
      });
    }
    if (context.dispatchAttemptedAt !== undefined && reached < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatchAttemptedAt'],
        message: '未到 dispatch-attempted 阶段不得写入该时间',
      });
    }
  });
export type RunMemoryContext = z.infer<typeof runMemoryContextSchema>;

export const previewMemoryRequestSchema = z
  .object({
    taskId: z.string().min(1),
    taskContextRevisionId: z.string().min(1),
    expectedTaskContextRevision: z.number().int().positive(),
    prompt: z.string().trim().min(1),
  })
  .strict();
export type PreviewMemoryRequest = z.infer<typeof previewMemoryRequestSchema>;

export const memoryPreviewDataSchema = z
  .object({
    evaluatedAt: z.number().int().nonnegative(),
    policySnapshot: memoryPolicySnapshotSchema,
    selectedItems: z.array(memorySelectedMemorySchema).max(MEMORY_RECALL_TOTAL_ITEM_LIMIT),
    decisionSummary: memoryDecisionSummarySchema,
  })
  .strict();
export type MemoryPreviewData = z.infer<typeof memoryPreviewDataSchema>;

export const getRunMemoryContextRequestSchema = z.object({ runId: z.string().min(1) }).strict();
export type GetRunMemoryContextRequest = z.infer<typeof getRunMemoryContextRequestSchema>;

/** §9.2：旧运行没有审计行时 phase 为 legacy_unknown，context 省略，不伪造请求哈希。 */
export const memoryRunContextDataSchema = z
  .object({
    runId: z.string().min(1),
    phase: memoryRunPhaseSchema,
    context: runMemoryContextSchema.optional(),
    memories: z.array(memoryViewItemSchema).max(LIST_PAGE_MAX_LIMIT),
    reads: z.array(memoryReadSchema).max(LIST_PAGE_MAX_LIMIT),
  })
  .strict();
export type MemoryRunContextData = z.infer<typeof memoryRunContextDataSchema>;

export const MEMORY_JOB_LIST_DEFAULT_LIMIT = 20;
export const MEMORY_JOB_LIST_MAX_LIMIT = 50;
export const MEMORY_EXTRACTION_CONCURRENCY = 1;
export const MEMORY_EXTRACTION_QUEUE_LIMIT = 20;
export const MEMORY_EXTRACTION_TIMEOUT_MS = 30_000;
export const MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS = 2_048;
export const MEMORY_EXTRACTION_INPUT_CODE_POINT_LIMIT = 6_000;
export const MEMORY_EXTRACTION_TEXT_CODE_POINT_LIMIT = 6_000;
export const MEMORY_EXTRACTION_INSTRUCTION_CODE_POINT_LIMIT = 1_500;
export const MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT = 2_000;
export const MEMORY_EXTRACTION_SUMMARY_CODE_POINT_LIMIT = 1_000;
export const MEMORY_EXTRACTION_MAX_CANDIDATES = 3;
export const MEMORY_EXTRACTION_MIN_EVIDENCE = 1;
export const MEMORY_EXTRACTION_MAX_EVIDENCE = 3;
export const MEMORY_EXTRACTION_MAX_FRAGMENTS = 2;

/** §7.3：当前自动建议同意版本；开启写命令的门槛、作业快照与界面文案共用同一个定义。 */
export const MEMORY_SUGGESTION_CONSENT_VERSION = 1;

export const memoryJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'skipped',
]);
export type MemoryJobStatus = z.infer<typeof memoryJobStatusSchema>;
export const memoryJobTriggerSchema = z.enum(['automatic', 'manual-retry']);
export type MemoryJobTrigger = z.infer<typeof memoryJobTriggerSchema>;
export const modelFinishReasonSchema = z.enum([
  'stop',
  'length',
  'tool-calls',
  'content-filter',
  'unknown',
]);
export type ModelFinishReason = z.infer<typeof modelFinishReasonSchema>;

/** §7.2：超长输入取首尾等分片段并标注非全文；证据区间只能落在实际片段内。 */
export const memoryExtractionFragmentSchema = z
  .object({
    fragmentId: z.string().min(1),
    role: z.enum(['run-prompt', 'run-assistant', 'checkpoint-feedback', 'checkpoint-summary']),
    text: exactTextSchema('提炼输入片段', 1, MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT),
    partial: z.boolean(),
  })
  .strict();
export type MemoryExtractionFragment = z.infer<typeof memoryExtractionFragmentSchema>;

const modelEvidenceSchema = z
  .object({
    fragmentId: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.end <= evidence.start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: '证据区间为左闭右开且不得为空',
      });
    }
  });

/** §7.2：status、scope、ID、来源哈希与材料权限由宿主决定，模型输出这些字段即非法。 */
export const memoryExtractionCandidateSchema = z
  .object({
    content: exactTextSchema('候选正文', 1, MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS),
    facet: memoryFacetSchema,
    topicKey: trimmedTextSchema('议题标识', 1, MEMORY_TOPIC_KEY_MAX_CODE_POINTS).optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z
      .array(modelEvidenceSchema)
      .min(MEMORY_EXTRACTION_MIN_EVIDENCE)
      .max(MEMORY_EXTRACTION_MAX_EVIDENCE),
  })
  .strict();
export type MemoryExtractionCandidate = z.infer<typeof memoryExtractionCandidateSchema>;

export const memoryExtractionModelOutputSchema = z
  .object({
    candidates: z.array(memoryExtractionCandidateSchema).max(MEMORY_EXTRACTION_MAX_CANDIDATES),
  })
  .strict();
export type MemoryExtractionModelOutput = z.infer<typeof memoryExtractionModelOutputSchema>;

export const memoryExtractionUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type MemoryExtractionUsage = z.infer<typeof memoryExtractionUsageSchema>;

/** §7.3：候选写入、去重统计与作业成功终态在同事务提交。 */
export const memoryExtractionOutcomeSchema = z
  .object({
    candidateRevisionIds: z.array(z.string().min(1)).max(MEMORY_EXTRACTION_MAX_CANDIDATES),
    deduplicatedCount: z.number().int().nonnegative(),
    suppressedCount: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryExtractionOutcome = z.infer<typeof memoryExtractionOutcomeSchema>;

export const memoryExtractionSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run'), runId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('checkpoint'), checkpointId: z.string().min(1) }).strict(),
]);
export type MemoryExtractionSource = z.infer<typeof memoryExtractionSourceSchema>;

export const memoryExtractionJobSchema = z
  .object({
    id: z.string().min(1),
    /** §7.3：触发类型＋真实 source ID＋内容快照哈希，不含模型版本。 */
    sourceKey: z.string().min(1),
    workspaceId: z.string().min(1),
    taskId: z.string().min(1),
    source: memoryExtractionSourceSchema,
    fragments: z.array(memoryExtractionFragmentSchema).max(MEMORY_EXTRACTION_MAX_FRAGMENTS),
    sourceVersionHash: sha256HexSchema,
    materialDependencies: z.array(materialReferenceSchema).max(MEMORY_MATERIAL_DEPENDENCY_MAX),
    memoryDependencies: z.array(memoryDependencySchema).max(MEMORY_MEMORY_DEPENDENCY_MAX),
    modelProfileId: z.string().min(1).optional(),
    modelSnapshot: z.record(z.string(), z.unknown()).optional(),
    trigger: memoryJobTriggerSchema,
    consentRevision: z.number().int().nonnegative().optional(),
    status: memoryJobStatusSchema,
    revision: z.number().int().positive(),
    attempt: z.number().int().positive(),
    inputCodePoints: z.number().int().nonnegative(),
    outputCodePoints: z.number().int().nonnegative(),
    usage: memoryExtractionUsageSchema.optional(),
    outcome: memoryExtractionOutcomeSchema.optional(),
    errorCode: memoryJobErrorCodeSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type MemoryExtractionJob = z.infer<typeof memoryExtractionJobSchema>;

/** §9.2：JobSummary 是脱敏视图，不含密钥、模型原文输入或错误正文。 */
export const memoryJobSummarySchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    taskId: z.string().min(1),
    source: memoryExtractionSourceSchema,
    status: memoryJobStatusSchema,
    revision: z.number().int().positive(),
    attempt: z.number().int().positive(),
    trigger: memoryJobTriggerSchema,
    modelLabel: z.string().min(1).max(160).optional(),
    candidateCount: z.number().int().nonnegative(),
    errorCode: memoryJobErrorCodeSchema.optional(),
    diagnostic: z.string().trim().min(1).max(500).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryJobSummary = z.infer<typeof memoryJobSummarySchema>;

export const getMemorySettingsRequestSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export type GetMemorySettingsRequest = z.infer<typeof getMemorySettingsRequestSchema>;

export const setMemorySettingsRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    workspaceId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    autoSuggestEnabled: z.boolean(),
    consentVersion: z.number().int().positive().optional(),
  })
  .strict();
/**
 * 「开启必须带当前同意版本」是治理裁决，由 MemoryExtractionService 用 CONSENT_REQUIRED 回答；
 * 写在 Schema 里只会在 IPC 边界抛出渲染层无法呈现的 ZodError。
 */
export type SetMemorySettingsRequest = z.infer<typeof setMemorySettingsRequestSchema>;

export const memorySettingsDataSchema = z
  .object({
    receipt: memorySettingsWriteReceiptSchema,
    cancelledJobCount: z.number().int().nonnegative(),
  })
  .strict();
export type MemorySettingsData = z.infer<typeof memorySettingsDataSchema>;

export const listMemoryJobsRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    taskId: z.string().min(1).optional(),
    cursor: listCursorSchema.optional(),
    limit: z.number().int().positive().max(MEMORY_JOB_LIST_MAX_LIMIT).optional(),
  })
  .strict();
export type ListMemoryJobsRequest = z.infer<typeof listMemoryJobsRequestSchema>;

export const memoryJobListDataSchema = listPageSchema(memoryJobSummarySchema);
export type MemoryJobListData = z.infer<typeof memoryJobListDataSchema>;

export const retryMemoryJobRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    jobId: z.string().min(1),
    expectedRevision: z.number().int().positive(),
    consentVersion: z.number().int().positive(),
  })
  .strict();
export type RetryMemoryJobRequest = z.infer<typeof retryMemoryJobRequestSchema>;

export const cancelMemoryJobRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    jobId: z.string().min(1),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type CancelMemoryJobRequest = z.infer<typeof cancelMemoryJobRequestSchema>;

export const rebuildMemoryProjectionRequestSchema = z
  .object({ operationId: memoryOperationIdSchema })
  .strict();
export type RebuildMemoryProjectionRequest = z.infer<typeof rebuildMemoryProjectionRequestSchema>;

export const memoryProjectionStateDataSchema = z
  .object({ projectionState: memoryProjectionStateSchema })
  .strict();
export type MemoryProjectionStateData = z.infer<typeof memoryProjectionStateDataSchema>;

export const WORKSPACE_BRIEF_SECTION_ITEM_LIMIT = 10;
export const WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT = 5;
export const WORKSPACE_REFERENCE_ACTIVE_LIMIT = 20;

export const workspaceBriefMemoryItemSchema = z
  .object({
    memoryId: z.string().min(1),
    revisionId: z.string().min(1),
    contentHash: sha256HexSchema,
    content: trimmedTextSchema('记忆正文', 1, MEMORY_CONTENT_MAX_CODE_POINTS),
    scope: memoryScopeSchema,
    sourceAvailability: memorySourceAvailabilitySchema,
    requiresMaterialSelection: z.boolean(),
  })
  .strict();
export type WorkspaceBriefMemoryItem = z.infer<typeof workspaceBriefMemoryItemSchema>;

const workspaceBriefMemorySectionSchema = z
  .object({
    items: z.array(workspaceBriefMemoryItemSchema).max(WORKSPACE_BRIEF_SECTION_ITEM_LIMIT),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

/** §10：开放节点保留 summary/feedback/nextAction 原有标识，不推断成已确认结论。 */
export const workspaceBriefOpenIssueSchema = z
  .object({
    checkpointId: z.string().min(1),
    taskId: z.string().min(1),
    summary: z.string().trim().max(20_000),
    feedback: z.string().trim().max(10_000).optional(),
    nextAction: z.string().trim().max(10_000).optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type WorkspaceBriefOpenIssue = z.infer<typeof workspaceBriefOpenIssueSchema>;

export const workspaceBriefSchema = z
  .object({
    workspaceId: z.string().min(1),
    expertId: z.string().min(1).optional(),
    generatedAt: z.number().int().nonnegative(),
    goals: workspaceBriefMemorySectionSchema,
    constraints: workspaceBriefMemorySectionSchema,
    decisions: workspaceBriefMemorySectionSchema,
    methods: workspaceBriefMemorySectionSchema,
    openIssues: z
      .object({
        items: z.array(workspaceBriefOpenIssueSchema).max(WORKSPACE_BRIEF_SECTION_ITEM_LIMIT),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    referenceVersions: z
      .object({
        items: z.array(workspaceReferenceListItemSchema).max(WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type WorkspaceBrief = z.infer<typeof workspaceBriefSchema>;

export const workspaceMemoryBriefRequestSchema = z
  .object({ workspaceId: z.string().min(1), expertId: z.string().min(1).optional() })
  .strict();
export type WorkspaceMemoryBriefRequest = z.infer<typeof workspaceMemoryBriefRequestSchema>;

export const listWorkspaceReferenceVersionsRequestSchema = z
  .object({ workspaceId: z.string().min(1) })
  .strict();
export type ListWorkspaceReferenceVersionsRequest = z.infer<
  typeof listWorkspaceReferenceVersionsRequestSchema
>;

export const workspaceReferenceListDataSchema = z
  .object({
    items: z.array(workspaceReferenceListItemSchema).max(WORKSPACE_REFERENCE_ACTIVE_LIMIT),
  })
  .strict();
export type WorkspaceReferenceListData = z.infer<typeof workspaceReferenceListDataSchema>;

/** §10：expectedRevision 新建为 0；引用固定 versionId＋contentHash，不跟随 latest。 */
export const setWorkspaceReferenceVersionRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    workspaceId: z.string().min(1),
    artifactVersionId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    label: trimmedTextSchema('参考成果标签', 1, MEMORY_REFERENCE_LABEL_MAX_CODE_POINTS).optional(),
  })
  .strict();
export type SetWorkspaceReferenceVersionRequest = z.infer<
  typeof setWorkspaceReferenceVersionRequestSchema
>;

export const workspaceReferenceSetDataSchema = z
  .object({
    receipt: memoryReferenceWriteReceiptSchema,
    material: materialReferenceSchema,
  })
  .strict();
export type WorkspaceReferenceSetData = z.infer<typeof workspaceReferenceSetDataSchema>;

export const removeWorkspaceReferenceVersionRequestSchema = z
  .object({
    operationId: memoryOperationIdSchema,
    id: z.string().min(1),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type RemoveWorkspaceReferenceVersionRequest = z.infer<
  typeof removeWorkspaceReferenceVersionRequestSchema
>;

export const mcpConnectionStatusSchema = z.enum([
  'unconfigured',
  'connecting',
  'ready',
  'failed',
  'disconnected',
]);
export type McpConnectionStatus = z.infer<typeof mcpConnectionStatusSchema>;
export const mcpTransportSchema = z
  .object({
    kind: z.literal('stdio'),
    command: z.string().trim().min(1).max(2_000),
    args: z.array(z.string().max(2_000)).max(100).default([]),
    cwd: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();
export type McpTransport = z.input<typeof mcpTransportSchema>;
export const mcpToolSummarySchema = z
  .object({
    id: z.string().min(1),
    connectionId: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4_000),
    inputSchema: z.record(z.string(), z.unknown()),
    schemaHash: z.string().min(1),
    discoveredAt: z.number().int().nonnegative(),
  })
  .strict();
export type McpToolSummary = z.infer<typeof mcpToolSummarySchema>;
export const mcpConnectionSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    transport: mcpTransportSchema,
    status: mcpConnectionStatusSchema,
    serverName: z.string().min(1).optional(),
    serverVersion: z.string().min(1).optional(),
    tools: mcpToolSummarySchema.array().max(200),
    failureMessage: z.string().min(1).optional(),
    lastCheckedAt: z.number().int().nonnegative().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type McpConnectionSummary = z.infer<typeof mcpConnectionSummarySchema>;
export const saveMcpConnectionRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(160),
    transport: mcpTransportSchema,
  })
  .strict();
export type SaveMcpConnectionRequest = z.input<typeof saveMcpConnectionRequestSchema>;
export const getMcpConnectionRequestSchema = z.object({ id: z.string().min(1) }).strict();
export type GetMcpConnectionRequest = z.infer<typeof getMcpConnectionRequestSchema>;
export const deleteMcpConnectionRequestSchema = z.object({ id: z.string().min(1) }).strict();
export type DeleteMcpConnectionRequest = z.infer<typeof deleteMcpConnectionRequestSchema>;
export const mcpMutationResultSchema = z
  .object({ connection: mcpConnectionSummarySchema })
  .strict();
export type McpMutationResult = z.infer<typeof mcpMutationResultSchema>;
export const mcpTestResultSchema = z
  .object({ connection: mcpConnectionSummarySchema, tools: mcpToolSummarySchema.array() })
  .strict();
export type McpTestResult = z.infer<typeof mcpTestResultSchema>;

export const artifactInputRelationKindSchema = z.enum([
  'data',
  'rule',
  'comparison',
  'structure',
  'template',
  'background',
  'other',
]);
export type ArtifactInputRelationKind = z.infer<typeof artifactInputRelationKindSchema>;
export const artifactInputSchema = z.discriminatedUnion('kind', [
  materialReferenceSchema,
  z.object({ kind: z.literal('evidence'), evidenceId: z.string().min(1) }).strict(),
]);
export type ArtifactInput = z.infer<typeof artifactInputSchema>;
export const artifactInputRelationSchema = z
  .object({
    outputVersionId: z.string().min(1),
    input: artifactInputSchema,
    relation: artifactInputRelationKindSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type ArtifactInputRelation = z.infer<typeof artifactInputRelationSchema>;

export const artifactInputRelationInputSchema = z
  .object({ input: artifactInputSchema, relation: artifactInputRelationKindSchema })
  .strict();
export type ArtifactInputRelationInput = z.infer<typeof artifactInputRelationInputSchema>;

/** 版本声明种类由宿主判定：model/user 为显式声明，inherited 必有已声明祖先，legacy 只作历史关联。 */
export const artifactSourceDeclarationKindSchema = z.enum([
  'model',
  'user',
  'inherited',
  'legacy',
  'none',
]);
export type ArtifactSourceDeclarationKind = z.infer<typeof artifactSourceDeclarationKindSchema>;

export const inputSnapshotStatusSchema = z.enum(['preparing', 'ready', 'failed', 'cancelled']);
export type InputSnapshotStatus = z.infer<typeof inputSnapshotStatusSchema>;
export const inputSnapshotSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    sourcePath: z.string().min(1),
    contentHash: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    format: z.string().min(1),
    fileKey: z.string().min(1),
    status: inputSnapshotStatusSchema,
    failureCode: z.string().min(1).optional(),
    failureMessage: z.string().min(1).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type InputSnapshot = z.infer<typeof inputSnapshotSchema>;

export const taskContextRevisionSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    revision: z.number().int().positive(),
    executor: taskContextExecutorSchema,
    skillBindings: z
      .array(taskContextSkillBindingSchema)
      .max(MAX_RUN_SKILL_BINDINGS)
      .refine(
        (bindings) => new Set(bindings.map((binding) => binding.skillId)).size === bindings.length,
        { message: 'skillBindings 中存在重复的 skillId' },
      ),
    materials: taskMaterialSelectionSchema.array().max(50).optional(),
    excludedMemoryIds: z.array(z.string().min(1)).max(100).optional(),
    mcpToolBindings: z.array(mcpToolBindingSchema).max(50).optional(),
    modelReference: expertModelReferenceSchema.optional(),
    builtinToolPolicy: builtinToolPolicySchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type TaskContextRevision = z.infer<typeof taskContextRevisionSchema>;

export const getTaskContextRequestSchema = z.object({ taskId: z.string().min(1) }).strict();
export type GetTaskContextRequest = z.infer<typeof getTaskContextRequestSchema>;

export const saveTaskContextRequestSchema = z
  .object({
    taskId: z.string().min(1),
    expectedRevision: z.number().int().positive().optional(),
    executor: taskContextExecutorSchema,
    skillBindings: taskContextRevisionSchema.shape.skillBindings,
    materials: taskMaterialSelectionSchema.array().max(50).optional(),
    excludedMemoryIds: taskContextRevisionSchema.shape.excludedMemoryIds,
    mcpToolBindings: taskContextRevisionSchema.shape.mcpToolBindings,
    modelReference: expertModelReferenceSchema.optional(),
    builtinToolPolicy: builtinToolPolicySchema.optional(),
  })
  .strict();
export type SaveTaskContextRequest = z.infer<typeof saveTaskContextRequestSchema>;

export const taskContextMutationResultSchema = z
  .object({ context: taskContextRevisionSchema })
  .strict();
export type TaskContextMutationResult = z.infer<typeof taskContextMutationResultSchema>;

export const discussionCheckpointStageSchema = z.enum([
  'understanding',
  'research-complete',
  'report-outline',
  'report',
  'ppt-outline',
  'ppt-complete',
  'iteration',
]);
export type DiscussionCheckpointStage = z.infer<typeof discussionCheckpointStageSchema>;
export const discussionCheckpointStatusSchema = z.enum(['open', 'superseded']);
export type DiscussionCheckpointStatus = z.infer<typeof discussionCheckpointStatusSchema>;
export const discussionCheckpointSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    runId: z.string().min(1).optional(),
    stage: discussionCheckpointStageSchema,
    status: discussionCheckpointStatusSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(20_000),
    artifactVersionIds: z.array(z.string().min(1)).max(20),
    feedback: z.string().trim().max(10_000).optional(),
    nextAction: z.string().trim().max(10_000).optional(),
    supersedesId: z.string().min(1).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type DiscussionCheckpoint = z.infer<typeof discussionCheckpointSchema>;
export const listDiscussionCheckpointsRequestSchema = z
  .object({ taskId: z.string().min(1) })
  .strict();
export type ListDiscussionCheckpointsRequest = z.infer<
  typeof listDiscussionCheckpointsRequestSchema
>;
export const createDiscussionCheckpointRequestSchema = discussionCheckpointSchema
  .omit({ status: true, createdAt: true, updatedAt: true })
  .strict();
export type CreateDiscussionCheckpointRequest = z.infer<
  typeof createDiscussionCheckpointRequestSchema
>;
export const discussionCheckpointMutationResultSchema = z
  .object({ checkpoint: discussionCheckpointSchema })
  .strict();
export type DiscussionCheckpointMutationResult = z.infer<
  typeof discussionCheckpointMutationResultSchema
>;

export const listTaskMaterialCandidatesRequestSchema = z
  .object({ taskId: z.string().min(1).optional(), workspaceId: z.string().min(1).optional() })
  .strict()
  .refine((input) => Boolean(input.taskId ?? input.workspaceId), {
    message: 'taskId 或 workspaceId 至少提供一个',
  });
export type ListTaskMaterialCandidatesRequest = z.infer<
  typeof listTaskMaterialCandidatesRequestSchema
>;
export const prepareWorkspaceInputSnapshotRequestSchema = z
  .object({ taskId: z.string().min(1).optional(), workspaceId: z.string().min(1).optional() })
  .strict()
  .refine((input) => Boolean(input.taskId ?? input.workspaceId), {
    message: 'taskId 或 workspaceId 至少提供一个',
  });
export type PrepareWorkspaceInputSnapshotRequest = z.infer<
  typeof prepareWorkspaceInputSnapshotRequestSchema
>;

export const listSkillsRequestSchema = z.object({}).strict();
export type ListSkillsRequest = z.infer<typeof listSkillsRequestSchema>;

export const getSkillRequestSchema = z.object({ id: skillIdSchema }).strict();
export type GetSkillRequest = z.infer<typeof getSkillRequestSchema>;

export const saveSkillRuntimeProfileRequestSchema = z
  .object({ skillId: skillIdSchema, profile: runtimeProfileDraftSchema })
  .strict();
export type SaveSkillRuntimeProfileRequest = z.infer<typeof saveSkillRuntimeProfileRequestSchema>;

export const setSkillEnabledRequestSchema = z
  .object({ skillId: skillIdSchema, enabled: z.boolean() })
  .strict();
export type SetSkillEnabledRequest = z.infer<typeof setSkillEnabledRequestSchema>;

export const setSkillTrustRequestSchema = z
  .object({ skillId: skillIdSchema, trusted: z.boolean() })
  .strict();
export type SetSkillTrustRequest = z.infer<typeof setSkillTrustRequestSchema>;

export const revokeSkillTrustRequestSchema = z.object({ skillId: skillIdSchema }).strict();
export type RevokeSkillTrustRequest = z.infer<typeof revokeSkillTrustRequestSchema>;

export const copySkillRequestSchema = z
  .object({ skillId: skillIdSchema, name: z.string().trim().min(1).max(160).optional() })
  .strict();
export type CopySkillRequest = z.infer<typeof copySkillRequestSchema>;

export const exportSkillRequestSchema = z
  .object({ skillId: skillIdSchema, revisionId: skillRevisionIdSchema.optional() })
  .strict();
export type ExportSkillRequest = z.infer<typeof exportSkillRequestSchema>;

export const deleteSkillRequestSchema = z.object({ skillId: skillIdSchema }).strict();
export type DeleteSkillRequest = z.infer<typeof deleteSkillRequestSchema>;

export const importSkillRequestSchema = z.object({}).strict();
export type ImportSkillRequest = z.infer<typeof importSkillRequestSchema>;

export const skillMutationResultSchema = z
  .object({
    skill: skillSummarySchema,
  })
  .strict();
export type SkillMutationResult = z.infer<typeof skillMutationResultSchema>;

export const skillExportResultSchema = z
  .object({
    cancelled: z.boolean(),
    filePath: z.string().min(1).optional(),
  })
  .strict();
export type SkillExportResult = z.infer<typeof skillExportResultSchema>;

export const skillImportResultSchema = z
  .object({
    cancelled: z.boolean(),
    skill: skillSummarySchema.optional(),
  })
  .strict();
export type SkillImportResult = z.infer<typeof skillImportResultSchema>;

/** 环境键的平台维度：OS/架构/ABI 任一不同都不能复用同一个环境。 */
export const targetPlatformSchema = z
  .object({
    os: z.enum(['darwin', 'win32', 'linux']),
    arch: z.enum(['arm64', 'x64']),
    /** CPython ABI 标签，例如 `cp312`；包锁与解释器必须一致。 */
    abi: z.string().trim().min(1).max(40),
  })
  .strict();
export type TargetPlatform = z.infer<typeof targetPlatformSchema>;

/**
 * 基础解释器：默认是算台管理的固定发行制品（带真实校验值），
 * 高级选项是用户选择的本机解释器；两者都只作为 venv 的基础，绝不修改其全局 site-packages。
 */
export const baseInterpreterSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('managed'),
      distributionId: z.string().min(1),
      version: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .strict(),
  z
    .object({
      kind: z.literal('local'),
      path: z.string().min(1),
      version: z.string().min(1),
    })
    .strict(),
]);
export type BaseInterpreter = z.infer<typeof baseInterpreterSchema>;

/** 已批准来源地址：只允许 https，且不得内嵌凭据（凭据只能来自宿主明确设置）。 */
const approvedHttpsUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => value.startsWith('https://'), {
    message: 'Approved source must be an https URL',
  })
  .refine((value) => !value.includes('@'), {
    message: 'Approved source must not embed credentials',
  });

export const dependencyLockPackageSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(80),
    wheel: z.string().trim().min(1).max(300),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    /** 只允许两个已批准来源：随包 wheelhouse（离线）与显式批准的 https 索引。 */
    source: z.enum(['wheelhouse', 'approved-index']),
    origin: approvedHttpsUrl.optional(),
    /** 精确制品地址；存在时优先于 origin 拼接，避免各索引布局差异导致取错文件。 */
    url: approvedHttpsUrl.optional(),
    /** SPDX 标识或上游分类，随包分发前整理许可清单用（A20）。 */
    license: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type DependencyLockPackage = z.infer<typeof dependencyLockPackageSchema>;

export const dependencyLockSchema = z
  .object({
    lockVersion: z.literal(1),
    platform: targetPlatformSchema,
    /** 基础解释器必须满足的版本前缀，例如 `3.12`。 */
    pythonRequirement: z.string().trim().min(1).max(40),
    packages: z.array(dependencyLockPackageSchema).max(500),
    /** ready 之前必须成功 import 的模块；缺一项都不能标 ready。 */
    importProbes: z.array(z.string().trim().min(1).max(200)).max(200),
  })
  .strict();
export type DependencyLock = z.infer<typeof dependencyLockSchema>;

/** 快照排除项必须逐条列明理由：用户要能看清哪些内容没有进入受管副本。 */
export const dependencySnapshotExclusionSchema = z
  .object({
    path: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type DependencySnapshotExclusion = z.infer<typeof dependencySnapshotExclusionSchema>;

export const dependencySnapshotSchema = z
  .object({
    id: z.string().min(1),
    /** 用户选择的外部目录；只作为来源标识，运行时一律使用受管副本。 */
    origin: z.string().min(1),
    originCommit: z.string().min(1).optional(),
    /** 源目录的版本状态；读不到 git 身份时如实记 unknown，不默认当作干净。 */
    originState: z.enum(['clean', 'dirty', 'unknown']),
    /** 所选内容（含本地修改）的清单 hash；内容寻址，因此相同内容只有一个快照。 */
    manifestHash: z.string().min(1),
    /** 相对受管资产根的目录键；PPTM_HOME 指向它解析出的绝对路径，不指向开发仓库。 */
    pathKey: z.string().min(1),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    exclusions: z.array(dependencySnapshotExclusionSchema).max(2000),
    createdAt: z.number().int().nonnegative(),
    verifiedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DependencySnapshot = z.infer<typeof dependencySnapshotSchema>;

export const runtimeEnvironmentSchema = z
  .object({
    id: z.string().min(1),
    /** 基础解释器指纹 + 平台 + 完整包锁 hash 派生；只有完全相同才共享环境。 */
    environmentKey: z.string().min(1),
    base: baseInterpreterSchema,
    platform: targetPlatformSchema,
    lockHash: z.string().min(1),
    /** 本环境实际安装的依赖锁；健康检查的 import 探测与缺项展示都读它。 */
    lock: dependencyLockSchema,
    /** 相对受管资产根的最终目录键；Renderer 永远不构造绝对路径。 */
    pathKey: z.string().min(1),
    status: skillEnvironmentStatusSchema,
    failureCode: z.string().min(1).optional(),
    failureSummary: z.string().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    readyAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export const dependencyOperationKindSchema = z.enum(['prepare', 'repair']);
export type DependencyOperationKind = z.infer<typeof dependencyOperationKindSchema>;

export const dependencyOperationStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);
export type DependencyOperationStatus = z.infer<typeof dependencyOperationStatusSchema>;

export const dependencyOperationStepSchema = z.enum([
  'resolve-interpreter',
  'create-environment',
  'install-packages',
  'probe-imports',
  'finalize',
]);
export type DependencyOperationStep = z.infer<typeof dependencyOperationStepSchema>;

export const dependencyOperationSchema = z
  .object({
    id: z.string().min(1),
    environmentId: z.string().min(1),
    environmentKey: z.string().min(1),
    kind: dependencyOperationKindSchema,
    status: dependencyOperationStatusSchema,
    step: dependencyOperationStepSchema.optional(),
    /** 可展示进度文本；不写代理凭据、不写完整安装日志。 */
    message: z.string().optional(),
    failureCode: z.string().min(1).optional(),
    failureSummary: z.string().optional(),
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DependencyOperation = z.infer<typeof dependencyOperationSchema>;

export const scriptExecutionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
]);
export type ScriptExecutionStatus = z.infer<typeof scriptExecutionStatusSchema>;

export const scriptExecutionReasonSchema = z.enum([
  'spawn-failed',
  'execute-failed',
  'validate-failed',
  'publish-failed',
  'cleanup-failed',
  'interrupted',
  'timed-out',
  'cancelled-by-user',
  'cancelled-by-run',
  'cancelled-by-trust-revoke',
  'cancelled-by-disable',
]);
export type ScriptExecutionReason = z.infer<typeof scriptExecutionReasonSchema>;

export const jobFailurePhaseSchema = z.enum(['spawn', 'execute', 'validate', 'publish', 'cleanup']);
export type JobFailurePhase = z.infer<typeof jobFailurePhaseSchema>;

/** 宿主内部执行规格：只由 Main 依据 runtime profile 构造，Renderer 与模型都提交不了它。 */
export const jobSpecSchema = z
  .object({
    protocolVersion: z.literal(1),
    executionId: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    bindingId: z.string().min(1),
    commandId: z.string().min(1),
    executable: z.string().min(1),
    argv: z.array(z.string()),
    cwd: z.string().min(1),
    env: z.record(z.string(), z.string()),
    timeoutMs: z.number().int().positive().max(1_800_000),
    maxOutputBytes: z.number().int().positive(),
    maxLogBytes: z.number().int().positive(),
    expectedOutputs: z.array(z.string().min(1)).max(100),
    validatorId: z.string().min(1).optional(),
  })
  .strict();
export type JobSpec = z.infer<typeof jobSpecSchema>;

export const jobResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('succeeded'),
      exitCode: z.number().int(),
      outputIds: z.array(z.string().min(1)),
      reportHash: z.string().min(1).optional(),
      durationMs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('failed'),
      phase: jobFailurePhaseSchema,
      code: z.string().min(1),
      summary: z.string(),
      logKey: z.string().min(1).optional(),
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cancelled'),
      cleanupCompleted: z.boolean(),
      diagnosticOutputIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      kind: z.literal('timed-out'),
      cleanupCompleted: z.boolean(),
      diagnosticOutputIds: z.array(z.string().min(1)),
    })
    .strict(),
]);
export type JobResult = z.infer<typeof jobResultSchema>;

export const runSkillBindingSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    skillRevisionId: skillRevisionIdSchema,
    profileRevisionId: z.string().min(1),
    environmentId: z.string().min(1).optional(),
    dependencySnapshotIds: z.array(z.string().min(1)),
    grantId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type RunSkillBinding = z.infer<typeof runSkillBindingSchema>;

export const scriptExecutionSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    bindingId: z.string().min(1),
    commandId: z.string().min(1),
    argumentDigest: z.string(),
    inputHashes: z.array(z.string().min(1)),
    workDirKey: z.string().min(1),
    attemptKey: z.string().min(1),
    status: scriptExecutionStatusSchema,
    reason: scriptExecutionReasonSchema.optional(),
    reportHash: z.string().min(1).optional(),
    outputIds: z.array(z.string().min(1)),
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ScriptExecution = z.infer<typeof scriptExecutionSchema>;

export interface WorkspaceSummary {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskSummary {
  id: string;
  workspaceId: string;
  title: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
}

export const createTaskRequestSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(20_000),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export interface CreatedTask {
  task: TaskSummary;
  sessionId: string;
}

export interface RecentTaskSummary extends TaskSummary {
  sessionId: string;
  latestRun?: RunSummary;
}

export const listTasksRequestSchema = z.object({ workspaceId: z.string().min(1).optional() });
export type ListTasksRequest = z.infer<typeof listTasksRequestSchema>;

export const cancelRunRequestSchema = z.object({ runId: z.string().min(1) });
export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>;

export const listRunEventsRequestSchema = z.object({ runId: z.string().min(1) });
export type ListRunEventsRequest = z.infer<typeof listRunEventsRequestSchema>;
export const listRunsRequestSchema = z.object({ taskId: z.string().min(1).optional() });
export type ListRunsRequest = z.infer<typeof listRunsRequestSchema>;

export const modelRoleSchema = z.enum(['language', 'vision', 'embedding']);
export type ModelRole = z.infer<typeof modelRoleSchema>;
export const modelConnectionStatusSchema = z.enum(['untested', 'connected', 'failed']);
export type ModelConnectionStatus = z.infer<typeof modelConnectionStatusSchema>;

export const modelProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1).max(200),
  role: modelRoleSchema,
  apiKey: z.string().max(2000).optional().default(''),
  maxContextTokens: z.number().int().positive().max(10_000_000).default(8192),
  maxOutputTokens: z.number().int().positive().max(1_000_000).default(8192),
  temperature: z.number().min(0).max(2).default(0.7),
  enabled: z.boolean().default(true),
  priority: z.number().int().nonnegative().optional(),
});
export type ModelProfileInput = z.infer<typeof modelProfileInputSchema>;
export const saveModelProfileRequestSchema = modelProfileInputSchema.extend({
  id: z.string().min(1).optional(),
});

export interface ModelProfileSummary {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  role: ModelRole;
  apiKeyConfigured: boolean;
  enabled: boolean;
  priority: number;
  connectionStatus: ModelConnectionStatus;
  lastTestedAt?: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  temperature: number;
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeFormat = 'markdown' | 'text' | 'pdf' | 'docx';

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  sourcePath: string;
  format: KnowledgeFormat;
  byteSize: number;
  contentHash: string;
  /** 选材入口的修订身份（KM01 §2.4）：当前登记文档的最新修订 ID。 */
  currentRevisionId?: string;
  pageCount?: number;
  importedAt: number;
  updatedAt: number;
}

export interface KnowledgeImportResult {
  imported: KnowledgeDocumentSummary[];
  skipped: Array<{ sourcePath: string; reason: string }>;
}

export const searchKnowledgeRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    mode: z.enum(['keyword', 'hybrid']).optional(),
  })
  .strict();
export type SearchKnowledgeRequest = z.infer<typeof searchKnowledgeRequestSchema>;
export const openKnowledgeSourceRequestSchema = z.object({
  sourcePath: z.string().trim().min(1).max(4_000),
});
export type OpenKnowledgeSourceRequest = z.infer<typeof openKnowledgeSourceRequestSchema>;
export interface OpenKnowledgeSourceResult {
  opened: boolean;
  error?: string;
}
export const removeKnowledgeDocumentRequestSchema = z.object({ id: z.string().min(1) });
export type RemoveKnowledgeDocumentRequest = z.infer<typeof removeKnowledgeDocumentRequestSchema>;
export const refreshKnowledgeDocumentRequestSchema = z.object({ id: z.string().min(1) });
export type RefreshKnowledgeDocumentRequest = z.infer<typeof refreshKnowledgeDocumentRequestSchema>;
export interface KnowledgeRefreshResult {
  refreshed?: KnowledgeDocumentSummary;
  error?: string;
}

export interface KnowledgeSearchResult {
  document: KnowledgeDocumentSummary;
  locator: string;
  excerpt: string;
  /** 与命中正文同一读快照的完整修订引用；命中内容变化后引用必须一起更换。 */
  reference: KnowledgeMaterialReference;
  /** 命中所在修订的提取文本哈希。 */
  textHash: string;
  span?: KnowledgeSpan;
  excerptHash?: string;
}

export interface EvidenceSummary {
  id: string;
  taskId: string;
  runId: string;
  sourceType: 'local-file' | 'web-page' | 'mcp-tool';
  sourceUri: string;
  title: string;
  locator: string;
  excerpt: string;
  contentHash: string;
  capturedAt: number;
  knowledgeSource?: KnowledgeEvidenceSource;
}

export type ArtifactVersionOrigin = 'assistant-run' | 'user-edit';

export type ArtifactType = 'markdown' | 'presentation';

export type ValidationStatus = 'pending' | 'passed' | 'failed' | 'not-checked';

export interface ValidationState {
  structure: ValidationStatus;
  visual: ValidationStatus;
  manualEdit: ValidationStatus;
}

export interface FileArtifactMeta {
  mimeType: string;
  fileSize: number;
  fileHash: string;
  fileKey: string;
  validation: ValidationState;
}

export interface MarkdownArtifactSummary {
  id: string;
  workspaceId: string;
  taskId: string;
  type: 'markdown';
  /** 当前版本的采用声明种类。 */
  sourceDeclarationKind?: ArtifactSourceDeclarationKind;
  title: string;
  currentVersionId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FileArtifactSummary {
  id: string;
  workspaceId: string;
  taskId: string;
  type: 'presentation';
  sourceDeclarationKind?: ArtifactSourceDeclarationKind;
  title: string;
  currentVersionId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  mimeType: string;
  fileSize: number;
  createdAt: number;
  updatedAt: number;
}

export type ArtifactSummary = MarkdownArtifactSummary | FileArtifactSummary;

export interface MarkdownArtifactDetail extends MarkdownArtifactSummary {
  content: string;
  contentHash: string;
  evidence: EvidenceSummary[];
  inputRelations?: ArtifactInputRelation[];
}

export interface FileArtifactDetail extends FileArtifactSummary {
  fileHash: string;
  fileKey: string;
  validation: ValidationState;
  description?: string;
  evidence: EvidenceSummary[];
  inputRelations?: ArtifactInputRelation[];
}

export type ArtifactDetail = MarkdownArtifactDetail | FileArtifactDetail;

export interface MarkdownArtifactVersionSummary {
  type: 'markdown';
  id: string;
  artifactId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  createdAt: number;
  sourceDeclarationKind?: ArtifactSourceDeclarationKind;
}

export interface FileArtifactVersionSummary {
  type: 'presentation';
  id: string;
  artifactId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  createdAt: number;
  sourceDeclarationKind?: ArtifactSourceDeclarationKind;
  mimeType: string;
  fileSize: number;
  validation: ValidationState;
}

export type ArtifactVersionSummary = MarkdownArtifactVersionSummary | FileArtifactVersionSummary;

export interface MarkdownArtifactVersionDetail extends MarkdownArtifactVersionSummary {
  content: string;
  contentHash: string;
  evidence: EvidenceSummary[];
  inputRelations?: ArtifactInputRelation[];
}

export interface FileArtifactVersionDetail extends FileArtifactVersionSummary {
  fileHash: string;
  fileKey: string;
  description?: string;
  evidence: EvidenceSummary[];
  inputRelations?: ArtifactInputRelation[];
}

export type ArtifactVersionDetail = MarkdownArtifactVersionDetail | FileArtifactVersionDetail;

export const saveMarkdownArtifactRequestSchema = z
  .object({
    artifactId: z.string().min(1).optional(),
    taskId: z.string().min(1),
    origin: z.enum(['assistant-run', 'user-edit']).default('assistant-run'),
    runId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(2_000_000),
    inputRelations: artifactInputRelationInputSchema.array().max(50).optional(),
  })
  .superRefine((input, context) => {
    if (input.origin === 'assistant-run' && !input.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AI 运行生成的成果必须关联 Run',
        path: ['runId'],
      });
    }
    if (input.origin === 'user-edit' && input.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '人工修订不能伪装为 AI 运行产物',
        path: ['runId'],
      });
    }
    if (input.origin === 'user-edit' && input.inputRelations && !input.artifactId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '新建成果没有可核验的来源运行，无法声明采用依据',
        path: ['inputRelations'],
      });
    }
  });
export type SaveMarkdownArtifactRequest = z.infer<typeof saveMarkdownArtifactRequestSchema>;
export const listArtifactsRequestSchema = z.object({ taskId: z.string().min(1).optional() });
export type ListArtifactsRequest = z.infer<typeof listArtifactsRequestSchema>;
export const getArtifactRequestSchema = z.object({ id: z.string().min(1) });
export const listArtifactVersionsRequestSchema = z.object({ artifactId: z.string().min(1) });
export const getArtifactVersionRequestSchema = z.object({ id: z.string().min(1) });
export const exportMarkdownArtifactRequestSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1).optional(),
});
export type ExportMarkdownArtifactRequest = z.infer<typeof exportMarkdownArtifactRequestSchema>;
export interface ExportMarkdownArtifactResult {
  cancelled: boolean;
  filePath?: string;
}

export const validationStatusSchema = z.enum(['pending', 'passed', 'failed', 'not-checked']);
export type ValidationStatusInput = z.infer<typeof validationStatusSchema>;

export const validationStateSchema = z
  .object({
    structure: validationStatusSchema,
    visual: validationStatusSchema,
    manualEdit: validationStatusSchema,
  })
  .strict();
export type ValidationStateInput = z.infer<typeof validationStateSchema>;

/** Host-owned output metadata; never supplied by the model. */
export const verifiedExecutionOutputSchema = z
  .object({
    outputId: z.string().min(1),
    relativePath: z.string().min(1),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/u),
    fileSize: z.number().int().nonnegative(),
    reportHash: z.string().regex(/^[a-f0-9]{64}$/u),
    validation: validationStateSchema,
  })
  .strict();
export type VerifiedExecutionOutput = z.infer<typeof verifiedExecutionOutputSchema>;

export const registerFileArtifactRequestSchema = z
  .object({
    runId: z.string().min(1),
    executionId: z.string().min(1),
    outputId: z.string().min(1),
    artifactId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    mimeType: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(10_000).optional(),
    validation: validationStateSchema.optional(),
    inputRelations: artifactInputRelationInputSchema.array().max(50).optional(),
  })
  .superRefine((input, context) => {
    if (input.validation?.structure === 'failed') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '结构校验失败的成果不可登记为可交付版本',
        path: ['validation', 'structure'],
      });
    }
  });
export type RegisterFileArtifactRequest = z.infer<typeof registerFileArtifactRequestSchema>;

export interface RegisterFileArtifactResult {
  artifactId: string;
  versionId: string;
  versionNumber: number;
  fileKey: string;
  fileHash: string;
  fileSize: number;
  validation: ValidationState;
}

export const getFileArtifactRequestSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1).optional(),
});
export type GetFileArtifactRequest = z.infer<typeof getFileArtifactRequestSchema>;

export const exportFileArtifactRequestSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1).optional(),
});
export type ExportFileArtifactRequest = z.infer<typeof exportFileArtifactRequestSchema>;

export interface ExportFileArtifactResult {
  cancelled: boolean;
  filePath?: string;
}

export const listEvidenceRequestSchema = z.object({ taskId: z.string().min(1) });
export type ListEvidenceRequest = z.infer<typeof listEvidenceRequestSchema>;

export const modelProfileIdSchema = z.object({ id: z.string().min(1) });
export const setDefaultModelRequestSchema = z.object({ id: z.string().min(1) });
export const setModelEnabledRequestSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});
export const testModelRequestSchema = modelProfileInputSchema
  .pick({ baseUrl: true, model: true, role: true, apiKey: true })
  .extend({ id: z.string().min(1).optional() });
export const updateWindowThemeRequestSchema = z.object({
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  symbolColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type UpdateWindowThemeRequest = z.infer<typeof updateWindowThemeRequestSchema>;

export const windowToggleMaximizeRequestSchema = z.object({}).strict();
export type WindowToggleMaximizeRequest = z.infer<typeof windowToggleMaximizeRequestSchema>;

export const searchProviderIdSchema = z.enum(['baidu_qianfan']);
export type SearchProviderId = z.infer<typeof searchProviderIdSchema>;

export const searchEngineConfigInputSchema = z.object({
  provider: searchProviderIdSchema,
  apiKey: z.string().max(2000).optional().default(''),
  webTopK: z.number().int().min(1).max(20).default(10),
  enabled: z.boolean().default(true),
});
export type SearchEngineConfigInput = z.infer<typeof searchEngineConfigInputSchema>;
export const saveSearchEngineRequestSchema = searchEngineConfigInputSchema;
export const testSearchEngineRequestSchema = searchEngineConfigInputSchema;

export interface SearchEngineSummary {
  provider: SearchProviderId;
  apiKeyConfigured: boolean;
  enabled: boolean;
  webTopK: number;
  connectionStatus: ModelConnectionStatus;
  lastTestedAt?: number;
  updatedAt: number;
}

// —— 凭据契约（CF10，ADR-0024 §3/§4）。`CredentialRecord` 只属于 Main/持久层，
// 不进入任何 Renderer 读 DTO；下面只定义共享契约词汇，本卡不新增 IPC channel。

/** 凭据归属：一个凭据只有一个 owner（API profile、MCP 连接槽位或模型 profile）。 */
export const credentialOwnerKindSchema = z.enum([
  'api-service-profile',
  'mcp-connection',
  'model-profile',
]);
export type CredentialOwnerKind = z.infer<typeof credentialOwnerKindSchema>;

/** 单条凭据明文的长度上限；空值在上层归一为 keep，超长直接拒绝。 */
export const MAX_CREDENTIAL_LENGTH = 8_192;

/**
 * 只写不读的凭据变更语义（§4）：编辑器空输入归一为 `keep`，
 * `replace` 必须带非空值，`clear` 是显式动作。Renderer 持有的新值保存/取消即清空，不落 localStorage。
 */
export const credentialMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z
    .object({ action: z.literal('replace'), value: z.string().min(1).max(MAX_CREDENTIAL_LENGTH) })
    .strict(),
  z.object({ action: z.literal('clear') }).strict(),
]);
export type CredentialMutation = z.infer<typeof credentialMutationSchema>;

/**
 * 公开的凭据状态：只有版本元数据与 configured/availability 信息，绝不包含明文或密文。
 * `configured=false` 表示缺失（从未写入或已 clear）；`configured=true` 且 `available=false`
 * 表示受保护存储不可用——§6 里两者语义可区分。`version` 是单调递增的非敏感版本号。
 */
export const credentialStatusSchema = z
  .object({
    configured: z.boolean(),
    available: z.boolean(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

/** 凭据错误码（§6）：三者都禁止明文回退，各自对应明确的修复动作。 */
export const credentialErrorCodeSchema = z.enum([
  'credential_missing',
  'credential_unavailable',
  'credential_migration_required',
]);
export type CredentialErrorCode = z.infer<typeof credentialErrorCodeSchema>;

export interface RunSkillBindingSummary {
  skillId: string;
  skillName: string;
}

export interface RunSummary {
  id: string;
  taskId: string;
  sessionId: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
  /** 本次 Run 绑定的技能集合（按绑定顺序），用于界面恢复 chip 条。 */
  bindings?: RunSkillBindingSummary[];
}

export const notificationLevelSchema = z.enum(['info', 'success', 'warning', 'error']);
export type NotificationLevel = z.infer<typeof notificationLevelSchema>;
export const notificationKindSchema = z.enum(['run', 'knowledge-import', 'artifact', 'system']);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), taskId: z.string().min(1) }),
  z.object({ kind: z.literal('artifact'), artifactId: z.string().min(1) }),
  z.object({ kind: z.literal('knowledge') }),
]);
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export const notificationSummarySchema = z.object({
  id: z.string().min(1),
  level: notificationLevelSchema,
  kind: notificationKindSchema,
  title: z.string(),
  detail: z.string().optional(),
  target: notificationTargetSchema.optional(),
  read: z.boolean(),
  createdAt: z.number().int().nonnegative(),
});
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;

export const createNotificationInputSchema = z.object({
  level: notificationLevelSchema,
  kind: notificationKindSchema,
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2_000).optional(),
  target: notificationTargetSchema.optional(),
});
export type CreateNotificationInput = z.infer<typeof createNotificationInputSchema>;

export const markNotificationReadRequestSchema = z.object({ id: z.string().min(1) });
export type MarkNotificationReadRequest = z.infer<typeof markNotificationReadRequestSchema>;
export const markAllNotificationsReadRequestSchema = z.object({}).strict();
export const clearNotificationsRequestSchema = z.object({}).strict();

export const notificationChangeEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('created'),
    notification: notificationSummarySchema,
    unreadCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('read'),
    notificationId: z.string().min(1),
    unreadCount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('read-all'), unreadCount: z.number().int().nonnegative() }),
  z.object({ type: z.literal('cleared'), unreadCount: z.number().int().nonnegative() }),
]);
export type NotificationChangeEvent = z.infer<typeof notificationChangeEventSchema>;

export const notificationActivatedSchema = z.object({ id: z.string().min(1) });
export type NotificationActivated = z.infer<typeof notificationActivatedSchema>;

/** IPC 返回值同样跨信任边界；这些 Schema 由 Main 注册器在交给 Preload 前校验。 */
export const workspaceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  rootPath: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const runSkillBindingSummarySchema = z.object({
  skillId: z.string().min(1),
  skillName: z.string().min(1),
});
export const runSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  prompt: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  bindings: z.array(runSkillBindingSummarySchema).optional(),
});
export const taskSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string(),
  goal: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const createdTaskSchema = z.object({
  task: taskSummarySchema,
  sessionId: z.string().min(1),
});
export const recentTaskSummarySchema = taskSummarySchema.extend({
  sessionId: z.string().min(1),
  latestRun: runSummarySchema.optional(),
});
export const evidenceSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  sourceType: z.enum(['local-file', 'web-page', 'mcp-tool']),
  sourceUri: z.string().min(1),
  title: z.string(),
  locator: z.string(),
  excerpt: z.string(),
  contentHash: z.string().min(1),
  capturedAt: z.number().int().nonnegative(),
  knowledgeSource: knowledgeEvidenceSourceSchema.optional(),
});
export const markdownArtifactSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  type: z.literal('markdown'),
  sourceDeclarationKind: artifactSourceDeclarationKindSchema.optional(),
  title: z.string(),
  currentVersionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  origin: z.enum(['assistant-run', 'user-edit']),
  sourceRunId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const fileArtifactSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  type: z.literal('presentation'),
  sourceDeclarationKind: artifactSourceDeclarationKindSchema.optional(),
  title: z.string(),
  currentVersionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  origin: z.enum(['assistant-run', 'user-edit']),
  sourceRunId: z.string().min(1).optional(),
  mimeType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const artifactSummarySchema = z.discriminatedUnion('type', [
  markdownArtifactSummarySchema,
  fileArtifactSummarySchema,
]);
export const markdownArtifactDetailSchema = markdownArtifactSummarySchema.extend({
  content: z.string(),
  contentHash: z.string().min(1),
  evidence: z.array(evidenceSummarySchema),
  inputRelations: z.array(artifactInputRelationSchema).optional(),
});
export const fileArtifactDetailSchema = fileArtifactSummarySchema.extend({
  fileHash: z.string().min(1),
  fileKey: z.string().min(1),
  validation: validationStateSchema,
  description: z.string().trim().max(10_000).optional(),
  evidence: z.array(evidenceSummarySchema),
  inputRelations: z.array(artifactInputRelationSchema).optional(),
});
export const artifactDetailSchema = z.discriminatedUnion('type', [
  markdownArtifactDetailSchema,
  fileArtifactDetailSchema,
]);
export const markdownArtifactVersionSummarySchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  origin: z.enum(['assistant-run', 'user-edit']),
  sourceRunId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  /** 省略只出现在迁移前的历史数据；新写入一律显式携带。 */
  sourceDeclarationKind: artifactSourceDeclarationKindSchema.optional(),
});
export const fileArtifactVersionSummarySchema = markdownArtifactVersionSummarySchema.extend({
  mimeType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  validation: validationStateSchema,
});
export const artifactVersionSummarySchema = z.discriminatedUnion('type', [
  markdownArtifactVersionSummarySchema.extend({ type: z.literal('markdown') }),
  fileArtifactVersionSummarySchema.extend({ type: z.literal('presentation') }),
]);
export const markdownArtifactVersionDetailSchema = markdownArtifactVersionSummarySchema.extend({
  content: z.string(),
  contentHash: z.string().min(1),
  evidence: z.array(evidenceSummarySchema),
  inputRelations: z.array(artifactInputRelationSchema).optional(),
});
export const fileArtifactVersionDetailSchema = fileArtifactVersionSummarySchema.extend({
  fileHash: z.string().min(1),
  fileKey: z.string().min(1),
  description: z.string().trim().max(10_000).optional(),
  evidence: z.array(evidenceSummarySchema),
  inputRelations: z.array(artifactInputRelationSchema).optional(),
});
export const artifactVersionDetailSchema = z.discriminatedUnion('type', [
  markdownArtifactVersionDetailSchema.extend({ type: z.literal('markdown') }),
  fileArtifactVersionDetailSchema.extend({ type: z.literal('presentation') }),
]);
export const modelProfileSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  provider: z.string(),
  baseUrl: z.string().url(),
  model: z.string(),
  role: modelRoleSchema,
  apiKeyConfigured: z.boolean(),
  enabled: z.boolean(),
  priority: z.number().int().nonnegative(),
  connectionStatus: modelConnectionStatusSchema,
  lastTestedAt: z.number().int().nonnegative().optional(),
  maxContextTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  temperature: z.number(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const knowledgeDocumentSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  sourcePath: z.string().min(1),
  format: z.enum(['markdown', 'text', 'pdf', 'docx']),
  byteSize: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  currentRevisionId: z.string().min(1).optional(),
  pageCount: z.number().int().positive().optional(),
  importedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const knowledgeImportResultSchema = z.object({
  imported: z.array(knowledgeDocumentSummarySchema),
  skipped: z.array(z.object({ sourcePath: z.string().min(1), reason: z.string().min(1) })),
});
export const knowledgeSearchResultSchema = z.object({
  document: knowledgeDocumentSummarySchema,
  locator: z.string(),
  excerpt: z.string(),
  reference: knowledgeMaterialReferenceSchema,
  textHash: z.string().min(1),
  // 摘要必须能回算到 section 的精确码点范围（KM02 Run 审计使用；KM08 两入口统一）。
  span: knowledgeSpanSchema.optional(),
  excerptHash: z.string().min(1).optional(),
});
export const knowledgeRefreshResultSchema = z.object({
  refreshed: knowledgeDocumentSummarySchema.optional(),
  error: z.string().optional(),
});

/** 知识正文分页与修订身份（契约 §2.2/§2.3/§3.1）的唯一数值真相源。 */
export const KNOWLEDGE_REVISION_MAX_TEXT_CODE_POINTS = 2_000_000;
export const KNOWLEDGE_PAGE_DEFAULT_CODE_POINTS = 4_000;
export const KNOWLEDGE_PAGE_MAX_CODE_POINTS = 8_000;
export const KNOWLEDGE_PAGE_MAX_PARTS = 20;

/** Run 正文累计读取预算（知识契约 §2.2）：按每次实际返回码点计。 */
export const KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS = 60_000;
export const KNOWLEDGE_SEARCH_TOOL_MAX_RESULTS = 8;
export const KNOWLEDGE_SEARCH_SUMMARY_MAX_CODE_POINTS = 400;
export const KNOWLEDGE_SEARCH_CANDIDATE_LIMIT = 50;

/** 当前可发布向量总数上限（契约 §2.2）：超出保持关键词可用并报告容量不足。 */
export const KNOWLEDGE_VECTOR_MAX_PUBLISHED = 20_000;

/** Embedding 请求与响应预算（契约 §2.2/§7.2）：生产者与消费者都引用这里，不在实现里另写数字。 */
export const KNOWLEDGE_EMBEDDING_BATCH_INPUT_MAX = 16;
export const KNOWLEDGE_EMBEDDING_BATCH_CODE_POINT_BUDGET = 16_000;
export const KNOWLEDGE_EMBEDDING_QUERY_INPUT_MAX = 1;
export const KNOWLEDGE_EMBEDDING_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const KNOWLEDGE_EMBEDDING_DIMENSION_MIN = 1;
export const KNOWLEDGE_EMBEDDING_DIMENSION_MAX = 4_096;
export const KNOWLEDGE_EMBEDDING_BATCH_TIMEOUT_MS = 30_000;
export const KNOWLEDGE_EMBEDDING_QUERY_TIMEOUT_MS = 10_000;
/** 向量空间指纹的算法版本与固定请求格式；任一变化都使旧空间不兼容。 */
export const KNOWLEDGE_EMBEDDING_FINGERPRINT_VERSION = 'knowledge-embedding-v1';
export const KNOWLEDGE_EMBEDDING_RESPONSE_FORMAT = 'float';

/**
 * 无密钥的嵌入模型身份（契约 §7.1）。完整 endpoint 只存在于 Main 的请求配置里，
 * 对外只有它的指纹；dimension 省略表示共享空间还没被首个合法批次锁定。
 */
export const embeddingModelSnapshotSchema = z
  .object({
    profileId: z.string().min(1),
    provider: z.string().min(1),
    endpointFingerprint: z.string().min(1),
    model: z.string().min(1),
    modelFingerprint: z.string().min(1),
    dimension: z
      .number()
      .int()
      .min(KNOWLEDGE_EMBEDDING_DIMENSION_MIN)
      .max(KNOWLEDGE_EMBEDDING_DIMENSION_MAX)
      .optional(),
  })
  .strict();
export type EmbeddingModelSnapshot = z.infer<typeof embeddingModelSnapshotSchema>;

/** usage 只接受服务返回的非负整数；缺失就省略，不用字符数伪造。 */
export const embeddingUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();
export type EmbeddingUsage = z.infer<typeof embeddingUsageSchema>;

/** 索引作业词汇（知识契约 §8.1）：kind、状态与阶段各只有一份定义。 */
export const knowledgeJobKindSchema = z.enum([
  'import',
  'refresh',
  'rebuild-keyword',
  'rebuild-semantic',
  'check-source',
]);
export type KnowledgeJobKind = z.infer<typeof knowledgeJobKindSchema>;

export const knowledgeJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);
export type KnowledgeJobStatus = z.infer<typeof knowledgeJobStatusSchema>;

export const knowledgeJobItemStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);
export type KnowledgeJobItemStatus = z.infer<typeof knowledgeJobItemStatusSchema>;

export const knowledgeJobPhaseSchema = z.enum([
  'read',
  'extract',
  'chunk',
  'embed',
  'publish',
  'check',
]);
export type KnowledgeJobPhase = z.infer<typeof knowledgeJobPhaseSchema>;

/** 手动重试只接受这三种未完成原因，且作业必须已终态。 */
export const knowledgeRetryableItemStatusSchema = z.enum(['failed', 'interrupted', 'cancelled']);
export type KnowledgeRetryableItemStatus = z.infer<typeof knowledgeRetryableItemStatusSchema>;

/** 安全失败说明：稳定错误码 + 最多 500 码点的去敏文本（契约 §2.2）。 */
export const knowledgeJobFailureSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
  })
  .strict();
export type KnowledgeJobFailure = z.infer<typeof knowledgeJobFailureSchema>;

export const knowledgeJobSummarySchema = z
  .object({
    id: z.string().min(1),
    kind: knowledgeJobKindSchema,
    status: knowledgeJobStatusSchema,
    attempt: z.number().int().positive(),
    /** 按 job 持久化的单调事件序号，只用于展示顺序，不替代 attempt。 */
    sequence: z.number().int().positive(),
    retryOfJobId: z.string().min(1).optional(),
    spaceId: z.string().min(1).optional(),
    totalCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    failure: knowledgeJobFailureSchema.optional(),
  })
  .strict();
export type KnowledgeJobSummary = z.infer<typeof knowledgeJobSummarySchema>;

/** 条目摘要只回已登记 documentId 或文件名，不回原始 target/request JSON。 */
export const knowledgeJobItemSummarySchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    status: knowledgeJobItemStatusSchema,
    phase: knowledgeJobPhaseSchema,
    attempt: z.number().int().positive(),
    completedUnits: z.number().int().nonnegative(),
    totalUnits: z.number().int().nonnegative().optional(),
    resultRevisionId: z.string().min(1).optional(),
    failure: knowledgeJobFailureSchema.optional(),
  })
  .strict();
export type KnowledgeJobItemSummary = z.infer<typeof knowledgeJobItemSummarySchema>;

export const knowledgeJobDetailSchema = z
  .object({ job: knowledgeJobSummarySchema, items: z.array(knowledgeJobItemSummarySchema) })
  .strict();
export type KnowledgeJobDetail = z.infer<typeof knowledgeJobDetailSchema>;

/** 作业启动回执：耗时动作立即返回可取消、可回看的 jobId。 */
export const knowledgeJobAckSchema = z.object({ jobId: z.string().min(1) }).strict();
export type KnowledgeJobAck = z.infer<typeof knowledgeJobAckSchema>;

/** 文件对话框取消沿用既有语义：不创建作业，也不返回空 jobId。 */
export const knowledgeImportAckSchema = z
  .object({ cancelled: z.boolean(), jobId: z.string().min(1).optional() })
  .strict();
export type KnowledgeImportAck = z.infer<typeof knowledgeImportAckSchema>;

export const knowledgeJobCursorSchema = z
  .object({ createdAt: z.number().int().nonnegative(), id: z.string().min(1) })
  .strict();
export type KnowledgeJobCursor = z.infer<typeof knowledgeJobCursorSchema>;

export const listKnowledgeJobsRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    cursor: knowledgeJobCursorSchema.optional(),
  })
  .strict();
export type ListKnowledgeJobsRequest = z.infer<typeof listKnowledgeJobsRequestSchema>;

export const knowledgeJobPageSchema = z
  .object({
    jobs: z.array(knowledgeJobSummarySchema),
    nextCursor: knowledgeJobCursorSchema.optional(),
  })
  .strict();
export type KnowledgeJobPage = z.infer<typeof knowledgeJobPageSchema>;

export const knowledgeJobIdRequestSchema = z.object({ jobId: z.string().min(1) }).strict();

/** 取消结果只回答「有没有这个作业可取消」；取消本身不发失败通知。 */
export const knowledgeJobCancelResultSchema = z.object({ cancelled: z.boolean() }).strict();
export type KnowledgeJobCancelResult = z.infer<typeof knowledgeJobCancelResultSchema>;

export const retryKnowledgeJobRequestSchema = z
  .object({
    jobId: z.string().min(1),
    itemIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();
export type RetryKnowledgeJobRequest = z.infer<typeof retryKnowledgeJobRequestSchema>;

/** 语义设置（契约 §7.1）：启用时固定具体 profileId，切换必须显式。 */
export const knowledgeSearchSettingsSchema = z
  .object({
    semanticEnabled: z.boolean(),
    embeddingProfileId: z.string().min(1).optional(),
    revision: z.number().int().positive(),
    embeddingAvailable: z.boolean(),
    unavailableReason: z.string().max(500).optional(),
  })
  .strict();
export type KnowledgeSearchSettings = z.infer<typeof knowledgeSearchSettingsSchema>;

export const saveKnowledgeSettingsRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    semanticEnabled: z.boolean(),
    embeddingProfileId: z.string().min(1).optional(),
  })
  .strict();
export type SaveKnowledgeSettingsRequest = z.infer<typeof saveKnowledgeSettingsRequestSchema>;

/** 重建：关键词按目标文档或精确历史修订；语义整体重建不接受局部目标。 */
export const rebuildKnowledgeIndexRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('keyword'),
      documentIds: z.array(z.string().min(1)).max(200).optional(),
      revisions: z.array(knowledgeMaterialReferenceSchema).max(200).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('semantic'),
      resetSemanticSpace: z.boolean().optional(),
    })
    .strict(),
]);
export type RebuildKnowledgeIndexRequest = z.infer<typeof rebuildKnowledgeIndexRequestSchema>;

export const checkKnowledgeSourcesRequestSchema = z
  .object({ documentIds: z.array(z.string().min(1)).min(1).max(200) })
  .strict();
export type CheckKnowledgeSourcesRequest = z.infer<typeof checkKnowledgeSourcesRequestSchema>;

export const knowledgeWarningCodeSchema = z.enum([
  'formula-without-cached-result',
  'truncated',
  'unsupported-feature',
]);
export type KnowledgeWarningCode = z.infer<typeof knowledgeWarningCodeSchema>;

/**
 * KM07b 提取 Worker 线协议（契约 §8.2）：Main 给字节，Worker 还提取结果。
 * Worker 不读文件路径、不访问网络、不写数据库；请求与响应都逐行 JSON、有大小上限。
 */
export const KNOWLEDGE_WORKER_REQUEST_MAX_BASE64_BYTES = 32 * 1024 * 1024;
export const KNOWLEDGE_WORKER_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
export const KNOWLEDGE_WORKER_SHUTDOWN_GRACE_MS = 1_000;
export const KNOWLEDGE_WORKER_EXTRACT_TIMEOUT_MS = 30_000;

const knowledgeWorkerEnvelope = {
  id: z.string().min(1).max(64),
  nonce: z.string().min(1).max(64),
};

export const knowledgeExtractedSectionSchema = z
  .object({
    locator: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    content: z.string(),
  })
  .strict();
export type KnowledgeExtractedSection = z.infer<typeof knowledgeExtractedSectionSchema>;

export const knowledgeExtractedDocumentSchema = z
  .object({
    format: z.enum(['markdown', 'text', 'pdf', 'docx']),
    content: z.string(),
    pageCount: z.number().int().positive().optional(),
    warnings: z.array(knowledgeWarningCodeSchema).optional(),
    sections: z.array(knowledgeExtractedSectionSchema),
  })
  .strict();
export type KnowledgeExtractedDocument = z.infer<typeof knowledgeExtractedDocumentSchema>;

export const knowledgeWorkerJobContextSchema = z
  .object({
    jobId: z.string().min(1),
    attempt: z.number().int().positive(),
  })
  .strict();
export type KnowledgeWorkerJobContext = z.infer<typeof knowledgeWorkerJobContextSchema>;

export const knowledgeWorkerExtractRequestSchema = z
  .object({
    ...knowledgeWorkerEnvelope,
    op: z.literal('extract'),
    job: knowledgeWorkerJobContextSchema,
    format: knowledgeExtractedDocumentSchema.shape.format,
    dataBase64: z.string().max(KNOWLEDGE_WORKER_REQUEST_MAX_BASE64_BYTES),
  })
  .strict();
export type KnowledgeWorkerExtractRequest = z.infer<typeof knowledgeWorkerExtractRequestSchema>;

export const knowledgeWorkerShutdownRequestSchema = z
  .object({ ...knowledgeWorkerEnvelope, op: z.literal('shutdown') })
  .strict();

export const knowledgeWorkerScanEntrySchema = z
  .object({
    chunkId: z.string().min(1),
    vectorBase64: z.string().min(8),
  })
  .strict();
export type KnowledgeWorkerScanEntry = z.infer<typeof knowledgeWorkerScanEntrySchema>;

/**
 * 向量扫描（契约 §8.2/§9.2）：Main 读向量并按每批 ≤1 MiB 载荷切分，
 * Worker 只做点积并回本批 top 50；全局 top 50 必在各批 top 50 的并集内。
 */
export const KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES = 1024 * 1024;

export const knowledgeWorkerScanRequestSchema = z
  .object({
    ...knowledgeWorkerEnvelope,
    op: z.literal('scan'),
    spaceId: z.string().min(1),
    dimension: z
      .number()
      .int()
      .min(KNOWLEDGE_EMBEDDING_DIMENSION_MIN)
      .max(KNOWLEDGE_EMBEDDING_DIMENSION_MAX),
    queryBase64: z.string().min(8),
    entries: z
      .array(knowledgeWorkerScanEntrySchema)
      .max(
        Math.floor(
          KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES /
            (KNOWLEDGE_EMBEDDING_DIMENSION_MIN * Float32Array.BYTES_PER_ELEMENT),
        ),
      ),
  })
  .strict();
export type KnowledgeWorkerScanRequest = z.infer<typeof knowledgeWorkerScanRequestSchema>;

export const knowledgeWorkerRequestSchema = z.discriminatedUnion('op', [
  knowledgeWorkerExtractRequestSchema,
  knowledgeWorkerScanRequestSchema,
  knowledgeWorkerShutdownRequestSchema,
]);
export type KnowledgeWorkerRequest = z.infer<typeof knowledgeWorkerRequestSchema>;

export const knowledgeWorkerResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...knowledgeWorkerEnvelope,
      kind: z.literal('result'),
      document: knowledgeExtractedDocumentSchema,
    })
    .strict(),
  z
    .object({
      ...knowledgeWorkerEnvelope,
      kind: z.literal('scores'),
      scores: z.array(
        z
          .object({
            chunkId: z.string().min(1),
            score: z.number().finite(),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      ...knowledgeWorkerEnvelope,
      kind: z.literal('error'),
      code: z.string().min(1).max(64),
      message: z.string().min(1).max(500),
    })
    .strict(),
  z.object({ ...knowledgeWorkerEnvelope, kind: z.literal('shutdown') }).strict(),
]);
export type KnowledgeWorkerResponse = z.infer<typeof knowledgeWorkerResponseSchema>;

/**
 * KM08 统一检索管线（契约 §9）：scope 由宿主注入，runId 不是模型输入；
 * RRF 常数与候选上限只在契约 §2.2 定义，这里引用，不允许实现另写数字。
 */
export const knowledgeSearchScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('library'),
      collectionId: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('run'), runId: z.string().min(1) }).strict(),
]);
export type KnowledgeSearchScope = z.infer<typeof knowledgeSearchScopeSchema>;

export const knowledgeSearchModeSchema = z.enum(['keyword', 'hybrid']);
export type KnowledgeSearchMode = z.infer<typeof knowledgeSearchModeSchema>;

/** effectiveMode 多出的 vector 表示本次只有向量路有结果（契约 §9.3）。 */
export const knowledgeSearchEffectiveModeSchema = z.enum(['keyword', 'hybrid', 'vector']);
export type KnowledgeSearchEffectiveMode = z.infer<typeof knowledgeSearchEffectiveModeSchema>;

export const knowledgeSearchDegradedReasonSchema = z.enum([
  'semantic-disabled',
  'model-unavailable',
  'index-missing',
  'index-partial',
  'index-stale',
  'embedding-failed',
  'capacity-exceeded',
]);
export type KnowledgeSearchDegradedReason = z.infer<typeof knowledgeSearchDegradedReasonSchema>;

export const knowledgeSearchMatchedBySchema = z.enum(['keyword', 'vector', 'both']);
export type KnowledgeSearchMatchedBy = z.infer<typeof knowledgeSearchMatchedBySchema>;

/** RRF 融合常数（契约 §9.2）：两路同权，rank 从 1 起。 */
export const KNOWLEDGE_SEARCH_RRF_K = 60;

export const knowledgeSearchHitSchema = z
  .object({
    chunkId: z.string().min(1),
    reference: knowledgeMaterialReferenceSchema,
    textHash: z.string().min(1),
    title: z.string(),
    format: z.enum(['markdown', 'text', 'pdf', 'docx']),
    locator: z.string(),
    span: knowledgeSpanSchema,
    excerpt: z.string(),
    excerptHash: z.string().min(1),
    matchedBy: knowledgeSearchMatchedBySchema,
    evidenceId: z.string().min(1).optional(),
  })
  .strict();
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>;

export const knowledgeSearchCoverageSchema = z
  .object({
    eligibleChunks: z.number().int().nonnegative(),
    indexedChunks: z.number().int().nonnegative(),
  })
  .strict();
export type KnowledgeSearchCoverage = z.infer<typeof knowledgeSearchCoverageSchema>;

export const knowledgeSearchResponseSchema = z
  .object({
    results: z.array(knowledgeSearchHitSchema),
    requestedMode: knowledgeSearchModeSchema,
    effectiveMode: knowledgeSearchEffectiveModeSchema,
    degradedReason: knowledgeSearchDegradedReasonSchema.optional(),
    coverage: knowledgeSearchCoverageSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type KnowledgeSearchResponse = z.infer<typeof knowledgeSearchResponseSchema>;

export const knowledgeRevisionSummarySchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  revision: z.number().int().positive(),
  title: z.string(),
  sourcePath: z.string().min(1),
  format: z.enum(['markdown', 'text', 'pdf', 'docx']),
  byteSize: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  pageCount: z.number().int().positive().optional(),
  parserVersion: z.string().min(1),
  chunkingVersion: z.string().min(1),
  textHash: z.string().min(1),
  sectionCount: z.number().int().nonnegative(),
  warnings: z.array(knowledgeWarningCodeSchema),
  importedAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});
export type KnowledgeRevisionSummary = z.infer<typeof knowledgeRevisionSummarySchema>;

export const knowledgeTextPagePartSchema = z
  .object({
    span: knowledgeSpanSchema,
    locator: z.string(),
    text: z.string(),
    excerptHash: z.string().min(1),
  })
  .strict();
export type KnowledgeTextPagePart = z.infer<typeof knowledgeTextPagePartSchema>;

export const knowledgeTextPageSchema = z
  .object({
    reference: knowledgeMaterialReferenceSchema,
    textHash: z.string().min(1),
    title: z.string(),
    parserVersion: z.string().min(1),
    chunkingVersion: z.string().min(1),
    warnings: z.array(knowledgeWarningCodeSchema),
    parts: z.array(knowledgeTextPagePartSchema),
    returnedCodePoints: z.number().int().nonnegative(),
    complete: z.boolean(),
    nextCursor: knowledgeCursorSchema.optional(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.complete && page.nextCursor) {
      context.addIssue({
        code: 'custom',
        message: 'complete page must not carry nextCursor',
        path: ['nextCursor'],
      });
    }
  });
export type KnowledgeTextPage = z.infer<typeof knowledgeTextPageSchema>;

export const knowledgeReadRequestSchema = z
  .object({
    reference: knowledgeMaterialReferenceSchema,
    cursor: knowledgeCursorSchema.optional(),
    maxCodePoints: z.number().int().min(1).max(KNOWLEDGE_PAGE_MAX_CODE_POINTS).optional(),
  })
  .strict();
export type KnowledgeReadRequest = z.infer<typeof knowledgeReadRequestSchema>;

export const knowledgeResearchDraftMaterialSchema = z
  .object({
    reference: knowledgeMaterialReferenceSchema,
    purpose: materialPurposeSchema.default('background'),
  })
  .strict();
export type KnowledgeResearchDraftMaterial = z.infer<typeof knowledgeResearchDraftMaterialSchema>;

export const knowledgeCreateResearchDraftRequestSchema = z.object({
  operationId: z.string().uuid(),
  workspaceId: z.string().min(1),
  prompt: z.string().trim().min(1).max(8_000),
  materials: z.array(knowledgeResearchDraftMaterialSchema).min(1),
});
export type KnowledgeCreateResearchDraftRequest = z.infer<
  typeof knowledgeCreateResearchDraftRequestSchema
>;

export const knowledgeResearchDraftResultSchema = z
  .object({
    task: taskSummarySchema,
    context: taskContextRevisionSchema,
    prompt: z.string(),
  })
  .strict();
export type KnowledgeResearchDraftResult = z.infer<typeof knowledgeResearchDraftResultSchema>;

export const listKnowledgeRevisionsRequestSchema = z.object({ documentId: z.string().min(1) });
export type ListKnowledgeRevisionsRequest = z.infer<typeof listKnowledgeRevisionsRequestSchema>;

export const previewRunSourceRequestSchema = z
  .object({ runId: z.string().min(1), evidenceId: z.string().min(1) })
  .strict();
export type PreviewRunSourceRequest = z.infer<typeof previewRunSourceRequestSchema>;

/** 回看单条证据实际返回过的区间：精确来源止于 span、无续页；旧来源不推测位置（契约 §3.1）。 */
export const runSourcePreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), page: knowledgeTextPageSchema }).strict(),
  z.object({ kind: z.literal('legacy'), evidence: evidenceSummarySchema }).strict(),
]);
export type RunSourcePreview = z.infer<typeof runSourcePreviewSchema>;

/** 一次 Run 的成果采用声明：最后一次成功声明生效，空数组表示主动清除。 */
export const declareArtifactSourcesRequestSchema = z
  .object({
    runId: z.string().min(1),
    inputRelations: z.array(artifactInputRelationInputSchema).max(50),
  })
  .strict();
export type DeclareArtifactSourcesRequest = z.infer<typeof declareArtifactSourcesRequestSchema>;

export const runArtifactSourceDeclarationSchema = z
  .object({
    runId: z.string().min(1),
    inputs: z.array(artifactInputRelationInputSchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type RunArtifactSourceDeclaration = z.infer<typeof runArtifactSourceDeclarationSchema>;

export const getRunArtifactDeclarationsRequestSchema = z.object({ runId: z.string().min(1) });
export type GetRunArtifactDeclarationsRequest = z.infer<
  typeof getRunArtifactDeclarationsRequestSchema
>;

export const previewKnowledgeRequestSchema = z
  .object({
    documentId: z.string().min(1),
    revisionId: z.string().min(1),
    cursor: knowledgeCursorSchema.optional(),
    maxCodePoints: z.number().int().min(1).max(KNOWLEDGE_PAGE_MAX_CODE_POINTS).optional(),
  })
  .strict();
export type PreviewKnowledgeRequest = z.infer<typeof previewKnowledgeRequestSchema>;
export const openKnowledgeSourceResultSchema = z.object({
  opened: z.boolean(),
  error: z.string().optional(),
});
export const searchEngineSummarySchema = z.object({
  provider: searchProviderIdSchema,
  apiKeyConfigured: z.boolean(),
  enabled: z.boolean(),
  webTopK: z.number().int().positive(),
  connectionStatus: modelConnectionStatusSchema,
  lastTestedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export const connectionTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export const exportMarkdownArtifactResultSchema = z.object({
  cancelled: z.boolean(),
  filePath: z.string().min(1).optional(),
});
export const registerFileArtifactResultSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  fileKey: z.string().min(1),
  fileHash: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  validation: validationStateSchema,
});
export const exportFileArtifactResultSchema = z.object({
  cancelled: z.boolean(),
  filePath: z.string().min(1).optional(),
});

export const openFileArtifactRequestSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1).optional(),
});
export type OpenFileArtifactRequest = z.infer<typeof openFileArtifactRequestSchema>;
export const openFileArtifactResultSchema = z.object({
  opened: z.boolean(),
  error: z.string().optional(),
});
export interface OpenFileArtifactResult {
  opened: boolean;
  error?: string;
}

export const getArtifactThumbnailsRequestSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1).optional(),
});
export type GetArtifactThumbnailsRequest = z.infer<typeof getArtifactThumbnailsRequestSchema>;

export const artifactThumbnailSchema = z.object({
  slideIndex: z.number().int().nonnegative(),
  // 直接内联图片数据而不是本机路径：Renderer 不得接触文件系统，且开发模式下页面
  // 源是 http://localhost，`file://` 子资源会被拦下。
  dataUrl: z.string().startsWith('data:image/'),
});
export type ArtifactThumbnail = z.infer<typeof artifactThumbnailSchema>;

export const getArtifactThumbnailsResultSchema = z.object({
  thumbnails: z.array(artifactThumbnailSchema),
  error: z.string().optional(),
});
export interface GetArtifactThumbnailsResult {
  thumbnails: ArtifactThumbnail[];
  error?: string | undefined;
}
export const startRunResultSchema = z.object({ runId: z.string().min(1) });
export const cancelledResultSchema = z.object({ cancelled: z.boolean() });
export const deletedResultSchema = z.object({ deleted: z.boolean() });
export const updatedResultSchema = z.object({ updated: z.boolean() });
export const removedResultSchema = z.object({ removed: z.boolean() });
export const modelSaveResultSchema = z.object({ id: z.string().min(1) });
export const searchEngineSaveResultSchema = z.object({ provider: searchProviderIdSchema });
export const unreadCountResultSchema = z.object({ unreadCount: z.number().int().nonnegative() });
export const clearedResultSchema = z.object({ cleared: z.literal(true) });
export const maximizedResultSchema = z.object({ maximized: z.boolean() });
export const voidResultSchema = z.undefined();

/**
 * 依赖与环境管理（A12）。
 *
 * Renderer 只提交**登记标识**（受管候选 id、随包锁 id、快照 id）或由主进程对话框
 * 选出的路径；它永远不能直接提交可执行路径、环境变量或任意目录作为执行输入。
 */
export const dependencyBaseChoiceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('managed'),
      distributionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('local'),
      /** 由主进程文件对话框选出并回传的路径。 */
      path: z.string().min(1),
    })
    .strict(),
]);
export type DependencyBaseChoice = z.infer<typeof dependencyBaseChoiceSchema>;

export const managedDistributionSummarySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    platform: targetPlatformSchema,
    license: z.string().min(1),
    /** 制品是否已在受管目录落地；未落地时准备作业需要显式联网下载。 */
    installed: z.boolean(),
  })
  .strict();
export type ManagedDistributionSummary = z.infer<typeof managedDistributionSummarySchema>;

export const dependencyOptionsSchema = z
  .object({
    distributions: z.array(managedDistributionSummarySchema),
    lockIds: z.array(z.string().min(1)),
    snapshots: z.array(dependencySnapshotSchema),
    environments: z.array(runtimeEnvironmentSchema),
  })
  .strict();
export type DependencyOptions = z.infer<typeof dependencyOptionsSchema>;

export const listDependencyOptionsRequestSchema = z.object({}).strict();
export type ListDependencyOptionsRequest = z.infer<typeof listDependencyOptionsRequestSchema>;

export const dependencyPlanRequestSchema = z
  .object({
    base: dependencyBaseChoiceSchema,
    lockId: z.string().trim().min(1).max(160),
  })
  .strict();
export type DependencyPlanRequest = z.infer<typeof dependencyPlanRequestSchema>;

export const dependencyPlanSchema = z
  .object({
    environmentKey: z.string().min(1),
    base: baseInterpreterSchema,
    platform: targetPlatformSchema,
    lockHash: z.string().min(1),
    lock: dependencyLockSchema,
    missingWheels: z.array(z.string().min(1)),
    requiresDownload: z.boolean(),
    environment: runtimeEnvironmentSchema.nullable(),
    openOperationId: z.string().min(1).optional(),
  })
  .strict();
export type DependencyPlan = z.infer<typeof dependencyPlanSchema>;

export const prepareDependencyRequestSchema = dependencyPlanRequestSchema
  .extend({
    kind: dependencyOperationKindSchema.optional(),
  })
  .strict();
export type PrepareDependencyRequest = z.infer<typeof prepareDependencyRequestSchema>;

export const prepareDependencyResultSchema = z
  .object({
    operationId: z.string().min(1),
    environmentId: z.string().min(1),
    environmentKey: z.string().min(1),
    reused: z.boolean(),
  })
  .strict();
export type PrepareDependencyResult = z.infer<typeof prepareDependencyResultSchema>;

export const cancelDependencyRequestSchema = z.object({ operationId: z.string().min(1) }).strict();
export type CancelDependencyRequest = z.infer<typeof cancelDependencyRequestSchema>;

export const cancelDependencyResultSchema = z
  .object({
    applied: z.boolean(),
    status: dependencyOperationStatusSchema,
  })
  .strict();
export type CancelDependencyResult = z.infer<typeof cancelDependencyResultSchema>;

export const getDependencyOperationRequestSchema = z
  .object({ operationId: z.string().min(1) })
  .strict();
export type GetDependencyOperationRequest = z.infer<typeof getDependencyOperationRequestSchema>;

export const chooseInterpreterResultSchema = z
  .object({
    cancelled: z.boolean(),
    path: z.string().min(1).optional(),
  })
  .strict();
export type ChooseInterpreterResult = z.infer<typeof chooseInterpreterResultSchema>;

export const registerToolchainRequestSchema = z
  .object({
    /** 相对所选目录的包含根；留空表示整个目录（仍按快照排除规则过滤）。 */
    include: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  })
  .strict();
export type RegisterToolchainRequest = z.infer<typeof registerToolchainRequestSchema>;

export const registerToolchainResultSchema = z
  .object({
    cancelled: z.boolean(),
    snapshot: dependencySnapshotSchema.nullable(),
    reused: z.boolean(),
  })
  .strict();
export type RegisterToolchainResult = z.infer<typeof registerToolchainResultSchema>;

export const refreshSkillDependencyGrantRequestSchema = z
  .object({
    skillId: z.string().min(1),
    lockId: z.string().trim().min(1).max(160),
    snapshotIds: z.array(z.string().min(1)).max(20),
    /**
     * 省略或 false 时只复核授权是否覆盖当前依赖，供界面如实展示；
     * true 才在用户明确点击后建立授权。查看与确认必须是两个意图。
     */
    confirm: z.boolean().optional(),
  })
  .strict();
export type RefreshSkillDependencyGrantRequest = z.infer<
  typeof refreshSkillDependencyGrantRequestSchema
>;

export const refreshSkillDependencyGrantResultSchema = z
  .object({
    skill: skillSummarySchema,
    /** 授权被拒绝（未信任/已撤销/缺运行配置）时没有指纹可言，因此可选。 */
    fingerprint: z.string().min(1).optional(),
    grantActive: z.boolean(),
    grantCreated: z.boolean(),
    /** 授权没有生效时必须说明原因，不能只回一个 false。 */
    blockedReason: z.string().optional(),
  })
  .strict();
export type RefreshSkillDependencyGrantResult = z.infer<
  typeof refreshSkillDependencyGrantResultSchema
>;

export const testSkillRunRequestSchema = z
  .object({
    skillId: z.string().min(1),
    prompt: z.string().trim().min(1).optional(),
  })
  .strict();
export type TestSkillRunRequest = z.infer<typeof testSkillRunRequestSchema>;

export const testSkillRunResultSchema = z
  .object({
    runId: z.string().min(1),
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();
export type TestSkillRunResult = z.infer<typeof testSkillRunResultSchema>;

export const IpcChannel = {
  StartRun: 'run:start',
  CancelRun: 'run:cancel',
  ListRunEvents: 'run:list-events',
  ListRuns: 'run:list',
  RunEvent: 'run:event',
  GetDefaultWorkspace: 'workspace:get-default',
  SelectWorkspace: 'workspace:select',
  ListWorkspaces: 'workspace:list',
  CreateTask: 'task:create',
  ListTasks: 'task:list',
  ListEvidence: 'evidence:list',
  ListArtifacts: 'artifact:list',
  GetArtifact: 'artifact:get',
  ListArtifactVersions: 'artifact:list-versions',
  GetArtifactVersion: 'artifact:get-version',
  SaveMarkdownArtifact: 'artifact:save-markdown',
  ExportMarkdownArtifact: 'artifact:export-markdown',
  RegisterFileArtifact: 'artifact:register-file',
  GetFileArtifact: 'artifact:get-file',
  ExportFileArtifact: 'artifact:export-file',
  OpenFileArtifact: 'artifact:open-file',
  GetArtifactThumbnails: 'artifact:get-thumbnails',
  ListModels: 'model:list',
  SaveModel: 'model:save',
  DeleteModel: 'model:delete',
  SetDefaultModel: 'model:set-default',
  SetModelEnabled: 'model:set-enabled',
  ListKnowledge: 'knowledge:list',
  ImportKnowledge: 'knowledge:import',
  SearchKnowledge: 'knowledge:search',
  OpenKnowledgeSource: 'knowledge:open-source',
  RemoveKnowledgeDocument: 'knowledge:remove',
  RefreshKnowledgeDocument: 'knowledge:refresh',
  ListKnowledgeRevisions: 'knowledge:list-revisions',
  PreviewKnowledge: 'knowledge:preview',
  CreateResearchDraft: 'knowledge:create-research-draft',
  PreviewRunSource: 'knowledge:preview-run-source',
  ListKnowledgeJobs: 'knowledge:list-jobs',
  GetKnowledgeJob: 'knowledge:get-job',
  CancelKnowledgeJob: 'knowledge:cancel-job',
  RetryKnowledgeJob: 'knowledge:retry-job',
  KnowledgeJobEvent: 'knowledge:job-event',
  GetKnowledgeSettings: 'knowledge:get-settings',
  SaveKnowledgeSettings: 'knowledge:save-settings',
  RebuildKnowledgeIndex: 'knowledge:rebuild-index',
  CheckKnowledgeSources: 'knowledge:check-sources',
  DeclareArtifactSources: 'artifact:declare-sources',
  GetRunArtifactDeclarations: 'artifact:get-run-declarations',
  ListSearchEngines: 'search:list',
  SaveSearchEngine: 'search:save',
  TestSearchEngine: 'search:test',
  TestModel: 'model:test',
  ListSkills: 'skill:list',
  GetSkill: 'skill:get',
  ImportSkill: 'skill:import',
  SaveSkillRuntimeProfile: 'skill:save-runtime-profile',
  SetSkillTrust: 'skill:set-trust',
  RevokeSkillTrust: 'skill:revoke-trust',
  SetSkillEnabled: 'skill:set-enabled',
  CopySkill: 'skill:copy',
  ExportSkill: 'skill:export',
  DeleteSkill: 'skill:delete',
  RefreshSkillDependencyGrant: 'skill:refresh-dependency-grant',
  TestSkillRun: 'skill:test-run',
  ListExperts: 'expert:list',
  GetExpert: 'expert:get',
  CreateExpert: 'expert:create',
  SaveExpertRevision: 'expert:save-revision',
  CopyExpert: 'expert:copy',
  SetExpertLifecycle: 'expert:set-lifecycle',
  GetTaskContext: 'task-context:get',
  SaveTaskContext: 'task-context:save',
  ListDiscussionCheckpoints: 'discussion-checkpoint:list',
  CreateDiscussionCheckpoint: 'discussion-checkpoint:create',
  ListTaskMaterialCandidates: 'task-material:list-candidates',
  PrepareWorkspaceInputSnapshot: 'task-material:prepare-input-snapshot',
  ListMemories: 'memory:list',
  CreateMemory: 'memory:create',
  UpdateMemory: 'memory:update',
  SetMemoryStatus: 'memory:set-status',
  GetMemory: 'memory:get',
  ResolveMemoryConflict: 'memory:resolve-conflict',
  PreviewMemory: 'memory:preview',
  GetRunMemoryContext: 'memory:run-context',
  GetMemorySettings: 'memory:get-settings',
  SetMemorySettings: 'memory:set-settings',
  ListMemoryJobs: 'memory:list-jobs',
  RetryMemoryJob: 'memory:retry-job',
  CancelMemoryJob: 'memory:cancel-job',
  RebuildMemoryProjection: 'memory:rebuild-projection',
  GetWorkspaceMemoryBrief: 'workspace:memory-brief',
  ListWorkspaceReferenceVersions: 'workspace:list-reference-versions',
  SetWorkspaceReferenceVersion: 'workspace:set-reference-version',
  RemoveWorkspaceReferenceVersion: 'workspace:remove-reference-version',
  ListMcpConnections: 'mcp:list-connections',
  GetMcpConnection: 'mcp:get-connection',
  SaveMcpConnection: 'mcp:save-connection',
  DeleteMcpConnection: 'mcp:delete-connection',
  TestMcpConnection: 'mcp:test-connection',
  ListDependencyOptions: 'dependency:list-options',
  InspectDependencyPlan: 'dependency:inspect-plan',
  PrepareDependencyEnvironment: 'dependency:prepare',
  CancelDependencyPreparation: 'dependency:cancel',
  GetDependencyOperation: 'dependency:get-operation',
  ChoosePythonInterpreter: 'dependency:choose-interpreter',
  RegisterToolchainSnapshot: 'dependency:register-toolchain',
  UpdateWindowTheme: 'window:update-theme',
  WindowToggleMaximize: 'window:toggle-maximize',
  ListNotifications: 'notification:list',
  MarkNotificationRead: 'notification:mark-read',
  MarkAllNotificationsRead: 'notification:mark-all-read',
  ClearNotifications: 'notification:clear',
  NotificationChangeEvent: 'notification:event',
  NotificationActivated: 'notification:activated',
} as const;

export interface BetterWorkDesktopApi {
  runs: {
    start(input: StartRunRequest): Promise<{ runId: string }>;
    cancel(input: CancelRunRequest): Promise<{ cancelled: boolean }>;
    list(input?: ListRunsRequest): Promise<RunSummary[]>;
    listEvents(input: ListRunEventsRequest): Promise<AgentRuntimeEvent[]>;
    onEvent(listener: (event: AgentRuntimeEvent) => void): () => void;
  };
  workspace: {
    getDefault(): Promise<WorkspaceSummary>;
    selectDirectory(): Promise<WorkspaceSummary | null>;
    listAll(): Promise<WorkspaceSummary[]>;
    memoryBrief(input: WorkspaceMemoryBriefRequest): Promise<Result<WorkspaceBrief>>;
    listReferenceVersions(
      input: ListWorkspaceReferenceVersionsRequest,
    ): Promise<Result<WorkspaceReferenceListData>>;
    setReferenceVersion(
      input: SetWorkspaceReferenceVersionRequest,
    ): Promise<Result<WorkspaceReferenceSetData>>;
    removeReferenceVersion(
      input: RemoveWorkspaceReferenceVersionRequest,
    ): Promise<Result<MemoryReferenceWriteReceipt>>;
  };
  tasks: {
    create(input: CreateTaskRequest): Promise<CreatedTask>;
    list(input?: ListTasksRequest): Promise<RecentTaskSummary[]>;
  };
  evidence: {
    list(input: ListEvidenceRequest): Promise<EvidenceSummary[]>;
  };
  artifacts: {
    list(input?: ListArtifactsRequest): Promise<ArtifactSummary[]>;
    get(input: { id: string }): Promise<ArtifactDetail | null>;
    listVersions(input: { artifactId: string }): Promise<ArtifactVersionSummary[]>;
    getVersion(input: { id: string }): Promise<ArtifactVersionDetail | null>;
    saveMarkdown(input: SaveMarkdownArtifactRequest): Promise<ArtifactSummary>;
    exportMarkdown(input: ExportMarkdownArtifactRequest): Promise<ExportMarkdownArtifactResult>;
    registerFile(input: RegisterFileArtifactRequest): Promise<RegisterFileArtifactResult>;
    getFileDetail(input: GetFileArtifactRequest): Promise<FileArtifactDetail | null>;
    exportFile(input: ExportFileArtifactRequest): Promise<ExportFileArtifactResult>;
    openFile(input: OpenFileArtifactRequest): Promise<OpenFileArtifactResult>;
    getThumbnails(input: GetArtifactThumbnailsRequest): Promise<GetArtifactThumbnailsResult>;
  };
  models: {
    list(): Promise<ModelProfileSummary[]>;
    save(input: z.infer<typeof saveModelProfileRequestSchema>): Promise<{ id: string }>;
    delete(input: { id: string }): Promise<{ deleted: boolean }>;
    setDefault(input: { id: string }): Promise<{ updated: boolean }>;
    setEnabled(input: { id: string; enabled: boolean }): Promise<{ updated: boolean }>;
    test(input: z.infer<typeof testModelRequestSchema>): Promise<{ ok: boolean; message: string }>;
  };
  searchEngines: {
    list(): Promise<SearchEngineSummary[]>;
    save(input: z.input<typeof saveSearchEngineRequestSchema>): Promise<{ provider: string }>;
    test(
      input: z.input<typeof testSearchEngineRequestSchema>,
    ): Promise<{ ok: boolean; message: string }>;
  };
  notifications: {
    list(): Promise<NotificationSummary[]>;
    markRead(input: MarkNotificationReadRequest): Promise<{ unreadCount: number }>;
    markAllRead(): Promise<{ unreadCount: number }>;
    clear(): Promise<{ cleared: boolean }>;
    onChange(listener: (event: NotificationChangeEvent) => void): () => void;
    onActivate(listener: (input: NotificationActivated) => void): () => void;
  };
  chrome: {
    updateTheme(input: UpdateWindowThemeRequest): Promise<void>;
    toggleMaximize(): Promise<{ maximized: boolean }>;
  };
  knowledge: {
    list(): Promise<KnowledgeDocumentSummary[]>;
    importFromDialog(): Promise<KnowledgeImportAck>;
    jobs(input?: ListKnowledgeJobsRequest): Promise<KnowledgeJobPage>;
    job(input: { jobId: string }): Promise<KnowledgeJobDetail | null>;
    cancelJob(input: { jobId: string }): Promise<{ cancelled: boolean }>;
    retryJob(input: RetryKnowledgeJobRequest): Promise<KnowledgeJobAck>;
    onJobEvent(listener: (event: KnowledgeJobSummary) => void): () => void;
    settings(): Promise<KnowledgeSearchSettings>;
    saveSettings(input: SaveKnowledgeSettingsRequest): Promise<KnowledgeSearchSettings>;
    rebuildIndex(input: RebuildKnowledgeIndexRequest): Promise<KnowledgeJobAck>;
    checkSources(input: CheckKnowledgeSourcesRequest): Promise<KnowledgeJobAck>;
    search(input: SearchKnowledgeRequest): Promise<KnowledgeSearchResponse>;
    openSource(input: OpenKnowledgeSourceRequest): Promise<OpenKnowledgeSourceResult>;
    remove(input: RemoveKnowledgeDocumentRequest): Promise<{ removed: boolean }>;
    refresh(input: RefreshKnowledgeDocumentRequest): Promise<KnowledgeJobAck>;
    listRevisions(input: ListKnowledgeRevisionsRequest): Promise<KnowledgeRevisionSummary[]>;
    preview(input: PreviewKnowledgeRequest): Promise<KnowledgeTextPage>;
    createResearchDraft(
      input: KnowledgeCreateResearchDraftRequest,
    ): Promise<KnowledgeResearchDraftResult>;
    previewRunSource(input: PreviewRunSourceRequest): Promise<RunSourcePreview>;
    declareArtifactSources(
      input: DeclareArtifactSourcesRequest,
    ): Promise<RunArtifactSourceDeclaration>;
    getRunArtifactDeclarations(
      input: GetRunArtifactDeclarationsRequest,
    ): Promise<RunArtifactSourceDeclaration | null>;
  };
  skills: {
    list(): Promise<SkillSummary[]>;
    get(input: GetSkillRequest): Promise<SkillDetail | null>;
    importFromDialog(): Promise<SkillImportResult>;
    saveRuntimeProfile(input: SaveSkillRuntimeProfileRequest): Promise<SkillMutationResult>;
    setTrust(input: SetSkillTrustRequest): Promise<SkillMutationResult>;
    revokeTrust(input: RevokeSkillTrustRequest): Promise<SkillMutationResult>;
    setEnabled(input: SetSkillEnabledRequest): Promise<SkillMutationResult>;
    copy(input: CopySkillRequest): Promise<SkillMutationResult>;
    export(input: ExportSkillRequest): Promise<SkillExportResult>;
    delete(input: DeleteSkillRequest): Promise<{ deleted: boolean }>;
    refreshDependencyGrant(
      input: RefreshSkillDependencyGrantRequest,
    ): Promise<RefreshSkillDependencyGrantResult>;
    testRun(input: TestSkillRunRequest): Promise<TestSkillRunResult>;
  };
  experts: {
    list(input?: ListExpertsRequest): Promise<ExpertSummary[]>;
    get(input: GetExpertRequest): Promise<ExpertDetail | null>;
    create(input: CreateExpertRequest): Promise<ExpertMutationResult>;
    saveRevision(input: SaveExpertRevisionRequest): Promise<ExpertMutationResult>;
    copy(input: CopyExpertRequest): Promise<ExpertMutationResult>;
    setLifecycle(input: SetExpertLifecycleRequest): Promise<ExpertMutationResult>;
  };
  taskContexts: {
    get(input: GetTaskContextRequest): Promise<TaskContextRevision | null>;
    save(input: SaveTaskContextRequest): Promise<TaskContextMutationResult>;
  };
  discussionCheckpoints: {
    list(input: ListDiscussionCheckpointsRequest): Promise<DiscussionCheckpoint[]>;
    create(input: CreateDiscussionCheckpointRequest): Promise<DiscussionCheckpointMutationResult>;
  };
  materials: {
    listCandidates(input: ListTaskMaterialCandidatesRequest): Promise<MaterialCandidate[]>;
    prepareInputSnapshot(
      input: PrepareWorkspaceInputSnapshotRequest,
    ): Promise<InputSnapshot | null>;
  };
  memories: {
    list(input: ListMemoriesRequest): Promise<Result<ListPage<MemoryViewItem>>>;
    get(input: GetMemoryRequest): Promise<Result<MemoryViewItem>>;
    create(input: CreateMemoryRequest): Promise<Result<MemoryWriteReceipt>>;
    update(input: UpdateMemoryRequest): Promise<Result<MemoryWriteReceipt>>;
    setStatus(input: SetMemoryStatusRequest): Promise<Result<MemoryWriteReceipt>>;
    resolveConflict(
      input: ResolveMemoryConflictRequest,
    ): Promise<Result<MemoryConflictResolutionData>>;
    preview(input: PreviewMemoryRequest): Promise<Result<MemoryPreviewData>>;
    runContext(input: GetRunMemoryContextRequest): Promise<Result<MemoryRunContextData>>;
    getSettings(input: GetMemorySettingsRequest): Promise<Result<WorkspaceMemorySettings>>;
    setSettings(input: SetMemorySettingsRequest): Promise<Result<MemorySettingsData>>;
    listJobs(input: ListMemoryJobsRequest): Promise<Result<ListPage<MemoryJobSummary>>>;
    retryJob(input: RetryMemoryJobRequest): Promise<Result<MemoryJobSummary>>;
    cancelJob(input: CancelMemoryJobRequest): Promise<Result<MemoryJobSummary>>;
    rebuildProjection(
      input: RebuildMemoryProjectionRequest,
    ): Promise<Result<MemoryProjectionStateData>>;
  };
  mcp: {
    listConnections(): Promise<McpConnectionSummary[]>;
    getConnection(input: GetMcpConnectionRequest): Promise<McpConnectionSummary | null>;
    saveConnection(input: SaveMcpConnectionRequest): Promise<McpMutationResult>;
    deleteConnection(input: DeleteMcpConnectionRequest): Promise<{ deleted: boolean }>;
    testConnection(input: GetMcpConnectionRequest): Promise<McpTestResult>;
  };
  dependencies: {
    listOptions(): Promise<DependencyOptions>;
    inspectPlan(input: DependencyPlanRequest): Promise<DependencyPlan>;
    prepare(input: PrepareDependencyRequest): Promise<PrepareDependencyResult>;
    cancel(input: CancelDependencyRequest): Promise<CancelDependencyResult>;
    getOperation(input: GetDependencyOperationRequest): Promise<DependencyOperation | null>;
    chooseInterpreter(): Promise<ChooseInterpreterResult>;
    registerToolchain(input: RegisterToolchainRequest): Promise<RegisterToolchainResult>;
  };
}
