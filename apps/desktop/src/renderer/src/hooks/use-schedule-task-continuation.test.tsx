// @vitest-environment jsdom

import type {
  ScheduleOccurrenceDetail,
  TaskContextRevision,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScheduleTaskContinuation } from './use-schedule-task-continuation';

const occurrence: ScheduleOccurrenceDetail = {
  occurrence: {
    id: 'occurrence-1',
    scheduleId: 'schedule-1',
    configVersion: 3,
    trigger: 'scheduled',
    period: {
      rule: 'previous-month',
      timeZone: 'Asia/Shanghai',
      anchorAt: 10,
      startAt: 1,
      endAt: 9,
      label: '2026 年 8 月',
    },
    phase: 'closed',
    preparationOutcome: 'needs-material',
    taskId: 'task-1',
    sessionId: 'session-1',
    sourceSnapshotId: 'snapshot-1',
    createdAt: 1,
    requestedAt: 1,
    preparedAt: 2,
    finishedAt: 3,
  },
  result: {
    occurrence: {
      id: 'occurrence-1',
      scheduleId: 'schedule-1',
      configVersion: 3,
      trigger: 'scheduled',
      period: {
        rule: 'previous-month',
        timeZone: 'Asia/Shanghai',
        anchorAt: 10,
        startAt: 1,
        endAt: 9,
        label: '2026 年 8 月',
      },
      phase: 'closed',
      preparationOutcome: 'needs-material',
      taskId: 'task-1',
      sessionId: 'session-1',
      sourceSnapshotId: 'snapshot-1',
      createdAt: 1,
      requestedAt: 1,
      preparedAt: 2,
      finishedAt: 3,
    },
    status: 'needs-material',
    outputReceipts: [],
  },
  config: {
    scheduleId: 'schedule-1',
    version: 3,
    name: '月度经营分析',
    expertId: 'expert-1',
    expertRevisionId: 'expert-revision-1',
    requirements: '分析经营表现',
    expectedArtifactTypes: ['markdown'],
    timing: {
      frequency: 'monthly',
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    },
    periodRule: 'previous-month',
    knowledgeSources: [],
    outputSubdirectory: '定时成果',
    createdAt: 1,
  },
  task: {
    id: 'task-1',
    workspaceId: 'workspace-1',
    title: '月度经营分析 · 2026 年 8 月',
    goal: '分析经营表现',
    createdAt: 1,
    updatedAt: 2,
  },
  sourceSnapshot: {
    id: 'snapshot-1',
    occurrenceId: 'occurrence-1',
    workspaceId: 'workspace-1',
    status: 'ready',
    configVersion: 3,
    evaluatedAt: 1,
    manifestHash: 'a'.repeat(64),
    itemCount: 2,
    totalFileBytes: 512,
    createdAt: 1,
    completedAt: 2,
  },
  outputReceipts: [],
  readMaterialCount: 0,
  adoptedMaterialCount: 0,
};

const context: TaskContextRevision = {
  id: 'context-1',
  taskId: 'task-1',
  revision: 5,
  executor: { kind: 'general' },
  skillBindings: [],
  materials: [],
  scheduleSourceSnapshotId: 'snapshot-1',
  excludedMemoryIds: ['memory-1'],
  mcpToolBindings: [],
  modelReference: { mode: 'application-default' },
  builtinToolPolicy: { mode: 'application-defaults' },
  createdAt: 1,
  updatedAt: 5,
};
const supplementedMaterial: TaskMaterialSelection = {
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'document-1',
    knowledgeRevisionId: 'knowledge-revision-2',
    contentHash: 'content-hash-2',
    sourcePath: '/workspace/合成规则.md',
  },
  purpose: 'rule',
  addedFrom: 'workspace-candidate',
};
const draft = {
  executor: context.executor,
  skillBindings: context.skillBindings,
  materials: [supplementedMaterial],
  excludedMemoryIds: context.excludedMemoryIds ?? [],
  mcpToolBindings: context.mcpToolBindings ?? [],
};

const installApi = (save: Window['betterwork']['taskContexts']['save']) => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { taskContexts: { save } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
});

describe('useScheduleTaskContinuation', () => {
  it('removes only the current Task scope with an expected revision and preserves all other context', async () => {
    const { scheduleSourceSnapshotId, ...withoutScope } = context;
    expect(scheduleSourceSnapshotId).toBe('snapshot-1');
    const savedContext = {
      ...withoutScope,
      id: 'context-2',
      revision: 6,
      updatedAt: 6,
      materials: draft.materials,
    };
    const save = vi.fn<Window['betterwork']['taskContexts']['save']>(async (input) => ({
      context: { ...savedContext, taskId: input.taskId, materials: input.materials ?? [] },
    }));
    installApi(save);
    const onContextSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ taskContext }) => useScheduleTaskContinuation({ taskContext, onContextSaved }),
      { initialProps: { taskContext: context } },
    );

    act(() => result.current.attach(occurrence));
    expect(result.current.view?.scopeAttached).toBe(true);
    act(() => result.current.removeScope(draft));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    rerender({ taskContext: savedContext });
    await waitFor(() => expect(result.current.view?.scopeAttached).toBe(false));
    expect(save).toHaveBeenCalledWith({
      taskId: 'task-1',
      expectedRevision: 5,
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [supplementedMaterial],
      scheduleSourceSnapshotId: null,
      excludedMemoryIds: ['memory-1'],
      mcpToolBindings: [],
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'application-defaults' },
    });
    expect(onContextSaved).toHaveBeenCalledWith(savedContext);
  });

  it('keeps the snapshot attached after a failed compare-and-save and reports one inline error', async () => {
    const save = vi.fn<Window['betterwork']['taskContexts']['save']>(async () => {
      throw new Error('TaskContext revision 已变化');
    });
    installApi(save);
    const { result } = renderHook(() =>
      useScheduleTaskContinuation({ taskContext: context, onContextSaved: vi.fn() }),
    );

    act(() => result.current.attach(occurrence));
    act(() => result.current.removeScope(draft));

    await waitFor(() => expect(result.current.scopeError).toContain('TaskContext revision 已变化'));
    expect(result.current.view?.scopeAttached).toBe(true);
    expect(result.current.removingScope).toBe(false);
  });

  it('does not start duplicate scope updates while one save is pending', async () => {
    let resolveSave:
      | ((value: Awaited<ReturnType<Window['betterwork']['taskContexts']['save']>>) => void)
      | undefined;
    const save = vi.fn<Window['betterwork']['taskContexts']['save']>(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    installApi(save);
    const { scheduleSourceSnapshotId, ...withoutScope } = context;
    expect(scheduleSourceSnapshotId).toBe('snapshot-1');
    const savedContext = { ...withoutScope, id: 'context-2', revision: 6, updatedAt: 6 };
    const { result } = renderHook(() =>
      useScheduleTaskContinuation({ taskContext: context, onContextSaved: vi.fn() }),
    );
    act(() => result.current.attach(occurrence));

    act(() => {
      result.current.removeScope(draft);
      result.current.removeScope(draft);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.removingScope).toBe(true);
    const finishSave = resolveSave;
    if (!finishSave) throw new Error('scope save was not started');
    await act(async () => {
      finishSave({ context: savedContext });
    });
    await waitFor(() => expect(result.current.removingScope).toBe(false));
  });
});
