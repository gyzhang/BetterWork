// @vitest-environment jsdom

import type {
  NotificationChangeEvent,
  NotificationSummary,
  NotificationTarget,
} from '@betterwork/agent-protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationCenter, ToastHost, useNotifications } from './notifications';

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
        onDelete={vi.fn(async () => ({ deleted: true }))}
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
    const last = screen.getByRole('button', { name: '删除通知：索引已重建' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '全部已读' }));
  });
});

/** `useNotifications` 的浮层投影没有页面可借，这里复刻 App 的接线：钩子出 toasts，`ToastHost` 画。 */
function ToastProbe({
  isTargetVisible,
  navigate = () => undefined,
  onActivationError,
}: {
  isTargetVisible: () => boolean;
  navigate?: (target: NotificationTarget) => void;
  onActivationError?: () => void;
}): React.JSX.Element {
  const { toasts, dismissToast, pauseToast, resumeToast } = useNotifications({
    navigate,
    isTargetVisible,
    ...(onActivationError ? { onActivationError } : {}),
  });
  return (
    <ToastHost
      toasts={toasts}
      onActivate={() => undefined}
      onDismiss={dismissToast}
      onPause={pauseToast}
      onResume={resumeToast}
    />
  );
}

describe('全局浮层投影（useNotifications + ToastHost）', () => {
  let emit: ((event: NotificationChangeEvent) => void) | undefined;
  let activate: ((input: { id: string }) => void) | undefined;
  let getNotification: ReturnType<
    typeof vi.fn<(input: { id: string }) => Promise<NotificationSummary | null>>
  >;
  let ready: ReturnType<typeof vi.fn<() => Promise<{ ready: true }>>>;

  const installApi = (): void => {
    emit = undefined;
    activate = undefined;
    getNotification = vi.fn(async (): Promise<NotificationSummary | null> => null);
    ready = vi.fn(async (): Promise<{ ready: true }> => ({ ready: true }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        notifications: {
          list: async () => [],
          get: getNotification,
          rendererReady: ready,
          onChange: (cb: (event: NotificationChangeEvent) => void) => {
            emit = cb;
            return () => undefined;
          },
          onActivate: (cb: (input: { id: string }) => void) => {
            activate = cb;
            return () => undefined;
          },
          markRead: async () => 0,
          markAllRead: async () => 0,
          clear: async () => undefined,
        },
      },
    });
  };

  const renderHost = (isTargetVisible: boolean): HTMLElement => {
    const { container } = render(<ToastProbe isTargetVisible={() => isTargetVisible} />);
    return container;
  };

  it('失败通知投影成右下角浮层', () => {
    installApi();
    renderHost(false);

    act(() => {
      emit?.({
        type: 'created',
        notification: note({ level: 'error', title: '任务失败：回款核对', read: false }),
        unreadCount: 1,
      });
    });

    expect(document.querySelector('.toast-stack')?.textContent).toContain('任务失败：回款核对');
  });

  it('落库即已读的成功通知不再投影成浮层：它是留档，不是打扰', () => {
    installApi();
    renderHost(false);

    act(() => {
      emit?.({
        type: 'created',
        notification: note({ level: 'success', title: '任务完成：季度复盘', read: true }),
        unreadCount: 0,
      });
    });

    expect(document.querySelector('.toast')).toBeNull();
    // 仍然进消息中心，只是不再弹浮层。
    expect(screen.queryAllByRole('button', { name: /通知/ })).toHaveLength(0);
  });

  it('目标视图正可见时同页抑制，不重复播报', () => {
    installApi();
    renderHost(true);

    act(() => {
      emit?.({
        type: 'created',
        notification: note({ level: 'error', title: '任务失败：回款核对', read: false }),
        unreadCount: 1,
      });
    });

    expect(document.querySelector('.toast')).toBeNull();
  });

  it('ready 握手之后按稳定 ID 重新读取旧通知，而不依赖首屏列表', async () => {
    installApi();
    const old = note({
      id: 'notification-outside-first-page',
      target: { kind: 'task', taskId: 'old-task' },
    });
    getNotification.mockResolvedValue(old);
    const navigate = vi.fn();
    render(<ToastProbe isTargetVisible={() => false} navigate={navigate} />);
    expect(ready).toHaveBeenCalledOnce();

    await act(async () => {
      activate?.({ id: old.id });
    });

    expect(getNotification).toHaveBeenCalledWith({ id: old.id });
    expect(navigate).toHaveBeenCalledWith(old.target);
  });

  it('稳定 ID 已清除时向页面反馈，而不是静默丢弃点击', async () => {
    installApi();
    const onActivationError = vi.fn();
    render(<ToastProbe isTargetVisible={() => false} onActivationError={onActivationError} />);

    await act(async () => {
      activate?.({ id: 'cleared-notification' });
    });

    expect(onActivationError).toHaveBeenCalledOnce();
  });

  it('浮层的 x 只收投影，不改动消息中心的底账', () => {
    installApi();
    renderHost(false);
    const markRead = vi.fn(async () => 0);
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        notifications: {
          list: async () => [],
          onChange: (cb: (event: NotificationChangeEvent) => void) => {
            emit = cb;
            return () => undefined;
          },
          onActivate: () => (): void => undefined,
          markRead,
          markAllRead: async () => 0,
          clear: async () => undefined,
        },
      },
    });

    act(() => {
      emit?.({
        type: 'created',
        notification: note({ level: 'error', title: '任务失败：回款核对', read: false }),
        unreadCount: 1,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭提醒' }));

    expect(document.querySelector('.toast')).toBeNull();
    expect(markRead).not.toHaveBeenCalled();
  });
});

describe('notification state and subscription ownership', () => {
  const install = (
    initial: NotificationSummary[] = [],
    list?: () => Promise<NotificationSummary[]>,
  ) => {
    let emit!: (event: NotificationChangeEvent) => void;
    let activate!: (input: { id: string }) => void;
    const offChange = vi.fn();
    const offActivate = vi.fn();
    const ipc = {
      list: vi.fn(list ?? (async () => initial)),
      get: vi.fn(async (): Promise<NotificationSummary | null> => note()),
      markRead: vi.fn(async () => 0),
      markAllRead: vi.fn(async () => 0),
      delete: vi.fn(async () => ({ deleted: true })),
      clear: vi.fn(async () => undefined),
      rendererReady: vi.fn(async () => ({ ready: true })),
      onChange: (listener: typeof emit) => {
        emit = listener;
        return offChange;
      },
      onActivate: (listener: typeof activate) => {
        activate = listener;
        return offActivate;
      },
    };
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { notifications: ipc },
    });
    const navigate = vi.fn();
    const onActivationError = vi.fn();
    const hook = renderHook(() =>
      useNotifications({ navigate, onActivationError, isTargetVisible: () => false }),
    );
    return {
      ...hook,
      ipc,
      navigate,
      onActivationError,
      emit: (event: NotificationChangeEvent) => emit(event),
      activate: (id: string) => activate({ id }),
      offChange,
      offActivate,
    };
  };

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'betterwork');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('projects read, read-all, deleted and cleared events while keeping the persisted unread count', async () => {
    const h = install([note(), note({ id: 'read', read: true })]);
    await waitFor(() => expect(h.result.current.notifications).toHaveLength(2));
    expect(h.result.current.unreadCount).toBe(1);
    act(() => h.emit({ type: 'read', notificationId: 'note-1', unreadCount: 0 }));
    expect(h.result.current.notifications.every((n) => n.read)).toBe(true);
    act(() => h.emit({ type: 'created', notification: note({ id: 'new' }), unreadCount: 1 }));
    act(() => h.emit({ type: 'read-all', unreadCount: 0 }));
    expect(h.result.current.notifications.every((n) => n.read)).toBe(true);
    act(() => h.emit({ type: 'deleted', notificationId: 'new', unreadCount: 0 }));
    expect(h.result.current.notifications.map((n) => n.id)).toEqual(['note-1', 'read']);
    expect(h.result.current.toasts).toEqual([]);
    act(() => h.emit({ type: 'cleared', unreadCount: 0 }));
    expect(h.result.current.notifications).toEqual([]);
    expect(h.result.current.unreadCount).toBe(0);
  });

  it.each(['created', 'read', 'read-all', 'deleted', 'cleared'] as const)(
    'merges a late initial snapshot with the intervening %s event',
    async (type) => {
      let resolve!: (list: NotificationSummary[]) => void;
      const h = install(
        [],
        () =>
          new Promise((finish) => {
            resolve = finish;
          }),
      );
      const old = note({ id: 'old' });
      const fresh = note({ id: 'fresh', title: 'Fresh notification' });
      act(() => {
        if (type === 'created') h.emit({ type, notification: fresh, unreadCount: 2 });
        else if (type === 'read') h.emit({ type, notificationId: old.id, unreadCount: 0 });
        else if (type === 'read-all') h.emit({ type, unreadCount: 0 });
        else if (type === 'deleted') h.emit({ type, notificationId: old.id, unreadCount: 0 });
        else h.emit({ type, unreadCount: 0 });
      });
      await act(async () => resolve([old]));
      expect(h.result.current.notifications.map((item) => item.id)).toEqual(
        type === 'created'
          ? ['fresh', 'old']
          : type === 'deleted' || type === 'cleared'
            ? []
            : ['old'],
      );
      expect(h.result.current.unreadCount).toBe(type === 'created' ? 2 : 0);
      if (type === 'read' || type === 'read-all')
        expect(h.result.current.notifications[0]?.read).toBe(true);
      expect(h.result.current.toasts).toHaveLength(type === 'created' ? 1 : 0);
    },
  );

  it('deduplicates a stable notification ID present in both the snapshot and its created event', async () => {
    let resolve!: (list: NotificationSummary[]) => void;
    const h = install(
      [],
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    act(() =>
      h.emit({ type: 'created', notification: note({ title: 'Latest title' }), unreadCount: 1 }),
    );
    await act(async () => resolve([note({ title: 'Snapshot title' })]));
    expect(h.result.current.notifications).toHaveLength(1);
    expect(h.result.current.notifications[0]?.title).toBe('Latest title');
  });

  it('caps toast projections while retaining every notification in the center', async () => {
    const h = install();
    await act(async () => {});
    act(() => {
      for (let i = 0; i < 6; i++)
        h.emit({ type: 'created', notification: note({ id: `n-${i}` }), unreadCount: i + 1 });
    });
    expect(h.result.current.toasts.map((t) => t.id)).toEqual(['n-5', 'n-4', 'n-3', 'n-2']);
    expect(h.result.current.notifications).toHaveLength(6);
    expect(h.result.current.unreadCount).toBe(6);
  });

  it('pauses expiration during reading and gives a resumed toast a fresh lifetime', async () => {
    vi.useFakeTimers();
    const h = install();
    await act(async () => {});
    act(() => h.emit({ type: 'created', notification: note(), unreadCount: 1 }));
    act(() => h.result.current.pauseToast('note-1'));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(h.result.current.toasts).toHaveLength(1);
    act(() => h.result.current.resumeToast('note-1'));
    act(() => {
      vi.advanceTimersByTime(3_999);
    });
    expect(h.result.current.toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(501);
    });
    expect(h.result.current.toasts).toEqual([]);
    expect(h.result.current.notifications).toHaveLength(1);
  });

  it.each([false, true])(
    'marks activated notifications read only when needed (read=%s)',
    async (read) => {
      const h = install();
      await act(async () => {});
      const notification = note({ read });
      act(() => h.result.current.activate(notification));
      expect(h.ipc.markRead).toHaveBeenCalledTimes(read ? 0 : 1);
      expect(h.navigate).toHaveBeenCalledWith(notification.target);
      act(() => h.result.current.activate({ ...notification, target: undefined }));
      expect(h.navigate).toHaveBeenCalledTimes(1);
    },
  );

  it('hands maintenance failures back to the caller or the background logging outlet', async () => {
    const h = install();
    await act(async () => {});
    const error = new Error('synthetic rejection');
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.ipc.delete.mockRejectedValue(error);
    await expect(h.result.current.deleteNotification('note-1')).rejects.toBe(error);
    expect(h.ipc.delete).toHaveBeenCalledWith({ id: 'note-1' });
    h.ipc.markAllRead.mockRejectedValue(error);
    h.ipc.clear.mockRejectedValue(error);
    await act(async () => {
      h.result.current.markAllRead();
      h.result.current.clear();
    });
    expect(logger).toHaveBeenCalledWith('全部标记已读 failed', error);
    expect(logger).toHaveBeenCalledWith('清空通知 failed', error);
  });

  it('reports failed system target restoration once and removes both subscriptions on unmount', async () => {
    const h = install();
    await act(async () => {});
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.ipc.get.mockRejectedValue(new Error('unavailable'));
    await act(async () => h.activate('old'));
    expect(h.onActivationError).toHaveBeenCalledOnce();
    expect(h.navigate).not.toHaveBeenCalled();
    h.unmount();
    expect(h.offChange).toHaveBeenCalledOnce();
    expect(h.offActivate).toHaveBeenCalledOnce();
  });

  it('discards target restoration that finishes after unmount', async () => {
    const h = install();
    await act(async () => {});
    let finish!: (notification: NotificationSummary) => void;
    h.ipc.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => h.activate('old'));
    h.unmount();
    await act(async () => finish(note()));
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.ipc.markRead).not.toHaveBeenCalled();
  });
});
