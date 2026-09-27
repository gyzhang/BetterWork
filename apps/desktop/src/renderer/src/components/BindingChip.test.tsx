// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BindingChip, BindingChipBar } from './BindingChip';

afterEach(() => {
  cleanup();
});

describe('BindingChip 基座', () => {
  it('名称同时是悬停标题，移除按钮带得出可及名称', () => {
    const { container } = render(<BindingChip name="知识库检索" onRemove={vi.fn()} />);

    expect(container.querySelector('.binding-chip-label')?.getAttribute('title')).toBe(
      '知识库检索',
    );
    const remove = container.querySelector('button') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('移除 知识库检索');
  });

  it('跨语义时移除按钮用整句名称（材料片那种「移除材料 X」）', () => {
    const { container } = render(
      <BindingChip name="报价表.xlsx" removeLabel="移除材料 报价表.xlsx" onRemove={vi.fn()} />,
    );

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      '移除材料 报价表.xlsx',
    );
  });

  it('身份与失效只换 tone 档位，外壳几何是同一份', () => {
    const { container, rerender } = render(<BindingChip name="行业专家" onRemove={vi.fn()} />);
    expect(container.querySelector('.binding-chip')?.getAttribute('data-tone')).toBe('default');

    rerender(<BindingChip name="行业专家" tone="brand" onRemove={vi.fn()} />);
    expect(container.querySelector('.binding-chip')?.getAttribute('data-tone')).toBe('brand');

    rerender(<BindingChip name="报价表.xlsx" tone="danger" onRemove={vi.fn()} />);
    expect(container.querySelector('.binding-chip')?.getAttribute('data-tone')).toBe('danger');
  });

  it('内联控件排在名称与移除按钮之间，点移除只回调 onRemove', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <BindingChip name="报价表.xlsx" onRemove={onRemove}>
        <span>作参考</span>
      </BindingChip>,
    );

    const chip = container.querySelector('.binding-chip') as HTMLElement;
    const order = [...chip.children].map((child) => child.className);
    expect(order).toEqual(['binding-chip-label', '', 'binding-chip-remove']);
    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('禁用时移除按钮不可点（运行中不许改绑定）', () => {
    const { container } = render(<BindingChip name="知识库检索" disabled onRemove={vi.fn()} />);

    expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('片条带 list 语义与区域名称，让「当前绑定了哪几样」可读', () => {
    const { container } = render(
      <BindingChipBar label="已选能力">
        <BindingChip name="知识库检索" onRemove={vi.fn()} />
      </BindingChipBar>,
    );

    const bar = container.querySelector('.binding-chip-bar') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('list');
    expect(bar.getAttribute('aria-label')).toBe('已选能力');
    expect(container.querySelector('.binding-chip')?.getAttribute('role')).toBe('listitem');
  });
});
