// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChevronLeftIcon, CloseIcon } from '../icons';
import { IconButton } from './IconButton';

afterEach(() => {
  cleanup();
});

describe('IconButton 基座', () => {
  it('图标按钮必须带可及名称，且图标本身对读屏隐藏', () => {
    const { container } = render(<IconButton label="关闭" icon={CloseIcon} />);

    const button = container.querySelector('button.icon-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('关闭');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('两档尺寸各自决定方块与字形，页面不再逐处写 size', () => {
    const { container } = render(
      <>
        <IconButton label="关闭提示" icon={CloseIcon} size="sm" />
        <IconButton label="关闭" icon={CloseIcon} />
      </>,
    );

    const [sm, md] = [...container.querySelectorAll('button')];
    expect((sm as HTMLElement).dataset['size']).toBe('sm');
    expect(sm?.querySelector('svg')?.getAttribute('width')).toBe('12');
    expect(md?.querySelector('svg')?.getAttribute('width')).toBe('14');
  });

  it('折叠触发器把展开状态带给读屏，未给时不写这个属性', () => {
    const { container } = render(
      <>
        <IconButton label="收起导航" icon={ChevronLeftIcon} expanded={false} />
        <IconButton label="关闭" icon={CloseIcon} />
      </>,
    );

    const [toggle, plain] = [...container.querySelectorAll('button')];
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(plain?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('禁用与点击都落在按钮本身', () => {
    const onClick = vi.fn();
    const { container } = render(<IconButton label="关闭" icon={CloseIcon} onClick={onClick} />);
    const button = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    const { container: disabledBox } = render(
      <IconButton label="关闭" icon={CloseIcon} disabled onClick={onClick} />,
    );
    expect((disabledBox.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('领域钩子只带定位，不带方块几何', () => {
    const { container } = render(
      <IconButton className="sidebar-collapse-button" label="收起导航" icon={ChevronLeftIcon} />,
    );

    const button = container.querySelector('button') as HTMLElement;
    expect(button.className).toBe('icon-button sidebar-collapse-button');
  });
});
