// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListRow } from './ListRow';

afterEach(() => {
  cleanup();
});

describe('ListRow 基座', () => {
  it('行内文字一律落进主区插槽，页面拿不到裸节点', () => {
    const { container } = render(
      <ListRow
        leading={<span aria-hidden="true">MD</span>}
        title="季度复盘"
        detail="按回款口径统计"
        meta="更新于 3 天前"
        trailing={<span aria-hidden="true">·</span>}
      />,
    );

    expect(container.querySelector('.list-row-leading')).toBeTruthy();
    expect(container.querySelector('.list-row-title')?.textContent).toBe('季度复盘');
    expect(container.querySelector('.list-row-detail')?.textContent).toBe('按回款口径统计');
    expect(container.querySelector('.list-row-meta')?.textContent).toBe('更新于 3 天前');
    expect(container.querySelector('.list-row-trailing')).toBeTruthy();
  });

  it('children 接在主区三行之后，供结构特殊的行展开', () => {
    const { container } = render(
      <ListRow title="连接名称">
        <div className="mcp-tool-summary">3 个工具</div>
      </ListRow>,
    );

    const main = container.querySelector('.list-row-main') as HTMLElement;
    expect(main.querySelector('.list-row-title')).toBeTruthy();
    expect(main.querySelector('.mcp-tool-summary')).toBeTruthy();
  });

  it('给出 onClick 时整行是一个带名称的按钮，选中态走 aria-current', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ListRow label="查看成果「周报复盘」" onClick={onClick} selected />,
    );

    const row = container.querySelector('button.list-row') as HTMLButtonElement;
    expect(row.getAttribute('aria-label')).toBe('查看成果「周报复盘」');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.dataset['variant']).toBe('divider');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('禁用：可点行交给 disabled，静态行交给 data-disabled', () => {
    const { container } = render(
      <>
        <ListRow title="已停用" onClick={vi.fn()} disabled />
        <ListRow as="li" title="已归档" disabled />
      </>,
    );

    const button = container.querySelector('button.list-row') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect((container.querySelector('li.list-row') as HTMLElement).dataset['disabled']).toBe(
      'true',
    );
  });

  it('非交互行按 as 决定语义容器，并保留页面那一个领域钩子类', () => {
    const { container } = render(
      <ListRow as="li" className="memory-row memory-candidate" tone="muted" title="口径" />,
    );

    const row = container.querySelector('li.list-row') as HTMLElement;
    expect(row.className).toBe('list-row memory-row memory-candidate');
    expect(row.dataset['tone']).toBe('muted');
  });

  it('卡片与裸行只差一个 data-variant，几何差异不落到页面身上', () => {
    const { container } = render(<ListRow as="article" variant="card" title="技能" />);

    const row = container.querySelector('article.list-row') as HTMLElement;
    expect(row.dataset['variant']).toBe('card');
  });
});
