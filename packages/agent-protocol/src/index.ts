import { z } from 'zod';

export const messageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

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

export const cancelRunRequestSchema = z.object({ runId: z.string().min(1) });
export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>;

export const listRunEventsRequestSchema = z.object({ runId: z.string().min(1) });
export type ListRunEventsRequest = z.infer<typeof listRunEventsRequestSchema>;

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
    getDefaultPath(): Promise<string>;
    selectDirectory(): Promise<string | null>;
  };
}
