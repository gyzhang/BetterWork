// @vitest-environment jsdom

import type {
  McpConnectionSummary,
  McpToolBinding,
  McpToolSummary,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpToolBindingsPicker } from './McpToolBindingsPicker';

const contractHash = 'a'.repeat(64);

const tool = (connectionId: string, id: string, description = ''): McpToolSummary => ({
  id,
  connectionId,
  name: `${id} 工具`,
  description,
  inputSchema: {},
  schemaHash: 'sha256:0000',
  contractHash,
  reviewed: true,
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
  lifecycle: 'enabled',
  tools,
  createdAt: 0,
  updatedAt: 0,
});

const binding = (connectionId: string, toolId: string): McpToolBinding => ({
  connectionId,
  toolId,
  contractHash,
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

  it('每组连接提供全选框，并把工具列表默认折叠', () => {
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
    expect(container.querySelectorAll('.mcp-binding-select-all')).toHaveLength(2);
    expect(container.querySelectorAll('.mcp-binding-group .disclosure')).toHaveLength(2);
    expect(container.querySelectorAll('.mcp-binding-group .disclosure[open]')).toHaveLength(0);

    const disclosure = container.querySelector('.mcp-binding-group .disclosure');
    const summary = disclosure?.querySelector('summary');
    expect(summary?.textContent).toContain('工具列表（1）');
    if (summary) fireEvent.click(summary);
    expect(disclosure?.hasAttribute('open')).toBe(true);
  });

  it('勾选组按连接命名，读屏时不会只剩一串「未勾选」', () => {
    const { container } = render(
      <McpToolBindingsPicker
        connections={[connection('a', '内部数据服务', [tool('a', 'monthly_summary')])]}
        bindings={[]}
        onChange={vi.fn()}
      />,
    );

    expect(
      container
        .querySelector('.check-list[aria-label="内部数据服务 的工具"]')
        ?.getAttribute('aria-label'),
    ).toBe('内部数据服务 的工具');
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

    const inputs =
      container
        .querySelector('.check-list[aria-label="内部数据服务 的工具"]')
        ?.querySelectorAll('input') ?? [];
    expect((inputs[0] as HTMLInputElement).checked).toBe(true);
    expect((inputs[1] as HTMLInputElement).checked).toBe(false);
    expect(inputs[1]?.getAttribute('title')).toBe('只有描述');
    fireEvent.click(inputs[1] as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith([binding('a', 'one'), binding('a', 'two')]);
  });

  it('全部工具展示半选状态，可一次绑定并清除该连接的工具', () => {
    const onChange = vi.fn();
    const connections = [connection('a', '内部数据服务', [tool('a', 'one'), tool('a', 'two')])];
    const { container, rerender } = render(
      <McpToolBindingsPicker
        connections={connections}
        bindings={[binding('a', 'one')]}
        onChange={onChange}
      />,
    );

    const selectAll = container.querySelector('.mcp-binding-select-all input') as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
    fireEvent.click(selectAll);
    expect(onChange).toHaveBeenCalledWith([binding('a', 'one'), binding('a', 'two')]);

    rerender(
      <McpToolBindingsPicker
        connections={connections}
        bindings={[binding('a', 'one'), binding('a', 'two')]}
        onChange={onChange}
      />,
    );
    const allSelected = container.querySelector(
      '.mcp-binding-select-all input',
    ) as HTMLInputElement;
    expect(allSelected.checked).toBe(true);
    fireEvent.click(allSelected);
    expect(onChange).toHaveBeenLastCalledWith([]);
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

    const inputs =
      container
        .querySelector('.check-list[aria-label="内部数据服务 的工具"]')
        ?.querySelectorAll('input') ?? [];
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
