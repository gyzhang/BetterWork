import type {
  CreateNotificationInput,
  NotificationChangeEvent,
  NotificationSummary,
} from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import { type BrowserWindow, Notification } from 'electron';

import type { NotificationRepository } from '../persistence';

/**
 * 通知的收口点：先持久化、再广播，最后在窗口失焦时发系统通知（ADR-0006）。
 *
 * 只依赖 NotificationRepository 而不是整个 AppStore——触发点分散在 RunService 与
 * IPC 层，但「怎么落库、怎么广播、什么时候打扰用户」只有这一处。
 * Agent Core 对通知一无所知。
 */
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  create(
    input: CreateNotificationInput,
    options?: { systemNotify?: boolean },
  ): NotificationSummary {
    const notification = this.notifications.save(input);
    this.broadcast({
      type: 'created',
      notification,
      unreadCount: this.notifications.unreadCount(),
    });
    if (options?.systemNotify) this.showSystemNotification(notification);
    return notification;
  }

  list(): NotificationSummary[] {
    return this.notifications.list();
  }

  markRead(id: string): number {
    const unreadCount = this.notifications.markRead(id);
    this.broadcast({ type: 'read', notificationId: id, unreadCount });
    return unreadCount;
  }

  markAllRead(): number {
    const unreadCount = this.notifications.markAllRead();
    this.broadcast({ type: 'read-all', unreadCount });
    return unreadCount;
  }

  clear(): void {
    this.notifications.clear();
    this.broadcast({ type: 'cleared', unreadCount: 0 });
  }

  /** 只在窗口失焦时打扰用户；点击后聚焦窗口并把跳转意图交回 Renderer。 */
  private showSystemNotification(notification: NotificationSummary): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;

    const systemNotification = new Notification({
      title: notification.title,
      body: notification.detail ?? '算台 BetterWork',
    });
    systemNotification.on('click', () => {
      const target = this.getWindow();
      if (!target || target.isDestroyed()) return;
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
      target.webContents.send(IpcChannel.NotificationActivated, { id: notification.id });
    });
    systemNotification.show();
  }

  private broadcast(event: NotificationChangeEvent): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IpcChannel.NotificationChangeEvent, event);
  }
}
