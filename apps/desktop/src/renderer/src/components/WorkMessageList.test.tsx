// @vitest-environment jsdom

import {
  type AgentRuntimeEvent,
  agentRuntimeEventSchema,
  type RunSummary,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunArtifactSaveState } from '../hooks/use-run-artifact-save';
import * as toolActivity from '../lib/tool-activity';
import * as projection from '../lib/work-message';
import { WorkMessageList } from './WorkMessageList';

const run = (id: string): RunSummary => ({
  id,
  taskId: 'task',
  sessionId: 'session',
  prompt: `要求 ${id}`,
  status: 'completed',
  createdAt: 1,
});
const completed = (id: string): AgentRuntimeEvent[] => [
  agentRuntimeEventSchema.parse({
    id: `answer-${id}`,
    runId: id,
    createdAt: 1,
    sequence: 1,
    type: 'message.completed',
    messageId: `m-${id}`,
    content: `正文 ${id}`,
  }),
  agentRuntimeEventSchema.parse({
    id: `completed-${id}`,
    runId: id,
    createdAt: 1,
    sequence: 2,
    type: 'run.completed',
    finalContent: `正文 ${id}`,
  }),
];
const runs = [run('old'), run('latest')];
const events = new Map(runs.map((item) => [item.id, completed(item.id)]));
const props = () => ({
  runs,
  events,
  activeRunId: 'latest',
  savedRunIds: new Set<string>(),
  artifactSave: {
    savingRunId: undefined,
    feedback: undefined,
    dismissFeedback: vi.fn(),
    save: vi.fn(async () => undefined),
  } satisfies RunArtifactSaveState,
  userName: '你',
  assistantName: 'AI',
  latestReplyRef: createRef<HTMLDivElement>(),
  onRemember: vi.fn(),
  capture: undefined,
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('work message actions and projection ownership', () => {
  it('each completed answer saves its own Run and final content', () => {
    const input = props();
    render(<WorkMessageList {...input} />);
    const buttons = screen.getAllByRole('button', { name: '保存为成果' });
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    expect(input.artifactSave.save.mock.calls).toEqual([
      [{ run: runs[0], content: '正文 old' }],
      [{ run: runs[1], content: '正文 latest' }],
    ]);
  });
  it('save failure has one outlet under its target answer; success has one local toast', () => {
    const input = props();
    const { container, rerender } = render(
      <WorkMessageList
        {...input}
        artifactSave={{
          ...input.artifactSave,
          feedback: { runId: 'old', tone: 'error', message: '保存校验失败' },
        }}
      />,
    );
    expect(screen.getAllByText('保存校验失败')).toHaveLength(1);
    expect(
      within(container.querySelectorAll('.run-group')[0]! as HTMLElement).getByText('保存校验失败'),
    ).toBeTruthy();
    expect(
      within(container.querySelectorAll('.run-group')[1]! as HTMLElement).queryByText(
        '保存校验失败',
      ),
    ).toBeNull();
    rerender(
      <WorkMessageList
        {...input}
        artifactSave={{
          ...input.artifactSave,
          feedback: { runId: 'old', tone: 'success', message: '已保存' },
        }}
      />,
    );
    expect(screen.getAllByText('已保存')).toHaveLength(1);
    expect(screen.queryByText('保存校验失败')).toBeNull();
  });
  it('historical answer and tool projections are reused during active streaming', () => {
    const project = vi.spyOn(projection, 'projectWorkRun');
    const tools = vi.spyOn(toolActivity, 'deriveToolActivity');
    const input = props();
    const historical = events.get('old')!;
    const { rerender } = render(<WorkMessageList {...input} />);
    const next = new Map(events);
    next.set('latest', [
      ...events.get('latest')!,
      agentRuntimeEventSchema.parse({
        id: 'delta',
        runId: 'latest',
        createdAt: 1,
        sequence: 3,
        type: 'message.delta',
        messageId: 'm-latest',
        delta: '追加',
      }),
    ]);
    rerender(
      <WorkMessageList
        {...input}
        events={next}
        artifactSave={{ ...input.artifactSave, save: vi.fn(async () => undefined) }}
      />,
    );
    expect(project.mock.calls.filter(([value]) => value === historical)).toHaveLength(1);
    expect(tools.mock.calls.filter(([value]) => value === historical)).toHaveLength(1);
    expect(project).toHaveBeenCalledTimes(3);
  });
  it('memory capture remains on the latest completed answer with its exact event and trigger', () => {
    const input = props();
    render(<WorkMessageList {...input} />);
    const button = screen.getByRole('button', { name: '记住这段经验' });
    fireEvent.click(button);
    expect(input.onRemember).toHaveBeenCalledWith(
      'latest',
      { eventId: 'answer-latest', content: '正文 latest' },
      button,
    );
  });
  it('failure and cancellation keep partial content visible without save actions', () => {
    const input = props();
    const incomplete = new Map(
      runs.map((item, index) => [
        item.id,
        [
          agentRuntimeEventSchema.parse({
            id: `delta-${item.id}`,
            runId: item.id,
            createdAt: 1,
            sequence: 1,
            type: 'message.delta',
            messageId: item.id,
            delta: `片段 ${item.id}`,
          }),
          agentRuntimeEventSchema.parse({
            id: `terminal-${item.id}`,
            runId: item.id,
            createdAt: 1,
            sequence: 2,
            type: index ? 'run.cancelled' : 'run.failed',
            ...(index ? {} : { error: '失败原因' }),
          }),
        ],
      ]),
    );
    render(<WorkMessageList {...input} events={incomplete} />);
    expect(screen.queryByRole('button', { name: '保存为成果' })).toBeNull();
    expect(screen.getByText('片段 old')).toBeTruthy();
    expect(screen.getByText(/本次运行未完成/).textContent).toContain('失败原因');
    expect(screen.getByText('本次运行已停止。可以调整要求后重新开始。')).toBeTruthy();
  });
  it('saving disables all save buttons and preserves the saved label on the source Run', () => {
    const input = props();
    render(
      <WorkMessageList
        {...input}
        savedRunIds={new Set(['latest'])}
        artifactSave={{ ...input.artifactSave, savingRunId: 'old' }}
      />,
    );
    expect(screen.getByRole('button', { name: '正在保存…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '已保存为成果' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
