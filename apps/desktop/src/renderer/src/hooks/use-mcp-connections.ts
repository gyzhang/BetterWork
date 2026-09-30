import type {
  McpConnectionSummary,
  McpMutationResult,
  McpTestResult,
  SaveMcpConnectionRequest,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface McpConnectionsState {
  connections: McpConnectionSummary[];
  loading: boolean;
  error: string;
  refresh: () => void;
  save: (input: SaveMcpConnectionRequest) => Promise<McpMutationResult>;
  remove: (id: string) => Promise<{ deleted: boolean }>;
  test: (id: string) => Promise<McpTestResult>;
}

export function useMcpConnections(): McpConnectionsState {
  const [connections, setConnections] = useState<McpConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback((): void => {
    setLoading(true);
    trackAction(
      window.betterwork.mcp
        .listConnections()
        .then(setConnections)
        .catch((failure: unknown) => {
          setError(describeActionError(failure, '读取 MCP 连接失败，请重试。'));
        })
        .finally(() => setLoading(false)),
      '刷新 MCP 连接',
    );
  }, []);
  useEffect(() => refresh(), [refresh]);
  const save = useCallback(
    (input: SaveMcpConnectionRequest): Promise<McpMutationResult> =>
      window.betterwork.mcp.saveConnection(input),
    [],
  );
  const remove = useCallback(
    (id: string): Promise<{ deleted: boolean }> => window.betterwork.mcp.deleteConnection({ id }),
    [],
  );
  const test = useCallback(
    (id: string): Promise<McpTestResult> => window.betterwork.mcp.testConnection({ id }),
    [],
  );
  return { connections, loading, error, refresh, save, remove, test };
}
