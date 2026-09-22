import { abortError } from './errors';
import type {
  ModelFinishReason,
  ModelProvider,
  ModelRequest,
  ModelStreamChunk,
  ModelUsage,
} from './types';

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

const DEFAULT_STREAM_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/** 只有真实正数才是一次可用的 token 上限；缺失或非法值退回既有的 profile 缺省。 */
const tokenCeiling = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const maxOutputTokensFor = (
  profileCeiling: number | undefined,
  requestCeiling: number | undefined,
): number => {
  const profile = tokenCeiling(profileCeiling) ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(tokenCeiling(requestCeiling) ?? profile, profile);
};

const FINISH_REASON_BY_WIRE_VALUE: ReadonlyMap<string, ModelFinishReason> = new Map([
  ['stop', 'stop'],
  ['length', 'length'],
  ['tool-calls', 'tool-calls'],
  ['tool_calls', 'tool-calls'],
  ['content-filter', 'content-filter'],
  ['content_filter', 'content-filter'],
]);

const finishReasonOf = (wireValue: string): ModelFinishReason =>
  FINISH_REASON_BY_WIRE_VALUE.get(wireValue) ?? 'unknown';

const tokenCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** usage 只搬运上游真实返回的数字，绝不把 code points 之类推算值冒充成 token。 */
const usageOf = (usage: StreamUsage | null | undefined): ModelUsage | undefined => {
  if (!usage) return undefined;
  const promptTokens = tokenCount(usage.prompt_tokens);
  const completionTokens = tokenCount(usage.completion_tokens);
  const totalTokens = tokenCount(usage.total_tokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
};

interface StreamUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
}

interface StreamPayload {
  choices?: Array<{
    finish_reason?: unknown;
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
  usage?: StreamUsage | null;
}

/**
 * 归一化用户填写的 base URL。
 * 三种填法都要落到同一个端点：`https://host/v1`、带若干尾斜杠的同一地址、
 * 以及已经写全的 `https://host/v1/chat/completions`。
 */
const endpoint = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (!normalizedPath.endsWith('/chat/completions')) {
    url.pathname = `${normalizedPath}/chat/completions`;
  } else {
    url.pathname = normalizedPath;
  }
  return url.toString();
};

const displayBaseUrl = (baseUrl: string): string => {
  try {
    const url = new URL(baseUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '配置的模型地址';
  }
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
          max_tokens: maxOutputTokensFor(this.config.maxOutputTokens, request.maxOutputTokens),
          stream: true,
        }),
        signal,
      });
    } catch (error) {
      throw this.requestError(error, request.signal, timeout);
    }
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
    if (!response.body) throw new Error('模型服务没有返回流式响应');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    let wireFinishReason: string | undefined;
    let usage: ModelUsage | undefined;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const emitLine = (line: string): ModelStreamChunk[] => {
      if (!line.startsWith('data:')) return [];
      const data = line.slice(5).trim();
      if (!data) return [];
      if (data === '[DONE]') {
        completed = true;
        return [];
      }
      const chunk = JSON.parse(data) as StreamPayload;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      const parsedUsage = usageOf(chunk.usage);
      if (parsedUsage) usage = parsedUsage;
      if (choice?.finish_reason) {
        completed = true;
        if (wireFinishReason === undefined && typeof choice.finish_reason === 'string') {
          wireFinishReason = choice.finish_reason;
        }
      }
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
    yield {
      type: 'done',
      ...(wireFinishReason === undefined ? {} : { finishReason: finishReasonOf(wireFinishReason) }),
      ...(usage === undefined ? {} : { usage }),
    };
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

  private requestError(error: unknown, requestSignal: AbortSignal, timeout: AbortSignal): Error {
    if (requestSignal.aborted) return abortError();
    if (timeout.aborted) {
      return new Error(`模型流响应超时（超过 ${this.streamTimeoutMs / 1000} 秒）`, {
        cause: error,
      });
    }
    const detail = error instanceof Error ? error.message : '未知网络错误';
    return new Error(`无法连接模型服务（${displayBaseUrl(this.config.baseUrl)}）：${detail}`, {
      cause: error,
    });
  }
}
