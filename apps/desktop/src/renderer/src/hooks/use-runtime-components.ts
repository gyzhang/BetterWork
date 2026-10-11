import type {
  ManagedDistributionSummary,
  ManagedNodeRuntimeSummary,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface RuntimeComponentsState {
  distributions: ManagedDistributionSummary[];
  nodeRuntime: ManagedNodeRuntimeSummary | undefined;
  loading: boolean;
  error: string;
  refresh: () => void;
}

/** 应用级运行时清单由设置分区读取；Renderer 视图只消费状态和动作。 */
export function useRuntimeComponents(): RuntimeComponentsState {
  const [distributions, setDistributions] = useState<ManagedDistributionSummary[]>([]);
  const [nodeRuntime, setNodeRuntime] = useState<ManagedNodeRuntimeSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback((): void => {
    setLoading(true);
    setError('');
    trackAction(
      window.betterwork.dependencies
        .listOptions({ includeNodeRuntime: true })
        .then((options) => {
          setDistributions(
            options.distributions.filter(
              (distribution) =>
                distribution.platform.os === 'darwin' && distribution.platform.arch === 'arm64',
            ),
          );
          setNodeRuntime(options.nodeRuntime);
        })
        .catch((failure: unknown) => {
          setError(describeActionError(failure, '读取受管运行时状态失败。'));
        })
        .finally(() => setLoading(false)),
      '检查受管运行时状态',
    );
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { distributions, nodeRuntime, loading, error, refresh };
}
