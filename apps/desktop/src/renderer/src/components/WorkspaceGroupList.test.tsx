// @vitest-environment jsdom

import type { WorkspaceTaskGroup } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceGroupList } from './WorkspaceGroupList';

const groupOf = (workspaceId: string, name: string, taskCount = 0): WorkspaceTaskGroup => ({
  workspace: {
    id: workspaceId,
    name,
    rootPath: `/tmp/${workspaceId}`,
    iconId: 'folder',
    accentId: 'moss',
    createdAt: 1,
    updatedAt: 1,
  },
  tasks: Array.from({ length: taskCount }, (_, index) => ({
    id: `task-${workspaceId}-${index}`,
    title: `任务 ${index + 1}`,
    goal: '目标',
    workspaceId,
    sessionId: 'session-1',
    createdAt: 1,
    updatedAt: 1,
    latestRun: undefined,
  })),
  totalTasks: taskCount,
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceGroupList', () => {
  it('空分组时显示空态提示', () => {
    render(
      <WorkspaceGroupList
        groups={[]}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => true}
        showsAll={() => false}
        onToggleGroup={vi.fn()}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={false}
        onRevealFromRail={vi.fn()}
      />,
    );

    expect(screen.getByText('还没有工作空间，新建一个开始。')).toBeTruthy();
  });

  it('渲染空间名称', () => {
    const groups = [groupOf('ws-1', '测试空间')];
    render(
      <WorkspaceGroupList
        groups={groups}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => true}
        showsAll={() => false}
        onToggleGroup={vi.fn()}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={false}
        onRevealFromRail={vi.fn()}
      />,
    );

    expect(screen.getByText('测试空间')).toBeTruthy();
  });

  it('展开时显示任务列表', () => {
    const groups = [groupOf('ws-1', '测试空间', 2)];
    render(
      <WorkspaceGroupList
        groups={groups}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => true}
        showsAll={() => false}
        onToggleGroup={vi.fn()}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={false}
        onRevealFromRail={vi.fn()}
      />,
    );

    expect(screen.getByText('任务 1')).toBeTruthy();
    expect(screen.getByText('任务 2')).toBeTruthy();
  });

  it('折叠时不显示任务列表', () => {
    const groups = [groupOf('ws-1', '测试空间', 2)];
    render(
      <WorkspaceGroupList
        groups={groups}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => false}
        showsAll={() => false}
        onToggleGroup={vi.fn()}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={false}
        onRevealFromRail={vi.fn()}
      />,
    );

    expect(screen.queryByText('任务 1')).toBeNull();
  });

  it('点击空间行调用 onToggleGroup', () => {
    const onToggleGroup = vi.fn();
    const groups = [groupOf('ws-1', '测试空间')];
    render(
      <WorkspaceGroupList
        groups={groups}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => true}
        showsAll={() => false}
        onToggleGroup={onToggleGroup}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={false}
        onRevealFromRail={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('测试空间'));
    expect(onToggleGroup).toHaveBeenCalledExactlyOnceWith('ws-1');
  });

  it('rail 模式只显示图标', () => {
    const groups = [groupOf('ws-1', '测试空间')];
    const { container } = render(
      <WorkspaceGroupList
        groups={groups}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => true}
        showsAll={() => false}
        onToggleGroup={vi.fn()}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={true}
        onRevealFromRail={vi.fn()}
      />,
    );

    expect(container.querySelector('.workspace-rail')).toBeTruthy();
    expect(screen.queryByText('测试空间')).toBeNull();
  });

  it('展开的任务超过预览数时显示「展示更多」', () => {
    const groups = [groupOf('ws-1', '测试空间', 5)];
    render(
      <WorkspaceGroupList
        groups={groups}
        currentWorkspaceId="ws-1"
        activeTaskId={undefined}
        isOpen={() => true}
        showsAll={() => false}
        onToggleGroup={vi.fn()}
        onToggleShowAll={vi.fn()}
        onSelectTask={vi.fn()}
        onAction={vi.fn()}
        rail={false}
        onRevealFromRail={vi.fn()}
      />,
    );

    expect(screen.getByText('展示更多（2）')).toBeTruthy();
  });
});
