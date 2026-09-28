import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface StatusNoteProps {
  /** 状态语气只有四档（docs/10 §11.5.2）：`--info` 属通知等级那一套词汇，不给这一轴补档。 */
  tone?: StatusTone;
  /** 一句现在为真的事实，如「当前依赖已有有效执行授权」。与 `problems` 至少给一个。 */
  message?: ReactNode;
  /** 明细清单：一句「有 N 项阻塞」之下的具体条目。 */
  problems?: readonly string[] | undefined;
  /** 只承载定位钩子，不承载外观。 */
  className?: string | undefined;
}

/**
 * 一句只读状态说明的唯一出口（docs/10 §11.5.2）。
 *
 * 状态轴说「这个对象现在是什么」，反馈轴（§11.5.1）说「你刚做的那一下怎么样了」。
 * 这句话此前散在八个类名里各自写一遍语义字色，并且长成两种观感：一行纯文字
 * （`.success-copy` 要靠 `!important` 才盖得住容器那条 `> p` 规则）和借了反馈壳的
 * 带底块（`.memory-pending-governance` 的 `--info-soft`、`.appearance-note` 的
 * `--surface-raised`）。与 ADR-0031 收口前的 Button 同源：类名方案拦不住下一个页面。
 *
 * 基座只出「文字」那一档——没有底、没有内距、不自带上下缝，缝由容器 `gap`
 * 或容器侧规则拥有。需要拦住用户的动作结果仍然用 `InlineError`，别把成功写成
 * 常驻的一行绿字。
 */
export function StatusNote({
  tone = 'neutral',
  message,
  problems,
  className,
}: StatusNoteProps): React.JSX.Element {
  const hasProblems = problems !== undefined && problems.length > 0;
  return (
    <div className={className ? `status-note ${className}` : 'status-note'} data-tone={tone}>
      {message !== undefined && <p className="status-note-message">{message}</p>}
      {hasProblems && (
        <ul className="status-note-problems">
          {problems?.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
