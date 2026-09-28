import type { ReactNode } from 'react';

import { Button } from './Button';

/**
 * 内联反馈的两档语义。`danger` 是「这件事失败了」，`warning` 是「还能继续但有风险」——
 * 后者此前借的是 `.memory-warnings` 一套独立的 warning 底色，与错误条只差颜色。
 */
export type InlineErrorTone = 'danger' | 'warning';

export interface InlineErrorProps {
  /**
   * 一句话结论。与 `problems` **至少给一个**：只有明细、没有结论的提示块（如契约 §9.1
   * 的「保存成功但带警告」）不该为了套基座被硬造出一句标题。
   */
  message?: ReactNode;
  /** 多条明细（校验问题、失败条目）。给了就排在结论下面，不另起一个块。 */
  problems?: readonly string[] | undefined;
  /** 缺省 `danger`。 */
  tone?: InlineErrorTone | undefined;
  /** 这条消息自带的重试入口。失败可重试时给，别让用户去翻页面别的按钮。 */
  onRetry?: (() => void) | undefined;
  /** 读完就能关掉。不给则常驻到承载它的状态变化——常驻是特性，不是遗漏。 */
  onDismiss?: (() => void) | undefined;
  /** 领域动作（「查看条目」一类），排在重试左侧。 */
  actions?: ReactNode;
  /** 只承载定位钩子，不承载外观（ADR-0031 同一口径）。 */
  className?: string | undefined;
}

/**
 * 内联反馈的唯一出口（docs/10 §11.5.1 第二落点）。
 *
 * 在它之前，「一条带底色的错误条」有八套几何：`.inline-message.error` 与
 * `.artifact-action-error` 是 `9px 11px`，`.knowledge-issues` 与 `.memory-warnings` 是
 * `10px 12px`，`.tool-detail-error` 是 `8px` 且没有圆角也没有字号，`.field-error` 只借
 * 字色与底，`.memory-projection` 是 `10px 12px` 配 `--warning-soft`，`.action-note.error`
 * 连底都没有。动作更有三种摆法——`float: right`、`margin-top: 8px`、以及干脆写在正文里。
 * 同一件事的八处真相与 ADR-0031 收口前的 Button 同源：类名方案拦不住下一个页面再造一套。
 *
 * 2026-09-28 那轮收掉六套，剩下两处 2026-09-29 才补：`.memory-projection` 当时不在扫描
 * 清单里；`.action-note.error` 曾被算作已迁入，实际类与调用点都还在——它无底无内距，讲的是
 * 「保存成果」那一下的结果，按 §11.5.1 归这里，成功那一档则归 `TransientToast`。
 */
export function InlineError({
  message,
  problems,
  tone = 'danger',
  onRetry,
  onDismiss,
  actions,
  className,
}: InlineErrorProps): React.JSX.Element {
  const hasProblems = problems !== undefined && problems.length > 0;
  const hasActions = actions !== undefined || onRetry !== undefined || onDismiss !== undefined;
  const buttonTone = tone === 'danger' ? 'danger' : 'neutral';
  return (
    <div
      className={className ? `inline-error ${className}` : 'inline-error'}
      data-tone={tone}
      role="alert"
    >
      {message !== undefined && <p className="inline-error-message">{message}</p>}
      {hasProblems && (
        <ul className="inline-error-problems">
          {problems?.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {hasActions && (
        <div className="inline-error-actions">
          {actions}
          {onRetry && (
            <Button variant="link" size="sm" tone={buttonTone} type="button" onClick={onRetry}>
              重试
            </Button>
          )}
          {onDismiss && (
            <Button variant="link" size="sm" tone={buttonTone} type="button" onClick={onDismiss}>
              关闭
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
