import { type AgentRuntimeEvent, agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { finalRunContent, mergeRunEvents } from './run-events';

const event = (input: Record<string, unknown>): AgentRuntimeEvent =>
  agentRuntimeEventSchema.parse({ ...input, runId: 'run-1', createdAt: 1 });

describe('run event derivation', () => {
  it('uses only the completed event content when saving a result', () => {
    expect(
      finalRunContent([
        event({
          id: 'first',
          sequence: 0,
          type: 'message.delta',
          messageId: 'm-1',
          delta: '先检索。',
        }),
        event({ id: 'final', sequence: 1, type: 'run.completed', finalContent: '最终报告' }),
      ]),
    ).toBe('最终报告');
  });

  it('keeps incremental events received while a snapshot was loading', () => {
    const started = event({
      id: 'started',
      sequence: 0,
      type: 'run.started',
      taskId: 'task-1',
      sessionId: 'session-1',
    });
    const completed = event({
      id: 'completed',
      sequence: 1,
      type: 'run.completed',
      finalContent: '完成',
    });
    expect(mergeRunEvents([started], [started, completed])).toEqual([started, completed]);
  });
});
