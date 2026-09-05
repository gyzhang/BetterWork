import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationLevel, NotificationSummary, NotificationTarget } from '@betterwork/agent-protocol';
import { AlertIcon, BellIcon, CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons';

const TOAST_MAX = 4;
const TOAST_DURATION = 4_000;
const TOAST_ERROR_DURATION = 6_000;
const TOAST_SWEEP_INTERVAL = 250;

interface ToastItem { id: string; notification: NotificationSummary; expiresAt: number; }

interface UseNotificationsOptions {
  navigate: (target: NotificationTarget) => void;
  isTargetVisible: (notification: NotificationSummary) => boolean;
}

export const useNotifications = ({ navigate, isTargetVisible }: UseNotificationsOptions): {
  notifications: NotificationSummary[];
  unreadCount: number;
  toasts: ToastItem[];
  activate: (notification: NotificationSummary) => void;
  markAllRead: () => void;
  clear: () => void;
  dismissToast: (id: string) => void;
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
} => {
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const notificationsRef = useRef<NotificationSummary[]>([]);
  const pausedToastsRef = useRef(new Set<string>());
  const callbacksRef = useRef({ navigate, isTargetVisible });
  callbacksRef.current = { navigate, isTargetVisible };

  useEffect(() => {
    let disposed = false;
    void window.betterwork.notifications.list().then((list) => {
      if (disposed) return;
      setNotifications(list);
      setUnreadCount(list.filter((item) => !item.read).length);
    });
    const offChange = window.betterwork.notifications.onChange((event) => {
      if (event.type === 'created') {
        setNotifications((current) => [event.notification, ...current]);
        setUnreadCount(event.unreadCount);
        if (!callbacksRef.current.isTargetVisible(event.notification)) {
          const duration = event.notification.level === 'error' ? TOAST_ERROR_DURATION : TOAST_DURATION;
          setToasts((current) => [{ id: event.notification.id, notification: event.notification, expiresAt: Date.now() + duration }, ...current].slice(0, TOAST_MAX));
        }
      } else if (event.type === 'read') {
        setNotifications((current) => current.map((item) => item.id === event.notificationId ? { ...item, read: true } : item));
        setUnreadCount(event.unreadCount);
      } else if (event.type === 'read-all') {
        setNotifications((current) => current.map((item) => item.read ? item : { ...item, read: true }));
        setUnreadCount(event.unreadCount);
      } else {
        setNotifications([]);
        setUnreadCount(event.unreadCount);
        setToasts([]);
      }
    });
    const offActivate = window.betterwork.notifications.onActivate(({ id }) => {
      const notification = notificationsRef.current.find((item) => item.id === id);
      if (!notification) return;
      if (!notification.read) void window.betterwork.notifications.markRead({ id });
      if (notification.target) callbacksRef.current.navigate(notification.target);
    });
    return () => { disposed = true; offChange(); offActivate(); };
  }, []);

  useEffect(() => { notificationsRef.current = notifications; }, [notifications]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setToasts((current) => current.filter((toast) => pausedToastsRef.current.has(toast.id) || toast.expiresAt > now));
    }, TOAST_SWEEP_INTERVAL);
    return () => window.clearInterval(timer);
  }, []);

  const activate = useCallback((notification: NotificationSummary): void => {
    if (!notification.read) void window.betterwork.notifications.markRead({ id: notification.id });
    setToasts((current) => current.filter((toast) => toast.id !== notification.id));
    if (notification.target) callbacksRef.current.navigate(notification.target);
  }, []);
  const markAllRead = useCallback((): void => { void window.betterwork.notifications.markAllRead(); }, []);
  const clear = useCallback((): void => { void window.betterwork.notifications.clear(); }, []);
  const dismissToast = useCallback((id: string): void => { setToasts((current) => current.filter((toast) => toast.id !== id)); }, []);
  const pauseToast = useCallback((id: string): void => { pausedToastsRef.current.add(id); }, []);
  const resumeToast = useCallback((id: string): void => {
    pausedToastsRef.current.delete(id);
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, expiresAt: Date.now() + TOAST_DURATION } : toast));
  }, []);

  return { notifications, unreadCount, toasts, activate, markAllRead, clear, dismissToast, pauseToast, resumeToast };
};

const LevelIcon = ({ level }: { level: NotificationLevel }): React.JSX.Element => {
  if (level === 'success') return <CheckIcon size={12} />;
  if (level === 'error') return <AlertIcon size={12} />;
  if (level === 'warning') return <WarningIcon size={12} />;
  return <InfoIcon size={12} />;
};

const relativeTime = (timestamp: number): string => {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
};

interface NotificationCenterProps { notifications: NotificationSummary[]; unreadCount: number; open: boolean; onOpenChange: (open: boolean) => void; onActivate: (notification: NotificationSummary) => void; onMarkAllRead: () => void; onClear: () => void; }

export const NotificationCenter = ({ notifications, unreadCount, open, onOpenChange, onActivate, onMarkAllRead, onClear }: NotificationCenterProps): React.JSX.Element => (
  <div className="notification-anchor">
    <button className={open ? 'notification-bell active' : 'notification-bell'} aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : '通知'} onClick={() => onOpenChange(!open)}>
      <span aria-hidden="true"><BellIcon size={15} /></span>
      <span className="bell-label">通知</span>
      {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <div className="notification-overlay" onMouseDown={() => onOpenChange(false)} />}
    {open && (
      <div className="notification-panel" role="dialog" aria-label="消息中心">
        <div className="notification-panel-header">
          <div><strong>消息中心</strong><small>{unreadCount > 0 ? `未读 ${unreadCount} 条` : '已全部阅读'}</small></div>
          <div className="notification-panel-actions">
            {unreadCount > 0 && <button onClick={onMarkAllRead}>全部已读</button>}
            {notifications.length > 0 && <button className="danger-text" onClick={() => { if (window.confirm('清空全部通知？此操作不可恢复。')) onClear(); }}>清空</button>}
          </div>
        </div>
        <div className="notification-list">
          {notifications.length === 0 ? <div className="notification-empty"><span aria-hidden="true"><BellIcon size={16} /></span><strong>暂无通知</strong><p>任务与导入的结果会保存在这里。</p></div> : notifications.map((item) => (
            <button key={item.id} className={item.read ? 'notification-item' : 'notification-item unread'} onClick={() => onActivate(item)}>
              <span className={`level-${item.level}`} aria-hidden="true"><LevelIcon level={item.level} /></span>
              <div>
                <strong>{item.title}</strong>
                {item.detail && <p>{item.detail}</p>}
                <small>{relativeTime(item.createdAt)}</small>
              </div>
              {!item.read && <span className="notification-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);

interface ToastHostProps { toasts: ToastItem[]; onActivate: (notification: NotificationSummary) => void; onDismiss: (id: string) => void; onPause: (id: string) => void; onResume: (id: string) => void; }

export const ToastHost = ({ toasts, onActivate, onDismiss, onPause, onResume }: ToastHostProps): React.JSX.Element | null => {
  if (toasts.length === 0) return null;
  return <div className="toast-host" aria-live="polite">
    {toasts.map((toast) => (
      <div key={toast.id} className="toast" role="status" onMouseEnter={() => onPause(toast.id)} onMouseLeave={() => onResume(toast.id)}>
        <span className={`level-${toast.notification.level}`} aria-hidden="true"><LevelIcon level={toast.notification.level} /></span>
        <button className="toast-body" onClick={() => onActivate(toast.notification)}>
          <strong>{toast.notification.title}</strong>
          {toast.notification.detail && <p>{toast.notification.detail}</p>}
        </button>
        <button aria-label="关闭提醒" onClick={() => onDismiss(toast.id)}><CloseIcon size={12} /></button>
      </div>
    ))}
  </div>;
};
