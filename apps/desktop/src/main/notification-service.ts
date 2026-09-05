import { Notification, type BrowserWindow } from 'electron';
import type { CreateNotificationInput, NotificationChangeEvent, NotificationSummary } from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import { RunJournal } from './run-journal';

export class NotificationService {
  constructor(
    private readonly journal: RunJournal,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  create(input: CreateNotificationInput, options?: { systemNotify?: boolean }): NotificationSummary {
    const notification = this.journal.saveNotification(input);
    this.broadcast({ type: 'created', notification, unreadCount: this.journal.unreadNotificationCount() });
    if (options?.systemNotify) this.showSystemNotification(notification);
    return notification;
  }

  list(): NotificationSummary[] {
    return this.journal.listNotifications();
  }

  markRead(id: string): number {
    const unreadCount = this.journal.markNotificationRead(id);
    this.broadcast({ type: 'read', notificationId: id, unreadCount });
    return unreadCount;
  }

  markAllRead(): number {
    const unreadCount = this.journal.markAllNotificationsRead();
    this.broadcast({ type: 'read-all', unreadCount });
    return unreadCount;
  }

  clear(): void {
    this.journal.clearNotifications();
    this.broadcast({ type: 'cleared', unreadCount: 0 });
  }

  private showSystemNotification(notification: NotificationSummary): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;
    const systemNotification = new Notification({ title: notification.title, body: notification.detail ?? '算台 BetterWork' });
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
    if (window && !window.isDestroyed()) window.webContents.send(IpcChannel.NotificationChangeEvent, event);
  }
}
