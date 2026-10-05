// @vitest-environment jsdom

import type {
  SaveTaskContinuityBriefRequest,
  TaskContinuityBriefMutationResult,
  TaskContinuityRevision,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTaskContinuity } from './use-task-continuity';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value,>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  if (!resolve) throw new Error('Deferred promise did not initialize');
  return { promise, resolve };
};

const revisionOf = (taskId: string, revision = 1): TaskContinuityRevision => ({
  id: `${taskId}-continuity-${revision}`,
  taskId,
  revision,
  schemaVersion: 1,
  brief: {
    schemaVersion: 1,
    objective: { text: `${taskId} 的目标`, source: 'task-goal' },
    activeRequirements: [],
  },
  sourceKind: 'task-goal',
  briefHash: 'a'.repeat(64),
  createdAt: revision,
});

const getBrief = vi.fn<(input: { taskId: string }) => Promise<TaskContinuityRevision | null>>();
const saveBrief =
  vi.fn<(input: SaveTaskContinuityBriefRequest) => Promise<TaskContinuityBriefMutationResult>>();

const installApi = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { taskContinuity: { getBrief, saveBrief } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  getBrief.mockReset();
  saveBrief.mockReset();
});

describe('useTaskContinuity', () => {
  it('ignores a late load after switching Tasks', async () => {
    installApi();
    const firstTaskRead = deferred<TaskContinuityRevision | null>();
    getBrief.mockImplementation(({ taskId }) =>
      taskId === 'task-a' ? firstTaskRead.promise : Promise.resolve(revisionOf(taskId)),
    );
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useTaskContinuity(taskId),
      { initialProps: { taskId: 'task-a' } },
    );

    rerender({ taskId: 'task-b' });
    await waitFor(() => expect(result.current.revision?.taskId).toBe('task-b'));
    await act(async () => firstTaskRead.resolve(revisionOf('task-a')));

    expect(result.current.revision?.taskId).toBe('task-b');
  });

  it('surfaces a revision conflict and reloads the latest persisted revision', async () => {
    installApi();
    getBrief
      .mockResolvedValueOnce(revisionOf('task-a', 1))
      .mockResolvedValueOnce(revisionOf('task-a', 2));
    saveBrief.mockResolvedValue({ kind: 'conflict', currentRevision: 2 });
    const { result } = renderHook(() => useTaskContinuity('task-a'));
    await waitFor(() => expect(result.current.revision?.revision).toBe(1));

    await act(async () => {
      await result.current.save({
        taskId: 'task-a',
        expectedRevision: 1,
        objective: '修订目标',
        activeRequirements: [],
        progress: null,
      });
    });
    expect(result.current.conflict).toBe(true);
    expect(result.current.errorKind).toBe('conflict');
    expect(result.current.revision?.revision).toBe(1);

    await act(async () => result.current.refresh());
    expect(result.current.revision?.revision).toBe(2);
    expect(result.current.error).toBe('');
  });

  it('does not apply a late save result to a different selected Task', async () => {
    installApi();
    getBrief.mockImplementation(async ({ taskId }) => revisionOf(taskId));
    const lateSave = deferred<TaskContinuityBriefMutationResult>();
    saveBrief.mockReturnValue(lateSave.promise);
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useTaskContinuity(taskId),
      { initialProps: { taskId: 'task-a' } },
    );
    await waitFor(() => expect(result.current.revision?.taskId).toBe('task-a'));
    let pendingSave: Promise<TaskContinuityBriefMutationResult | null> | undefined;
    act(() => {
      pendingSave = result.current.save({
        taskId: 'task-a',
        expectedRevision: 1,
        objective: '修订目标',
        activeRequirements: [],
        progress: null,
      });
      rerender({ taskId: 'task-b' });
    });
    await waitFor(() => expect(result.current.revision?.taskId).toBe('task-b'));
    await act(async () => lateSave.resolve({ kind: 'conflict', currentRevision: 2 }));
    if (!pendingSave) throw new Error('Task save did not start');
    await pendingSave;

    expect(result.current.revision?.taskId).toBe('task-b');
    expect(result.current.conflict).toBe(false);
  });
});
