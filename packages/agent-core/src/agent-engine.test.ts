import { describe, expect, it, vi } from 'vitest';
import { calculatorTool, createKnowledgeSearchTool } from '@betterwork/tool-runtime';
import { ReActAgentEngine } from './agent-engine';
import { FakeModelProvider } from './fake-provider';
import { OpenAICompatibleProvider } from './openai-compatible-provider';

describe('ReActAgentEngine', () => {
  it('emits an ordered tool run and final answer', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    for await (const event of engine.run({
      runId: 'run-1', taskId: 'task-1', sessionId: 'session-1',
      prompt: '计算: (12 + 8) * 3', workspacePath: '.',
      model: new FakeModelProvider(0), tools: [calculatorTool], signal: new AbortController().signal,
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started', 'reasoning.delta', 'tool.requested', 'tool.started', 'tool.progress',
      'tool.completed', 'message.started', 'message.delta', 'message.delta', 'message.completed', 'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
  });

  it('emits cancellation instead of failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = new ReActAgentEngine();
    const events = [];
    for await (const event of engine.run({
      runId: 'run-2', taskId: 'task-1', sessionId: 'session-1', prompt: 'hello', workspacePath: '.',
      model: new FakeModelProvider(), tools: [], signal: controller.signal,
    })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['run.started', 'run.cancelled']);
  });

  it('lets the teaching provider search local knowledge through a read-only tool', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    for await (const event of engine.run({
      runId: 'run-knowledge', taskId: 'task-1', sessionId: 'session-1', prompt: '搜索知识: 续约风险', workspacePath: '.',
      model: new FakeModelProvider(0),
      tools: [createKnowledgeSearchTool(() => [{ id: 'doc-1', title: '客户访谈', sourcePath: '/notes/customer.md', format: 'markdown', excerpt: '续约风险需要季度复盘。' }])],
      signal: new AbortController().signal,
    })) events.push(event);

    expect(events.some((event) => event.type === 'tool.requested' && event.toolCall.name === 'knowledge_search')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('cancels an active stream without reporting a failure', async () => {
    const controller = new AbortController();
    const engine = new ReActAgentEngine();
    const events = [];
    for await (const event of engine.run({
      runId: 'run-3', taskId: 'task-1', sessionId: 'session-1', prompt: 'hello', workspacePath: '.',
      model: new FakeModelProvider(1), tools: [], signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'message.delta') controller.abort();
    }

    expect(events.at(-1)?.type).toBe('run.cancelled');
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);
  });

  it('parses an OpenAI-compatible text stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"连接"}}]}\n\ndata: {"choices":[{"delta":{"content":"成功"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider({ id: 'model-1', baseUrl: 'http://localhost:8000/v1', apiKey: 'secret', model: 'demo' });
    const chunks = [];
    for await (const chunk of provider.stream({ messages: [{ id: 'm-1', role: 'user', content: 'hello' }], tools: [], signal: new AbortController().signal })) chunks.push(chunk);

    expect(chunks).toEqual([{ type: 'text-delta', delta: '连接' }, { type: 'text-delta', delta: '成功' }, { type: 'done' }]);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });
});
