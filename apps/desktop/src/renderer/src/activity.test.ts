import { describe, expect, it } from 'vitest';
import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { deriveActivityGroups } from './activity';

const event = <T extends AgentRuntimeEvent['type']>(
  type: T,
  payload: Omit<
    Extract<AgentRuntimeEvent, { type: T }>,
    'id' | 'runId' | 'sequence' | 'createdAt' | 'type'
  >,
  sequence: number,
): AgentRuntimeEvent =>
  ({
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    createdAt: sequence * 1000,
    type,
    ...payload,
  }) as AgentRuntimeEvent;

describe('deriveActivityGroups', () => {
  it('groups raw calculator events into user-facing work stages', () => {
    const groups = deriveActivityGroups([
      event('run.started', { taskId: 'task-1', sessionId: 'session-1' }, 0),
      event('reasoning.delta', { delta: '选择确定性计算工具。' }, 1),
      event('tool.requested', { toolCall: { id: 'tool-1', name: 'calculator', input: {} } }, 2),
      event('tool.completed', { toolCallId: 'tool-1', output: { result: 60 } }, 3),
      event('message.completed', { messageId: 'message-1', content: '计算结果是 60。' }, 4),
      event('run.completed', { finalContent: '计算结果是 60。' }, 5),
    ]);

    expect(groups).toMatchObject([
      { id: 'understand', title: '理解任务', status: 'completed' },
      { id: 'tools', title: '计算数据', status: 'completed' },
      { id: 'compose', title: '整理结果', status: 'completed' },
      { id: 'finish', title: '任务完成', status: 'completed' },
    ]);
  });

  it('keeps an unfinished tool stage visible while a run is active', () => {
    const groups = deriveActivityGroups([
      event('run.started', { taskId: 'task-1', sessionId: 'session-1' }, 0),
      event('tool.started', { toolCall: { id: 'tool-1', name: 'read_text_file', input: {} } }, 1),
    ]);

    expect(groups).toContainEqual(
      expect.objectContaining({ id: 'tools', title: '阅读资料', status: 'running' }),
    );
    expect(groups).not.toContainEqual(expect.objectContaining({ id: 'finish' }));
  });

  it('names each retrieval tool instead of falling back to a generic stage title', () => {
    const knowledge = deriveActivityGroups([
      event('run.started', { taskId: 'task-1', sessionId: 'session-1' }, 0),
      event('tool.started', { toolCall: { id: 'tool-1', name: 'knowledge_search', input: {} } }, 1),
    ]);
    expect(knowledge).toContainEqual(
      expect.objectContaining({ id: 'tools', title: '查阅个人资料' }),
    );

    const web = deriveActivityGroups([
      event('run.started', { taskId: 'task-1', sessionId: 'session-1' }, 0),
      event('tool.started', { toolCall: { id: 'tool-1', name: 'web_search', input: {} } }, 1),
    ]);
    expect(web).toContainEqual(expect.objectContaining({ id: 'tools', title: '搜索网络资料' }));

    const unknown = deriveActivityGroups([
      event('run.started', { taskId: 'task-1', sessionId: 'session-1' }, 0),
      event('tool.started', { toolCall: { id: 'tool-1', name: 'future_tool', input: {} } }, 1),
    ]);
    expect(unknown).toContainEqual(expect.objectContaining({ id: 'tools', title: '处理工作材料' }));
  });

  it('reports how many sources a retrieval step actually found', () => {
    const groups = deriveActivityGroups([
      event('run.started', { taskId: 'task-1', sessionId: 'session-1' }, 0),
      event('tool.started', { toolCall: { id: 'tool-1', name: 'web_search', input: {} } }, 1),
      event(
        'tool.completed',
        {
          toolCallId: 'tool-1',
          output: { results: [{ url: 'https://a' }, { url: 'https://b' }, { url: 'https://c' }] },
        },
        2,
      ),
      event('run.completed', { finalContent: '已完成' }, 3),
    ]);

    expect(groups).toContainEqual(
      expect.objectContaining({
        id: 'tools',
        title: '搜索网络资料',
        description: '已查阅 3 条来源',
        status: 'completed',
      }),
    );
  });
});
