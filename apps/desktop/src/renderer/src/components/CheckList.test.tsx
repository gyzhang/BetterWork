// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckList, type CheckOption } from './CheckList';

const OPTIONS: readonly CheckOption<string>[] = [
  { id: 'a', label: '资料检索', checked: true },
  { id: 'b', label: '网页正文', checked: false },
  { id: 'c', label: '远程 MCP', checked: false, disabled: true, hint: '尚未检测' },
];

afterEach(() => {
  cleanup();
});

describe('CheckList 基座', () => {
  it('每项是 label 包住原生复选框，点文字也能勾选', () => {
    const onToggle = vi.fn();
    const { container } = render(<CheckList label="能力" options={OPTIONS} onToggle={onToggle} />);

    const items = container.querySelectorAll('label.check-list-item');
    expect(items).toHaveLength(3);
    fireEvent.click(items[1] as HTMLLabelElement);
    expect(onToggle).toHaveBeenCalledWith('b', true);
  });

  it('给了 label 才有 group 语义；在 fieldset 里就不另包一层', () => {
    const { container } = render(<CheckList options={OPTIONS} onToggle={vi.fn()} />);

    const list = container.querySelector('.check-list') as HTMLElement;
    expect(list.hasAttribute('role')).toBe(false);
    expect(list.hasAttribute('aria-label')).toBe(false);
  });

  it('禁用项保留禁用，说明走原生 title 兜底', () => {
    const { container } = render(<CheckList options={OPTIONS} onToggle={vi.fn()} />);

    const inputs = container.querySelectorAll('input');
    expect((inputs[2] as HTMLInputElement).disabled).toBe(true);
    expect((inputs[0] as HTMLInputElement).hasAttribute('title')).toBe(false);
    expect(inputs[2]?.getAttribute('title')).toBe('尚未检测');
  });

  it('空列表不渲染零个复选框，而是那句说明', () => {
    const { container } = render(
      <CheckList options={[]} empty={<span>还没有可配置的 Skill。</span>} onToggle={vi.fn()} />,
    );

    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('.check-list')?.textContent).toBe('还没有可配置的 Skill。');
  });
});
