// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

afterEach(() => {
  cleanup();
});

describe('Switch 基座', () => {
  it('是一个 role=switch 的按钮，状态走 aria-checked 而不是文案', () => {
    const { container, rerender } = render(
      <Switch label="语义检索" checked={false} onChange={vi.fn()} />,
    );

    const button = container.querySelector('button.switch') as HTMLButtonElement;
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(button.textContent).toBe('语义检索');

    rerender(<Switch label="语义检索" checked onChange={vi.fn()} />);
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.textContent).toBe('语义检索');
  });

  it('点击把取反后的值交给页面，名称不变', () => {
    const onChange = vi.fn();
    const { container } = render(<Switch label="自动提炼建议" checked onChange={onChange} />);

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('禁用时既不可点，也保持可读的名称', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Switch label="启用" checked={false} onChange={onChange} disabled />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
    expect(button.textContent).toBe('启用');
  });

  it('轨道与滑块是装饰，不进可及名称', () => {
    const { container } = render(<Switch label="受信任" checked={false} onChange={vi.fn()} />);

    expect(container.querySelector('.switch-track')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });
});
