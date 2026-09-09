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

export const skillBindingSchema = z
  .object({
    skillId: z.string().min(1),
    revisionId: z.string().min(1).optional(),
  })
  .strict();
export type SkillBinding = z.infer<typeof skillBindingSchema>;

export const startRunRequestSchema = z
  .object({
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
    prompt: z.string().trim().min(1),
    skillBinding: skillBindingSchema.optional(),
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
}

export interface FileArtifactDetail extends FileArtifactSummary {
  fileHash: string;
  fileKey: string;
  validation: ValidationState;
  description?: string;
  evidence: EvidenceSummary[];
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
}

export interface FileArtifactVersionSummary {
  type: 'presentation';
  id: string;
  artifactId: string;
  versionNumber: number;
  origin: ArtifactVersionOrigin;
  sourceRunId?: string;
  createdAt: number;
  mimeType: string;
  fileSize: number;
  validation: ValidationState;
}

export type ArtifactVersionSummary = MarkdownArtifactVersionSummary | FileArtifactVersionSummary;

export interface MarkdownArtifactVersionDetail extends MarkdownArtifactVersionSummary {
  content: string;
  contentHash: string;
  evidence: EvidenceSummary[];
}

export interface FileArtifactVersionDetail extends FileArtifactVersionSummary {
  fileHash: string;
  fileKey: string;
  description?: string;
  evidence: EvidenceSummary[];
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

export const registerFileArtifactRequestSchema = z
  .object({
    runId: z.string().min(1),
    executionId: z.string().min(1),
    outputId: z.string().min(1),
    artifactId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    mimeType: z.string().trim().min(1).max(120),
    description: z.string().trim().max(10_000).optional(),
    validation: validationStateSchema,
  })
  .superRefine((input, context) => {
    if (input.validation.structure === 'failed') {
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
export const markdownArtifactSummarySchema = z.object({
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
export const fileArtifactSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  type: z.literal('presentation'),
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
});
export const fileArtifactDetailSchema = fileArtifactSummarySchema.extend({
  fileHash: z.string().min(1),
  fileKey: z.string().min(1),
  validation: validationStateSchema,
  description: z.string().trim().max(10_000).optional(),
  evidence: z.array(evidenceSummarySchema),
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
});
export const fileArtifactVersionDetailSchema = fileArtifactVersionSummarySchema.extend({
  fileHash: z.string().min(1),
  fileKey: z.string().min(1),
  description: z.string().trim().max(10_000).optional(),
  evidence: z.array(evidenceSummarySchema),
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
