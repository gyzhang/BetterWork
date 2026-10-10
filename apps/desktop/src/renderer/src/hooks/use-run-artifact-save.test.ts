// @vitest-environment jsdom

import type { ArtifactSummary, RunSummary } from '@betterwork/agent-protocol';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRunArtifactSave } from './use-run-artifact-save';
import { useTaskSelection } from './use-task-selection';

const task = { id: 'task-a', sessionId: 'session-a', title: '季度报告' };
const run: RunSummary = {
  id: 'old-run',
  taskId: task.id,
  sessionId: task.sessionId,
  prompt: '首轮要求',
  status: 'completed',
  createdAt: 1,
};
const saved: ArtifactSummary = {
  id: 'markdown',
  workspaceId: 'workspace',
  taskId: task.id,
  type: 'markdown',
  origin: 'assistant-run',
  title: task.title,
  currentVersionId: 'version-2',
  versionNumber: 2,
  sourceRunId: run.id,
  createdAt: 1,
  updatedAt: 2,
};

function setup(artifacts: ArtifactSummary[] = []) {
  const api = {
    artifacts: {
      saveMarkdown: vi.fn<Window['betterwork']['artifacts']['saveMarkdown']>(async () => saved),
    },
  };
  vi.stubGlobal('betterwork', api);
  const onCommitted = vi.fn();
  const onSaved = vi.fn();
  const hook = renderHook(() => {
    const selection = useTaskSelection();
    const save = useRunArtifactSave({
      task: selection.activeTask,
      artifacts,
      captureSelection: selection.captureSelection,
      isCurrentSelection: selection.isCurrentSelection,
      onCommitted,
      onSaved,
    });
    return { selection, save };
  });
  act(() => hook.result.current.selection.selectTask(task, { runId: 'latest-run' }));
  return { ...hook, api, onCommitted, onSaved };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Run artifact save ownership', () => {
  it('uses the clicked historical Run and the existing Markdown identity, skipping file artifacts', async () => {
    const world = setup([
      {
        ...saved,
        id: 'pptx',
        type: 'presentation',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileSize: 512,
      },
      saved,
    ]);
    await act(() => world.result.current.save.save({ run, content: '首轮最终正文' }));
    expect(world.api.artifacts.saveMarkdown).toHaveBeenCalledExactlyOnceWith({
      artifactId: saved.id,
      taskId: task.id,
      origin: 'assistant-run',
      runId: run.id,
      title: task.title,
      content: '首轮最终正文',
    });
    expect(world.result.current.save.feedback).toEqual({
      runId: run.id,
      tone: 'success',
      message: '已保存为 Markdown 成果（v2）。',
      selection: world.result.current.selection.captureSelection(),
    });
    expect(world.onCommitted).toHaveBeenCalledTimes(1);
    expect(world.onSaved).toHaveBeenCalledTimes(1);
  });
  it('creates Markdown when the Task only has a file artifact and rejects cross-Task or empty targets', async () => {
    const world = setup([
      {
        ...saved,
        id: 'pptx',
        type: 'presentation',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileSize: 512,
      },
    ]);
    await act(async () => {
      await world.result.current.save.save({ run: { ...run, taskId: 'other' }, content: '正文' });
      await world.result.current.save.save({ run, content: ' ' });
      await world.result.current.save.save({ run, content: '正文' });
    });
    expect(world.api.artifacts.saveMarkdown).toHaveBeenCalledTimes(1);
    expect(world.api.artifacts.saveMarkdown.mock.calls[0]![0]).not.toHaveProperty('artifactId');
  });
  it('blocks a second synchronous click and exposes busy until the request settles', async () => {
    const world = setup();
    let finish!: (artifact: ArtifactSummary) => void;
    world.api.artifacts.saveMarkdown.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = world.result.current.save.save({ run, content: '正文' });
      duplicate = world.result.current.save.save({ run, content: '重复正文' });
    });
    await duplicate;
    expect(world.api.artifacts.saveMarkdown).toHaveBeenCalledTimes(1);
    expect(world.result.current.save.savingRunId).toBe(run.id);
    await act(async () => {
      finish(saved);
      await first;
    });
    expect(world.result.current.save.savingRunId).toBeUndefined();
  });
  it('failure belongs to its Run and can be retried without changing the target', async () => {
    const world = setup();
    world.api.artifacts.saveMarkdown.mockRejectedValueOnce(new Error('成果写入失败'));
    await act(() => world.result.current.save.save({ run, content: '首轮正文' }));
    expect(world.result.current.save.feedback).toMatchObject({
      runId: run.id,
      tone: 'error',
      message: '成果写入失败',
    });
    expect(world.onSaved).not.toHaveBeenCalled();
    await act(() => world.result.current.save.save({ run, content: '首轮正文' }));
    expect(world.api.artifacts.saveMarkdown.mock.calls[0]).toEqual(
      world.api.artifacts.saveMarkdown.mock.calls[1],
    );
    expect(world.result.current.save.feedback?.tone).toBe('success');
  });
  it('A to B to A drops late success feedback and panel navigation while retaining the committed refresh', async () => {
    const world = setup();
    let finish!: (artifact: ArtifactSummary) => void;
    world.api.artifacts.saveMarkdown.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let request!: Promise<void>;
    act(() => {
      request = world.result.current.save.save({ run, content: '原任务正文' });
    });
    act(() => {
      world.result.current.selection.selectTask({ ...task, id: 'task-b' });
      world.result.current.selection.selectTask(task);
    });
    await act(async () => {
      finish(saved);
      await request;
    });
    expect(world.result.current.save.feedback).toBeUndefined();
    expect(world.onSaved).not.toHaveBeenCalled();
    expect(world.onCommitted).toHaveBeenCalledTimes(1);
  });
  it('late failure after new Task is recorded without contaminating its feedback', async () => {
    const world = setup();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail!: (error: Error) => void;
    world.api.artifacts.saveMarkdown.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    let request!: Promise<void>;
    act(() => {
      request = world.result.current.save.save({ run, content: '原任务正文' });
    });
    act(() => world.result.current.selection.selectTask(undefined));
    await act(async () => {
      fail(new Error('旧请求失败'));
      await request;
    });
    expect(world.result.current.save.feedback).toBeUndefined();
    expect(log).toHaveBeenCalledWith('保存原任务成果失败', '旧请求失败');
    expect(world.onCommitted).not.toHaveBeenCalled();
  });
  it('already visible feedback cannot reappear after A to B to A or a new Run selection', async () => {
    const world = setup();
    await act(() => world.result.current.save.save({ run, content: '正文' }));
    expect(world.result.current.save.feedback).toBeDefined();
    act(() => world.result.current.selection.selectStartedRun('another-run'));
    expect(world.result.current.save.feedback).toBeUndefined();
    act(() => {
      world.result.current.selection.selectTask({ ...task, id: 'task-b' });
      world.result.current.selection.selectTask(task);
    });
    expect(world.result.current.save.feedback).toBeUndefined();
  });
});
