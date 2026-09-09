import { randomUUID } from 'node:crypto';

import type {
  AgentMessage,
  AgentRuntimeEvent,
  AgentRuntimeEventInput,
  ToolCall,
} from '@betterwork/agent-protocol';

import { abortError, describeError, isAbortError } from './errors';
import type { AgentEngine, AgentRunInput, SkillInstruction } from './types';

const SYSTEM_PROMPT = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return `今天是 ${year} 年 ${month} 月 ${day} 日。搜索新闻或时效性内容时，请在关键词中包含当前年份。`;
};

export const SKILL_INSTRUCTION_BUDGET = 16_000;

const OVERFLOW_HINT =
  '（部分 Skill 指令因长度被截断，可通过 skill_read_resource 工具按需读取完整内容。）';

const formatSkillHeader = (name: string): string =>
  `以下是 Skill「${name}」的指令，请在后续回答中遵循这些说明：`;

export const buildSkillMessages = (
  instructions: readonly SkillInstruction[] | undefined,
): AgentMessage[] => {
  if (!instructions || instructions.length === 0) return [];

  const seen = new Set<string>();
  const deduped: SkillInstruction[] = [];
  for (const item of instructions) {
    if (seen.has(item.skillId)) continue;
    seen.add(item.skillId);
    deduped.push(item);
  }

  const messages: AgentMessage[] = [];
  let totalLength = 0;

  for (const item of deduped) {
    const header = formatSkillHeader(item.name);
    const entryLength = header.length + item.instruction.length;

    if (totalLength + entryLength <= SKILL_INSTRUCTION_BUDGET) {
      messages.push({
        id: randomUUID(),
        role: 'system',
        content: `${header}\n\n${item.instruction}`,
      });
      totalLength += entryLength;
      continue;
    }

    const remaining = SKILL_INSTRUCTION_BUDGET - totalLength;
    if (remaining > OVERFLOW_HINT.length + 4) {
      const truncated = item.instruction.slice(0, remaining - OVERFLOW_HINT.length);
      messages.push({
        id: randomUUID(),
        role: 'system',
        content: `${header}\n\n${truncated}${OVERFLOW_HINT}`,
      });
    }
    break;
  }

  return messages;
};

class RunEventFactory {
  private sequence = 0;

  constructor(private readonly runId: string) {}

  create(input: AgentRuntimeEventInput): AgentRuntimeEvent {
    return {
      ...input,
      id: randomUUID(),
      runId: this.runId,
      sequence: this.sequence++,
      createdAt: Date.now(),
    };
  }
}

export class ReActAgentEngine implements AgentEngine {
  async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const events = new RunEventFactory(input.runId);
    const skillMessages = buildSkillMessages(input.skillInstructions);
    const messages: AgentMessage[] = [
      { id: randomUUID(), role: 'system', content: SYSTEM_PROMPT() },
      ...skillMessages,
      ...(input.messages ?? []),
      { id: randomUUID(), role: 'user', content: input.prompt },
    ];
    const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
    const maxToolRounds = input.maxToolRounds ?? 8;

    yield events.create({ type: 'run.started', taskId: input.taskId, sessionId: input.sessionId });

    try {
      for (let round = 0; round <= maxToolRounds; round += 1) {
        if (input.signal.aborted) throw abortError();

        const messageId = randomUUID();
        let content = '';
        const pendingToolCalls: ToolCall[] = [];
        let messageStarted = false;

        for await (const chunk of input.model.stream({
          messages,
          tools: input.tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
          signal: input.signal,
        })) {
          if (input.signal.aborted) throw abortError();

          if (chunk.type === 'reasoning-delta') {
            yield events.create({ type: 'reasoning.delta', delta: chunk.delta });
          } else if (chunk.type === 'text-delta') {
            if (!messageStarted) {
              messageStarted = true;
              yield events.create({ type: 'message.started', messageId });
            }
            content += chunk.delta;
            yield events.create({ type: 'message.delta', messageId, delta: chunk.delta });
          } else if (chunk.type === 'tool-call') {
            pendingToolCalls.push(chunk.toolCall);
            yield events.create({ type: 'tool.requested', toolCall: chunk.toolCall });
          }
        }

        if (messageStarted) {
          yield events.create({ type: 'message.completed', messageId, content });
          messages.push({
            id: messageId,
            role: 'assistant',
            content,
            ...(pendingToolCalls.length > 0 ? { toolCalls: pendingToolCalls } : {}),
          });
        }

        if (pendingToolCalls.length === 0) {
          yield events.create({ type: 'run.completed', finalContent: content });
          return;
        }

        if (round === maxToolRounds) throw new Error(`Tool round limit exceeded: ${maxToolRounds}`);

        if (!messageStarted)
          messages.push({
            id: messageId,
            role: 'assistant',
            content: '',
            toolCalls: pendingToolCalls,
          });
        for (const toolCall of pendingToolCalls) {
          const tool = tools.get(toolCall.name);
          if (!tool) throw new Error(`Unknown tool: ${toolCall.name}`);
          yield events.create({ type: 'tool.started', toolCall });
          const progress: AgentRuntimeEvent[] = [];
          let wakeForProgress: (() => void) | undefined;
          const onAbort = (): void => wakeForProgress?.();
          input.signal.addEventListener('abort', onAbort, { once: true });
          const execution = tool
            .execute(toolCall.input, {
              runId: input.runId,
              toolCallId: toolCall.id,
              workspacePath: input.workspacePath,
              signal: input.signal,
              reportProgress(message) {
                progress.push(
                  events.create({ type: 'tool.progress', toolCallId: toolCall.id, message }),
                );
                wakeForProgress?.();
              },
            })
            .then(
              (output) => ({ type: 'completed' as const, output }),
              (error: unknown) => ({ type: 'failed' as const, error }),
            );
          try {
            let outcome: Awaited<typeof execution> | undefined;
            while (!outcome || progress.length > 0) {
              const nextProgress = progress.shift();
              if (nextProgress) {
                yield nextProgress;
                continue;
              }
              if (outcome) break;
              const progressSignal = new Promise<void>((resolve) => {
                wakeForProgress = resolve;
              });
              const result = await Promise.race([execution, progressSignal]);
              wakeForProgress = undefined;
              if (input.signal.aborted) throw abortError();
              if (result) outcome = result;
            }
            if (!outcome) throw new Error('Tool execution ended without a result');
            if (outcome.type === 'completed') {
              yield events.create({
                type: 'tool.completed',
                toolCallId: toolCall.id,
                output: outcome.output,
              });
              messages.push({
                id: randomUUID(),
                role: 'tool',
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: JSON.stringify(outcome.output),
              });
            } else {
              const message = describeError(outcome.error);
              yield events.create({ type: 'tool.failed', toolCallId: toolCall.id, error: message });
              messages.push({
                id: randomUUID(),
                role: 'tool',
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: JSON.stringify({ error: message }),
              });
            }
          } finally {
            input.signal.removeEventListener('abort', onAbort);
            wakeForProgress = undefined;
          }
        }
      }
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        yield events.create({ type: 'run.cancelled' });
        return;
      }
      yield events.create({ type: 'run.failed', error: describeError(error) });
    }
  }
}
