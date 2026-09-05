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
  eventBaseSchema.extend({ type: z.literal('run.started'), taskId: z.string(), sessionId: z.string() }),
  eventBaseSchema.extend({ type: z.literal('message.started'), messageId: z.string() }),
  eventBaseSchema.extend({ type: z.literal('message.delta'), messageId: z.string(), delta: z.string() }),
  eventBaseSchema.extend({ type: z.literal('message.completed'), messageId: z.string(), content: z.string() }),
  eventBaseSchema.extend({ type: z.literal('reasoning.delta'), delta: z.string() }),
  eventBaseSchema.extend({ type: z.literal('tool.requested'), toolCall: toolCallSchema }),
  eventBaseSchema.extend({ type: z.literal('tool.started'), toolCall: toolCallSchema }),
  eventBaseSchema.extend({ type: z.literal('tool.progress'), toolCallId: z.string(), message: z.string() }),
  eventBaseSchema.extend({ type: z.literal('tool.completed'), toolCallId: z.string(), output: z.unknown() }),
  eventBaseSchema.extend({ type: z.literal('tool.failed'), toolCallId: z.string(), error: z.string() }),
  eventBaseSchema.extend({ type: z.literal('run.completed'), finalContent: z.string() }),
  eventBaseSchema.extend({ type: z.literal('run.failed'), error: z.string() }),
  eventBaseSchema.extend({ type: z.literal('run.cancelled') }),
]);
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
type WithoutEventEnvelope<T> = T extends unknown
  ? Omit<T, 'id' | 'runId' | 'sequence' | 'createdAt'>
  : never;
export type AgentRuntimeEventInput = WithoutEventEnvelope<AgentRuntimeEvent>;

export const startRunRequestSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  prompt: z.string().trim().min(1),
  workspacePath: z.string().min(1),
});
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

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
export const saveModelProfileRequestSchema = modelProfileInputSchema.extend({ id: z.string().min(1).optional() });

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
export const openKnowledgeSourceRequestSchema = z.object({ sourcePath: z.string().trim().min(1).max(4_000) });
export type OpenKnowledgeSourceRequest = z.infer<typeof openKnowledgeSourceRequestSchema>;
export interface OpenKnowledgeSourceResult { opened: boolean; error?: string; }
export const removeKnowledgeDocumentRequestSchema = z.object({ id: z.string().min(1) });
export type RemoveKnowledgeDocumentRequest = z.infer<typeof removeKnowledgeDocumentRequestSchema>;
export const refreshKnowledgeDocumentRequestSchema = z.object({ id: z.string().min(1) });
export type RefreshKnowledgeDocumentRequest = z.infer<typeof refreshKnowledgeDocumentRequestSchema>;
export interface KnowledgeRefreshResult { refreshed?: KnowledgeDocumentSummary; error?: string; }

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

export const saveMarkdownArtifactRequestSchema = z.object({
  artifactId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  origin: z.enum(['assistant-run', 'user-edit']).default('assistant-run'),
  runId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(2_000_000),
}).superRefine((input, context) => {
  if (input.origin === 'assistant-run' && !input.runId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'AI 运行生成的成果必须关联 Run', path: ['runId'] });
  }
  if (input.origin === 'user-edit' && input.runId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '人工修订不能伪装为 AI 运行产物', path: ['runId'] });
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
export const setModelEnabledRequestSchema = z.object({ id: z.string().min(1), enabled: z.boolean() });
export const testModelRequestSchema = modelProfileInputSchema.pick({ baseUrl: true, model: true, role: true, apiKey: true }).extend({ id: z.string().min(1).optional() });
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
    test(input: z.input<typeof testSearchEngineRequestSchema>): Promise<{ ok: boolean; message: string }>;
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
