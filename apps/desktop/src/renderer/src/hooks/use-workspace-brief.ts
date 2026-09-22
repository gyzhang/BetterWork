import type { WorkspaceBrief, WorkspaceMemoryBriefRequest } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { trackAction } from '../lib/async-action';
import { settleMemoryCall } from '../lib/memory-result';

/**
 * 工作空间简报（产品设计 §3.6、契约 §10）。
 *
 * 简报是**可重建的只读视图**：不持久化正文、不调用模型、不整体注入。
 * 因此这里只有两条纪律：
 * 1. **不伪造**——取数失败时保留错误态并允许重试，绝不拿上一次的旧简报冒充现状；
 * 2. **不串空间**——响应按「workspaceId＋expertId」键守卫，切空间后的迟到响应直接丢弃。
 */

export interface WorkspaceBriefQuery {
  workspaceId: string | undefined;
  expertId: string | undefined;
}

export interface WorkspaceBriefState {
  brief: WorkspaceBrief | undefined;
  loading: boolean;
  error: string;
  /** 简报所属空间；用于在切换瞬间明确标注这不是当前空间的内容。 */
  loadedFor: string | undefined;
  refresh: () => void;
}

const briefKey = (workspaceId: string | undefined, expertId: string | undefined): string =>
  `${workspaceId ?? '-'}|${expertId ?? '-'}`;

export function useWorkspaceBrief(query: WorkspaceBriefQuery): WorkspaceBriefState {
  const { workspaceId, expertId } = query;
  const [brief, setBrief] = useState<WorkspaceBrief>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedFor, setLoadedFor] = useState<string>();
  const guard = useRef({ key: '', request: 0 });
  const key = briefKey(workspaceId, expertId);

  const load = useCallback((): void => {
    if (workspaceId === undefined) {
      guard.current = { key: '', request: guard.current.request + 1 };
      setBrief(undefined);
      setError('');
      setLoadedFor(undefined);
      setLoading(false);
      return;
    }
    guard.current.request += 1;
    const requestId = guard.current.request;
    guard.current.key = key;
    const input: WorkspaceMemoryBriefRequest = {
      workspaceId,
      ...(expertId ? { expertId } : {}),
    };
    setLoading(true);
    setError('');
    trackAction(
      settleMemoryCall(
        window.betterwork.workspace.memoryBrief(input),
        '工作空间简报读取失败，请重试。',
      ).then((outcome) => {
        if (guard.current.request !== requestId || guard.current.key !== key) return;
        setLoading(false);
        if (outcome.ok) {
          setBrief(outcome.data);
          setLoadedFor(key);
          setError('');
        } else {
          // 失败时清空：留着别的空间或上一次的简报会被当成现状（契约 §10）。
          setBrief(undefined);
          setLoadedFor(undefined);
          setError(outcome.message);
        }
      }),
      '读取工作空间简报',
    );
  }, [expertId, key, workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  return { brief, loading, error, loadedFor, refresh: load };
}
