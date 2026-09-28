import type { ReactNode, ReactPortal } from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { AlertIcon, CheckIcon, CloseIcon } from '../icons';
import { IconButton } from './IconButton';

export type ToastTone = 'success' | 'error';

const TOAST_STACK_ID = 'toast-stack';
const DURATION: Record<ToastTone, number> = { success: 4_000, error: 6_000 };

/**
 * 右下角那一列浮层的共用容器。
 *
 * 此前 `TransientToast` 自带 `.page-toast-host`、`ToastHost` 自带 `.toast-host`，
 * 两者都 `position: fixed` 在 `right: 20px / bottom: 20px`、同为 `--z-toast`。
 * 同一坐标上的两个固定层，谁后渲染谁盖住谁——App 在主体之后渲染 `ToastHost`，
 * 于是页面发出的短时确认会被全局通知整列压掉，用户读到的是「点了没反应」。
 * 一列浮层只能有一个容器，几何与堆叠因此只住在这里。
 */
function toastStack(): HTMLElement {
  const existing = document.getElementById(TOAST_STACK_ID);
  if (existing) return existing;
  const created = document.createElement('div');
  created.id = TOAST_STACK_ID;
  created.className = 'toast-stack';
  created.setAttribute('aria-live', 'polite');
  document.body.appendChild(created);
  return created;
}

/** 把一条浮层挂进共用堆叠容器；`ToastHost` 与 `TransientToast` 走同一个出口。 */
export function intoToastStack(content: ReactNode): ReactPortal {
  return createPortal(content, toastStack());
}

export function TransientToast({
  tone,
  message,
  onDismiss,
}: {
  tone: ToastTone;
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  // 计时只认「这一条浮层是哪一句、哪一档」，不认 `onDismiss` 的标识：调用点写内联箭头时，
  // 宿主每次重渲染都换一个函数，把它列进依赖等于每次重渲染都重新计时——运行中那 4s／6s
  // 可能永远走不完。回调经 ref 转发，标识变化不再影响计时，触发的仍是最新那一个。
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), DURATION[tone]);
    return () => window.clearTimeout(timer);
  }, [tone, message]);

  return intoToastStack(
    <div className="toast" role="status">
      <span className={`level-${tone}`} aria-hidden="true">
        {tone === 'success' ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
      </span>
      <p>{message}</p>
      <IconButton label="关闭提醒" icon={CloseIcon} size="sm" onClick={onDismiss} />
    </div>,
  );
}
