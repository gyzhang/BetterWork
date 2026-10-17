import type {
  RunDiagnosticIssueMark,
  RunDiagnosticIssueMarkCategory,
  RunDiagnosticsScopeRequest,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import { useTransientToast } from './use-transient-toast';

export interface RunDiagnosticIssueMarkState {
  mark: RunDiagnosticIssueMark | null;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  toast: ReturnType<typeof useTransientToast>['toast'];
  refresh: () => void;
  save: (category: RunDiagnosticIssueMarkCategory, diagnosticNodeId?: string) => void;
  clear: () => void;
  dismissToast: () => void;
}

interface StoredIssueMarkState {
  mark: RunDiagnosticIssueMark | null;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
}

const emptyState = (): StoredIssueMarkState => ({
  mark: null,
  loaded: false,
  loading: false,
  saving: false,
  error: '',
});

/** Keep a user-authored issue mark scoped to one Run and protect edits with its revision. */
export function useRunDiagnosticIssueMark(
  scope: RunDiagnosticsScopeRequest,
  enabled: boolean,
): RunDiagnosticIssueMarkState {
  const [state, setState] = useState<StoredIssueMarkState>(emptyState);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestIdRef = useRef(0);
  const savingRef = useRef(false);
  const { toast, showToast, dismissToast } = useTransientToast();
  const { workspaceId, taskId, runId } = scope;

  const refresh = useCallback((): void => {
    setRefreshRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!enabled) return;

    let active = true;
    const isCurrent = (): boolean => active && requestIdRef.current === requestId;
    setState((current) => ({ ...current, loading: true, error: '' }));
    const load = async (): Promise<void> => {
      try {
        const mark = await window.betterwork.runs.getDiagnosticIssueMark({
          workspaceId,
          taskId,
          runId,
        });
        if (!isCurrent()) return;
        setState((current) => ({ ...current, mark, loaded: true, loading: false, error: '' }));
      } catch (failure) {
        if (isCurrent()) {
          setState((current) => ({
            ...current,
            loading: false,
            error: describeActionError(failure, '读取问题标记失败，请重试。'),
          }));
        }
      }
    };

    trackAction(load(), '读取 Run 问题标记');
    return () => {
      active = false;
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [enabled, refreshRevision, runId, taskId, workspaceId]);

  const mutate = useCallback(
    (category: RunDiagnosticIssueMarkCategory | null, diagnosticNodeId?: string): void => {
      if (!enabled || !state.loaded || state.loading || savingRef.current) return;
      savingRef.current = true;
      const requestId = requestIdRef.current;
      const expectedRevision = state.mark?.revision ?? null;
      setState((current) => ({ ...current, saving: true, error: '' }));

      const saveMark = async (): Promise<void> => {
        try {
          const mark = await window.betterwork.runs.setDiagnosticIssueMark({
            workspaceId,
            taskId,
            runId,
            expectedRevision,
            category,
            ...(category !== null && diagnosticNodeId ? { diagnosticNodeId } : {}),
          });
          if (requestIdRef.current !== requestId) return;
          setState((current) => ({ ...current, mark, loaded: true, saving: false, error: '' }));
          showToast('success', category === null ? '问题标记已清除' : '问题标记已保存');
        } catch (failure) {
          if (requestIdRef.current === requestId) {
            setState((current) => ({
              ...current,
              saving: false,
              error: describeActionError(failure, '保存问题标记失败，请重试。'),
            }));
          }
        } finally {
          savingRef.current = false;
        }
      };

      trackAction(saveMark(), category === null ? '清除 Run 问题标记' : '保存 Run 问题标记');
    },
    [enabled, runId, showToast, state.loaded, state.loading, state.mark, taskId, workspaceId],
  );

  const save = useCallback(
    (category: RunDiagnosticIssueMarkCategory, diagnosticNodeId?: string): void => {
      mutate(category, diagnosticNodeId);
    },
    [mutate],
  );
  const clear = useCallback((): void => mutate(null), [mutate]);

  return { ...state, toast, refresh, save, clear, dismissToast };
}
