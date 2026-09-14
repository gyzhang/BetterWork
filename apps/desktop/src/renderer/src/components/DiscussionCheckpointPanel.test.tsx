// @vitest-environment jsdom

import type {
  ArtifactSummary,
  CreateDiscussionCheckpointRequest,
} from '@betterwork/agent-protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('DiscussionCheckpointPanel', () => {
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
