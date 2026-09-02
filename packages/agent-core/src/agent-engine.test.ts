import { describe, expect, it } from 'vitest';
import { calculatorTool } from '@betterwork/tool-runtime';
import { ReActAgentEngine } from './agent-engine';
import { FakeModelProvider } from './fake-provider';

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
});
