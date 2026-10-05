import type { ReactNode } from 'react';

import { Tooltip } from './Tooltip';

export type ListRowVariant = 'divider' | 'card' | 'plain';

export interface ListRowProps {
  /** divider＝列表内的分隔线行；card＝带边框圆角的卡片行；plain＝侧栏的裸行（悬停才出底）。 */
  variant?: ListRowVariant | undefined;
  /** 左槽：图标、复选框、格式徽标。装饰由槽内元素自己负责，基座只给位置。 */
  leading?: ReactNode | undefined;
  /**
   * 主区第一行；不给时主区完全交给 children（结构特殊的行用这种）。
   * 默认单行截断，被裁切时由 Tooltip 补全。
   */
  title?: ReactNode | undefined;
  /** 主区第二行：一句说明。 */
  detail?: ReactNode | undefined;
  /** 主区第三行：时间、路径、状态这类次要信息。 */
  meta?: ReactNode | undefined;
  /** 右槽：动作按钮组。 */
  actions?: ReactNode | undefined;
  /** 长正文与多动作并存时，操作独占正文下方一行，避免挤压阅读宽度。 */
  actionsPlacement?: 'side' | 'below' | undefined;
  /** 右端小标记（未读点之类）。 */
  trailing?: ReactNode | undefined;
  /** 主区内、三行之后的展开内容。 */
  children?: ReactNode | undefined;
  /** 提供后整行是一个 button；此时右槽里不要再放按钮。 */
  onClick?: (() => void) | undefined;
  /** 当前项（侧栏选中的任务）。 */
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  /** muted＝降饱和（停用、已过期）；danger＝整行强调危险。 */
  tone?: 'default' | 'muted' | 'danger' | undefined;
  /** 整行是按钮时的可及名称（如「查看成果「标题」」）。 */
  label?: string | undefined;
  /** 非交互行的语义容器：列表项用 li，文章卡片用 article。 */
  as?: 'div' | 'li' | 'article' | undefined;
  /**
   * 标题与次要信息按句子折行，不截断。默认档是单行省略号，适合「任务名」「成果标题」
   * 这类标签；但简报条目与被选记忆**整句就是内容**
   * （docs/reviews/2026-09-27-ui-reuse-audit.md §4.4），省略号会把用户要看的那句话切掉。
   */
  multiline?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 列表行的唯一骨架：左槽 + 主区（标题／说明／次要信息）+ 右槽。
 *
 * 「图标 + 标题 + 副文本 + 右侧动作」这一种结构此前有 9 份独立几何，gap 从 4 到
 * 16、padding 从 `10px 2px` 到 `16px 16px`、圆角 7/8/10 各写一遍，没有一条差异
 * 来自业务需求（docs/reviews/2026-09-26-ui-consistency.md §3.4）。
 * 行内文字的尺寸也收在这里：标题 13px、说明 12px 次要、meta 12px 弱化。
 */
export function ListRow({
  variant = 'divider',
  leading,
  title,
  detail,
  meta,
  actions,
  actionsPlacement = 'side',
  trailing,
  children,
  onClick,
  selected = false,
  disabled = false,
  tone = 'default',
  as = 'div',
  className,
  label,
  multiline = false,
}: ListRowProps): React.JSX.Element {
  const classes = `list-row${className ? ` ${className}` : ''}`;
  const attributes = {
    className: classes,
    'data-variant': variant,
    'data-tone': tone,
    'data-actions-placement': actionsPlacement,
    ...(selected ? { 'data-selected': 'true' } : {}),
    ...(multiline ? { 'data-overflow': 'wrap' } : {}),
  };
  const main = (
    <div className="list-row-main">
      {title ? (
        <Tooltip className="list-row-title">
          <strong>{title}</strong>
        </Tooltip>
      ) : undefined}
      {detail ? <p className="list-row-detail">{detail}</p> : undefined}
      {meta ? <small className="list-row-meta">{meta}</small> : undefined}
      {children}
    </div>
  );
  const body = (
    <>
      {actionsPlacement === 'below' ? (
        <div className="list-row-content">
          {leading ? <span className="list-row-leading">{leading}</span> : undefined}
          {main}
          {trailing ? <span className="list-row-trailing">{trailing}</span> : undefined}
        </div>
      ) : (
        <>
          {leading ? <span className="list-row-leading">{leading}</span> : undefined}
          {main}
        </>
      )}
      {actions ? <div className="list-row-actions">{actions}</div> : undefined}
      {trailing && actionsPlacement === 'side' ? (
        <span className="list-row-trailing">{trailing}</span>
      ) : undefined}
    </>
  );

  if (onClick) {
    return (
      <button
        {...attributes}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  if (as === 'li')
    return (
      <li {...attributes} {...(disabled ? { 'data-disabled': 'true' } : {})}>
        {body}
      </li>
    );
  if (as === 'article')
    return (
      <article {...attributes} {...(disabled ? { 'data-disabled': 'true' } : {})}>
        {body}
      </article>
    );
  return (
    <div {...attributes} {...(disabled ? { 'data-disabled': 'true' } : {})}>
      {body}
    </div>
  );
}
