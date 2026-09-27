// @vitest-environment jsdom

import type { RunSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunSummaryRow } from './RunSummaryRow';

const runOf = (status: RunSummary['status']): RunSummary => ({
  id: 'r1',
  taskId: 't1',
  sessionId: 's1',
  prompt: '把三条产品线的季度差值列成表',
  status,
  createdAt: new Date(2026, 8, 27, 21, 4).getTime(),
});

afterEach(() => {
  cleanup();
});

describe('RunSummaryRow 基座', () => {
  it('状态与时间合成一行，行几何仍归 ListRow 的 plain 档', () => {
    const { container } = render(
      <RunSummaryRow run={runOf('completed')} title="季度复盘" action="打开任务" />,
    );

    expect(container.querySelector('.list-row')?.getAttribute('data-variant')).toBe('plain');
    expect(container.querySelector('.list-row-title')?.textContent).toBe('季度复盘');
    const meta = container.querySelector('.list-row-meta')?.textContent ?? '';
    expect(meta.startsWith('已完成 · ')).toBe(true);
    expect(container.querySelector('.list-row-detail')).toBeNull();
  });

  it('没跑过的任务说「等待开始」，不报一个空状态', () => {
    const { container } = render(
      <RunSummaryRow run={undefined} title="新建的任务" action="打开任务" />,
    );

    expect(container.querySelector('.list-row-meta')?.textContent).toBe('等待开始');
  });

  it('整行可点时名称把动词、标题与状态报全', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <RunSummaryRow
        run={runOf('running')}
        title="季度复盘"
        action="查看执行记录"
        onSelect={onSelect}
      />,
    );

    const row = getByRole('button');
    // 时间由 `formatTime` 按本地格式给出，断言只锁到「状态＋分隔点」这一层。
    expect(row.getAttribute('aria-label')).toMatch(/^查看执行记录「季度复盘」，进行中 · /);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalled();
  });
});
