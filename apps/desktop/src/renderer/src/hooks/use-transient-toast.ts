import { useCallback, useState } from 'react';

import type { ToastTone } from '../components/TransientToast';

export interface TransientToastMessage {
  tone: ToastTone;
  message: string;
}

/**
 * 局部短时确认浮层的状态：当场发起、当场可见的成功 / 信息 / 拒绝都走这里，
 * 由 `TransientToast` 在 4s / 6s 后自动消失。
 *
 * 与消息中心的全局 `ToastHost` 分工不同——这里不落库、不进通知列表：
 * 长操作结果才走 `NotificationService`（见 docs/10 §11.5.1 决策表）。
 */
export function useTransientToast(): {
  toast: TransientToastMessage | undefined;
  showToast: (tone: ToastTone, message: string) => void;
  dismissToast: () => void;
} {
  const [toast, setToast] = useState<TransientToastMessage | undefined>();
  const showToast = useCallback((tone: ToastTone, message: string): void => {
    setToast({ tone, message });
  }, []);
  const dismissToast = useCallback((): void => setToast(undefined), []);
  return { toast, showToast, dismissToast };
}
