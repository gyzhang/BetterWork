import type {
  RunDiagnosticsHistoryFilter,
  RunDiagnosticsHistoryPage,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface RunDiagnosticsHistoryState {
  page: RunDiagnosticsHistoryPage | undefined;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  refresh: () => void;
  loadMore: () => void;
}

const emptyState = (): Omit<RunDiagnosticsHistoryState, 'refresh' | 'loadMore'> => ({
  page: undefined,
  loading: false,
  loadingMore: false,
  error: '',
});

/** Load workspace-scoped execution history while discarding responses from older filters. */
export function useRunDiagnosticsHistory(
  workspaceId: string,
  filter: RunDiagnosticsHistoryFilter,
  enabled: boolean,
): RunDiagnosticsHistoryState {
  const [state, setState] =
    useState<Omit<RunDiagnosticsHistoryState, 'refresh' | 'loadMore'>>(emptyState);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestIdRef = useRef(0);
  const loadingMoreRequestIdRef = useRef(0);
  const taskId = filter.taskId;
  const fromCreatedAt = filter.fromCreatedAt;
  const throughCreatedAt = filter.throughCreatedAt;
  const expertRevisionId = filter.expertRevisionId;
  const skillRevisionId = filter.skillRevisionId;
  const modelFingerprint = filter.modelFingerprint;

  const refresh = useCallback((): void => {
    setRefreshRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!enabled) return;

    const selectedFilter: RunDiagnosticsHistoryFilter = {
      ...(taskId ? { taskId } : {}),
      ...(fromCreatedAt !== undefined ? { fromCreatedAt } : {}),
      ...(throughCreatedAt !== undefined ? { throughCreatedAt } : {}),
      ...(expertRevisionId ? { expertRevisionId } : {}),
      ...(skillRevisionId ? { skillRevisionId } : {}),
      ...(modelFingerprint ? { modelFingerprint } : {}),
    };
    let active = true;
    const isCurrent = (): boolean => active && requestIdRef.current === requestId;
    setState({ ...emptyState(), loading: true });

    const load = async (): Promise<void> => {
      try {
        const page = await window.betterwork.runs.listDiagnosticsHistory({
          workspaceId,
          filter: selectedFilter,
        });
        if (!isCurrent()) return;
        setState({ page, loading: false, loadingMore: false, error: '' });
      } catch (failure) {
        if (!isCurrent()) return;
        setState({
          ...emptyState(),
          error: describeActionError(failure, '读取执行记录失败，请重试。'),
        });
      }
    };

    trackAction(load(), '读取 Run 执行记录与统计');
    return () => {
      active = false;
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [
    enabled,
    expertRevisionId,
    fromCreatedAt,
    modelFingerprint,
    refreshRevision,
    skillRevisionId,
    taskId,
    throughCreatedAt,
    workspaceId,
  ]);

  const loadMore = useCallback((): void => {
    const cursor = state.page?.nextCursor;
    const requestId = requestIdRef.current;
    if (!enabled || !cursor || loadingMoreRequestIdRef.current === requestId) return;
    loadingMoreRequestIdRef.current = requestId;
    setState((current) => ({ ...current, loadingMore: true, error: '' }));

    const selectedFilter: RunDiagnosticsHistoryFilter = {
      ...(taskId ? { taskId } : {}),
      ...(fromCreatedAt !== undefined ? { fromCreatedAt } : {}),
      ...(throughCreatedAt !== undefined ? { throughCreatedAt } : {}),
      ...(expertRevisionId ? { expertRevisionId } : {}),
      ...(skillRevisionId ? { skillRevisionId } : {}),
      ...(modelFingerprint ? { modelFingerprint } : {}),
    };
    const isCurrent = (): boolean => requestIdRef.current === requestId;

    const load = async (): Promise<void> => {
      try {
        const nextPage = await window.betterwork.runs.listDiagnosticsHistory({
          workspaceId,
          filter: selectedFilter,
          cursor,
        });
        if (!isCurrent()) return;
        setState((current) => {
          if (!current.page) return { ...current, loadingMore: false };
          const existingRunIds = new Set(current.page.runs.map((run) => run.summary.runId));
          const appendedRuns = nextPage.runs.filter(
            (run) => !existingRunIds.has(run.summary.runId),
          );
          return {
            ...current,
            page: { ...nextPage, runs: [...current.page.runs, ...appendedRuns] },
            loadingMore: false,
            error: '',
          };
        });
      } catch (failure) {
        if (isCurrent()) {
          setState((current) => ({
            ...current,
            loadingMore: false,
            error: describeActionError(failure, '读取更多执行记录失败，请重试。'),
          }));
        }
      } finally {
        if (loadingMoreRequestIdRef.current === requestId) loadingMoreRequestIdRef.current = 0;
      }
    };

    trackAction(load(), '读取更多 Run 执行记录');
  }, [
    enabled,
    expertRevisionId,
    fromCreatedAt,
    modelFingerprint,
    skillRevisionId,
    state.page,
    taskId,
    throughCreatedAt,
    workspaceId,
  ]);

  return { ...state, refresh, loadMore };
}
