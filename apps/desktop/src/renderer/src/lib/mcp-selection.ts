import type { McpConnectionStatus, McpToolBinding } from '@betterwork/agent-protocol';

/** 失效连接不能新增工具，但已有绑定必须仍可取消，避免配置被锁死。 */
export const canToggleMcpTool = (status: McpConnectionStatus, checked: boolean): boolean =>
  status === 'ready' || checked;

export const hasMcpToolBinding = (
  bindings: McpToolBinding[],
  connectionId: string,
  toolId: string,
): boolean =>
  bindings.some((binding) => binding.connectionId === connectionId && binding.toolId === toolId);

export const setMcpToolBinding = (
  bindings: McpToolBinding[],
  connectionId: string,
  toolId: string,
  checked: boolean,
): McpToolBinding[] => {
  if (checked) {
    if (hasMcpToolBinding(bindings, connectionId, toolId)) return bindings;
    return [...bindings, { connectionId, toolId }];
  }
  return bindings.filter(
    (binding) => binding.connectionId !== connectionId || binding.toolId !== toolId,
  );
};
