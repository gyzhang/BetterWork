import type {
  NotificationLevel,
  NotificationSummary,
  NotificationTarget,
} from '@betterwork/agent-protocol';
import type { ReactPortal } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './components/Button';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { EmptyContext } from './components/EmptyState';
import { IconButton } from './components/IconButton';
import { ListRow } from './components/ListRow';
import { useOverlaySemantics } from './components/Modal';
import { SectionHeader } from './components/SectionHeader';
import { intoToastStack } from './components/TransientToast';
import { AlertIcon, BellIcon, CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons';
import { trackAction } from './lib/async-action';
import { relativeTime } from './lib/format';

const TOAST_MAX = 4;
const TOAST_DURATION = 4_000;
const TOAST_ERROR_DURATION = 6_000;
const TOAST_SWEEP_INTERVAL = 250;

interface ToastItem {
  id: string;
  notification: NotificationSummary;
  expiresAt: number;
}

interface UseNotificationsOptions {
  navigate: (target: NotificationTarget) => void;
  isTargetVisible: (notification: NotificationSummary) => boolean;
}

export const useNotifications = ({
  navigate,
  isTargetVisible,
}: UseNotificationsOptions): {
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

  useEffect(() => {
    let disposed = false;
    trackAction(
      window.betterwork.notifications.list().then((list) => {
        if (disposed) return;
        setNotifications(list);
        setUnreadCount(list.filter((item) => !item.read).length);
      }),
      '加载消息中心',
    );
    const offChange = window.betterwork.notifications.onChange((event) => {
      if (event.type === 'created') {
        setNotifications((current) => [event.notification, ...current]);
        setUnreadCount(event.unreadCount);
        // 落库即已读的通知（成功类）不再投影成浮层：它是一条留档，不是一次打扰。
        // 同页抑制仍然只管「你正在看那个对象」，两者取与。
        if (!event.notification.read && !callbacksRef.current.isTargetVisible(event.notification)) {
          const duration =
            event.notification.level === 'error' ? TOAST_ERROR_DURATION : TOAST_DURATION;
          setToasts((current) =>
            [
              {
                id: event.notification.id,
                notification: event.notification,
                expiresAt: Date.now() + duration,
              },
              ...current,
            ].slice(0, TOAST_MAX),
          );
        }
      } else if (event.type === 'read') {
        setNotifications((current) =>
          current.map((item) =>
            item.id === event.notificationId ? { ...item, read: true } : item,
          ),
        );
        setUnreadCount(event.unreadCount);
      } else if (event.type === 'read-all') {
        setNotifications((current) =>
          current.map((item) => (item.read ? item : { ...item, read: true })),
        );
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
      if (!notification.read) {
        trackAction(window.betterwork.notifications.markRead({ id }), '标记通知已读');
      }
      if (notification.target) callbacksRef.current.navigate(notification.target);
    });
    return () => {
      disposed = true;
      offChange();
      offActivate();
    };
  }, []);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // 渲染期间写 ref 违反 React 的纯度约束；改为在 effect 里同步最新值，
  // 事件回调依然能读到当前的 navigate / isTargetVisible。
  useEffect(() => {
    callbacksRef.current = { navigate, isTargetVisible };
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setToasts((current) =>
        current.filter((toast) => pausedToastsRef.current.has(toast.id) || toast.expiresAt > now),
      );
    }, TOAST_SWEEP_INTERVAL);
    return () => window.clearInterval(timer);
  }, []);

  const activate = useCallback((notification: NotificationSummary): void => {
    if (!notification.read) {
      trackAction(
        window.betterwork.notifications.markRead({ id: notification.id }),
        '标记通知已读',
      );
    }
    setToasts((current) => current.filter((toast) => toast.id !== notification.id));
    if (notification.target) callbacksRef.current.navigate(notification.target);
  }, []);
  const markAllRead = useCallback((): void => {
    trackAction(window.betterwork.notifications.markAllRead(), '全部标记已读');
  }, []);
  const clear = useCallback((): void => {
    trackAction(window.betterwork.notifications.clear(), '清空通知');
  }, []);
  const dismissToast = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const pauseToast = useCallback((id: string): void => {
    pausedToastsRef.current.add(id);
  }, []);
  const resumeToast = useCallback((id: string): void => {
    pausedToastsRef.current.delete(id);
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, expiresAt: Date.now() + TOAST_DURATION } : toast,
      ),
    );
  }, []);

  return {
    notifications,
    unreadCount,
    toasts,
    activate,
    markAllRead,
    clear,
    dismissToast,
    pauseToast,
    resumeToast,
  };
};

const LevelIcon = ({ level }: { level: NotificationLevel }): React.JSX.Element => {
  if (level === 'success') return <CheckIcon size={12} />;
  if (level === 'error') return <AlertIcon size={12} />;
  if (level === 'warning') return <WarningIcon size={12} />;
  return <InfoIcon size={12} />;
};

interface NotificationCenterProps {
  notifications: NotificationSummary[];
  unreadCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivate: (notification: NotificationSummary) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}

interface NotificationPanelProps {
  notifications: NotificationSummary[];
  unreadCount: number;
  /** 由铃铛 rect 算出的视口坐标；面板 portal 到 body 后 CSS 已无锚点可依。 */
  position: { left: number; top: number; maxHeight: number };
  onClose: () => void;
  onActivate: (notification: NotificationSummary) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}

/**
 * 消息中心面板：贴在铃铛右侧，所以不套 `Modal` 的背板与居中几何，
 * 但键盘与焦点语义必须同一份——Esc 能关、进入时 inert 掉应用主体、
 * Tab 在面板内循环、关闭后焦点回到铃铛（`useOverlaySemantics`）。
 * 面板与背板必须 portal 到 body：`useOverlaySemantics` inert 的是整个 `<main>`，
 * 留在壳内的话面板自己也被 pointer-events 锁死（2026-09-26 线上事故）。
 */
const NotificationPanel = ({
  notifications,
  unreadCount,
  position,
  onClose,
  onActivate,
  onMarkAllRead,
  onClear,
}: NotificationPanelProps): React.JSX.Element => {
  const [clearRequested, setClearRequested] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useOverlaySemantics(panelRef, { onClose });

  return (
    <>
      <section
        ref={panelRef}
        className="notification-panel"
        role="dialog"
        aria-modal="true"
        aria-label="消息中心"
        style={{
          left: position.left,
          top: position.top,
          maxHeight: position.maxHeight,
        }}
      >
        <SectionHeader
          className="notification-panel-heading"
          title="消息中心"
          hint={unreadCount > 0 ? `未读 ${unreadCount} 条` : '已全部阅读'}
          actions={
            <>
              {unreadCount > 0 && (
                <Button variant="quiet" size="sm" type="button" onClick={onMarkAllRead}>
                  全部已读
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="quiet"
                  size="sm"
                  tone="danger"
                  type="button"
                  onClick={() => setClearRequested(true)}
                >
                  清空
                </Button>
              )}
            </>
          }
        />
        <div className="notification-list">
          {notifications.length === 0 ? (
            <EmptyContext
              title="暂无通知"
              detail="任务与导入的结果会保存在这里。"
              icon={<BellIcon size={16} />}
            />
          ) : (
            notifications.map((item) => (
              <ListRow
                key={item.id}
                className={item.read ? undefined : 'unread'}
                onClick={() => onActivate(item)}
                leading={
                  <span className={`level-${item.level}`} aria-hidden="true">
                    <LevelIcon level={item.level} />
                  </span>
                }
                title={item.title}
                detail={item.detail}
                meta={relativeTime(item.createdAt)}
                trailing={
                  item.read ? undefined : <span className="notification-dot" aria-hidden="true" />
                }
              />
            ))
          )}
        </div>
      </section>
      {clearRequested && (
        <ConfirmationDialog
          title="清空全部通知？"
          detail="清空后无法恢复历史通知记录。"
          confirmLabel="清空通知"
          onCancel={() => setClearRequested(false)}
          onConfirm={() => {
            setClearRequested(false);
            onClear();
          }}
        />
      )}
    </>
  );
};

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 480;
const PANEL_GAP = 10;
const PANEL_VIEWPORT_MARGIN = 12;

export const NotificationCenter = ({
  notifications,
  unreadCount,
  open,
  onOpenChange,
  onActivate,
  onMarkAllRead,
  onClear,
}: NotificationCenterProps): React.JSX.Element => {
  const bellRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(
    null,
  );

  // 覆盖层已 portal 到 body，锚点只剩铃铛的视口坐标；窗口变化时重测。
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const measure = (): void => {
      const bell = bellRef.current;
      if (!bell) return;
      const rect = bell.getBoundingClientRect();
      const fitsRight = rect.right + PANEL_GAP + PANEL_WIDTH <= innerWidth - PANEL_VIEWPORT_MARGIN;
      // 面板底边贴铃铛底，向上生长；480px 是旧版锚定面板的高度上限，
      // 通高面板会把整窗吞掉（2026-09-26 光哥验收打回）。
      const maxHeight = Math.min(PANEL_MAX_HEIGHT, innerHeight - 2 * PANEL_VIEWPORT_MARGIN);
      const bottom = Math.max(PANEL_VIEWPORT_MARGIN, rect.bottom);
      setPosition({
        left: fitsRight
          ? rect.right + PANEL_GAP
          : Math.max(PANEL_VIEWPORT_MARGIN, rect.left - PANEL_GAP - PANEL_WIDTH),
        top: Math.max(PANEL_VIEWPORT_MARGIN, bottom - maxHeight),
        maxHeight,
      });
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [open]);

  return (
    <div className="notification-anchor">
      <IconButton
        size="row"
        icon={BellIcon}
        label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : '通知'}
        title="通知"
        hasPopup="dialog"
        expanded={open}
        buttonRef={bellRef}
        onClick={() => onOpenChange(!open)}
        trailing={
          unreadCount > 0 ? (
            <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          ) : undefined
        }
      />
      {open &&
        position &&
        createPortal(
          <>
            <div
              className="notification-overlay"
              onMouseDown={() => onOpenChange(false)}
              role="presentation"
            />
            <NotificationPanel
              notifications={notifications}
              unreadCount={unreadCount}
              position={position}
              onClose={() => onOpenChange(false)}
              onActivate={onActivate}
              onMarkAllRead={onMarkAllRead}
              onClear={onClear}
            />
          </>,
          document.body,
        )}
    </div>
  );
};

interface ToastHostProps {
  toasts: ToastItem[];
  onActivate: (notification: NotificationSummary) => void;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export const ToastHost = ({
  toasts,
  onActivate,
  onDismiss,
  onPause,
  onResume,
}: ToastHostProps): ReactPortal | null => {
  if (toasts.length === 0) return null;
  return intoToastStack(
    <>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          role="status"
          onMouseEnter={() => onPause(toast.id)}
          onMouseLeave={() => onResume(toast.id)}
        >
          <span className={`level-${toast.notification.level}`} aria-hidden="true">
            <LevelIcon level={toast.notification.level} />
          </span>
          <button className="toast-body" onClick={() => onActivate(toast.notification)}>
            <strong>{toast.notification.title}</strong>
            {toast.notification.detail && <p>{toast.notification.detail}</p>}
          </button>
          <IconButton
            label="关闭提醒"
            icon={CloseIcon}
            size="sm"
            onClick={() => onDismiss(toast.id)}
          />
        </div>
      ))}
    </>,
  );
};
