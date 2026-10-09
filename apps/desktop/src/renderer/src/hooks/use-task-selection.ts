import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { useCallback, useRef, useState } from 'react';

export interface SelectedTask {
  id: string;
  sessionId: string;
  title: string;
}

interface TaskSelectionIdentity {
  taskId: string | undefined;
  runId: string | undefined;
  workspaceId: string | undefined;
  selectionRevision: number;
  workspaceRevision: number;
  historyRevision: number;
}

export type TaskSelectionRequest = Pick<
  TaskSelectionIdentity,
  'selectionRevision' | 'workspaceRevision'
>;
export type TaskHistoryRequest = Pick<TaskSelectionIdentity, 'historyRevision' | 'taskId'>;

interface TaskSelectionOptions {
  runId?: string;
  preserveHistory?: boolean;
}

interface TaskSelectionOwner {
  workspace: WorkspaceSummary | undefined;
  activeTask: SelectedTask | undefined;
  activeRunId: string | undefined;
  current: () => Readonly<TaskSelectionIdentity>;
  setWorkspace: (workspace: WorkspaceSummary) => void;
  selectTask: (task: SelectedTask | undefined, options?: TaskSelectionOptions) => void;
  registerCreatedTask: (task: SelectedTask) => void;
  selectStartedRun: (runId: string) => void;
  restoreLatestRun: (runId: string) => void;
  captureSelection: () => TaskSelectionRequest;
  isCurrentSelection: (request: TaskSelectionRequest) => boolean;
  captureHistory: () => TaskHistoryRequest;
  isCurrentHistory: (request: TaskHistoryRequest) => boolean;
  captureWorkspace: () => number;
  isCurrentWorkspace: (revision: number) => boolean;
}

export function useTaskSelection(): TaskSelectionOwner {
  const [workspace, updateWorkspace] = useState<WorkspaceSummary>();
  const [activeTask, updateTask] = useState<SelectedTask>();
  const [activeRunId, updateRun] = useState<string>();
  const identity = useRef<TaskSelectionIdentity>({
    workspaceId: undefined,
    taskId: undefined,
    runId: undefined,
    selectionRevision: 0,
    workspaceRevision: 0,
    historyRevision: 0,
  });
  const current = useCallback((): Readonly<TaskSelectionIdentity> => identity.current, []);
  const setWorkspace = useCallback((selected: WorkspaceSummary): void => {
    if (identity.current.workspaceId !== selected.id) identity.current.workspaceRevision += 1;
    identity.current.workspaceId = selected.id;
    updateWorkspace(selected);
  }, []);
  const selectTask = useCallback(
    (task: SelectedTask | undefined, options: TaskSelectionOptions = {}): void => {
      if (!options.preserveHistory || identity.current.taskId !== task?.id)
        identity.current.historyRevision += 1;
      identity.current.selectionRevision += 1;
      identity.current.taskId = task?.id;
      identity.current.runId = options.runId;
      updateTask(task);
      updateRun(options.runId);
    },
    [],
  );
  // Task creation belongs to the pending start; it does not replace that selection.
  const registerCreatedTask = useCallback((task: SelectedTask): void => {
    identity.current.taskId = task.id;
    updateTask(task);
  }, []);
  // Navigation already advanced the selection before loading this latest Run.
  const restoreLatestRun = useCallback((runId: string): void => {
    identity.current.runId = runId;
    updateRun(runId);
  }, []);
  // New Run details expire old selection reads, while same-Task history stays valid.
  const selectStartedRun = useCallback(
    (runId: string): void => {
      identity.current.selectionRevision += 1;
      restoreLatestRun(runId);
    },
    [restoreLatestRun],
  );
  const captureSelection = useCallback(
    (): TaskSelectionRequest => ({
      selectionRevision: identity.current.selectionRevision,
      workspaceRevision: identity.current.workspaceRevision,
    }),
    [],
  );
  const isCurrentSelection = useCallback(
    (request: TaskSelectionRequest): boolean =>
      identity.current.selectionRevision === request.selectionRevision &&
      identity.current.workspaceRevision === request.workspaceRevision,
    [],
  );
  const captureHistory = useCallback(
    (): TaskHistoryRequest => ({
      historyRevision: identity.current.historyRevision,
      taskId: identity.current.taskId,
    }),
    [],
  );
  const isCurrentHistory = useCallback(
    (request: TaskHistoryRequest): boolean =>
      identity.current.historyRevision === request.historyRevision &&
      identity.current.taskId === request.taskId,
    [],
  );
  const captureWorkspace = useCallback((): number => identity.current.workspaceRevision, []);
  const isCurrentWorkspace = useCallback(
    (revision: number): boolean => identity.current.workspaceRevision === revision,
    [],
  );
  return {
    workspace,
    activeTask,
    activeRunId,
    current,
    setWorkspace,
    selectTask,
    registerCreatedTask,
    selectStartedRun,
    restoreLatestRun,
    captureSelection,
    isCurrentSelection,
    captureHistory,
    isCurrentHistory,
    captureWorkspace,
    isCurrentWorkspace,
  };
}
