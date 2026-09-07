import { abortError } from './errors';
import type { ModelProvider, ModelRequest, ModelStreamChunk } from './types';

export interface OpenAICompatibleProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface OpenAICompatibleProviderOptions {
  fetchImpl?: typeof fetch;
  streamTimeoutMs?: number;
}

const DEFAULT_STREAM_TIMEOUT_MS = 120_000;

/**
 * 归一化用户填写的 base URL。
 * 三种填法都要落到同一个端点：`https://host/v1`、带若干尾斜杠的同一地址、
 * 以及已经写全的 `https://host/v1/chat/completions`。
 */
const endpoint = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly fetchImpl: typeof fetch;
  private readonly streamTimeoutMs: number;

  constructor(
    private readonly config: OpenAICompatibleProviderConfig,
    options: OpenAICompatibleProviderOptions = {},
  ) {
    this.id = config.id;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.streamTimeoutMs = options.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const timeout = AbortSignal.timeout(this.streamTimeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
            ...(message.toolName ? { name: message.toolName } : {}),
            ...(message.toolCalls
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.input) },
                  })),
                }
              : {}),
          })),
          tools:
            request.tools.length > 0
              ? request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                }))
              : undefined,
          temperature: this.config.temperature ?? 0.7,
          max_tokens: this.config.maxOutputTokens ?? 8192,
          stream: true,
        }),
        signal,
      });
    } catch (error) {
      throw this.streamError(error, request.signal, timeout);
    }
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
    if (!response.body) throw new Error('模型服务没有返回流式响应');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const emitLine = (line: string): ModelStreamChunk[] => {
      if (!line.startsWith('data:')) return [];
      const data = line.slice(5).trim();
      if (!data) return [];
      if (data === '[DONE]') {
        completed = true;
        return [];
      }
      const chunk = JSON.parse(data) as {
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (choice?.finish_reason) completed = true;
      const output: ModelStreamChunk[] = [];
      if (delta?.reasoning_content)
        output.push({ type: 'reasoning-delta', delta: delta.reasoning_content });
      if (delta?.content) output.push({ type: 'text-delta', delta: delta.content });
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const current = toolCalls.get(index) ?? {
          id: call.id ?? `tool-${index}`,
          name: '',
          arguments: '',
        };
        current.id = call.id ?? current.id;
        current.name += call.function?.name ?? '';
        current.arguments += call.function?.arguments ?? '';
        toolCalls.set(index, current);
      }
      return output;
    };

    try {
      while (true) {
        const result = await reader.read();
        buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) yield* emitLine(line.trim());
        if (result.done) break;
      }
      if (buffer.trim()) yield* emitLine(buffer.trim());
    } catch (error) {
      throw this.streamError(error, request.signal, timeout);
    } finally {
      reader.releaseLock();
    }
    if (!completed) throw new Error('模型流在收到完成信号前结束');
    for (const call of toolCalls.values()) {
      const input = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
      yield { type: 'tool-call', toolCall: { id: call.id, name: call.name, input } };
    }
    yield { type: 'done' };
  }

  private streamError(error: unknown, requestSignal: AbortSignal, timeout: AbortSignal): Error {
    if (requestSignal.aborted) return abortError();
    if (timeout.aborted) {
      return new Error(`模型流响应超时（超过 ${this.streamTimeoutMs / 1000} 秒）`, {
        cause: error,
      });
    }
    return error instanceof Error ? error : new Error('模型流请求失败', { cause: error });
  }
}
