// @vitest-environment jsdom
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolActivity } from './ToolActivity';

const event = (fields: Record<string, unknown>) =>
  agentRuntimeEventSchema.parse({
    id: 'event',
    runId: 'run',
    sequence: 0,
    createdAt: 1,
    ...fields,
  });
afterEach(cleanup);

describe('ToolActivity', () => {
  it('keeps thirteen calls behind one summary and opens only the selected payload', () => {
    const events = Array.from({ length: 13 }, (_, index) => [
      event({
        type: 'tool.started',
        toolCall: {
          id: `t-${index}`,
          name: 'skill_execute',
          input: { commandId: `step-${index}` },
        },
      }),
      event({
        type: 'tool.completed',
        toolCallId: `t-${index}`,
        output: { content: `output-${index}\nsecond line` },
      }),
    ]).flat();
    render(<ToolActivity events={events} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /工作过程 · 13 步/ }));
    fireEvent.click(screen.getByRole('button', { name: /step-0 / }));
    expect(screen.getByRole('region', { name: '输入参数' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '执行结果' }).textContent).toContain(
      'output-0\nsecond line',
    );
    expect(screen.queryByText(/output-1/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /工作过程 · 13 步/ }));
    expect(document.querySelector('pre')).toBeNull();
  });
  it('makes failure visible even when collapsed and exposes its error on demand', () => {
    render(
      <ToolActivity
        events={[
          event({ type: 'tool.started', toolCall: { id: 't', name: 'skill_execute', input: {} } }),
          event({ type: 'tool.failed', toolCallId: 't', error: '校验未通过' }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /1 次失败/ }));
    fireEvent.click(screen.getByRole('button', { name: /执行技能命令/ }));
    expect(screen.getByRole('alert').textContent).toBe('校验未通过');
  });
});
