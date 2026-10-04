import { IpcChannel, notificationActivatedSchema } from '@betterwork/agent-protocol';
import type { BrowserWindow } from 'electron';

export interface NotificationActivationServiceOptions {
  readonly getWindow: () => BrowserWindow | null;
  readonly ensureWindow: () => BrowserWindow | null;
  readonly onError?: (error: unknown) => void;
}

/** Holds a clicked notification ID until the owning Renderer has installed its listeners. */
export class NotificationActivationService {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly ensureWindow: () => BrowserWindow | null;
  private readonly onError: (error: unknown) => void;
  private pendingNotificationId: string | undefined;
  private readyWebContentsId: number | undefined;

  constructor(options: NotificationActivationServiceOptions) {
    this.getWindow = options.getWindow;
    this.ensureWindow = options.ensureWindow;
    this.onError =
      options.onError ?? ((error) => console.error('Notification activation failed', error));
  }

  activate(notificationId: string): void {
    this.pendingNotificationId = notificationId;
    try {
      const window = this.ensureWindow();
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      this.deliverIfReady(window);
    } catch (error) {
      this.reportError(error);
    }
  }

  rendererReady(webContentsId: number): boolean {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || window.webContents.id !== webContentsId) return false;
    this.readyWebContentsId = webContentsId;
    this.deliverIfReady(window);
    return true;
  }

  windowClosed(webContentsId: number): void {
    if (this.readyWebContentsId === webContentsId) this.readyWebContentsId = undefined;
  }

  private deliverIfReady(window: BrowserWindow): void {
    const notificationId = this.pendingNotificationId;
    if (
      !notificationId ||
      window.isDestroyed() ||
      window.webContents.id !== this.readyWebContentsId
    ) {
      return;
    }
    try {
      window.webContents.send(
        IpcChannel.NotificationActivated,
        notificationActivatedSchema.parse({ id: notificationId }),
      );
      this.pendingNotificationId = undefined;
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch (reportError) {
      queueMicrotask(() => {
        throw reportError;
      });
    }
  }
}
