import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { deriveToolActivity, formatToolValue } from './tool-activity';

const event = (fields: Record<string, unknown>) =>
  agentRuntimeEventSchema.parse({
    id: 'event',
    runId: 'run',
    sequence: 0,
    createdAt: 1,
    ...fields,
  });
const call = { id: 'tool-1', name: 'skill_execute', input: { commandId: 'validate' } };

describe('tool activity', () => {
  it('merges requested, started, progress and result into one ordered call', () => {
    const tools = deriveToolActivity([
      event({ type: 'tool.requested', toolCall: call }),
      event({ type: 'tool.started', toolCall: call }),
      event({ type: 'tool.progress', toolCallId: call.id, message: '校验中' }),
      event({ type: 'tool.completed', toolCallId: call.id, output: { text: '通过\n无错误' } }),
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      ...call,
      status: 'completed',
      executionState: 'started',
      output: { text: '通过\n无错误' },
    });
  });
  it('closes unfinished tools on cancellation while preserving successful calls', () => {
    const tools = deriveToolActivity([
      event({ type: 'tool.started', toolCall: call }),
      event({ type: 'tool.completed', toolCallId: call.id, output: 'done' }),
      event({ type: 'tool.started', toolCall: { ...call, id: 'tool-2' } }),
      event({ type: 'run.cancelled' }),
    ]);
    expect(tools.map((tool) => tool.status)).toEqual(['completed', 'cancelled']);
  });
  it('retains failures and formats structured values without flattening text', () => {
    expect(
      deriveToolActivity([
        event({ type: 'tool.failed', toolCallId: call.id, error: '失败原因' }),
      ])[0],
    ).toMatchObject({ status: 'rejected', executionState: 'not-started', error: '失败原因' });
    expect(formatToolValue('第一行\n第二行')).toBe('第一行\n第二行');
    expect(formatToolValue({ count: 2 })).toBe('{\n  "count": 2\n}');
  });

  it('distinguishes a rejected request from failures after tool execution starts', () => {
    const tools = deriveToolActivity([
      event({ type: 'tool.requested', toolCall: { ...call, id: 'rejected' } }),
      event({
        type: 'tool.failed',
        toolCallId: 'rejected',
        error: '参数不是有效 JSON',
        diagnostic: { kind: 'invalid-arguments', source: 'model-provider-output' },
      }),
      event({ type: 'tool.requested', toolCall: { ...call, id: 'failed' } }),
      event({ type: 'tool.started', toolCall: { ...call, id: 'failed' } }),
      event({ type: 'tool.failed', toolCallId: 'failed', error: '运行失败' }),
    ]);

    expect(tools).toMatchObject([
      { id: 'rejected', status: 'rejected', executionState: 'not-started' },
      { id: 'failed', status: 'failed', executionState: 'started' },
    ]);
  });

  it('preserves started execution for structured Skill failures, timeouts and cancellation', () => {
    const outcomes = [
      { status: 'failed', reason: 'execute-failed' },
      { status: 'timed-out' },
      { status: 'cancelled' },
    ];
    const tools = outcomes.map((output, index) => {
      const id = `skill-${index}`;
      return deriveToolActivity([
        event({ type: 'tool.started', toolCall: { ...call, id } }),
        event({ type: 'tool.completed', toolCallId: id, output }),
      ])[0];
    });

    expect(tools).toMatchObject([
      { status: 'failed', executionState: 'started' },
      { status: 'failed', executionState: 'started' },
      { status: 'cancelled', executionState: 'started' },
    ]);
  });
});
