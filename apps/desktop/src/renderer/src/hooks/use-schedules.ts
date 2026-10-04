import {
  LIST_PAGE_DEFAULT_LIMIT,
  type ScheduleAggregate,
  type ScheduleDetail,
  type SchedulePageCursor,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface SchedulesState {
  details: ScheduleDetail[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  refreshError: string;
  refresh: () => void;
}

/**
 * 定时任务列表事实只在 Main 读取；变更推送仅触发失效重读，不把事件当作状态快照。
 * 每次重读有代号，迟到的列表或详情不能覆盖较新的事实。
 */
export function useSchedules(active: boolean): SchedulesState {
  const [details, setDetails] = useState<ScheduleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const requestId = useRef(0);
  const hasLoaded = useRef(false);

  const refresh = useCallback((): void => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(!hasLoaded.current);
    setRefreshing(hasLoaded.current);
    setRefreshError('');

    const load = async (): Promise<void> => {
      try {
        const aggregates: ScheduleAggregate[] = [];
        let cursor: SchedulePageCursor | undefined;

        do {
          const page = await window.betterwork.schedules.list({
            limit: LIST_PAGE_DEFAULT_LIMIT,
            ...(cursor ? { cursor } : {}),
          });
          if (page.status === 'rejected') throw new Error(page.error.message);
          aggregates.push(...page.data.items);
          cursor = page.data.nextCursor;
        } while (cursor !== undefined);

        const nextDetails: ScheduleDetail[] = [];
        for (let offset = 0; offset < aggregates.length; offset += LIST_PAGE_DEFAULT_LIMIT) {
          const batch = aggregates.slice(offset, offset + LIST_PAGE_DEFAULT_LIMIT);
          const batchDetails = await Promise.all(
            batch.map(async ({ schedule }) => {
              const result = await window.betterwork.schedules.get({ scheduleId: schedule.id });
              if (result.status === 'rejected') throw new Error(result.error.message);
              return result.data;
            }),
          );
          nextDetails.push(...batchDetails);
          if (requestId.current !== currentRequestId) return;
        }

        if (requestId.current !== currentRequestId) return;
        hasLoaded.current = true;
        setDetails(nextDetails);
        setError('');
        setRefreshError('');
      } catch (caughtError) {
        if (requestId.current !== currentRequestId) return;
        const message = describeActionError(caughtError, '读取定时任务列表失败，请重试。');
        if (hasLoaded.current) setRefreshError(message);
        else setError(message);
      } finally {
        if (requestId.current === currentRequestId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    trackAction(load(), '刷新定时任务列表');
  }, []);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.betterwork.schedules.onChange(() => refresh());
    refresh();
    return () => {
      requestId.current += 1;
      unsubscribe();
    };
  }, [active, refresh]);

  return { details, loading, refreshing, error, refreshError, refresh };
}
