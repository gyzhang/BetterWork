import {
  type EvidenceSummary,
  LIST_PAGE_DEFAULT_LIMIT,
  type ScheduleDetail,
  type ScheduleOccurrenceDetail,
  type ScheduleOccurrenceHistoryItem,
  type SchedulePageCursor,
  type ScheduleSourceCursor,
  type ScheduleSourceItem,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import { mergeScheduleOccurrenceHistory } from '../lib/schedule-detail';

export interface ScheduleDetailState {
  historyItems: ScheduleOccurrenceHistoryItem[];
  historyCursor?: SchedulePageCursor;
  historyLoading: boolean;
  historyError: string;
  loadMoreHistory: () => void;
  selectedOccurrenceId?: string;
  occurrence?: ScheduleOccurrenceDetail;
  occurrenceLoading: boolean;
  occurrenceError: string;
  selectOccurrence: (occurrenceId: string) => void;
  refreshOccurrence: () => void;
  sourceItems: ScheduleSourceItem[];
  sourceLoading: boolean;
  sourceError: string;
  refreshSources: () => void;
  evidence: EvidenceSummary[];
  evidenceLoading: boolean;
  evidenceError: string;
  refreshEvidence: () => void;
}

const loadAllSourceItems = async (occurrenceId: string): Promise<ScheduleSourceItem[]> => {
  const items: ScheduleSourceItem[] = [];
  let cursor: ScheduleSourceCursor | undefined;
  do {
    const response = await window.betterwork.schedules.listSourceItems({
      occurrenceId,
      limit: LIST_PAGE_DEFAULT_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    if (response.status === 'rejected') throw new Error(response.error.message);
    items.push(...response.data.items);
    cursor = response.data.nextCursor;
  } while (cursor !== undefined);
  return items;
};

const loadRunEvidence = async (
  taskId: string | undefined,
  runId: string | undefined,
): Promise<EvidenceSummary[]> => {
  if (!taskId || !runId) return [];
  const items = await window.betterwork.evidence.list({ taskId });
  return items.filter((item) => item.runId === runId);
};

export function useScheduleDetail(detail: ScheduleDetail): ScheduleDetailState {
  const [historyItems, setHistoryItems] = useState(detail.history.items);
  const [historyCursor, setHistoryCursor] = useState(detail.history.nextCursor);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | undefined>(
    detail.history.items[0]?.occurrence.id,
  );
  const [occurrence, setOccurrence] = useState<ScheduleOccurrenceDetail>();
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);
  const [occurrenceError, setOccurrenceError] = useState('');
  const [sourceItems, setSourceItems] = useState<ScheduleSourceItem[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const historyRequestId = useRef(0);
  const occurrenceRequestId = useRef(0);
  const sourceRequestId = useRef(0);
  const evidenceRequestId = useRef(0);
  const selectedOccurrenceIdRef = useRef(selectedOccurrenceId);
  const loadedMoreHistory = useRef(false);

  useEffect(() => {
    selectedOccurrenceIdRef.current = selectedOccurrenceId;
  }, [selectedOccurrenceId]);

  useEffect(() => {
    setHistoryItems((current) => mergeScheduleOccurrenceHistory(current, detail.history.items));
    if (!loadedMoreHistory.current) setHistoryCursor(detail.history.nextCursor);
  }, [detail.history]);

  const loadOccurrence = useCallback(
    async (occurrenceId: string, preservePrevious: boolean): Promise<void> => {
      const requestId = occurrenceRequestId.current + 1;
      let sourceRequest = 0;
      let evidenceRequest = 0;
      occurrenceRequestId.current = requestId;
      setOccurrenceLoading(true);
      setOccurrenceError('');
      if (!preservePrevious) {
        setOccurrence(undefined);
        setSourceItems([]);
        setEvidence([]);
        setSourceLoading(false);
        setEvidenceLoading(false);
        setSourceError('');
        setEvidenceError('');
      }

      try {
        const response = await window.betterwork.schedules.getOccurrence({ occurrenceId });
        if (response.status === 'rejected') throw new Error(response.error.message);
        if (occurrenceRequestId.current !== requestId) return;
        const nextOccurrence = response.data;
        setOccurrence(nextOccurrence);

        sourceRequest = sourceRequestId.current + 1;
        evidenceRequest = evidenceRequestId.current + 1;
        sourceRequestId.current = sourceRequest;
        evidenceRequestId.current = evidenceRequest;
        setSourceLoading(true);
        setEvidenceLoading(true);
        setSourceError('');
        setEvidenceError('');
        const [sourceResult, evidenceResult] = await Promise.allSettled([
          loadAllSourceItems(occurrenceId),
          loadRunEvidence(nextOccurrence.task?.id, nextOccurrence.run?.id),
        ]);
        if (occurrenceRequestId.current !== requestId) return;
        if (sourceRequestId.current === sourceRequest) {
          if (sourceResult.status === 'fulfilled') setSourceItems(sourceResult.value);
          else
            setSourceError(describeActionError(sourceResult.reason, '读取本期来源失败，请重试。'));
        }
        if (evidenceRequestId.current === evidenceRequest) {
          if (evidenceResult.status === 'fulfilled') setEvidence(evidenceResult.value);
          else
            setEvidenceError(
              describeActionError(evidenceResult.reason, '读取本期运行证据失败，请重试。'),
            );
        }
      } catch (caughtError) {
        if (occurrenceRequestId.current === requestId) {
          setOccurrenceError(describeActionError(caughtError, '读取本期详情失败，请重试。'));
        }
      } finally {
        if (occurrenceRequestId.current === requestId) setOccurrenceLoading(false);
        if (sourceRequest > 0 && sourceRequestId.current === sourceRequest) setSourceLoading(false);
        if (evidenceRequest > 0 && evidenceRequestId.current === evidenceRequest) {
          setEvidenceLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const occurrenceId = selectedOccurrenceId;
    if (!occurrenceId) return;
    trackAction(loadOccurrence(occurrenceId, false), '读取定时任务本期详情');
  }, [loadOccurrence, selectedOccurrenceId]);

  useEffect(() => {
    const unsubscribe = window.betterwork.schedules.onChange((event) => {
      if (
        event.scheduleId === detail.aggregate.schedule.id &&
        event.occurrenceId !== undefined &&
        event.occurrenceId === selectedOccurrenceIdRef.current
      ) {
        trackAction(loadOccurrence(event.occurrenceId, true), '刷新定时任务本期详情');
      }
    });
    return () => {
      occurrenceRequestId.current += 1;
      sourceRequestId.current += 1;
      evidenceRequestId.current += 1;
      unsubscribe();
    };
  }, [detail.aggregate.schedule.id, loadOccurrence]);

  const loadMoreHistory = useCallback((): void => {
    if (!historyCursor || historyLoading) return;
    const requestId = historyRequestId.current + 1;
    historyRequestId.current = requestId;
    setHistoryLoading(true);
    setHistoryError('');
    const load = async (): Promise<void> => {
      try {
        const response = await window.betterwork.schedules.listOccurrences({
          scheduleId: detail.aggregate.schedule.id,
          cursor: historyCursor,
          limit: LIST_PAGE_DEFAULT_LIMIT,
        });
        if (response.status === 'rejected') throw new Error(response.error.message);
        if (historyRequestId.current !== requestId) return;
        loadedMoreHistory.current = true;
        setHistoryItems((current) => mergeScheduleOccurrenceHistory(current, response.data.items));
        setHistoryCursor(response.data.nextCursor);
      } catch (caughtError) {
        if (historyRequestId.current === requestId) {
          setHistoryError(describeActionError(caughtError, '读取更多定时历史失败，请重试。'));
        }
      } finally {
        if (historyRequestId.current === requestId) setHistoryLoading(false);
      }
    };
    trackAction(load(), '读取更多定时任务历史');
  }, [detail.aggregate.schedule.id, historyCursor, historyLoading]);

  const selectOccurrence = useCallback((occurrenceId: string): void => {
    if (selectedOccurrenceIdRef.current === occurrenceId) return;
    setSelectedOccurrenceId(occurrenceId);
  }, []);

  const refreshOccurrence = useCallback((): void => {
    const occurrenceId = selectedOccurrenceIdRef.current;
    if (occurrenceId) trackAction(loadOccurrence(occurrenceId, true), '刷新定时任务本期详情');
  }, [loadOccurrence]);

  const refreshSources = useCallback((): void => {
    const occurrenceId = selectedOccurrenceIdRef.current;
    if (!occurrenceId) return;
    const requestId = sourceRequestId.current + 1;
    sourceRequestId.current = requestId;
    setSourceLoading(true);
    setSourceError('');
    const load = async (): Promise<void> => {
      try {
        const items = await loadAllSourceItems(occurrenceId);
        if (sourceRequestId.current === requestId) setSourceItems(items);
      } catch (caughtError) {
        if (sourceRequestId.current === requestId) {
          setSourceError(describeActionError(caughtError, '读取本期来源失败，请重试。'));
        }
      } finally {
        if (sourceRequestId.current === requestId) setSourceLoading(false);
      }
    };
    trackAction(load(), '刷新定时任务来源');
  }, []);

  const refreshEvidence = useCallback((): void => {
    const current = occurrence;
    if (!current) return;
    const requestId = evidenceRequestId.current + 1;
    evidenceRequestId.current = requestId;
    setEvidenceLoading(true);
    setEvidenceError('');
    const load = async (): Promise<void> => {
      try {
        const items = await loadRunEvidence(current.task?.id, current.run?.id);
        if (evidenceRequestId.current === requestId) setEvidence(items);
      } catch (caughtError) {
        if (evidenceRequestId.current === requestId) {
          setEvidenceError(describeActionError(caughtError, '读取本期运行证据失败，请重试。'));
        }
      } finally {
        if (evidenceRequestId.current === requestId) setEvidenceLoading(false);
      }
    };
    trackAction(load(), '刷新定时任务运行证据');
  }, [occurrence]);

  return {
    historyItems,
    ...(historyCursor ? { historyCursor } : {}),
    historyLoading,
    historyError,
    loadMoreHistory,
    ...(selectedOccurrenceId ? { selectedOccurrenceId } : {}),
    ...(occurrence ? { occurrence } : {}),
    occurrenceLoading,
    occurrenceError,
    selectOccurrence,
    refreshOccurrence,
    sourceItems,
    sourceLoading,
    sourceError,
    refreshSources,
    evidence,
    evidenceLoading,
    evidenceError,
    refreshEvidence,
  };
}
