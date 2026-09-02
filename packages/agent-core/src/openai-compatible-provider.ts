import type { ModelProvider, ModelRequest, ModelStreamChunk } from './types';

export interface OpenAICompatibleProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
}

const endpoint = (baseUrl: string): string => baseUrl.replace(/\/$/, '').endsWith('/chat/completions')
  ? baseUrl
  : `${baseUrl.replace(/\/$/, '')}/chat/completions`;

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const response = await fetch(endpoint(this.config.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.config.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          ...(message.toolName ? { name: message.toolName } : {}),
          ...(message.toolCalls ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}),
        })),
        tools: request.tools.length > 0 ? request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) : undefined,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: this.config.maxOutputTokens ?? 8192,
        stream: true,
      }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
    if (!response.body) throw new Error('模型服务没有返回流式响应');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const emitLine = (line: string): ModelStreamChunk[] => {
      if (!line.startsWith('data:')) return [];
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return [];
      const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
      const delta = chunk.choices?.[0]?.delta;
      const output: ModelStreamChunk[] = [];
      if (delta?.reasoning_content) output.push({ type: 'reasoning-delta', delta: delta.reasoning_content });
      if (delta?.content) output.push({ type: 'text-delta', delta: delta.content });
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const current = toolCalls.get(index) ?? { id: call.id ?? `tool-${index}`, name: '', arguments: '' };
        current.id = call.id ?? current.id;
        current.name += call.function?.name ?? '';
        current.arguments += call.function?.arguments ?? '';
        toolCalls.set(index, current);
      }
      return output;
    };

    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield* emitLine(line.trim());
      if (result.done) break;
    }
    if (buffer.trim()) yield* emitLine(buffer.trim());
    for (const call of toolCalls.values()) {
      const input = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
      yield { type: 'tool-call', toolCall: { id: call.id, name: call.name, input } };
    }
    yield { type: 'done' };
  }
}
