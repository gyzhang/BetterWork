import type { McpConnectionStatus } from '@betterwork/agent-protocol';

/** 失效连接不能新增工具，但已有绑定必须仍可取消，避免配置被锁死。 */
export const canToggleMcpTool = (status: McpConnectionStatus, checked: boolean): boolean =>
  status === 'ready' || checked;
