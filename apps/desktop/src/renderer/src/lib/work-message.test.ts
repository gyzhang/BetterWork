import { type AgentRuntimeEvent, agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { projectWorkRun } from './work-message';

const event = (input: Record<string, unknown>): AgentRuntimeEvent =>
  agentRuntimeEventSchema.parse({ runId: 'run-1', createdAt: 1, ...input });
const delta = event({
  id: 'delta',
  sequence: 1,
  type: 'message.delta',
  messageId: 'm',
  delta: '中间检索说明',
});

describe('work Run projection', () => {
  it('completed content replaces intermediate rounds and retains the exact answer event', () => {
    const projection = projectWorkRun([
      delta,
      event({
        id: 'answer',
        sequence: 2,
        type: 'message.completed',
        messageId: 'm-final',
        content: '最终报告',
      }),
      event({ id: 'completed', sequence: 3, type: 'run.completed', finalContent: '最终报告' }),
    ]);
    expect(projection).toMatchObject({
      content: '最终报告',
      finalContent: '最终报告',
      completed: true,
      terminal: true,
      answer: { eventId: 'answer', content: '最终报告' },
    });
  });
  it('streaming content is visible without a saveable final answer', () => {
    expect(projectWorkRun([delta])).toMatchObject({
      content: '中间检索说明',
      completed: false,
      terminal: false,
      finalContent: undefined,
      answer: undefined,
    });
  });
  it('failure retains partial text and its failure reason without a saveable result', () => {
    expect(
      projectWorkRun([
        delta,
        event({ id: 'failed', sequence: 2, type: 'run.failed', error: '模型请求失败' }),
      ]),
    ).toMatchObject({
      content: '中间检索说明',
      failure: '模型请求失败',
      terminal: true,
      finalContent: undefined,
    });
  });
  it('cancellation remains distinct from failure', () => {
    expect(
      projectWorkRun([delta, event({ id: 'cancelled', sequence: 2, type: 'run.cancelled' })]),
    ).toMatchObject({
      cancelled: true,
      terminal: true,
      failure: undefined,
      finalContent: undefined,
    });
  });
  it('an empty completion and a mismatched final message cannot create a capture source', () => {
    const completed = event({
      id: 'completed',
      sequence: 2,
      type: 'run.completed',
      finalContent: ' ',
    });
    expect(projectWorkRun([completed])).toMatchObject({
      completed: true,
      finalContent: undefined,
      answer: undefined,
    });
    expect(
      projectWorkRun([
        event({
          id: 'answer',
          sequence: 1,
          type: 'message.completed',
          messageId: 'm',
          content: '旧答案',
        }),
        event({ id: 'completed', sequence: 2, type: 'run.completed', finalContent: '最终答案' }),
      ]).answer,
    ).toBeUndefined();
  });
});
