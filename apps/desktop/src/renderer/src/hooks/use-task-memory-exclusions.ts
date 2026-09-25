import type {
  TaskMemoryExclusionItem,
  TaskMemoryExclusionsRequest,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { trackAction } from '../lib/async-action';
import { settleMemoryCall } from '../lib/memory-result';

/**
 * 「本任务已排除」清单（改进 Spec §5、契约 §11.2）。
 *
 * 它是 TaskContext 的只读投影，与范围预览彼此独立：换问法、prompt 为空、
 * 预览失败或重启之后都能读到，恢复入口因此不会消失。
 * 迟到响应按「任务＋上下文修订＋请求序号」丢弃，不会覆盖另一个任务的清单。
 */
export interface TaskMemoryExclusionsQuery {
  taskId: string | undefined;
  taskContextRevisionId: string | undefined;
  expectedTaskContextRevision: number | undefined;
}

export interface TaskMemoryExclusionsState {
  items: TaskMemoryExclusionItem[];
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useTaskMemoryExclusions(
  query: TaskMemoryExclusionsQuery,
): TaskMemoryExclusionsState {
  const { taskId, taskContextRevisionId, expectedTaskContextRevision } = query;
  const [items, setItems] = useState<TaskMemoryExclusionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const guard = useRef({ key: '', request: 0 });

  const key = `${taskId ?? '-'}|${taskContextRevisionId ?? '-'}|${expectedTaskContextRevision ?? '-'}`;
  const available =
    taskId !== undefined &&
    taskContextRevisionId !== undefined &&
    expectedTaskContextRevision !== undefined;

  const reload = useCallback((): void => {
    if (taskId === undefined || taskContextRevisionId === undefined) return;
    if (expectedTaskContextRevision === undefined) return;
    const input: TaskMemoryExclusionsRequest = {
      taskId,
      taskContextRevisionId,
      expectedTaskContextRevision,
    };
    guard.current.request += 1;
    const requestId = guard.current.request;
    guard.current.key = key;
    setLoading(true);
    setError('');
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.taskExclusions(input),
        '读取本任务已排除记忆失败，请重试。',
      ).then((outcome) => {
        if (guard.current.request !== requestId || guard.current.key !== key) return;
        setLoading(false);
        if (outcome.ok) {
          setItems(outcome.data.items);
          return;
        }
        setItems([]);
        setError(outcome.message);
      }),
      '读取本任务已排除记忆',
    );
  }, [taskId, taskContextRevisionId, expectedTaskContextRevision, key]);

  useEffect(() => {
    if (!available) {
      // 上下文还没建立：丢掉上一个任务的清单，但不报错。
      guard.current.request += 1;
      guard.current.key = '';
      setItems([]);
      setError('');
      setLoading(false);
      return;
    }
    reload();
  }, [available, reload]);

  return { items, loading, error, reload };
}
