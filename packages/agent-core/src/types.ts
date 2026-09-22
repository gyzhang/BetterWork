import type { AgentMessage, AgentRuntimeEvent, ToolCall } from '@betterwork/agent-protocol';

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MODEL_FINISH_REASONS = [
  'stop',
  'length',
  'tool-calls',
  'content-filter',
  'unknown',
] as const;

export type ModelFinishReason = (typeof MODEL_FINISH_REASONS)[number];

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type ModelStreamChunk =
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'done'; finishReason?: ModelFinishReason; usage?: ModelUsage };

export interface ModelRequest {
  messages: AgentMessage[];
  tools: ModelToolDefinition[];
  signal: AbortSignal;
  maxOutputTokens?: number;
}

export interface ModelProvider {
  readonly id: string;
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}

export interface ToolExecutionContext {
  runId: string;
  toolCallId: string;
  workspacePath: string;
  signal: AbortSignal;
  reportProgress(message: string): void;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}

export interface SkillInstruction {
  skillId: string;
  name: string;
  instruction: string;
}

export interface AgentRunInput {
  runId: string;
  taskId: string;
  sessionId: string;
  prompt: string;
  workspacePath: string;
  messages?: AgentMessage[];
  model: ModelProvider;
  tools: AgentTool[];
  signal: AbortSignal;
  maxToolRounds?: number;
  expertInstruction?: string;
  skillInstructions?: SkillInstruction[];
}

export interface AgentEngine {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}
