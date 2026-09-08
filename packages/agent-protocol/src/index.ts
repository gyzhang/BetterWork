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
  eventBaseSchema.extend({ type: z.literal('run.cancelled') }),
]);
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
type WithoutEventEnvelope<T> = T extends unknown
  ? Omit<T, 'id' | 'runId' | 'sequence' | 'createdAt'>
  : never;
export type AgentRuntimeEventInput = WithoutEventEnvelope<AgentRuntimeEvent>;

export const startRunRequestSchema = z
  .object({
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
    prompt: z.string().trim().min(1),
  })
  .strict();
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

export const copySkillRequestSchema = z
  .object({ skillId: skillIdSchema, name: z.string().trim().min(1).max(160).optional() })
  .strict();
export type CopySkillRequest = z.infer<typeof copySkillRequestSchema>;

export const exportSkillRequestSchema = z
  .object({ skillId: skillIdSchema, revisionId: skillRevisionIdSchema.optional() })
  .strict();
export type ExportSkillRequest = z.infer<typeof exportSkillRequestSchema>;

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
  pageCount?: number;
  importedAt: number;
  updatedAt: number;
}

export interface KnowledgeImportResult {
  imported: KnowledgeDocumentSummary[];
  skipped: Array<{ sourcePath: string; reason: string }>;
}

export const searchKnowledgeRequestSchema = z.object({ query: z.string().trim().min(1).max(500) });
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
}

export interface EvidenceSummary {
  id: string;
  taskId: string;
  runId: string;
  sourceType: 'local-file' | 'web-page';
  sourceUri: string;
  title: string;
  locator: string;
  excerpt: string;
  contentHash: string;
  capturedAt: number;
}

export type ArtifactVersionOrigin = 'assistant-run' | 'user-edit';

export interface ArtifactSummary {
  id: string;
  workspaceId: string;
  taskId: string;
  type: 'markdown';
  title: string;
  currentVersionId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactDetail extends ArtifactSummary {
  content: string;
  contentHash: string;
  evidence: EvidenceSummary[];
}

export interface ArtifactVersionSummary {
  id: string;
  artifactId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  createdAt: number;
}

export interface ArtifactVersionDetail extends ArtifactVersionSummary {
  content: string;
  contentHash: string;
  evidence: EvidenceSummary[];
}

export const saveMarkdownArtifactRequestSchema = z
  .object({
    artifactId: z.string().min(1).optional(),
    taskId: z.string().min(1),
    origin: z.enum(['assistant-run', 'user-edit']).default('assistant-run'),
    runId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(2_000_000),
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

export interface RunSummary {
  id: string;
  taskId: string;
  sessionId: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
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
export const runSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  prompt: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
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
  sourceType: z.enum(['local-file', 'web-page']),
  sourceUri: z.string().min(1),
  title: z.string(),
  locator: z.string(),
  excerpt: z.string(),
  contentHash: z.string().min(1),
  capturedAt: z.number().int().nonnegative(),
});
export const artifactSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  type: z.literal('markdown'),
  title: z.string(),
  currentVersionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  origin: z.enum(['assistant-run', 'user-edit']),
  sourceRunId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const artifactDetailSchema = artifactSummarySchema.extend({
  content: z.string(),
  contentHash: z.string().min(1),
  evidence: z.array(evidenceSummarySchema),
});
export const artifactVersionSummarySchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  origin: z.enum(['assistant-run', 'user-edit']),
  sourceRunId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
});
export const artifactVersionDetailSchema = artifactVersionSummarySchema.extend({
  content: z.string(),
  contentHash: z.string().min(1),
  evidence: z.array(evidenceSummarySchema),
});
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
});
export const knowledgeRefreshResultSchema = z.object({
  refreshed: knowledgeDocumentSummarySchema.optional(),
  error: z.string().optional(),
});
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

export const IpcChannel = {
  StartRun: 'run:start',
  CancelRun: 'run:cancel',
  ListRunEvents: 'run:list-events',
  ListRuns: 'run:list',
  RunEvent: 'run:event',
  GetDefaultWorkspace: 'workspace:get-default',
  SelectWorkspace: 'workspace:select',
  CreateTask: 'task:create',
  ListTasks: 'task:list',
  ListEvidence: 'evidence:list',
  ListArtifacts: 'artifact:list',
  GetArtifact: 'artifact:get',
  ListArtifactVersions: 'artifact:list-versions',
  GetArtifactVersion: 'artifact:get-version',
  SaveMarkdownArtifact: 'artifact:save-markdown',
  ExportMarkdownArtifact: 'artifact:export-markdown',
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
  ListSearchEngines: 'search:list',
  SaveSearchEngine: 'search:save',
  TestSearchEngine: 'search:test',
  TestModel: 'model:test',
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
    importFromDialog(): Promise<KnowledgeImportResult>;
    search(input: SearchKnowledgeRequest): Promise<KnowledgeSearchResult[]>;
    openSource(input: OpenKnowledgeSourceRequest): Promise<OpenKnowledgeSourceResult>;
    remove(input: RemoveKnowledgeDocumentRequest): Promise<{ removed: boolean }>;
    refresh(input: RefreshKnowledgeDocumentRequest): Promise<KnowledgeRefreshResult>;
  };
}
