import { describe, expect, it, vi } from 'vitest';
import { calculatorTool, createKnowledgeSearchTool } from '@betterwork/tool-runtime';
import { ReActAgentEngine } from './agent-engine';
import { FakeModelProvider } from './fake-provider';
import { OpenAICompatibleProvider } from './openai-compatible-provider';
import { type AgentTool, type ModelProvider, type ModelStreamChunk } from './types';

const scriptedModel = (rounds: ModelStreamChunk[][]): ModelProvider => {
  let call = 0;
  return {
    id: 'scripted',
    async *stream(): AsyncIterable<ModelStreamChunk> {
      yield* rounds[Math.min(call, rounds.length - 1)] ?? [];
      call += 1;
    },
  };
};

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
      tools: [createKnowledgeSearchTool(() => [{ id: 'doc-1', title: '客户访谈', sourcePath: '/notes/customer.md', format: 'markdown', locator: '全文', excerpt: '续约风险需要季度复盘。' }])],
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

  it('rejects a non-200 model response with a readable error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('exploded', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider({ id: 'model-1', baseUrl: 'http://localhost:8000/v1', apiKey: 'secret', model: 'demo' });
    await expect(async () => {
      for await (const chunk of provider.stream({ messages: [{ id: 'm-1', role: 'user', content: 'hello' }], tools: [], signal: new AbortController().signal })) void chunk;
    }).rejects.toThrow('模型请求失败（HTTP 500）');
    vi.unstubAllGlobals();
  });

  it('reports a failing tool as tool.failed and lets the model recover', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    const failingTool: AgentTool = {
      name: 'boom', description: '总是失败的教学工具', inputSchema: { type: 'object' },
      execute: async () => { throw new Error('工具内部执行失败'); },
    };
    for await (const event of engine.run({
      runId: 'run-tool-failed', taskId: 'task-1', sessionId: 'session-1', prompt: '试试失败的工具', workspacePath: '.',
      model: scriptedModel([
        [{ type: 'tool-call', toolCall: { id: 'call-1', name: 'boom', input: {} } }, { type: 'done' }],
        [{ type: 'text-delta', delta: '工具失败后继续完成任务。' }, { type: 'done' }],
      ]),
      tools: [failingTool], signal: new AbortController().signal,
    })) events.push(event);

    expect(events.find((event) => event.type === 'tool.failed')).toMatchObject({ toolCallId: 'call-1', error: '工具内部执行失败' });
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);
  });

  it('fails the run when the model requests an unknown tool', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    for await (const event of engine.run({
      runId: 'run-unknown-tool', taskId: 'task-1', sessionId: 'session-1', prompt: '调用不存在的工具', workspacePath: '.',
      model: scriptedModel([[{ type: 'tool-call', toolCall: { id: 'call-x', name: '不存在', input: {} } }, { type: 'done' }]]),
      tools: [], signal: new AbortController().signal,
    })) events.push(event);

    expect(events.at(-1)).toMatchObject({ type: 'run.failed', error: 'Unknown tool: 不存在' });
    expect(events.some((event) => event.type === 'tool.started')).toBe(false);
  });

  it('fails the run when the model exceeds the tool round limit', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    const loopTool: AgentTool = { name: 'loop', description: '成功执行但模型会继续调用', inputSchema: { type: 'object' }, execute: async () => ({ ok: true }) };
    for await (const event of engine.run({
      runId: 'run-round-limit', taskId: 'task-1', sessionId: 'session-1', prompt: '不停调用工具', workspacePath: '.',
      model: scriptedModel([[{ type: 'tool-call', toolCall: { id: 'call-loop', name: 'loop', input: {} } }, { type: 'done' }]]),
      tools: [loopTool], signal: new AbortController().signal, maxToolRounds: 1,
    })) events.push(event);

    expect(events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', error: 'Tool round limit exceeded: 1' });
  });

  it('fails the run when the model stream errors after emitting output', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    const brokenModel: ModelProvider = {
      id: 'broken',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { type: 'text-delta', delta: '部分输出' };
        throw new Error('模型连接中断');
      },
    };
    for await (const event of engine.run({
      runId: 'run-stream-error', taskId: 'task-1', sessionId: 'session-1', prompt: '流会中断的任务', workspacePath: '.',
      model: brokenModel, tools: [], signal: new AbortController().signal,
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual(['run.started', 'message.started', 'message.delta', 'run.failed']);
    expect(events.at(-1)).toMatchObject({ error: '模型连接中断' });
  });
});
