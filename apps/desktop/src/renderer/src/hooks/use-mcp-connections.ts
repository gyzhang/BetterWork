import type {
  McpConnectionSummary,
  McpLifecycleRequest,
  McpLoginContinueRequest,
  McpMutationResult,
  McpOAuthPreparation,
  McpReviewRequest,
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
  test: (id: string, operationId?: string) => Promise<McpTestResult>;
  setLifecycle: (input: McpLifecycleRequest) => Promise<McpMutationResult>;
  reviewTool: (input: McpReviewRequest) => Promise<McpMutationResult>;
  cancel: (id: string, operationId: string) => Promise<{ cancelled: boolean }>;
  prepareLogin: (id: string, operationId: string) => Promise<McpOAuthPreparation>;
  continueLogin: (input: McpLoginContinueRequest) => Promise<McpTestResult>;
  logout: (id: string) => Promise<McpMutationResult>;
}

export function useMcpConnections(): McpConnectionsState {
  const [connections, setConnections] = useState<McpConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback((): void => {
    setLoading(true);
    setError('');
    trackAction(
      window.betterwork.mcp
        .listConnections()
        .then(setConnections)
        .catch((failure: unknown) =>
          setError(describeActionError(failure, '读取 MCP 连接失败，请重试。')),
        )
        .finally(() => setLoading(false)),
      '刷新 MCP 连接',
    );
  }, []);
  useEffect(() => refresh(), [refresh]);
  const request = (
    id: string,
    operationId: string = crypto.randomUUID(),
  ): { id: string; operationId: string; expectedRevisionId: string } => {
    const connection = connections.find((item) => item.id === id);
    if (!connection?.revisionId) throw new Error('MCP 连接修订不可用，请重新读取。');
    return { id, operationId, expectedRevisionId: connection.revisionId };
  };
  return {
    connections,
    loading,
    error,
    refresh,
    save: (input) => window.betterwork.mcp.saveConnection(input),
    remove: (id) =>
      window.betterwork.mcp.deleteConnection({
        id,
        expectedRevisionId: request(id).expectedRevisionId,
      }),
    test: (id, operationId) => window.betterwork.mcp.testConnection(request(id, operationId)),
    setLifecycle: (input) => window.betterwork.mcp.setLifecycle(input),
    reviewTool: (input) => window.betterwork.mcp.reviewTool(input),
    cancel: (id, operationId) => window.betterwork.mcp.cancelOperation(request(id, operationId)),
    prepareLogin: (id, operationId) => window.betterwork.mcp.prepareLogin(request(id, operationId)),
    continueLogin: (input) => window.betterwork.mcp.continueLogin(input),
    logout: (id) => window.betterwork.mcp.logout(request(id)),
  };
}
