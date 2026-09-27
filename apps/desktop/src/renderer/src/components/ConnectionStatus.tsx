import type { McpConnectionStatus, ModelConnectionStatus } from '@betterwork/agent-protocol';

import { Badge, type BadgeTone } from './Badge';

/**
 * 连接状态片的唯一映射。
 *
 * 「连接成功／失败／尚未验证」此前是设置页里三条 `<span className={...}>`：
 * 类名带领域色（`.connection-status.connected { color: var(--success) }`），
 * 但既不是 `Badge` 也不是 Token 档位——同一个「失败」在模型行、Web 搜索小节与
 * MCP 列表里各自裸着写字色（docs/reviews/2026-09-27-ui-reuse-audit.md §4.3 P6、§10.2 欠账）。
 * 两种状态枚举共用一张档位表，文案仍由各领域自己给（MCP 说「可用」，模型说「连接成功」）。
 */
const CONNECTION_TONE: Record<ModelConnectionStatus | McpConnectionStatus, BadgeTone> = {
  connected: 'success',
  ready: 'success',
  connecting: 'brand',
  failed: 'danger',
  disconnected: 'neutral',
  unconfigured: 'outline',
  untested: 'outline',
};

export function ConnectionStatus({
  status,
  label,
}: {
  status: ModelConnectionStatus | McpConnectionStatus;
  /** 领域文案：模型档位说「连接成功」，MCP 连接说「可用」。 */
  label: string;
}): React.JSX.Element {
  return (
    <Badge shape="tag" tone={CONNECTION_TONE[status]}>
      {label}
    </Badge>
  );
}
