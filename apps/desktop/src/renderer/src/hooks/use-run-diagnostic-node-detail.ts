import type {
  RunDiagnosticNodeDetail,
  RunDiagnosticsScopeRequest,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface RunDiagnosticNodeDetailState {
  detail: RunDiagnosticNodeDetail | null | undefined;
  loading: boolean;
  error: string;
  retry: () => void;
}

interface StoredState extends Omit<RunDiagnosticNodeDetailState, 'retry'> {
  key: string;
}

const emptyState = (key = ''): StoredState => ({
  key,
  detail: undefined,
  loading: false,
  error: '',
});

/** Load one bounded tool payload only after the user opens its detail disclosure. */
export function useRunDiagnosticNodeDetail(
  scope: RunDiagnosticsScopeRequest,
  nodeId?: string,
): RunDiagnosticNodeDetailState {
  const [state, setState] = useState<StoredState>(() => emptyState());
  const [attempt, setAttempt] = useState(0);
  const key = nodeId
    ? `${scope.workspaceId}\u0000${scope.taskId}\u0000${scope.runId}\u0000${nodeId}`
    : '';
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!nodeId) {
      setState(emptyState());
      return;
    }

    let active = true;
    setState({ key, detail: undefined, loading: true, error: '' });
    const load = async (): Promise<void> => {
      try {
        const detail = await window.betterwork.runs.getDiagnosticNodeDetail({
          workspaceId: scope.workspaceId,
          taskId: scope.taskId,
          runId: scope.runId,
          nodeId,
        });
        if (active) setState({ key, detail, loading: false, error: '' });
      } catch (failure) {
        if (active) {
          setState({
            key,
            detail: undefined,
            loading: false,
            error: describeActionError(failure, '无法加载工具载荷，请重试。'),
          });
        }
      }
    };

    trackAction(load(), '加载 Run 工具载荷');
    return () => {
      active = false;
    };
  }, [attempt, key, nodeId, scope.runId, scope.taskId, scope.workspaceId]);

  const visible = state.key === key ? state : { ...emptyState(key), loading: Boolean(key) };
  return {
    detail: visible.detail,
    loading: visible.loading,
    error: visible.error,
    retry,
  };
}
