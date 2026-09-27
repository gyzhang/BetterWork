import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  /** 区块标题。它是标题，所以渲染成真的标题元素而不是 `<strong>`——冒充标题的那 16 处永远不进文档大纲。 */
  title: ReactNode;
  /** 标题下（block 变体里在标题上方）的一句说明。计数属于这里，如「未读 3 条」。 */
  hint?: ReactNode | undefined;
  /** block 变体标题上方的小标（「模型」「记忆」这类分组名）。 */
  eyebrow?: ReactNode | undefined;
  /** 右槽动作。多个按钮的排布由这里负责，页面不再各写一份。 */
  actions?: ReactNode | undefined;
  /** block＝页面区块头（h2）；panel＝面板与卡片内的小节头（h3）。 */
  variant?: 'block' | 'panel' | undefined;
  className?: string | undefined;
}

/**
 * 区块头的唯一结构：小标题（＋ eyebrow）＋ 说明 ＋ 右槽动作。
 *
 * 这一种结构此前有 13 个类名各写一遍（`.settings-heading`、
 * `.selected-materials-heading`、`.skill-section-heading`、`.memory-group-heading`、
 * `.notification-panel-header`、`.artifact-reference-heading` …），
 * `gap` 取遍 4／8／12／16／24 五档，`display` 有 flex-row／column／grid 三种，
 * 标题与说明的字号在 13／14／15 之间来回——没有一条差异来自业务
 * （docs/reviews/2026-09-27-ui-reuse-audit.md §3.1 P1）。
 * 纵向缝由 `section-header-text` 自己的 gap 拥有，页面不得再给标题或说明补上下 margin。
 */
export function SectionHeader({
  title,
  hint,
  eyebrow,
  actions,
  variant = 'panel',
  className,
}: SectionHeaderProps): React.JSX.Element {
  const classes = `section-header${className ? ` ${className}` : ''}`;
  const heading =
    variant === 'block' ? (
      <h2 className="section-header-title">{title}</h2>
    ) : (
      <h3 className="section-header-title">{title}</h3>
    );
  return (
    <div className={classes} data-variant={variant}>
      <div className="section-header-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : undefined}
        {heading}
        {hint ? <p className="section-header-hint">{hint}</p> : undefined}
      </div>
      {actions ? <div className="section-header-actions">{actions}</div> : undefined}
    </div>
  );
}
