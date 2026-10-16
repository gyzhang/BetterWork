import { randomUUID } from 'node:crypto';

import type {
  AgentMessage,
  AgentRuntimeEvent,
  AgentRuntimeEventInput,
  ModelErrorCode,
} from '@betterwork/agent-protocol';

import { abortError, describeError, isAbortError } from './errors';
import type {
  AgentEngine,
  AgentRunInput,
  ModelFinishReason,
  ModelMessage,
  ModelToolCall,
  ModelUsage,
  SkillInstruction,
} from './types';

const SYSTEM_PROMPT = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return `今天是 ${year} 年 ${month} 月 ${day} 日。搜索新闻或时效性内容时，请在关键词中包含当前年份。`;
};

export const SKILL_INSTRUCTION_BUDGET = 16_000;

class ModelCallFailure extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModelCallFailure';
  }
}

const safeModelErrorSummary = (code: ModelErrorCode): string => {
  switch (code) {
    case 'provider-error':
      return '模型服务调用失败。';
    case 'stream-error':
      return '模型响应流读取失败。';
    case 'stream-incomplete':
      return '模型响应流未正常完成。';
    case 'empty-response':
      return '模型没有返回可用文本或工具调用。';
    case 'output-limit':
      return '模型响应达到输出上限。';
    case 'content-filter':
      return '模型响应被内容过滤中断。';
    case 'unknown-finish-reason':
      return '模型返回未知完成原因。';
  }
};

const OVERFLOW_HINT =
  '（部分 Skill 指令因长度被截断，可通过 skill_read_resource 工具按需读取完整内容。）';

const formatSkillHeader = (name: string): string =>
  `以下是 Skill「${name}」的指令，请在后续回答中遵循这些说明：`;
const formatRuntimeHeader = (name: string): string =>
  `以下是 Skill「${name}」的固定运行约定，执行时必须遵循：`;

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

  // 运行约定含当前 Run 的真实 bindingId 和可执行命令表，不能被长 SKILL.md 正文截掉。
  for (const item of deduped) {
    const runtimeInstruction = item.runtimeInstruction?.trim();
    if (!runtimeInstruction) continue;
    const content = `${formatRuntimeHeader(item.name)}\n\n${runtimeInstruction}`;
    if (totalLength + content.length > SKILL_INSTRUCTION_BUDGET) {
      throw new Error('所选 Skill 的运行约定超过上下文预算，无法安全启动 Run。');
    }
    messages.push({ id: randomUUID(), role: 'system', content });
    totalLength += content.length;
  }

  for (const item of deduped) {
    if (!item.instruction.trim()) continue;
    const header = formatSkillHeader(item.name);
    const fullContent = `${header}\n\n${item.instruction}`;

    if (totalLength + fullContent.length <= SKILL_INSTRUCTION_BUDGET) {
      messages.push({ id: randomUUID(), role: 'system', content: fullContent });
      totalLength += fullContent.length;
      continue;
    }

    const remaining = SKILL_INSTRUCTION_BUDGET - totalLength;
    const fixedLength = header.length + 2 + OVERFLOW_HINT.length;
    if (remaining > fixedLength) {
      const truncated = item.instruction.slice(0, remaining - fixedLength);
      const content = `${header}\n\n${truncated}${OVERFLOW_HINT}`;
      messages.push({
        id: randomUUID(),
        role: 'system',
        content,
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
  constructor(private readonly monotonicNow: () => number = () => performance.now()) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const events = new RunEventFactory(input.runId);
    const skillMessages = buildSkillMessages(input.skillInstructions);
    const messages: ModelMessage[] = [
      { id: randomUUID(), role: 'system', content: SYSTEM_PROMPT() },
      ...(input.expertInstruction
        ? [{ id: randomUUID(), role: 'system' as const, content: input.expertInstruction }]
        : []),
      ...skillMessages,
      ...(input.messages ?? []),
      { id: randomUUID(), role: 'user', content: input.prompt },
    ];
    const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
    const availableToolNames = input.tools.map((tool) => tool.name);
    const maxToolRounds = input.maxToolRounds ?? 20;
    const checkCancelled = (): void => {
      if (input.signal.aborted) throw abortError();
    };

    yield events.create({ type: 'run.started', taskId: input.taskId, sessionId: input.sessionId });

    try {
      for (let round = 0; round <= maxToolRounds; round += 1) {
        checkCancelled();

        const messageId = randomUUID();
        let content = '';
        const pendingToolCalls: Array<{ toolCall: ModelToolCall; error?: string }> = [];
        let messageStarted = false;
        let receivedDone = false;
        let receivedStreamChunk = false;
        let finishReason: ModelFinishReason | undefined;
        let usage: ModelUsage | undefined;
        let providerRequestId: string | undefined;
        let providerResponseId: string | undefined;
        let responseModel: string | undefined;
        let firstTextAt: number | undefined;
        const modelCallId = randomUUID();
        const modelStartedAt = this.monotonicNow();
        const toolCorrelation = { modelCallId, round };
        const endingFields = (durationMs: number) => ({
          modelCallId,
          round,
          durationMs,
          ...(firstTextAt === undefined
            ? {}
            : { timeToFirstTextMs: Math.max(0, firstTextAt - modelStartedAt) }),
          ...(finishReason === undefined ? {} : { finishReason }),
          ...(usage === undefined ? {} : { usage }),
          ...(providerRequestId === undefined ? {} : { providerRequestId }),
          ...(providerResponseId === undefined ? {} : { providerResponseId }),
          ...(responseModel === undefined ? {} : { responseModel }),
        });

        yield events.create({
          type: 'model.started',
          modelCallId,
          round,
          providerId: input.model.id,
          messageCount: messages.length,
          toolDefinitionCount: input.tools.length,
        });

        try {
          checkCancelled();
          for await (const chunk of input.model.stream({
            messages,
            tools: input.tools.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
            signal: input.signal,
          })) {
            receivedStreamChunk = true;
            checkCancelled();

            if (chunk.type === 'reasoning-delta') {
              yield events.create({ type: 'reasoning.delta', delta: chunk.delta });
            } else if (chunk.type === 'text-delta') {
              if (chunk.delta.length > 0 && firstTextAt === undefined) {
                firstTextAt = this.monotonicNow();
              }
              if (!messageStarted) {
                messageStarted = true;
                yield events.create({ type: 'message.started', messageId });
                checkCancelled();
              }
              content += chunk.delta;
              yield events.create({ type: 'message.delta', messageId, delta: chunk.delta });
            } else if (chunk.type === 'tool-call') {
              pendingToolCalls.push({ toolCall: chunk.toolCall });
              yield events.create({
                type: 'tool.requested',
                toolCall: chunk.toolCall,
                ...toolCorrelation,
              });
            } else if (chunk.type === 'tool-call-error') {
              const toolCall = { ...chunk.toolCall, input: {} };
              pendingToolCalls.push({
                toolCall: { ...toolCall, rawArguments: chunk.toolCall.rawArguments },
                error: chunk.error,
              });
              yield events.create({
                type: 'tool.requested',
                toolCall: {
                  id: chunk.toolCall.id,
                  name: chunk.toolCall.name,
                  input: {},
                },
                ...toolCorrelation,
              });
            } else if (chunk.type === 'done') {
              receivedDone = true;
              finishReason = chunk.finishReason;
              usage = chunk.usage;
              providerRequestId = chunk.providerRequestId;
              providerResponseId = chunk.providerResponseId;
              responseModel = chunk.responseModel;
            }
            checkCancelled();
          }

          checkCancelled();
          if (!receivedDone)
            throw new ModelCallFailure('stream-incomplete', '模型事件流结束时没有完成信号。');
          if (finishReason === 'length')
            throw new ModelCallFailure(
              'output-limit',
              '模型响应达到输出上限，Run 未完成。请提高模型输出上限或缩短任务输入后重试。',
            );
          if (finishReason === 'content-filter')
            throw new ModelCallFailure('content-filter', '模型响应被内容过滤中断，Run 未完成。');
          if (finishReason === 'unknown')
            throw new ModelCallFailure(
              'unknown-finish-reason',
              '模型返回未知完成原因，Run 未完成。',
            );
          if (pendingToolCalls.length === 0 && !content.trim())
            throw new ModelCallFailure('empty-response', '模型没有返回有效回复，Run 未完成。');
        } catch (error) {
          const durationMs = Math.max(0, this.monotonicNow() - modelStartedAt);
          if (input.signal.aborted || isAbortError(error)) {
            yield events.create({ type: 'model.cancelled', ...endingFields(durationMs) });
            throw abortError();
          }
          const errorCode =
            error instanceof ModelCallFailure
              ? error.code
              : receivedStreamChunk
                ? 'stream-error'
                : 'provider-error';
          yield events.create({
            type: 'model.failed',
            ...endingFields(durationMs),
            errorCode,
            errorSummary: safeModelErrorSummary(errorCode),
          });
          throw error;
        }

        const durationMs = Math.max(0, this.monotonicNow() - modelStartedAt);
        yield events.create({ type: 'model.completed', ...endingFields(durationMs) });
        checkCancelled();
        if (messageStarted) {
          yield events.create({ type: 'message.completed', messageId, content });
          checkCancelled();
          messages.push({
            id: messageId,
            role: 'assistant',
            content,
            ...(pendingToolCalls.length > 0
              ? { toolCalls: pendingToolCalls.map((pending) => pending.toolCall) }
              : {}),
          });
        }

        if (pendingToolCalls.length === 0) {
          if (!content.trim()) throw new Error('模型没有返回有效回复，Run 未完成。');
          yield events.create({ type: 'run.completed', finalContent: content });
          return;
        }

        if (round === maxToolRounds) throw new Error(`Tool round limit exceeded: ${maxToolRounds}`);

        if (!messageStarted)
          messages.push({
            id: messageId,
            role: 'assistant',
            content: '',
            toolCalls: pendingToolCalls.map((pending) => pending.toolCall),
          });
        for (const pending of pendingToolCalls) {
          checkCancelled();
          const { toolCall } = pending;
          if (pending.error !== undefined) {
            yield events.create({
              type: 'tool.failed',
              toolCallId: toolCall.id,
              error: pending.error,
              ...toolCorrelation,
              diagnostic: { kind: 'invalid-arguments', source: 'model-provider-output' },
            });
            checkCancelled();
            messages.push({
              id: randomUUID(),
              role: 'tool',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: JSON.stringify({ error: pending.error }),
            });
            continue;
          }
          const tool = tools.get(toolCall.name);
          if (!tool) {
            const error = `未知工具「${toolCall.name}」未注册到本次 Run。请只使用本次请求提供的工具，或直接继续回答。`;
            yield events.create({
              type: 'tool.failed',
              toolCallId: toolCall.id,
              error,
              ...toolCorrelation,
              diagnostic: {
                kind: 'unknown-tool',
                source: 'model-provider-output',
                requestedName: toolCall.name,
                availableToolNames,
                modelProviderId: input.model.id,
                round,
                ...(providerRequestId === undefined ? {} : { providerRequestId }),
                ...(providerResponseId === undefined ? {} : { providerResponseId }),
                ...(responseModel === undefined ? {} : { responseModel }),
              },
            });
            checkCancelled();
            messages.push({
              id: randomUUID(),
              role: 'tool',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: JSON.stringify({ error }),
            });
            continue;
          }
          yield events.create({ type: 'tool.started', toolCall, ...toolCorrelation });
          checkCancelled();
          const progress: AgentRuntimeEvent[] = [];
          let acceptsProgress = true;
          let wakeForProgress: (() => void) | undefined;
          const onAbort = (): void => wakeForProgress?.();
          input.signal.addEventListener('abort', onAbort, { once: true });
          const execution = Promise.resolve()
            .then(() => {
              checkCancelled();
              return tool.execute(toolCall.input, {
                runId: input.runId,
                toolCallId: toolCall.id,
                workspacePath: input.workspacePath,
                signal: input.signal,
                reportProgress(message) {
                  if (!acceptsProgress || input.signal.aborted) return;
                  progress.push(
                    events.create({
                      type: 'tool.progress',
                      toolCallId: toolCall.id,
                      message,
                      ...toolCorrelation,
                    }),
                  );
                  wakeForProgress?.();
                },
              });
            })
            .then((output: unknown) => {
              const serialized = JSON.stringify(output);
              if (serialized === undefined) throw new Error('工具结果无法序列化为 JSON。');
              return { output: JSON.parse(serialized) as unknown, content: serialized };
            })
            .then(
              ({ output, content: toolContent }) => ({
                type: 'completed' as const,
                output,
                content: toolContent,
              }),
              (error: unknown) => ({ type: 'failed' as const, error }),
            );
          try {
            let outcome: Awaited<typeof execution> | undefined;
            while (!outcome || progress.length > 0) {
              checkCancelled();
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
              checkCancelled();
              if (result) outcome = result;
            }
            if (!outcome) throw new Error('Tool execution ended without a result');
            if (outcome.type === 'completed') {
              yield events.create({
                type: 'tool.completed',
                toolCallId: toolCall.id,
                output: outcome.output,
                ...toolCorrelation,
              });
              checkCancelled();
              messages.push({
                id: randomUUID(),
                role: 'tool',
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: outcome.content,
              });
            } else {
              const message = describeError(outcome.error);
              yield events.create({
                type: 'tool.failed',
                toolCallId: toolCall.id,
                error: message,
                ...toolCorrelation,
              });
              checkCancelled();
              messages.push({
                id: randomUUID(),
                role: 'tool',
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: JSON.stringify({ error: message }),
              });
            }
          } finally {
            acceptsProgress = false;
            progress.length = 0;
            input.signal.removeEventListener('abort', onAbort);
            wakeForProgress = undefined;
          }
        }
      }
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        const reason = typeof input.signal.reason === 'string' ? input.signal.reason : undefined;
        yield events.create({
          type: 'run.cancelled',
          ...(reason ? { reason } : {}),
        });
        return;
      }
      yield events.create({ type: 'run.failed', error: describeError(error) });
    }
  }
}
