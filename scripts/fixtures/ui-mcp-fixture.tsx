import type { McpConnectionSummary } from '@betterwork/agent-protocol';

import { NavList } from '../../apps/desktop/src/renderer/src/components/NavList';
import type { McpConnectionsState } from '../../apps/desktop/src/renderer/src/hooks/use-mcp-connections';
import { McpSettings } from '../../apps/desktop/src/renderer/src/views/McpSettings';

const connection: McpConnectionSummary = {
  id: 'mcp-fixture',
  name: '合同核对与经营资料 / Contract Review MCP',
  revisionId: 'mcp-fixture-r1',
  revision: 1,
  lifecycle: 'disabled',
  status: 'unconfigured',
  tools: [],
  createdAt: 1,
  updatedAt: 1,
  transport: {
    kind: 'streamable-http',
    endpoint: 'https://mcp.synthetic.invalid/mcp',
    networkMode: 'public',
    networkApproved: false,
    authentication: { mode: 'oauth' },
  },
};
const state: McpConnectionsState = {
  connections: [connection],
  loading: false,
  error: '',
  refresh: () => {},
  save: async () => {
    throw new Error('合成配置冲突，请保留草稿并重试。');
  },
  remove: async () => ({ deleted: true }),
  test: async () => ({ connection, tools: [] }),
  setLifecycle: async () => ({ connection }),
  reviewTool: async () => ({ connection }),
  cancel: async () => ({ cancelled: true }),
  prepareLogin: async (_id, operationId) => ({
    operationId,
    resource: 'https://mcp.synthetic.invalid/mcp',
    issuers: ['https://login.synthetic.invalid'],
    scopes: ['report.read', 'contract.read'],
  }),
  continueLogin: async () => {
    throw new Error('合成授权失败，请重新登录。');
  },
  logout: async () => ({ connection }),
};
export function McpScenario(): React.JSX.Element {
  return (
    <div className="settings-layout">
      <aside className="settings-nav-list">
        <NavList
          label="设置分区"
          items={[{ id: 'mcp', label: 'MCP' }]}
          value="mcp"
          variant="panel"
          onSelect={() => {}}
        />
      </aside>
      <div className="settings-content">
        <McpSettings state={state} />
      </div>
    </div>
  );
}
export const mcpSteps = [
  'mcp-list',
  'mcp-editor',
  'mcp-http',
  'mcp-secret',
  'mcp-failed-save',
  'mcp-return',
  'mcp-consent',
  'mcp-failed-login',
  'mcp-menu',
];
