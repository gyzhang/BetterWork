// @vitest-environment jsdom

import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTaskSelection } from './use-task-selection';

const taskA = { id: 'task-a', sessionId: 'session-a', title: 'Task A' };
const taskB = { id: 'task-b', sessionId: 'session-b', title: 'Task B' };
const workspaceA: WorkspaceSummary = {
  id: 'workspace-a',
  name: 'A',
  rootPath: '/a',
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 1,
};

afterEach(cleanup);

describe('Task selection request scopes', () => {
  it('selection identity changes synchronously and visible state follows the same transition', () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => {
      result.current.selectTask(taskA, { runId: 'run-a' });
      expect(result.current.current()).toMatchObject({ taskId: taskA.id, runId: 'run-a' });
    });
    expect(result.current.activeTask).toEqual(taskA);
    expect(result.current.activeRunId).toBe('run-a');
  });

  it('A to B to A rejects the first selection and history tokens even though IDs match', () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.selectTask(taskA));
    const selection = result.current.captureSelection();
    const history = result.current.captureHistory();
    act(() => {
      result.current.selectTask(taskB);
      result.current.selectTask(taskA);
    });
    expect(result.current.isCurrentSelection(selection)).toBe(false);
    expect(result.current.isCurrentHistory(history)).toBe(false);
    expect(result.current.isCurrentSelection(result.current.captureSelection())).toBe(true);
  });

  it('Run selection and a new Run invalidate detail requests while retaining same-Task history', () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.selectTask(taskA, { runId: 'old-run' }));
    const history = result.current.captureHistory();
    const selection = result.current.captureSelection();
    act(() => result.current.selectTask(taskA, { runId: 'other-run', preserveHistory: true }));
    expect(result.current.isCurrentSelection(selection)).toBe(false);
    expect(result.current.isCurrentHistory(history)).toBe(true);
    const beforeStart = result.current.captureSelection();
    act(() => result.current.selectStartedRun('new-run'));
    expect(result.current.isCurrentSelection(beforeStart)).toBe(false);
    expect(result.current.isCurrentHistory(history)).toBe(true);
    expect(result.current.activeRunId).toBe('new-run');
  });

  it('Run selection in another Task invalidates history even when preservation was requested', () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.selectTask(taskA));
    const history = result.current.captureHistory();
    act(() => result.current.selectTask(taskB, { runId: 'run-b', preserveHistory: true }));
    expect(result.current.isCurrentHistory(history)).toBe(false);
  });

  it('Task creation and latest-Run restoration do not cancel the owning start/navigation request', () => {
    const { result } = renderHook(() => useTaskSelection());
    const pendingStart = result.current.captureSelection();
    act(() => result.current.registerCreatedTask(taskA));
    expect(result.current.isCurrentSelection(pendingStart)).toBe(true);
    const history = result.current.captureHistory();
    act(() => result.current.restoreLatestRun('latest'));
    expect(result.current.isCurrentSelection(pendingStart)).toBe(true);
    expect(result.current.isCurrentHistory(history)).toBe(true);
  });

  it('workspace A to B to A expires requests, while a same-workspace rename preserves them', () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.setWorkspace(workspaceA));
    const revision = result.current.captureWorkspace();
    const selection = result.current.captureSelection();
    act(() => result.current.setWorkspace({ ...workspaceA, name: 'Renamed' }));
    expect(result.current.isCurrentWorkspace(revision)).toBe(true);
    act(() => {
      result.current.setWorkspace({ ...workspaceA, id: 'workspace-b' });
      result.current.setWorkspace(workspaceA);
    });
    expect(result.current.isCurrentWorkspace(revision)).toBe(false);
    expect(result.current.isCurrentSelection(selection)).toBe(false);
  });

  it('new Task invalidates detail/history responses and clears both identities', () => {
    const { result } = renderHook(() => useTaskSelection());
    act(() => result.current.selectTask(taskA, { runId: 'run-a' }));
    const selection = result.current.captureSelection();
    const history = result.current.captureHistory();
    act(() => result.current.selectTask(undefined));
    expect(result.current.activeTask).toBeUndefined();
    expect(result.current.activeRunId).toBeUndefined();
    expect(result.current.current()).toMatchObject({ taskId: undefined, runId: undefined });
    expect(result.current.isCurrentSelection(selection)).toBe(false);
    expect(result.current.isCurrentHistory(history)).toBe(false);
  });
});
