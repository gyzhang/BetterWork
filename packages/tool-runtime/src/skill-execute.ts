import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z
  .object({
    bindingId: z.string().min(1),
    commandId: z.string().trim().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export interface SkillCommandExecuteInput {
  runId: string;
  toolCallId: string;
  bindingId: string;
  commandId: string;
  args: Record<string, unknown>;
}

export interface SkillCommandExecuteOutput {
  executionId: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'timed-out';
  reason?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  reportHash?: string;
  outputIds?: string[];
  durationMs?: number;
  message: string;
}

export type SkillCommandExecutor = (
  input: SkillCommandExecuteInput,
) => Promise<SkillCommandExecuteOutput>;

export const createSkillExecuteTool = (executor: SkillCommandExecutor): AgentTool => ({
  name: 'skill_execute',
  description:
    'Execute a registered command of the bound Skill (project-init, svg-export, template-merge, pptx-validate, etc.). The host resolves the executable and environment; submit structured arguments only.',
  inputSchema: {
    type: 'object',
    properties: {
      bindingId: {
        type: 'string',
        description: 'The Skill binding ID for the current run.',
      },
      commandId: {
        type: 'string',
        description: 'The registered command ID to execute.',
      },
      args: {
        type: 'object',
        description: 'Structured arguments for the command as defined by its argument schema.',
      },
    },
    required: ['bindingId', 'commandId'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(`正在执行命令：${input.commandId}`);

    const result = await executor({
      runId: context.runId,
      toolCallId: context.toolCallId,
      bindingId: input.bindingId,
      commandId: input.commandId,
      args: input.args ?? {},
    });

    if (context.signal.aborted) throw abortError();

    return result;
  },
});
