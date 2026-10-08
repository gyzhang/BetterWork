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
    private readonly onNotificationActivate?: (notificationId: string) => void,
  ) {}

  create(
    input: CreateNotificationInput,
    options?: { systemNotify?: boolean },
  ): NotificationSummary {
    const notification = this.persist(input);
    this.publish(notification, options);
    return notification;
  }

  /** Persists without broadcasting so a caller can include the row in a wider SQLite transaction. */
  persist(input: CreateNotificationInput): NotificationSummary {
    // 成功是一件事「已经办完了」，不是一条待办。它照样落库留档、照样能在消息中心回看，
    // 但计为已读：铃铛上那个数字回答的是「有什么还没处理」，25 条跑成功的任务把它撑到
    // 40 之后，这个数字就不再携带任何信息（docs/10 §11.5.1）。
    // 窗口失焦时的系统通知不受影响——那是「你不在这儿」的另一套打扰口径。
    return this.notifications.save(input, input.level === 'success' ? { read: true } : undefined);
  }

  /** Publishes an already committed notification and optionally asks macOS to display it. */
  publish(notification: NotificationSummary, options?: { systemNotify?: boolean }): void {
    this.broadcast({
      type: 'created',
      notification,
      unreadCount: this.notifications.unreadCount(),
    });
    if (options?.systemNotify) this.showSystemNotification(notification);
  }

  list(): NotificationSummary[] {
    return this.notifications.list();
  }

  get(notificationId: string): NotificationSummary | undefined {
    return this.notifications.get(notificationId);
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

  delete(id: string): boolean {
    const deleted = this.notifications.delete(id);
    // Even a stale delete request tells Renderer that this id is absent and should be removed.
    this.broadcast({
      type: 'deleted',
      notificationId: id,
      unreadCount: this.notifications.unreadCount(),
    });
    return deleted;
  }

  clear(): void {
    this.notifications.clear();
    this.broadcast({ type: 'cleared', unreadCount: 0 });
  }

  /** 只在窗口失焦时打扰用户；点击后聚焦窗口并把跳转意图交回 Renderer。 */
  private showSystemNotification(notification: NotificationSummary): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed() && window.isFocused()) return;

    try {
      if (!Notification.isSupported()) return;
      const systemNotification = new Notification({
        title: notification.title,
        body: notification.detail ?? '算台 BetterWork',
      });
      systemNotification.on('click', () => {
        if (this.onNotificationActivate) {
          this.onNotificationActivate(notification.id);
          return;
        }
        const target = this.getWindow();
        if (!target || target.isDestroyed()) return;
        if (target.isMinimized()) target.restore();
        target.show();
        target.focus();
        target.webContents.send(IpcChannel.NotificationActivated, { id: notification.id });
      });
      systemNotification.show();
    } catch (error) {
      console.warn(
        'System notification is unavailable; the message remains in the notification center',
        error,
      );
    }
  }

  private broadcast(event: NotificationChangeEvent): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IpcChannel.NotificationChangeEvent, event);
  }
}
