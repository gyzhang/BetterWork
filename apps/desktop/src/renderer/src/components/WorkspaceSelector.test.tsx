// @vitest-environment jsdom

import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSelector } from './WorkspaceSelector';

const workspaceOf = (id: string, name: string, rootPath = `/tmp/${id}`): WorkspaceSummary => ({
  id,
  name,
  rootPath,
  iconId: 'folder',
  accentId: 'moss',
  hidden: false,
  createdAt: 1,
  updatedAt: 1,
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceSelector', () => {
  it('没有当前空间时显示占位文字', () => {
    render(
      <WorkspaceSelector
        currentWorkspace={undefined}
        workspaces={[]}
        onSelectWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText('选择工作空间')).toBeTruthy();
  });

  it('有当前空间时显示空间名称', () => {
    const workspace = workspaceOf('ws-1', '测试空间');
    render(
      <WorkspaceSelector
        currentWorkspace={workspace}
        workspaces={[workspace]}
        onSelectWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText('测试空间')).toBeTruthy();
  });

  it('disabled 时触发器不可点击', () => {
    const workspace = workspaceOf('ws-1', '测试空间');
    render(
      <WorkspaceSelector
        currentWorkspace={workspace}
        workspaces={[workspace]}
        disabled
        onSelectWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('disabled')).not.toBeNull();
  });

  it('点击触发器打开菜单', () => {
    const workspace = workspaceOf('ws-1', '测试空间');
    render(
      <WorkspaceSelector
        currentWorkspace={workspace}
        workspaces={[workspace]}
        onSelectWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('disabled 时点击不打开菜单', () => {
    const workspace = workspaceOf('ws-1', '测试空间');
    render(
      <WorkspaceSelector
        currentWorkspace={workspace}
        workspaces={[workspace]}
        disabled
        onSelectWorkspace={vi.fn()}
        onNewWorkspace={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
