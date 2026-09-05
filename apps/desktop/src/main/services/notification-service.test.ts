import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { IpcChannel } from '@betterwork/agent-protocol';
import { AppStore } from '../persistence';
import { NotificationService } from './notification-service';

/**
 * 系统通知分支此前完全没有覆盖：既有测试用 `isFocused: () => true` 的窗口桩
 * 把它绕过去了。这里用 electron 模块替身，把「失焦才打扰用户」这条规则钉住。
 */
const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    title: string;
    body: string;
    shown: boolean;
    emitClick: () => void;
  }>,
  supported: true,
}));

vi.mock('electron', () => {
  interface FakeInstance {
    shown: boolean;
    on(event: string, handler: () => void): void;
    show(): void;
  }

  function FakeNotification(options: { title: string; body: string }): FakeInstance {
    const clickHandlers: Array<() => void> = [];
    const instance: FakeInstance = {
      shown: false,
      on(event, handler) {
        if (event === 'click') clickHandlers.push(handler);
      },
      show() {
        instance.shown = true;
      },
    };
    mocks.instances.push({
      get title() {
        return options.title;
      },
      get body() {
        return options.body;
      },
      get shown() {
        return instance.shown;
      },
      emitClick: () => {
        for (const handler of clickHandlers) handler();
      },
    });
    return instance;
  }

  FakeNotification.isSupported = (): boolean => mocks.supported;
  return { Notification: FakeNotification };
});

interface WindowStub {
  asBrowserWindow: BrowserWindow;
  sent: Array<{ channel: string; payload: unknown }>;
  /** 按引用暴露，focus 被调用后断言才看得到最新计数 */
  state: { focusCalls: number };
}

const createWindowStub = (focused: boolean): WindowStub => {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const state = { focusCalls: 0 };
  const stub = {
    isDestroyed: () => false,
    isFocused: () => focused,
    isMinimized: () => false,
    restore: () => undefined,
    show: () => undefined,
    focus: () => {
      state.focusCalls += 1;
    },
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
      },
    },
  };
  return { asBrowserWindow: stub as unknown as BrowserWindow, sent, state };
};

const openStores: AppStore[] = [];
const createStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  openStores.push(store);
  return store;
};

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.supported = true;
});

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
});

const eventsOn = (stub: WindowStub, channel: string): unknown[] =>
  stub.sent.filter((item) => item.channel === channel).map((item) => item.payload);

describe('NotificationService', () => {
  it('persists before broadcasting so the renderer can never see an unstored notification', () => {
    const store = createStore();
    const window = createWindowStub(true);
    const service = new NotificationService(store.notifications, () => window.asBrowserWindow);

    const notification = service.create({
      level: 'success',
      kind: 'knowledge-import',
      title: '已整理 2 份资料',
      target: { kind: 'knowledge' },
    });

    expect(store.notifications.list()).toEqual([
      expect.objectContaining({ id: notification.id, read: false }),
    ]);
    expect(eventsOn(window, IpcChannel.NotificationChangeEvent)).toEqual([
      { type: 'created', notification, unreadCount: 1 },
    ]);
    // 没有要求系统通知时，即使窗口失焦也不该打扰用户
    expect(mocks.instances).toHaveLength(0);
  });

  it('stays silent while the window is focused even when a system notification is requested', () => {
    const store = createStore();
    const window = createWindowStub(true);
    const service = new NotificationService(store.notifications, () => window.asBrowserWindow);

    service.create(
      { level: 'success', kind: 'run', title: '任务完成：季度复盘' },
      { systemNotify: true },
    );

    expect(mocks.instances).toHaveLength(0);
    expect(store.notifications.unreadCount()).toBe(1);
  });

  it('notifies the system only when the window lost focus, and jumps back on click', () => {
    const store = createStore();
    const window = createWindowStub(false);
    const service = new NotificationService(store.notifications, () => window.asBrowserWindow);

    const notification = service.create(
      {
        level: 'error',
        kind: 'run',
        title: '任务失败：季度复盘',
        detail: '模型服务返回 503',
        target: { kind: 'task', taskId: 'task-1' },
      },
      { systemNotify: true },
    );

    expect(mocks.instances).toHaveLength(1);
    const systemNotification = mocks.instances[0];
    expect(systemNotification?.shown).toBe(true);
    expect(systemNotification?.title).toBe('任务失败：季度复盘');
    expect(systemNotification?.body).toBe('模型服务返回 503');

    systemNotification?.emitClick();
    expect(window.state.focusCalls).toBe(1);
    expect(eventsOn(window, IpcChannel.NotificationActivated)).toEqual([{ id: notification.id }]);
  });

  it('falls back to the product name as the system notification body', () => {
    const store = createStore();
    const window = createWindowStub(false);
    const service = new NotificationService(store.notifications, () => window.asBrowserWindow);

    service.create({ level: 'info', kind: 'system', title: '算台已就绪' }, { systemNotify: true });
    expect(mocks.instances[0]?.body).toBe('算台 BetterWork');
  });

  it('skips the system notification when the platform does not support it', () => {
    mocks.supported = false;
    const store = createStore();
    const window = createWindowStub(false);
    const service = new NotificationService(store.notifications, () => window.asBrowserWindow);

    service.create({ level: 'info', kind: 'system', title: '算台已就绪' }, { systemNotify: true });
    expect(mocks.instances).toHaveLength(0);
  });

  it('still persists when there is no window to broadcast to', () => {
    const store = createStore();
    const service = new NotificationService(store.notifications, () => null);

    const notification = service.create({ level: 'warning', kind: 'artifact', title: '导出失败' });
    expect(store.notifications.list()).toHaveLength(1);
    expect(notification.read).toBe(false);
  });

  it('broadcasts read, read-all and cleared with the resulting unread count', () => {
    const store = createStore();
    const window = createWindowStub(true);
    const service = new NotificationService(store.notifications, () => window.asBrowserWindow);

    const first = service.create({ level: 'info', kind: 'system', title: '第一条' });
    service.create({ level: 'info', kind: 'system', title: '第二条' });

    expect(service.markRead(first.id)).toBe(1);
    expect(service.markAllRead()).toBe(0);
    service.create({ level: 'info', kind: 'system', title: '第三条' });
    service.clear();

    expect(store.notifications.list()).toEqual([]);
    expect(eventsOn(window, IpcChannel.NotificationChangeEvent)).toEqual([
      expect.objectContaining({ type: 'created', unreadCount: 1 }),
      expect.objectContaining({ type: 'created', unreadCount: 2 }),
      { type: 'read', notificationId: first.id, unreadCount: 1 },
      { type: 'read-all', unreadCount: 0 },
      expect.objectContaining({ type: 'created', unreadCount: 1 }),
      { type: 'cleared', unreadCount: 0 },
    ]);
  });
});
