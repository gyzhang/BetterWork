import type { ExpertSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { trackAction } from '../lib/async-action';

export interface ExpertsState {
  experts: ExpertSummary[];
  loading: boolean;
  error: string;
  refresh: () => void;
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

  return { experts, loading, error, refresh };
}
