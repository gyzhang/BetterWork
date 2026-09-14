import type {
  ExpertDetail,
  ExpertLifecycle,
  ExpertMutationResult,
  ExpertRevisionDraft,
  ExpertSummary,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { trackAction } from '../lib/async-action';

export interface ExpertsState {
  experts: ExpertSummary[];
  loading: boolean;
  error: string;
  refresh: () => void;
  get: (id: string) => Promise<ExpertDetail | null>;
  create: (draft: ExpertRevisionDraft) => Promise<ExpertMutationResult>;
  saveRevision: (input: {
    expertId: string;
    expectedRevision: number;
    revision: ExpertRevisionDraft;
  }) => Promise<ExpertMutationResult>;
  copy: (expertId: string) => Promise<ExpertMutationResult>;
  setLifecycle: (input: {
    expertId: string;
    lifecycle: ExpertLifecycle;
    expectedRevision: number;
  }) => Promise<ExpertMutationResult>;
}

export function useExperts(): ExpertsState {
  const [experts, setExperts] = useState<ExpertSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback((): void => {
    setLoading(true);
    trackAction(
      window.betterwork.experts.list().then((items) => {
        setExperts(items);
        setError('');
        setLoading(false);
      }),
      '刷新专家列表',
    );
  }, []);

  useEffect(() => refresh(), [refresh]);

  const get = useCallback((id: string): Promise<ExpertDetail | null> => {
    return window.betterwork.experts.get({ id });
  }, []);
  const create = useCallback((draft: ExpertRevisionDraft): Promise<ExpertMutationResult> => {
    return window.betterwork.experts.create(draft);
  }, []);
  const saveRevision = useCallback(
    (input: {
      expertId: string;
      expectedRevision: number;
      revision: ExpertRevisionDraft;
    }): Promise<ExpertMutationResult> => window.betterwork.experts.saveRevision(input),
    [],
  );
  const copy = useCallback(
    (expertId: string): Promise<ExpertMutationResult> =>
      window.betterwork.experts.copy({ expertId }),
    [],
  );
  const setLifecycle = useCallback(
    (input: {
      expertId: string;
      lifecycle: ExpertLifecycle;
      expectedRevision: number;
    }): Promise<ExpertMutationResult> => window.betterwork.experts.setLifecycle(input),
    [],
  );

  return { experts, loading, error, refresh, get, create, saveRevision, copy, setLifecycle };
}
