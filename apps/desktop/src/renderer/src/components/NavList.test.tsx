// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsIcon, WorkIcon } from '../icons';
import { type NavEntry, NavItem, NavList } from './NavList';

type View = 'work' | 'settings';

const ITEMS: readonly NavEntry<View>[] = [
  { id: 'work', label: '工作', icon: WorkIcon },
  { id: 'settings', label: '设置', icon: SettingsIcon },
];

afterEach(() => {
  cleanup();
});

describe('NavList 基座', () => {
  it('列表是带名称的导航区域，当前项同时给 aria-current 与 data-selected', () => {
    const { container } = render(
      <NavList label="主要导航" items={ITEMS} value="work" onSelect={vi.fn()} />,
    );

    const nav = container.querySelector('nav.nav-list') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe('主要导航');
    expect(nav.dataset['variant']).toBe('sidebar');
    const [first, second] = [...nav.querySelectorAll('button')];
    expect(first?.getAttribute('aria-current')).toBe('true');
    expect(first?.dataset['selected']).toBe('true');
    expect(second?.hasAttribute('aria-current')).toBe(false);
    expect(second?.dataset['selected']).toBeUndefined();
  });

  it('点击将 id 交给受控父组件，而不是自己记住选中', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <NavList label="设置分区" variant="panel" items={ITEMS} value="work" onSelect={onSelect} />,
    );

    fireEvent.click(container.querySelectorAll('button')[1] as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledWith('settings');
    expect(container.querySelector('nav')?.dataset['variant']).toBe('panel');
  });

  it('窄栏折叠不换一套几何，只切自定义属性，文字仍留在可及名称里', () => {
    const { container } = render(
      <NavList rail label="主要导航" items={ITEMS} value="work" onSelect={vi.fn()} />,
    );

    const nav = container.querySelector('nav') as HTMLElement;
    expect(nav.dataset['rail']).toBe('true');
    const button = nav.querySelector('button') as HTMLButtonElement;
    expect(button.dataset['rail']).toBe('true');
    // 名称来自 DOM 里的文字：折叠只是视觉收拢，不能把它从可及名称里删掉。
    expect(button.textContent).toContain('工作');
  });

  it('图标对读屏隐藏，装饰性 `<span>` 不带 aria-hidden 之外的语义', () => {
    const { container } = render(
      <NavList label="主要导航" items={ITEMS} value="work" onSelect={vi.fn()} />,
    );

    const mark = container.querySelector('.nav-item-icon') as HTMLElement;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelector('svg')).toBeTruthy();
  });

  it('单颗导航行用 NavItem：选中与禁用都由属性表达', () => {
    const onClick = vi.fn();
    const { container } = render(
      <NavItem label="设置" icon={SettingsIcon} selected disabled onClick={onClick} />,
    );

    const button = container.querySelector('button.nav-item') as HTMLButtonElement;
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(button.disabled).toBe(true);
  });
});
