import type { ReactNode } from 'react';

import type { ButtonSize, ButtonTone, ButtonVariant } from './Button';
import { Button } from './Button';

export interface AsyncButtonProps {
  /** 未忙碌时的文案；图标由调用方放进 label，与既有按钮保持一致。 */
  label: ReactNode;
  /** 忙碌时的文案（如「正在保存…」）。两份文案都由调用方给，基座只渲染当前那一份。 */
  busyLabel: ReactNode;
  busy: boolean;
  onClick?: (() => void) | undefined;
  type?: 'button' | 'submit' | undefined;
  /** 外观与几何一律交回 `Button` 的两个正交维度，这里不再自带一套皮。 */
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  tone?: ButtonTone | undefined;
  /** 额外的禁用条件（表单未填完等）；忙碌本身一定会禁用按钮。 */
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 会发长请求的按钮：`disabled` ＋ `aria-busy` ＋ 状态文案只有一处写法。
 *
 * 此前 17 个按钮各写一份 `{busy ? '正在…' : '保存'}` 并各自处理 disabled，
 * 于是同一屏里有的按钮忙碌时不置灰、有的连 `aria-busy` 都没有，读屏听不出
 * 「正在进行」与「按钮消失」的区别（长操作三要素里的「可见状态」，docs/10 §11.1）。
 * 这里只渲染当前那一份文案：把两份都留在 DOM 里撑宽度的做法会把隐藏文本
 * 混进 `textContent`，测试与辅助技术读到的都不是用户看到的那句话。
 *
 * 外观自 2026-09-28 起委托给 `Button`（ADR-0031）——它管的是「什么时候算忙」，
 * 不是「长什么样」，所以原来那张 `variant → 皮类名` 的映射表跟着皮一起删了。
 */
export function AsyncButton({
  label,
  busyLabel,
  busy,
  onClick,
  type = 'button',
  variant,
  size,
  tone,
  disabled = false,
  className,
}: AsyncButtonProps): React.JSX.Element {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      tone={tone}
      disabled={disabled || busy}
      aria-busy={busy}
      {...(className ? { className } : {})}
      {...(onClick ? { onClick } : {})}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}

/**
 * 行内「正在进行」提示：旋转指示器 ＋ 一句话，读屏按 `role=status` 播报。
 *
 * 此前 11 处加载状态是裸 `<p>`／`<small>` 文本，既没有指示器也没有 `aria-live`
 * （`LoadingPage` 只覆盖整页那种尺寸）。行内的这类状态统一走这里。
 */
export function InlineLoading({
  label,
  className,
}: {
  label: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={`inline-loading${className ? ` ${className}` : ''}`}
      role="status"
      aria-busy="true"
    >
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}
