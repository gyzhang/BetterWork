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
import { InlineError } from './components/InlineError';
import { ListRow } from './components/ListRow';
import { useOverlaySemantics } from './components/Modal';
import { SectionHeader } from './components/SectionHeader';
import { Tooltip } from './components/Tooltip';
import { intoToastStack } from './components/TransientToast';
import { AlertIcon, BellIcon, CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons';
import { describeActionError, trackAction } from './lib/async-action';
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
  onActivationError?: () => void;
}

export const useNotifications = ({
  navigate,
  isTargetVisible,
  onActivationError,
}: UseNotificationsOptions): {
  notifications: NotificationSummary[];
  unreadCount: number;
  toasts: ToastItem[];
  activate: (notification: NotificationSummary) => void;
  markAllRead: () => void;
  deleteNotification: (id: string) => Promise<{ deleted: boolean }>;
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
  const callbacksRef = useRef({ navigate, isTargetVisible, onActivationError });

  // Renderer 回调在挂载时先就位，冷启动 ready 握手随后才可能触发 Main 的待处理目标。
  useEffect(() => {
    callbacksRef.current = { navigate, isTargetVisible, onActivationError };
  });

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
      } else if (event.type === 'deleted') {
        setNotifications((current) => current.filter((item) => item.id !== event.notificationId));
        setUnreadCount(event.unreadCount);
        setToasts((current) => current.filter((toast) => toast.id !== event.notificationId));
        pausedToastsRef.current.delete(event.notificationId);
      } else {
        setNotifications([]);
        setUnreadCount(event.unreadCount);
        setToasts([]);
      }
    });
    const offActivate = window.betterwork.notifications.onActivate(({ id }) => {
      trackAction(
        window.betterwork.notifications
          .get({ id })
          .then((notification) => {
            if (disposed) return;
            if (!notification) {
              callbacksRef.current.onActivationError?.();
              return;
            }
            if (!notification.read) {
              trackAction(window.betterwork.notifications.markRead({ id }), '标记通知已读');
            }
            if (notification.target) callbacksRef.current.navigate(notification.target);
          })
          .catch((error: unknown) => {
            console.error('Unable to restore notification target', error);
            callbacksRef.current.onActivationError?.();
          }),
        '打开系统通知目标',
      );
    });
    trackAction(window.betterwork.notifications.rendererReady(), '通知 Renderer 就绪握手');
    return () => {
      disposed = true;
      offChange();
      offActivate();
    };
  }, []);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

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
  const deleteNotification = useCallback(
    (id: string): Promise<{ deleted: boolean }> => window.betterwork.notifications.delete({ id }),
    [],
  );
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
    deleteNotification,
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
  onDelete: (id: string) => Promise<{ deleted: boolean }>;
  onClear: () => void;
}

interface NotificationPanelProps {
  notifications: NotificationSummary[];
  unreadCount: number;
  /** 由铃铛 rect 算出的视口坐标；面板 portal 到 body 后 CSS 已无锚点可依。 */
  position: { left: number; bottom: number; maxHeight: number };
  onClose: () => void;
  onActivate: (notification: NotificationSummary) => void;
  onMarkAllRead: () => void;
  onDelete: (id: string) => Promise<{ deleted: boolean }>;
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
  onDelete,
  onClear,
}: NotificationPanelProps): React.JSX.Element => {
  const [clearRequested, setClearRequested] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState<NotificationSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{
    tone: 'danger' | 'warning';
    message: string;
  } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  useOverlaySemantics(panelRef, { onClose });

  const confirmDelete = (): void => {
    if (!deleteRequested || deletingId !== null) return;
    const notification = deleteRequested;
    setDeletingId(notification.id);
    setDeleteError(null);
    void onDelete(notification.id)
      .then(({ deleted }) => {
        if (!deleted) {
          setDeleteError({ tone: 'warning', message: '这条消息已不存在，列表已同步。' });
          setDeleteRequested(null);
          return;
        }
        setDeleteRequested(null);
      })
      .catch((error: unknown) => {
        setDeleteError({
          tone: 'danger',
          message: describeActionError(error, '删除消息失败，请重试。'),
        });
        setDeleteRequested(null);
      })
      .finally(() => setDeletingId(null));
  };

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
          bottom: position.bottom,
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
        {deleteError !== null && (
          <InlineError
            className="notification-delete-error"
            message={deleteError.message}
            tone={deleteError.tone}
            onDismiss={() => setDeleteError(null)}
          />
        )}
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
                as="article"
                className={`notification-row${item.read ? '' : ' unread'}`}
                leading={
                  <span className={`level-${item.level}`} aria-hidden="true">
                    <LevelIcon level={item.level} />
                  </span>
                }
                trailing={
                  item.read ? undefined : <span className="notification-dot" aria-hidden="true" />
                }
              >
                <Button
                  variant="link"
                  size="sm"
                  className="notification-open-action"
                  type="button"
                  aria-label={`打开通知：${item.title}`}
                  onClick={() => onActivate(item)}
                >
                  <Tooltip className="list-row-title">
                    <strong>{item.title}</strong>
                  </Tooltip>
                  {item.detail && <span className="list-row-detail">{item.detail}</span>}
                </Button>
                <div className="notification-row-meta">
                  <small className="list-row-meta">{relativeTime(item.createdAt)}</small>
                  <Button
                    variant="link"
                    size="sm"
                    tone="danger"
                    type="button"
                    aria-label={`删除通知：${item.title}`}
                    disabled={deletingId !== null}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteRequested(item);
                    }}
                  >
                    删除
                  </Button>
                </div>
              </ListRow>
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
      {deleteRequested && (
        <ConfirmationDialog
          title="删除这条消息？"
          detail={`删除“${deleteRequested.title}”后将无法恢复。`}
          confirmLabel={deletingId === deleteRequested.id ? '删除中…' : '删除消息'}
          busy={deletingId === deleteRequested.id}
          onCancel={() => setDeleteRequested(null)}
          onConfirm={confirmDelete}
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
  onDelete,
  onClear,
}: NotificationCenterProps): React.JSX.Element => {
  const bellRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);

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
      // 左下角落在铃铛上方，与铃铛留一个 gap；需要滚动时最多向上生长 480px。
      const viewportBottom = Math.max(PANEL_VIEWPORT_MARGIN, innerHeight - PANEL_VIEWPORT_MARGIN);
      const bottomEdge = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(viewportBottom, rect.top - PANEL_GAP),
      );
      const maxHeight = Math.min(PANEL_MAX_HEIGHT, bottomEdge - PANEL_VIEWPORT_MARGIN);
      setPosition({
        left: fitsRight
          ? rect.right + PANEL_GAP
          : Math.max(PANEL_VIEWPORT_MARGIN, rect.left - PANEL_GAP - PANEL_WIDTH),
        bottom: innerHeight - bottomEdge,
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
              onDelete={onDelete}
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
