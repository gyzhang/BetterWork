import type { McpConnectionSummary, McpToolBinding } from '@betterwork/agent-protocol';

import { canToggleMcpTool, hasMcpToolBinding, setMcpToolBinding } from '../lib/mcp-selection';
import { CheckList } from './CheckList';
import { Disclosure } from './Disclosure';
import { EmptyNotice } from './EmptyState';

const canAddMcpTool = (
  connection: McpConnectionSummary,
  tool: McpConnectionSummary['tools'][number],
): boolean =>
  canToggleMcpTool(connection.status, false) &&
  connection.lifecycle === 'enabled' &&
  tool.reviewed === true &&
  Boolean(tool.contractHash) &&
  connection.stale !== true;

/**
 * 「按连接分组的 MCP 工具勾选」的唯一结构。
 *
 * 上下文面板与专家编辑页此前各写一遍这段 JSX，而且两边**逐字相同**：
 * 同一组 `hasMcpToolBinding`／`canToggleMcpTool`／`setMcpToolBinding` 调用，
 * 同一个「尚未检测到工具」兜底，连「没有连接」时的提示也只是差两个字。
 * 审计 §4.5 记的是更糟的一半：专家页还直接借走了上下文面板的
 * `.selected-mcp-list`／`.selected-mcp-connection` 两个带领域名的类——
 * 改一处外观会炸到另一个页面。现在结构与文案都只住在这里。
 *
 * 分组标签用 `<strong>` 而不是 `SectionHeader`：这里没有小节标题的层级语义，
 * 一组连接只是勾选列表的一个分段；空态按 docs/10 §10.1 走 `EmptyNotice`。
 */
export function McpToolBindingsPicker({
  connections,
  bindings,
  onChange,
}: {
  connections: readonly McpConnectionSummary[];
  bindings: readonly McpToolBinding[];
  onChange: (bindings: McpToolBinding[]) => void;
}): React.JSX.Element {
  if (connections.length === 0) return <EmptyNotice title="请先在设置 → MCP 中配置并检测连接。" />;
  return (
    <div className="mcp-binding-picker">
      {connections.map((connection) => {
        const selected = (toolId: string): boolean =>
          hasMcpToolBinding(bindings, connection.id, toolId);
        const selectableTools = connection.tools.filter(
          (tool) => selected(tool.id) || canAddMcpTool(connection, tool),
        );
        const selectedCount = selectableTools.filter((tool) => selected(tool.id)).length;
        const allSelectableToolsSelected =
          selectableTools.length > 0 && selectedCount === selectableTools.length;

        return (
          <div className="mcp-binding-group" key={connection.id}>
            <div className="mcp-binding-group-header">
              <strong>{connection.name}</strong>
              {connection.tools.length > 0 ? (
                <CheckList
                  className="mcp-binding-select-all"
                  label={`${connection.name} 的工具选择`}
                  options={[
                    {
                      id: 'all-tools',
                      label: '全部工具',
                      checked: allSelectableToolsSelected,
                      indeterminate: selectedCount > 0 && !allSelectableToolsSelected,
                      disabled: selectableTools.length === 0,
                    },
                  ]}
                  onToggle={(_, checked) => {
                    if (!checked) {
                      onChange(
                        bindings.filter((binding) => binding.connectionId !== connection.id),
                      );
                      return;
                    }
                    const nextBindings = connection.tools.reduce<McpToolBinding[]>(
                      (currentBindings, tool) => {
                        if (selected(tool.id) || !canAddMcpTool(connection, tool)) {
                          return currentBindings;
                        }
                        return setMcpToolBinding(
                          currentBindings,
                          connection.id,
                          tool.id,
                          true,
                          connection.revisionId,
                          tool.contractHash,
                        );
                      },
                      [...bindings],
                    );
                    onChange(nextBindings);
                  }}
                />
              ) : null}
            </div>
            {connection.tools.length === 0 ? (
              <EmptyNotice title="尚未检测到工具" />
            ) : (
              <Disclosure label={`工具列表（${connection.tools.length}）`}>
                <CheckList
                  label={`${connection.name} 的工具`}
                  options={connection.tools.map((tool) => {
                    const checked = selected(tool.id);
                    return {
                      id: tool.id,
                      label: tool.name,
                      checked,
                      disabled: !checked && !canAddMcpTool(connection, tool),
                      ...(tool.description ? { hint: tool.description } : {}),
                    };
                  })}
                  onToggle={(toolId, checked) =>
                    onChange(
                      setMcpToolBinding(
                        bindings,
                        connection.id,
                        toolId,
                        checked,
                        connection.revisionId,
                        connection.tools.find((tool) => tool.id === toolId)?.contractHash,
                      ),
                    )
                  }
                />
              </Disclosure>
            )}
          </div>
        );
      })}
    </div>
  );
}
