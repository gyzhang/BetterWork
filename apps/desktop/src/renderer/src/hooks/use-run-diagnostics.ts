import {
  type AgentRuntimeEvent,
  RUN_DIAGNOSTICS_PAGE_SIZE_MAX,
  type RunDiagnosticNode,
  type RunDiagnosticsCursor,
  type RunDiagnosticsScopeRequest,
  type RunDiagnosticsSources,
  type RunDiagnosticsSummary,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import {
  hasRunEventSequenceGap,
  isRunDiagnosticsRelevantEvent,
  mergeRunDiagnosticNodes,
} from '../lib/run-diagnostics';
import { mergeRunEvents } from '../lib/run-events';

export interface RunDiagnosticsState {
  summary: RunDiagnosticsSummary | undefined;
  sources: RunDiagnosticsSources | undefined;
  nodes: RunDiagnosticNode[];
  loading: boolean;
  error: string;
  refresh: () => void;
}

const emptyState = (): Omit<RunDiagnosticsState, 'refresh'> => ({
  summary: undefined,
  sources: undefined,
  nodes: [],
  loading: false,
  error: '',
});

/** Read the current or historical Run projection and hand off persisted events to live updates. */
export function useRunDiagnostics(scope?: RunDiagnosticsScopeRequest): RunDiagnosticsState {
  const [state, setState] = useState<Omit<RunDiagnosticsState, 'refresh'>>(emptyState);
  const requestIdRef = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);
  const workspaceId = scope?.workspaceId;
  const taskId = scope?.taskId;
  const runId = scope?.runId;

  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!workspaceId || !taskId || !runId) {
      setState(emptyState());
      refreshRef.current = () => undefined;
      return;
    }

    const selectedScope = { workspaceId, taskId, runId };
    let active = true;
    let refreshBusy = false;
    let refreshPending = false;
    let eventSyncBusy = false;
    let eventSyncPending = false;
    let liveEvents: AgentRuntimeEvent[] = [];
    const eventIds = new Set<string>();
    const isCurrent = (): boolean => active && requestIdRef.current === requestId;

    setState({ ...emptyState(), loading: true });

    const loadPages = async (): Promise<RunDiagnosticNode[]> => {
      let cursor: RunDiagnosticsCursor | undefined;
      let nodes: RunDiagnosticNode[] = [];
      const visitedCursors = new Set<string>();

      while (true) {
        const page = await window.betterwork.runs.listDiagnosticsPage({
          ...selectedScope,
          pageSize: RUN_DIAGNOSTICS_PAGE_SIZE_MAX,
          ...(cursor ? { cursor } : {}),
        });
        if (!page) return nodes;
        nodes = mergeRunDiagnosticNodes(nodes, page.nodes);
        if (!page.nextCursor) return nodes;
        const cursorKey = JSON.stringify(page.nextCursor);
        if (visitedCursors.has(cursorKey)) {
          throw new Error('执行详情分页游标重复，无法完整读取，请重试。');
        }
        visitedCursors.add(cursorKey);
        cursor = page.nextCursor;
      }
    };

    const startRefresh = (): void => {
      if (!isCurrent()) return;
      if (refreshBusy) {
        refreshPending = true;
        return;
      }
      refreshBusy = true;
      setState((current) => ({
        ...current,
        loading: current.summary === undefined,
        error: '',
      }));

      const run = async (): Promise<void> => {
        try {
          do {
            refreshPending = false;
            const [summary, nodes, sources] = await Promise.all([
              window.betterwork.runs.getDiagnosticsSummary(selectedScope),
              loadPages(),
              window.betterwork.runs.getDiagnosticsSources(selectedScope),
            ]);
            if (!isCurrent()) return;
            setState((current) => ({
              summary: summary ?? undefined,
              sources: sources ?? undefined,
              nodes: summary ? mergeRunDiagnosticNodes(current.nodes, nodes) : [],
              loading: false,
              error: '',
            }));
          } while (refreshPending && isCurrent());
        } catch (failure) {
          if (isCurrent()) {
            setState((current) => ({
              ...current,
              loading: false,
              error: describeActionError(failure, '无法加载执行详情，请重试。'),
            }));
          }
        } finally {
          refreshBusy = false;
          if (refreshPending && isCurrent()) startRefresh();
        }
      };

      trackAction(run(), '加载 Run 执行诊断');
    };

    const syncEventGap = (): void => {
      if (!isCurrent()) return;
      if (eventSyncBusy) {
        eventSyncPending = true;
        return;
      }
      eventSyncBusy = true;
      eventSyncPending = false;

      const run = async (): Promise<void> => {
        try {
          const snapshot = await window.betterwork.runs.listEvents({ runId });
          if (!isCurrent()) return;
          const previousIds = new Set(liveEvents.map((event) => event.id));
          liveEvents = mergeRunEvents(snapshot, liveEvents);
          eventIds.clear();
          for (const event of liveEvents) eventIds.add(event.id);
          if (
            liveEvents.some(
              (event) => !previousIds.has(event.id) && isRunDiagnosticsRelevantEvent(event),
            )
          ) {
            startRefresh();
          }
        } catch (failure) {
          if (isCurrent()) {
            setState((current) => ({
              ...current,
              error: describeActionError(failure, '无法补读取运行事件，请重试。'),
            }));
          }
        } finally {
          eventSyncBusy = false;
          const shouldRetry = eventSyncPending && hasRunEventSequenceGap(liveEvents);
          eventSyncPending = false;
          if (shouldRetry && isCurrent()) syncEventGap();
        }
      };

      trackAction(run(), '补读取运行事件');
    };

    const unsubscribe = window.betterwork.runs.onEvent((event) => {
      if (!isCurrent() || event.runId !== runId || eventIds.has(event.id)) return;
      eventIds.add(event.id);
      liveEvents = mergeRunEvents(liveEvents, [event]);
      if (isRunDiagnosticsRelevantEvent(event)) startRefresh();
      if (hasRunEventSequenceGap(liveEvents)) syncEventGap();
    });

    const retry = (): void => {
      startRefresh();
      if (hasRunEventSequenceGap(liveEvents)) syncEventGap();
    };

    refreshRef.current = retry;
    startRefresh();

    return () => {
      active = false;
      if (requestIdRef.current === requestId) refreshRef.current = () => undefined;
      unsubscribe();
    };
  }, [runId, taskId, workspaceId]);

  return { ...state, refresh };
}
