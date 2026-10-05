import type {
  SaveTaskContinuityBriefRequest,
  TaskContinuityBriefMutationResult,
  TaskContinuityRevision,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

interface TaskContinuityLoadState {
  taskId: string | undefined;
  revision: TaskContinuityRevision | null | undefined;
  loading: boolean;
  saving: boolean;
  error: string;
  errorKind: 'load' | 'save' | 'conflict' | undefined;
  conflict: boolean;
}

export interface TaskContinuityState {
  revision: TaskContinuityRevision | null | undefined;
  loading: boolean;
  saving: boolean;
  error: string;
  errorKind: 'load' | 'save' | 'conflict' | undefined;
  conflict: boolean;
  refresh: () => Promise<void>;
  save: (
    input: SaveTaskContinuityBriefRequest,
  ) => Promise<TaskContinuityBriefMutationResult | null>;
  clearError: () => void;
}

/** Task 简报只按 taskId 加载，迟到的读取/保存响应不能覆盖当前选中任务。 */
export function useTaskContinuity(taskId: string | undefined): TaskContinuityState {
  const [state, setState] = useState<TaskContinuityLoadState>({
    taskId: undefined,
    revision: undefined,
    loading: false,
    saving: false,
    error: '',
    errorKind: undefined,
    conflict: false,
  });
  const activeTaskId = useRef<string | undefined>(undefined);
  const loadSequence = useRef(0);
  const saveSequence = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const targetTaskId = taskId;
    const sequence = ++loadSequence.current;
    if (targetTaskId === undefined) {
      setState({
        taskId: undefined,
        revision: undefined,
        loading: false,
        saving: false,
        error: '',
        errorKind: undefined,
        conflict: false,
      });
      return;
    }
    setState((current) => ({
      taskId: targetTaskId,
      revision: current.taskId === targetTaskId ? current.revision : undefined,
      loading: true,
      saving: false,
      error: '',
      errorKind: undefined,
      conflict: false,
    }));
    try {
      const revision = await window.betterwork.taskContinuity.getBrief({ taskId: targetTaskId });
      if (loadSequence.current !== sequence || activeTaskId.current !== targetTaskId) {
        return;
      }
      setState({
        taskId: targetTaskId,
        revision,
        loading: false,
        saving: false,
        error: '',
        errorKind: undefined,
        conflict: false,
      });
    } catch (error) {
      if (loadSequence.current !== sequence || activeTaskId.current !== targetTaskId) {
        return;
      }
      setState((current) => ({
        taskId: targetTaskId,
        revision: current.taskId === targetTaskId ? current.revision : undefined,
        loading: false,
        saving: false,
        error: describeActionError(error, '读取本任务简报失败，请重试。'),
        errorKind: 'load',
        conflict: false,
      }));
    }
  }, [taskId]);

  useEffect(() => {
    activeTaskId.current = taskId;
    trackAction(refresh(), '读取本任务连续简报');
    return () => {
      loadSequence.current += 1;
      saveSequence.current += 1;
    };
  }, [refresh, taskId]);

  const save = useCallback(
    async (
      input: SaveTaskContinuityBriefRequest,
    ): Promise<TaskContinuityBriefMutationResult | null> => {
      const targetTaskId = taskId;
      if (targetTaskId === undefined || activeTaskId.current !== targetTaskId) return null;
      const sequence = ++saveSequence.current;
      setState((current) => ({
        taskId: targetTaskId,
        revision: current.taskId === targetTaskId ? current.revision : undefined,
        loading: false,
        saving: true,
        error: '',
        errorKind: undefined,
        conflict: false,
      }));
      try {
        const result = await window.betterwork.taskContinuity.saveBrief(input);
        if (saveSequence.current !== sequence || activeTaskId.current !== targetTaskId) {
          return null;
        }
        if (result.kind === 'conflict') {
          setState((current) => ({
            taskId: targetTaskId,
            revision: current.taskId === targetTaskId ? current.revision : undefined,
            loading: false,
            saving: false,
            error: '本任务简报已被其他更新修改。请载入最新版本后复核，再重新保存。',
            errorKind: 'conflict',
            conflict: true,
          }));
          return result;
        }
        setState({
          taskId: targetTaskId,
          revision: result.revision,
          loading: false,
          saving: false,
          error: '',
          errorKind: undefined,
          conflict: false,
        });
        return result;
      } catch (error) {
        if (saveSequence.current !== sequence || activeTaskId.current !== targetTaskId) {
          return null;
        }
        setState((current) => ({
          taskId: targetTaskId,
          revision: current.taskId === targetTaskId ? current.revision : undefined,
          loading: false,
          saving: false,
          error: describeActionError(error, '保存本任务简报失败，请重试。'),
          errorKind: 'save',
          conflict: false,
        }));
        return null;
      }
    },
    [taskId],
  );

  const clearError = useCallback((): void => {
    setState((current) =>
      current.taskId === taskId
        ? { ...current, error: '', errorKind: undefined, conflict: false }
        : current,
    );
  }, [taskId]);

  const stateMatchesTask = state.taskId === taskId;
  return {
    revision: stateMatchesTask ? state.revision : undefined,
    loading: taskId !== undefined && (!stateMatchesTask || state.loading),
    saving: stateMatchesTask && state.saving,
    error: stateMatchesTask ? state.error : '',
    errorKind: stateMatchesTask ? state.errorKind : undefined,
    conflict: stateMatchesTask && state.conflict,
    refresh,
    save,
    clearError,
  };
}
