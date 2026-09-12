import type { AgentMessage } from '@betterwork/agent-protocol';
import { calculatorTool, createKnowledgeSearchTool } from '@betterwork/tool-runtime';
import { describe, expect, it, vi } from 'vitest';

import { buildSkillMessages, ReActAgentEngine, SKILL_INSTRUCTION_BUDGET } from './agent-engine';
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

const recordingModel = (
  rounds: ModelStreamChunk[][],
): ModelProvider & { readonly capturedMessages: AgentMessage[] } => {
  const capturedMessages: AgentMessage[] = [];
  let call = 0;
  return {
    id: 'recording',
    capturedMessages,
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      capturedMessages.push(...request.messages);
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
      runId: 'run-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '计算: (12 + 8) * 3',
      workspacePath: '.',
      model: new FakeModelProvider(0),
      tools: [calculatorTool],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'reasoning.delta',
      'tool.requested',
      'tool.started',
      'tool.progress',
      'tool.completed',
      'message.started',
      'message.delta',
      'message.delta',
      'message.completed',
      'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
  });

  it('emits cancellation instead of failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = new ReActAgentEngine();
    const events = [];
    for await (const event of engine.run({
      runId: 'run-2',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: 'hello',
      workspacePath: '.',
      model: new FakeModelProvider(),
      tools: [],
      signal: controller.signal,
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(['run.started', 'run.cancelled']);
  });

  it('lets the teaching provider search local knowledge through a read-only tool', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    for await (const event of engine.run({
      runId: 'run-knowledge',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '搜索知识: 续约风险',
      workspacePath: '.',
      model: new FakeModelProvider(0),
      tools: [
        createKnowledgeSearchTool(() => [
          {
            id: 'doc-1',
            title: '客户访谈',
            sourcePath: '/notes/customer.md',
            format: 'markdown',
            locator: '全文',
            excerpt: '续约风险需要季度复盘。',
          },
        ]),
      ],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(
      events.some(
        (event) => event.type === 'tool.requested' && event.toolCall.name === 'knowledge_search',
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('cancels an active stream without reporting a failure', async () => {
    const controller = new AbortController();
    const engine = new ReActAgentEngine();
    const events = [];
    for await (const event of engine.run({
      runId: 'run-3',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: 'hello',
      workspacePath: '.',
      model: new FakeModelProvider(1),
      tools: [],
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'message.delta') controller.abort();
    }

    expect(events.at(-1)?.type).toBe('run.cancelled');
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);
  });

  it('parses an OpenAI-compatible text stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"连接"}}]}\n\ndata: {"choices":[{"delta":{"content":"成功"}}]}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider({
      id: 'model-1',
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'secret',
      model: 'demo',
    });
    const chunks = [];
    for await (const chunk of provider.stream({
      messages: [{ id: 'm-1', role: 'user', content: 'hello' }],
      tools: [],
      signal: new AbortController().signal,
    }))
      chunks.push(chunk);

    expect(chunks).toEqual([
      { type: 'text-delta', delta: '连接' },
      { type: 'text-delta', delta: '成功' },
      { type: 'done' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('rejects a non-200 model response with a readable error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('exploded', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider({
      id: 'model-1',
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'secret',
      model: 'demo',
    });
    await expect(async () => {
      for await (const chunk of provider.stream({
        messages: [{ id: 'm-1', role: 'user', content: 'hello' }],
        tools: [],
        signal: new AbortController().signal,
      }))
        void chunk;
    }).rejects.toThrow('模型请求失败（HTTP 500）');
    vi.unstubAllGlobals();
  });

  it('reports a failing tool as tool.failed and lets the model recover', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    const failingTool: AgentTool = {
      name: 'boom',
      description: '总是失败的教学工具',
      inputSchema: { type: 'object' },
      execute: async () => {
        throw new Error('工具内部执行失败');
      },
    };
    for await (const event of engine.run({
      runId: 'run-tool-failed',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '试试失败的工具',
      workspacePath: '.',
      model: scriptedModel([
        [
          { type: 'tool-call', toolCall: { id: 'call-1', name: 'boom', input: {} } },
          { type: 'done' },
        ],
        [{ type: 'text-delta', delta: '工具失败后继续完成任务。' }, { type: 'done' }],
      ]),
      tools: [failingTool],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(events.find((event) => event.type === 'tool.failed')).toMatchObject({
      toolCallId: 'call-1',
      error: '工具内部执行失败',
    });
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);
  });

  it('emits tool progress before a long-running tool completes', async () => {
    let release: (() => void) | undefined;
    const longRunningTool: AgentTool = {
      name: 'wait',
      description: '先报告进度再完成',
      inputSchema: { type: 'object' },
      async execute(_input, context) {
        context.reportProgress('正在等待外部结果');
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true };
      },
    };
    const iterator = new ReActAgentEngine()
      .run({
        runId: 'run-progress',
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '等待工具',
        workspacePath: '.',
        model: scriptedModel([
          [{ type: 'tool-call', toolCall: { id: 'wait-1', name: 'wait', input: {} } }],
          [{ type: 'text-delta', delta: '完成' }, { type: 'done' }],
        ]),
        tools: [longRunningTool],
        signal: new AbortController().signal,
      })
      [Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe('run.started');
    expect((await iterator.next()).value?.type).toBe('tool.requested');
    expect((await iterator.next()).value?.type).toBe('tool.started');
    expect(await iterator.next()).toMatchObject({ value: { type: 'tool.progress' } });
    release?.();

    expect((await iterator.next()).value?.type).toBe('tool.completed');
  });

  it('injects the engine-owned toolCallId into the tool execution context', async () => {
    let seenToolCallId = '';
    const probeTool: AgentTool = {
      name: 'probe',
      description: '记录上下文身份',
      inputSchema: { type: 'object' },
      async execute(_input, context) {
        seenToolCallId = context.toolCallId;
        return { ok: true };
      },
    };
    const events = [];
    for await (const event of new ReActAgentEngine().run({
      runId: 'run-identity',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '记录身份',
      workspacePath: '.',
      model: scriptedModel([
        [{ type: 'tool-call', toolCall: { id: 'call-42', name: 'probe', input: {} } }],
        [{ type: 'text-delta', delta: '完成' }, { type: 'done' }],
      ]),
      tools: [probeTool],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(seenToolCallId).toBe('call-42');
    expect(events.find((event) => event.type === 'tool.started')).toMatchObject({
      toolCall: { id: 'call-42' },
    });
  });

  it('executes every tool call requested in the same model round', async () => {
    const events = [];
    const executed: number[] = [];
    const engine = new ReActAgentEngine();
    const multiTool: AgentTool = {
      name: 'record',
      description: '记录调用顺序',
      inputSchema: { type: 'object' },
      async execute(input) {
        const value = input.value;
        if (typeof value !== 'number') throw new Error('value must be a number');
        executed.push(value);
        return { value };
      },
    };
    for await (const event of engine.run({
      runId: 'run-multiple-tools',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '连续调用两个工具',
      workspacePath: '.',
      model: scriptedModel([
        [
          { type: 'tool-call', toolCall: { id: 'call-1', name: 'record', input: { value: 1 } } },
          { type: 'tool-call', toolCall: { id: 'call-2', name: 'record', input: { value: 2 } } },
          { type: 'done' },
        ],
        [{ type: 'text-delta', delta: '两个工具都已完成。' }, { type: 'done' }],
      ]),
      tools: [multiTool],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(executed).toEqual([1, 2]);
    expect(events.filter((event) => event.type === 'tool.started')).toMatchObject([
      { toolCall: { id: 'call-1' } },
      { toolCall: { id: 'call-2' } },
    ]);
    expect(events.filter((event) => event.type === 'tool.completed')).toMatchObject([
      { toolCallId: 'call-1' },
      { toolCallId: 'call-2' },
    ]);
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('fails the run when the model requests an unknown tool', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    for await (const event of engine.run({
      runId: 'run-unknown-tool',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '调用不存在的工具',
      workspacePath: '.',
      model: scriptedModel([
        [
          { type: 'tool-call', toolCall: { id: 'call-x', name: '不存在', input: {} } },
          { type: 'done' },
        ],
      ]),
      tools: [],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(events.at(-1)).toMatchObject({ type: 'run.failed', error: 'Unknown tool: 不存在' });
    expect(events.some((event) => event.type === 'tool.started')).toBe(false);
  });

  it('fails the run when the model exceeds the tool round limit', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    const loopTool: AgentTool = {
      name: 'loop',
      description: '成功执行但模型会继续调用',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    };
    for await (const event of engine.run({
      runId: 'run-round-limit',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '不停调用工具',
      workspacePath: '.',
      model: scriptedModel([
        [
          { type: 'tool-call', toolCall: { id: 'call-loop', name: 'loop', input: {} } },
          { type: 'done' },
        ],
      ]),
      tools: [loopTool],
      signal: new AbortController().signal,
      maxToolRounds: 1,
    }))
      events.push(event);

    expect(events.some((event) => event.type === 'tool.completed')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'run.failed',
      error: 'Tool round limit exceeded: 1',
    });
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
      runId: 'run-stream-error',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '流会中断的任务',
      workspacePath: '.',
      model: brokenModel,
      tools: [],
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.started',
      'message.delta',
      'run.failed',
    ]);
    expect(events.at(-1)).toMatchObject({ error: '模型连接中断' });
  });

  it('prepends a system message with the current date', async () => {
    const model = recordingModel([[{ type: 'text-delta', delta: 'ok' }, { type: 'done' }]]);
    const engine = new ReActAgentEngine();
    for await (const _event of engine.run({
      runId: 'run-system',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '今天几号',
      workspacePath: '.',
      model,
      tools: [],
      signal: new AbortController().signal,
    }))
      void _event;

    const systemMessage = model.capturedMessages.find((message) => message.role === 'system');
    expect(systemMessage).toBeDefined();
    const year = new Date().getFullYear();
    expect(systemMessage?.content).toContain(`${year} 年`);
    expect(systemMessage?.content).toContain('搜索新闻');
  });

  it('injects skill instructions as system messages between date prompt and history', async () => {
    const model = recordingModel([[{ type: 'text-delta', delta: 'ok' }, { type: 'done' }]]);
    const engine = new ReActAgentEngine();
    for await (const _event of engine.run({
      runId: 'run-skill',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '帮我生成 PPT',
      workspacePath: '.',
      model,
      tools: [],
      signal: new AbortController().signal,
      skillInstructions: [
        { skillId: 'skill-1', name: 'PPT 专家', instruction: '请使用 python-pptx 生成演示文稿。' },
      ],
    }))
      void _event;

    const systemMessages = model.capturedMessages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(2);
    expect(systemMessages[0]?.content).toContain('年');
    expect(systemMessages[1]?.content).toContain('PPT 专家');
    expect(systemMessages[1]?.content).toContain('python-pptx');

    const userMessages = model.capturedMessages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toBe('帮我生成 PPT');
  });

  it('deduplicates skill instructions by skillId', () => {
    const messages = buildSkillMessages([
      { skillId: 'skill-1', name: '专家 A', instruction: '指令 A' },
      { skillId: 'skill-1', name: '专家 A 副本', instruction: '重复指令' },
      { skillId: 'skill-2', name: '专家 B', instruction: '指令 B' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain('专家 A');
    expect(messages[0]?.content).toContain('指令 A');
    expect(messages[0]?.content).not.toContain('重复指令');
    expect(messages[1]?.content).toContain('专家 B');
  });

  it('injects each skill as its own system message, preserving the user-picked order', async () => {
    const model = recordingModel([[{ type: 'text-delta', delta: 'ok' }, { type: 'done' }]]);
    const engine = new ReActAgentEngine();
    for await (const _event of engine.run({
      runId: 'run-two-skills',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '两技能协作',
      workspacePath: '.',
      model,
      tools: [],
      signal: new AbortController().signal,
      skillInstructions: [
        { skillId: 'ppt', name: 'PPT 生成专家', instruction: 'PPT 专属口径' },
        { skillId: 'research', name: '研究助手', instruction: '研究助手口径' },
      ],
    }))
      void _event;

    const systemMessages = model.capturedMessages.filter((m) => m.role === 'system');
    // 日期段 + 两个 Skill 段，共 3 条。
    expect(systemMessages).toHaveLength(3);
    expect(systemMessages[1]?.content).toContain('PPT 生成专家');
    expect(systemMessages[1]?.content).toContain('PPT 专属口径');
    expect(systemMessages[2]?.content).toContain('研究助手');
    expect(systemMessages[2]?.content).toContain('研究助手口径');
    // 数组顺序即注入顺序：第一条是 PPT，第二条是研究助手。
    expect(systemMessages[1]?.content).not.toContain('研究助手');
    expect(systemMessages[2]?.content).not.toContain('PPT');
  });

  it('returns no skill messages when instructions are empty or undefined', () => {
    expect(buildSkillMessages(undefined)).toEqual([]);
    expect(buildSkillMessages([])).toEqual([]);
  });

  it('truncates and adds overflow hint when instructions exceed budget', () => {
    const longInstruction = '指'.repeat(SKILL_INSTRUCTION_BUDGET + 1000);
    const messages = buildSkillMessages([
      { skillId: 'skill-1', name: '长指令', instruction: longInstruction },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content.length).toBeLessThanOrEqual(SKILL_INSTRUCTION_BUDGET + 200);
    expect(messages[0]?.content).toContain('skill_read_resource');
  });

  it('terminates at the tool round limit even with skill instructions', async () => {
    const events = [];
    const engine = new ReActAgentEngine();
    const loopTool: AgentTool = {
      name: 'loop',
      description: '持续调用',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    };
    for await (const event of engine.run({
      runId: 'run-skill-limit',
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt: '循环',
      workspacePath: '.',
      model: scriptedModel([
        [
          { type: 'tool-call', toolCall: { id: 'call-loop', name: 'loop', input: {} } },
          { type: 'done' },
        ],
      ]),
      tools: [loopTool],
      signal: new AbortController().signal,
      maxToolRounds: 1,
      skillInstructions: [{ skillId: 'skill-1', name: '测试', instruction: '测试指令' }],
    }))
      events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: 'run.failed',
      error: 'Tool round limit exceeded: 1',
    });
  });
});
