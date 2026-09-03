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

export const cancelRunRequestSchema = z.object({ runId: z.string().min(1) });
export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>;

export const listRunEventsRequestSchema = z.object({ runId: z.string().min(1) });
export type ListRunEventsRequest = z.infer<typeof listRunEventsRequestSchema>;

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

export interface KnowledgeSearchResult {
  document: KnowledgeDocumentSummary;
  locator: string;
  excerpt: string;
}

export const modelProfileIdSchema = z.object({ id: z.string().min(1) });
export const setDefaultModelRequestSchema = z.object({ id: z.string().min(1) });
export const setModelEnabledRequestSchema = z.object({ id: z.string().min(1), enabled: z.boolean() });
export const testModelRequestSchema = modelProfileInputSchema.pick({ baseUrl: true, model: true, role: true, apiKey: true }).extend({ id: z.string().min(1).optional() });
export const updateWindowThemeRequestSchema = z.object({
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  symbolColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type UpdateWindowThemeRequest = z.infer<typeof updateWindowThemeRequestSchema>;

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
  ListModels: 'model:list',
  SaveModel: 'model:save',
  DeleteModel: 'model:delete',
  SetDefaultModel: 'model:set-default',
  SetModelEnabled: 'model:set-enabled',
  ListKnowledge: 'knowledge:list',
  ImportKnowledge: 'knowledge:import',
  SearchKnowledge: 'knowledge:search',
  TestModel: 'model:test',
  UpdateWindowTheme: 'window:update-theme',
} as const;

export interface BetterWorkDesktopApi {
  runs: {
    start(input: StartRunRequest): Promise<{ runId: string }>;
    cancel(input: CancelRunRequest): Promise<{ cancelled: boolean }>;
    list(): Promise<RunSummary[]>;
    listEvents(input: ListRunEventsRequest): Promise<AgentRuntimeEvent[]>;
    onEvent(listener: (event: AgentRuntimeEvent) => void): () => void;
  };
  workspace: {
    getDefault(): Promise<WorkspaceSummary>;
    selectDirectory(): Promise<WorkspaceSummary | null>;
  };
  tasks: {
    create(input: CreateTaskRequest): Promise<CreatedTask>;
  };
  models: {
    list(): Promise<ModelProfileSummary[]>;
    save(input: z.infer<typeof saveModelProfileRequestSchema>): Promise<{ id: string }>;
    delete(input: { id: string }): Promise<{ deleted: boolean }>;
    setDefault(input: { id: string }): Promise<{ updated: boolean }>;
    setEnabled(input: { id: string; enabled: boolean }): Promise<{ updated: boolean }>;
    test(input: z.infer<typeof testModelRequestSchema>): Promise<{ ok: boolean; message: string }>;
  };
  chrome: {
    updateTheme(input: UpdateWindowThemeRequest): Promise<void>;
  };
  knowledge: {
    list(): Promise<KnowledgeDocumentSummary[]>;
    importFromDialog(): Promise<KnowledgeImportResult>;
    search(input: SearchKnowledgeRequest): Promise<KnowledgeSearchResult[]>;
  };
}
