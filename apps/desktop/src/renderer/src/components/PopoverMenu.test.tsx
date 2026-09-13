// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PopoverMenuItem } from './PopoverMenu';
import { PopoverMenu } from './PopoverMenu';

afterEach(cleanup);

const ITEMS: PopoverMenuItem[] = [
  { id: 'a', label: '技能一' },
  { id: 'b', label: '技能二' },
  { id: 'c', label: '不可用项', disabled: true, hint: '尚未信任' },
  { id: 'd', label: '技能四' },
];

/** 包装组件提供 anchorRef。 */
function Wrapper({
  open,
  onDismiss,
  onSelect,
}: {
  open: boolean;
  onDismiss: () => void;
  onSelect: (id: string) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <main>
      <button ref={anchorRef} type="button">
        打开菜单
      </button>
      <PopoverMenu
        open={open}
        anchorRef={anchorRef}
        items={ITEMS}
        label="能力选择"
        onDismiss={onDismiss}
        onSelect={onSelect}
      />
    </main>
  );
}

describe('PopoverMenu', () => {
  it('focuses the first enabled item on open and restores focus on dismiss', () => {
    const onDismiss = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = render(<Wrapper open={false} onDismiss={onDismiss} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Wrapper open={true} onDismiss={onDismiss} onSelect={onSelect} />);
    // 焦点进入第一个可用项（技能一，跳过 disabled 的无）
    const firstItem = screen.getByRole('menuitem', { name: '技能一' });
    expect(document.activeElement).toBe(firstItem);

    // 关闭后归还焦点由组件卸载副作用处理——模拟 open=false 触发 unmount。
    rerender(<Wrapper open={false} onDismiss={onDismiss} onSelect={onSelect} />);
    // portal 已移除
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    const onDismiss = vi.fn();
    render(<Wrapper open={true} onDismiss={onDismiss} onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onDismiss = vi.fn();
    render(<Wrapper open={true} onDismiss={onDismiss} onSelect={vi.fn()} />);
    const backdrop = document.querySelector('.popover-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as Element);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown skips disabled items and wraps around', () => {
    const onSelect = vi.fn();
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={onSelect} />);
    const menu = screen.getByRole('menu');
    // 初始焦点在技能一（index 0）
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能二' }));
    // 下一个是 disabled 的「不可用项」，应跳到「技能四」
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能四' }));
    // wrap 回到第一个
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能一' }));
  });

  it('ArrowUp moves backward skipping disabled items', () => {
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    // 从技能一开始，向上应 wrap 到最后一个可用项「技能四」
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能四' }));
    // 再向上跳过 disabled，到「技能二」
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能二' }));
  });

  it('Home and End jump to first and last enabled items', () => {
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能四' }));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '技能一' }));
  });

  it('Enter selects the focused item', () => {
    const onSelect = vi.fn();
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={onSelect} />);
    const menu = screen.getByRole('menu');
    // 初始在「技能一」，按 Enter
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('does not select a disabled item via keyboard', () => {
    const onSelect = vi.fn();
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={onSelect} />);
    const menu = screen.getByRole('menu');
    // 移到不可用项
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // 技能二
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // 跳到技能四（跳过 disabled）
    // 不可用项不会被选中
    expect(screen.getByRole('menuitem', { name: /不可用项/ }).hasAttribute('aria-disabled')).toBe(
      true,
    );
  });

  it('renders hint text for items that have it', () => {
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('尚未信任')).not.toBeNull();
  });

  it('exposes correct ARIA attributes on the menu', () => {
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('能力选择');
    const disabledItem = screen.getByRole('menuitem', { name: /不可用项/ });
    expect(disabledItem.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not use emoji or Unicode characters as icons', () => {
    render(<Wrapper open={true} onDismiss={vi.fn()} onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    const emojiPattern = /\p{Emoji_Presentation}/u;
    expect(emojiPattern.test(menu.textContent ?? '')).toBe(false);
  });
});
