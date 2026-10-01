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
    const { container } = render(<IconButton size="md" label="关闭" icon={CloseIcon} />);

    const button = container.querySelector('button.icon-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('关闭');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('三档命中区各自决定字形，档位是必填属性', () => {
    // `sm` 与 `row` 是 CSS 里各有覆写的一档，`md` 是没有覆写的那一档（基座 28px）。
    // 缺省会替调用点选档，同排里就可能一颗写 `sm`、一颗隐式 `md`；
    // 这里同时补上此前没有用例的 `row`（侧栏消息铃铛那一档）。
    const { container } = render(
      <>
        <IconButton size="sm" label="关闭提示" icon={CloseIcon} />
        <IconButton size="md" label="关闭" icon={CloseIcon} />
        <IconButton size="row" label="消息中心" icon={CloseIcon} />
      </>,
    );

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.dataset['size'])).toEqual(['sm', 'md', 'row']);
    expect(buttons.map((button) => button.querySelector('svg')?.getAttribute('width'))).toEqual([
      '12',
      '14',
      '16',
    ]);
  });

  it('折叠触发器把展开状态带给读屏，未给时不写这个属性', () => {
    const { container } = render(
      <>
        <IconButton size="md" label="收起导航" icon={ChevronLeftIcon} expanded={false} />
        <IconButton size="sm" label="关闭" icon={CloseIcon} />
      </>,
    );

    const [toggle, plain] = [...container.querySelectorAll('button')];
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(plain?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('禁用与点击都落在按钮本身', () => {
    const onClick = vi.fn();
    const { container } = render(
      <IconButton size="md" label="关闭" icon={CloseIcon} onClick={onClick} />,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    const { container: disabledBox } = render(
      <IconButton size="md" label="关闭" icon={CloseIcon} disabled onClick={onClick} />,
    );
    expect((disabledBox.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('领域钩子只带定位，不带方块几何', () => {
    const { container } = render(
      <IconButton
        size="md"
        className="sidebar-collapse-button"
        label="收起导航"
        icon={ChevronLeftIcon}
      />,
    );

    const button = container.querySelector('button') as HTMLElement;
    expect(button.className).toBe('icon-button sidebar-collapse-button');
  });
});
