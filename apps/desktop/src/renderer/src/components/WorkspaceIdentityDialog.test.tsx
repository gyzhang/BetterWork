// @vitest-environment jsdom

import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceIdentityDraft } from '../hooks/use-workspace-identity';
import { WorkspaceIdentityDialog } from './WorkspaceIdentityDialog';

const draftOf = (overrides: Partial<WorkspaceIdentityDraft> = {}): WorkspaceIdentityDraft => ({
  rootPath: '/tmp/test-workspace',
  name: '测试空间',
  iconId: 'folder',
  accentId: 'moss',
  ...overrides,
});

const workspaceOf = (overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id: 'ws-1',
  name: '测试空间',
  rootPath: '/tmp/test-workspace',
  iconId: 'folder',
  accentId: 'moss',
  hidden: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceIdentityDialog', () => {
  it('新建模式显示「新建工作空间」标题', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf()}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('新建工作空间')).toBeTruthy();
    expect(screen.getByText('创建')).toBeTruthy();
  });

  it('编辑模式显示「编辑工作空间」标题', () => {
    render(
      <WorkspaceIdentityDialog
        editing={workspaceOf()}
        draft={draftOf()}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('编辑工作空间')).toBeTruthy();
    expect(screen.getByText('保存修改')).toBeTruthy();
  });

  it('显示文件夹路径', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf({ rootPath: '/Users/test/project' })}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('project')).toBeTruthy();
    expect(screen.getByText('/Users/test/project')).toBeTruthy();
  });

  it('未选文件夹时显示占位文字', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf({ rootPath: '' })}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={false}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('点击选择要长期工作的文件夹')).toBeTruthy();
  });

  it('名称输入框显示当前值', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf({ name: '我的空间' })}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByDisplayValue('我的空间');
    expect(input).toBeTruthy();
  });

  it('修改名称调用 onChangeDraft', () => {
    const onChangeDraft = vi.fn();
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf({ name: '' })}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={false}
        onChangeDraft={onChangeDraft}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByDisplayValue('');
    fireEvent.change(input, { target: { value: '新名称' } });
    expect(onChangeDraft).toHaveBeenCalledExactlyOnceWith({ name: '新名称' });
  });

  it('显示路径被占用的错误', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf()}
        error=""
        takenByName="已有空间"
        busy={false}
        picking={false}
        canSubmit={false}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText('这个文件夹已经登记为「已有空间」，请直接打开它，或换一个目录。'),
    ).toBeTruthy();
  });

  it('显示提交错误', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf()}
        error="权限不足"
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('权限不足')).toBeTruthy();
  });

  it('点击取消调用 onClose', () => {
    const onClose = vi.fn();
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf()}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalled();
  });

  it('点击提交调用 onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf()}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('创建'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('canSubmit 为 false 时提交按钮禁用', () => {
    render(
      <WorkspaceIdentityDialog
        editing={undefined}
        draft={draftOf()}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={false}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const button = screen.getByText('创建').closest('button');
    expect(button?.getAttribute('disabled')).not.toBeNull();
  });

  it('编辑模式下文件夹按钮禁用', () => {
    render(
      <WorkspaceIdentityDialog
        editing={workspaceOf()}
        draft={draftOf()}
        error=""
        takenByName={undefined}
        busy={false}
        picking={false}
        canSubmit={true}
        onChangeDraft={vi.fn()}
        onChooseDirectory={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const folderButton = screen.getByText('test-workspace').closest('button');
    expect(folderButton?.getAttribute('disabled')).not.toBeNull();
  });
});
