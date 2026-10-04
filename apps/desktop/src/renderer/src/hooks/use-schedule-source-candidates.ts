import type { KnowledgeCollection, KnowledgeDocumentSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface ScheduleSourceCandidatesState {
  documents: KnowledgeDocumentSummary[];
  collections: KnowledgeCollection[];
  loading: boolean;
  error: string;
  refresh: () => void;
}

/** 定时配置仅读取知识库元数据；本期具体修订仍由 Main 在准备时固定。 */
export function useScheduleSourceCandidates(active: boolean): ScheduleSourceCandidatesState {
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const refresh = useCallback((): void => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);
    setError('');

    const load = async (): Promise<void> => {
      try {
        const [nextDocuments, nextCollections] = await Promise.all([
          window.betterwork.knowledge.list({ filter: { kind: 'all' } }),
          window.betterwork.knowledge.listCollections(),
        ]);
        if (requestId.current !== currentRequestId) return;
        setDocuments(nextDocuments);
        setCollections(nextCollections);
      } catch (caughtError) {
        if (requestId.current === currentRequestId) {
          setError(describeActionError(caughtError, '读取知识来源失败，请重试。'));
        }
      } finally {
        if (requestId.current === currentRequestId) setLoading(false);
      }
    };

    trackAction(load(), '读取定时任务知识来源');
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    return () => {
      requestId.current += 1;
    };
  }, [active, refresh]);

  return { documents, collections, loading, error, refresh };
}
