// @vitest-environment jsdom

import type { NotificationSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationCenter } from './notifications';

afterEach(() => cleanup());

const note = (over: Partial<NotificationSummary> = {}): NotificationSummary => ({
  id: 'note-1',
  level: 'success',
  kind: 'knowledge-import',
  title: '索引已重建',
  detail: '20 份资料完成。',
  createdAt: 1_700_000_000_000,
  read: false,
  target: { kind: 'task', taskId: 'task-1' },
  ...over,
});

/** 受控开合：`open` 变化走 rerender，焦点归还与 inert 恢复都发生在同一棵树上。 */
function Bell({ onOpenChange = vi.fn() } = {}) {
  const notifications = [note()];
  const tree = (open: boolean): React.JSX.Element => (
    <main>
      <NotificationCenter
        notifications={notifications}
        unreadCount={1}
        open={open}
        onOpenChange={onOpenChange}
        onActivate={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClear={vi.fn()}
      />
    </main>
  );
  const result = render(tree(false));
  return { onOpenChange, open: (next: boolean) => result.rerender(tree(next)) };
}

describe('消息中心（Modal 基座的锚定覆盖层）', () => {
  it('铃铛带 aria-haspopup 与 aria-expanded，展开状态跟着面板走', () => {
    const bell = Bell();
    const trigger = screen.getByRole('button', { name: '通知，1 条未读' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    bell.open(true);
    expect(
      screen.getByRole('button', { name: '通知，1 条未读' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('打开时 inert 掉应用主体并把焦点交给面板内第一个控件', () => {
    const bell = Bell();
    const trigger = screen.getByRole('button', { name: '通知，1 条未读' });
    trigger.focus();
    bell.open(true);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '全部已读' }));
  });

  it('关闭时焦点还给铃铛并解除 inert', () => {
    const bell = Bell();
    const trigger = screen.getByRole('button', { name: '通知，1 条未读' });
    trigger.focus();
    bell.open(true);
    bell.open(false);
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  });

  it('Esc 关闭面板', () => {
    const bell = Bell();
    bell.open(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(bell.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('面板与背板 portal 到 body，不留在被 inert 的 <main> 里', () => {
    // 2026-09-26 线上事故：面板挂在 <main> 内，useOverlaySemantics inert 整个
    // <main> 时把面板自己也锁死了——滚动无效、点哪都无响应，
    // 只剩 window 上的 Esc 活着。jsdom 不模拟指针命中，只能锁 DOM 归属。
    const bell = Bell();
    bell.open(true);
    const main = document.querySelector('main');
    const panel = screen.getByRole('dialog', { name: '消息中心' });
    expect(main?.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
    const overlay = document.querySelector('.notification-overlay');
    expect(overlay).not.toBeNull();
    expect(main?.contains(overlay ?? null)).toBe(false);
  });

  it('Tab 在面板内循环，不会走到已经 inert 的页面里', () => {
    const bell = Bell();
    bell.open(true);
    const last = screen.getByRole('button', { name: /索引已重建/ });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '全部已读' }));
  });
});
