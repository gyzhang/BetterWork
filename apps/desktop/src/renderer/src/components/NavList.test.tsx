// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  vi.useRealTimers();
});

/** jsdom 不做排版，能不能装下只能靠伪造滚动盒尺寸来表达（同 Tooltip 的用例口径）。 */
const makeClipped = (element: HTMLElement, clipped: boolean): void => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: clipped ? 60 : 20 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 20 });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: clipped ? 320 : 120 });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 120 });
};

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

/**
 * 侧栏与上下文面板都是定宽列：名称放不下时只能收短，不能横向滚出去。
 * 收短必须就地读得回全文，否则用户看到的是「文字被砍断」而不是「名字长」。
 */
describe('导航行名称的截断补全', () => {
  const LONG_NAME = 'betterwork-e55-two-periods-and-a-fairly-long-workspace-name';

  it('名称被裁掉时悬停读出全文，且全文一直留在锚点里', () => {
    vi.useFakeTimers();
    const { container } = render(<NavItem label={LONG_NAME} onClick={vi.fn()} />);
    const label = container.querySelector('.nav-item-label') as HTMLElement;
    expect(label.classList.contains('tooltip-anchor')).toBe(true);
    makeClipped(label, true);

    fireEvent.mouseEnter(label);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const tip = screen.queryByRole('tooltip', { hidden: true });
    expect(tip?.textContent).toBe(LONG_NAME);
    expect(tip?.getAttribute('aria-hidden')).toBe('true');
  });

  it('放得下就什么都不弹——每行悬停都弹一句全文读起来像控件坏了', () => {
    vi.useFakeTimers();
    const { container } = render(<NavItem label="工作" onClick={vi.fn()} />);
    const label = container.querySelector('.nav-item-label') as HTMLElement;
    makeClipped(label, false);

    fireEvent.mouseEnter(label);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });
});
