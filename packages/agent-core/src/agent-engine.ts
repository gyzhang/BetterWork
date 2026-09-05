import { randomUUID } from 'node:crypto';
import type {
  AgentMessage,
  AgentRuntimeEvent,
  AgentRuntimeEventInput,
  ToolCall,
} from '@betterwork/agent-protocol';
import { abortError, describeError, isAbortError } from './errors';
import type { AgentEngine, AgentRunInput } from './types';

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
    const messages: AgentMessage[] = [
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
        let pendingToolCall: ToolCall | undefined;
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
            pendingToolCall = chunk.toolCall;
            yield events.create({ type: 'tool.requested', toolCall: chunk.toolCall });
          }
        }

        if (messageStarted) {
          yield events.create({ type: 'message.completed', messageId, content });
          messages.push({
            id: messageId,
            role: 'assistant',
            content,
            ...(pendingToolCall ? { toolCalls: [pendingToolCall] } : {}),
          });
        }

        if (!pendingToolCall) {
          yield events.create({ type: 'run.completed', finalContent: content });
          return;
        }

        if (round === maxToolRounds) throw new Error(`Tool round limit exceeded: ${maxToolRounds}`);

        const tool = tools.get(pendingToolCall.name);
        if (!tool) throw new Error(`Unknown tool: ${pendingToolCall.name}`);
        // 绑定为不可变引用：下面的进度回调与结果处理都属于同一次调用，
        // 也因此在闭包里不再需要非空断言。
        const toolCall: ToolCall = pendingToolCall;

        if (!messageStarted)
          messages.push({
            id: messageId,
            role: 'assistant',
            content: '',
            toolCalls: [toolCall],
          });
        yield events.create({ type: 'tool.started', toolCall });
        const progress: AgentRuntimeEvent[] = [];
        try {
          const output = await tool.execute(toolCall.input, {
            runId: input.runId,
            workspacePath: input.workspacePath,
            signal: input.signal,
            reportProgress(message) {
              progress.push(
                events.create({ type: 'tool.progress', toolCallId: toolCall.id, message }),
              );
            },
          });
          for (const event of progress) yield event;
          yield events.create({ type: 'tool.completed', toolCallId: toolCall.id, output });
          messages.push({
            id: randomUUID(),
            role: 'tool',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: JSON.stringify(output),
          });
        } catch (error) {
          if (input.signal.aborted) throw abortError();
          const message = describeError(error);
          yield events.create({
            type: 'tool.failed',
            toolCallId: toolCall.id,
            error: message,
          });
          messages.push({
            id: randomUUID(),
            role: 'tool',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: JSON.stringify({ error: message }),
          });
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
