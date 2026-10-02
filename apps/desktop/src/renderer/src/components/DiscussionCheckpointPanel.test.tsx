// @vitest-environment jsdom

import type {
  ArtifactSummary,
  CreateDiscussionCheckpointRequest,
  DiscussionCheckpoint,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiscussionCheckpointPanel } from './DiscussionCheckpointPanel';

const artifact: ArtifactSummary = {
  id: 'artifact-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  type: 'markdown',
  title: '经营报告',
  currentVersionId: 'version-1',
  versionNumber: 1,
  origin: 'assistant-run',
  createdAt: 1,
  updatedAt: 1,
};

afterEach(cleanup);

describe('DiscussionCheckpointPanel', () => {
  it('历史节点状态使用同一徽标，勾选取消只移除精确版本，保存失败保留表单', async () => {
    const checkpoint: DiscussionCheckpoint = {
      id: 'old',
      taskId: 'task-1',
      stage: 'report-outline',
      status: 'superseded',
      title: '旧节点',
      summary: '旧结论',
      artifactVersionIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const onCreate = vi.fn().mockRejectedValue(new Error('保存失败已由上层呈现'));
    render(
      <DiscussionCheckpointPanel
        taskId="task-1"
        checkpoints={[checkpoint, { ...checkpoint, id: 'current', status: 'open' }]}
        artifacts={[artifact]}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByText('报告大纲 · 当前').getAttribute('data-tone')).toBe('brand');
    expect(screen.getByText('报告大纲 · 已替代').getAttribute('data-tone')).toBe('neutral');
    fireEvent.click(screen.getByRole('button', { name: '记录节点' }));
    const group = screen.getByRole('group', { name: '关联当前成果版本' });
    expect(group.querySelector('.check-list')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新节点' } });
    fireEvent.change(screen.getByLabelText('当前结论'), { target: { value: '新结论' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '经营报告' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '经营报告' }));
    fireEvent.click(screen.getByRole('button', { name: '保存节点' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存节点' })).toHaveProperty('disabled', false),
    );
    expect(onCreate.mock.calls[0]?.[0].artifactVersionIds).toEqual([]);
    expect(screen.getByLabelText('标题')).toHaveProperty('value', '新节点');
    expect(screen.getByLabelText('当前结论')).toHaveProperty('value', '新结论');
  });
  it('submits a structured checkpoint and supersedes the open node', async () => {
    const onCreate = vi.fn<(input: CreateDiscussionCheckpointRequest) => Promise<void>>(
      async () => undefined,
    );
    render(
      <DiscussionCheckpointPanel
        taskId="task-1"
        checkpoints={[
          {
            id: 'checkpoint-1',
            taskId: 'task-1',
            stage: 'report-outline',
            status: 'open',
            title: '旧大纲',
            summary: '等待反馈',
            artifactVersionIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        artifacts={[artifact]}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '记录节点' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新版大纲' } });
    fireEvent.change(screen.getByLabelText('当前结论'), { target: { value: '补充预算偏差页' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '经营报告' }));
    fireEvent.click(screen.getByRole('button', { name: '保存节点' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      taskId: 'task-1',
      stage: 'report-outline',
      title: '新版大纲',
      summary: '补充预算偏差页',
      artifactVersionIds: ['version-1'],
      supersedesId: 'checkpoint-1',
    });
  });
});
