// @vitest-environment jsdom

import type {
  McpConnectionSummary,
  McpToolBinding,
  McpToolSummary,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpToolBindingsPicker } from './McpToolBindingsPicker';

const tool = (connectionId: string, id: string, description = ''): McpToolSummary => ({
  id,
  connectionId,
  name: `${id} 工具`,
  description,
  inputSchema: {},
  schemaHash: 'sha256:0000',
  discoveredAt: 0,
});

const connection = (
  id: string,
  name: string,
  tools: McpToolSummary[],
  status: McpConnectionSummary['status'] = 'ready',
): McpConnectionSummary => ({
  id,
  name,
  transport: { kind: 'stdio', command: 'node', args: [] },
  status,
  tools,
  createdAt: 0,
  updatedAt: 0,
});

const binding = (connectionId: string, toolId: string): McpToolBinding => ({
  connectionId,
  toolId,
});

afterEach(() => {
  cleanup();
});

describe('McpToolBindingsPicker', () => {
  it('没有连接时给那句引导，而不是一个空列表', () => {
    const { container } = render(
      <McpToolBindingsPicker connections={[]} bindings={[]} onChange={vi.fn()} />,
    );

    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('.empty-notice')?.textContent).toContain('请先在设置');
  });

  it('每组连接是一个分段：连接名 ＋ 它自己的工具勾选组', () => {
    const { container } = render(
      <McpToolBindingsPicker
        connections={[
          connection('a', '内部数据服务', [tool('a', 'monthly_summary')]),
          connection('b', '工单系统', [tool('b', 'list_tickets')]),
        ]}
        bindings={[]}
        onChange={vi.fn()}
      />,
    );

    const groups = container.querySelectorAll('.mcp-binding-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelector('strong')?.textContent).toBe('内部数据服务');
    expect(container.querySelectorAll('.check-list')).toHaveLength(2);
  });

  it('勾选组按连接命名，读屏时不会只剩一串「未勾选」', () => {
    const { container } = render(
      <McpToolBindingsPicker
        connections={[connection('a', '内部数据服务', [tool('a', 'monthly_summary')])]}
        bindings={[]}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('.check-list')?.getAttribute('aria-label')).toBe(
      '内部数据服务 的工具',
    );
  });

  it('已绑定的项显示为勾选，点未绑定的项把它加进来', () => {
    const onChange = vi.fn();
    const { container } = render(
      <McpToolBindingsPicker
        connections={[
          connection('a', '内部数据服务', [tool('a', 'one'), tool('a', 'two', '只有描述')]),
        ]}
        bindings={[binding('a', 'one')]}
        onChange={onChange}
      />,
    );

    const inputs = container.querySelectorAll('input');
    expect((inputs[0] as HTMLInputElement).checked).toBe(true);
    expect((inputs[1] as HTMLInputElement).checked).toBe(false);
    expect(inputs[1]?.getAttribute('title')).toBe('只有描述');
    fireEvent.click(inputs[1] as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith([binding('a', 'one'), binding('a', 'two')]);
  });

  it('连接失效时未绑定的工具不可勾选，但已有绑定仍可取消', () => {
    const { container } = render(
      <McpToolBindingsPicker
        connections={[
          connection('a', '内部数据服务', [tool('a', 'one'), tool('a', 'two')], 'failed'),
        ]}
        bindings={[binding('a', 'one')]}
        onChange={vi.fn()}
      />,
    );

    const inputs = container.querySelectorAll('input');
    expect((inputs[0] as HTMLInputElement).disabled).toBe(false);
    expect((inputs[1] as HTMLInputElement).disabled).toBe(true);
  });

  it('检测不到工具的连接说清楚，不渲染零个复选框', () => {
    const { container } = render(
      <McpToolBindingsPicker
        connections={[connection('a', '内部数据服务', [])]}
        bindings={[]}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('.mcp-binding-group')?.textContent).toContain('尚未检测到工具');
  });
});
