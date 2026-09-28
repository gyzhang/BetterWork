import type { ReactNode } from 'react';

import { Tooltip } from './Tooltip';

export interface CardProps {
  /** 名称左边的身份块：图标或首字。36×36 方格由基座给，内容自己带。 */
  leading?: ReactNode | undefined;
  /** 卡片的名字。结构特殊的卡（如记忆建议卡）可以不传，主区整块走 `children`。 */
  title?: ReactNode | undefined;
  /** 名称下方那一行署名：来源、作者与版本号。 */
  byline?: ReactNode | undefined;
  /** 说明。**一律三行定高**，被裁切时由 `Tooltip` 补全——短描述不弹，长描述才弹。 */
  description?: ReactNode | undefined;
  /** 提供后「身份 + 名称 + 说明」是卡片的点击区；标签行与页脚动作留在点击区之外。 */
  onOpen?: (() => void) | undefined;
  /** 右上角主行动（悬停才显形的那一颗）。它和 `onOpen` 是兄弟，不是嵌套。 */
  topTrailing?: ReactNode | undefined;
  /** 说明之后的展开内容：用途标签、状态提示。 */
  children?: ReactNode | undefined;
  /** 页脚：一排就地动作。缝由卡片的 `gap` 拥有，动作自己不带外边距。 */
  footer?: ReactNode | undefined;
  /** 承载位置的钩子（网格定位与领域内容），不得用来改外壳几何。 */
  className?: string | undefined;
}

/** 卡片与列表行共用的身份块（36×36 的品牌底）：图标或首字，纯装饰。 */
export function CardMark({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="card-mark" aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * 卡片外壳与卡片内容排版的唯一出口（docs/10 §10.1）。
 *
 * `ListRow` 的 `card` 档早就把「图标 + 名称 + 说明 + 动作」收成一份几何，网格里的卡片
 * 却各自另起一套外壳：五套内距（`16px`／`11px 12px`／`10px`／`10px 12px`）、两种圆角
 * （成果输入卡跳到 `--radius-row`），而 `.skill-card-head` 与 `.expert-card-head`、
 * `.skill-card-desc` 与 `.expert-card-desc` 是**逐字相同的两份规则**。列表模式一直站在
 * 基座上，卡片模式没有——同一条数据的两种视图，本应只差排布。
 *
 * 外壳四件套（内距、底、边框、圆角）住在 `styles.css` 里 `.card` 与
 * `.list-row[data-variant='card']` 共用的那一条规则上；两者只在方向上分家：
 * 行是横向的「左槽 + 主区 + 右槽」，卡是纵向的「身份 + 名称 + 说明 + 展开 + 页脚」。
 */
export function Card({
  leading,
  title,
  byline,
  description,
  onOpen,
  topTrailing,
  children,
  footer,
  className,
}: CardProps): React.JSX.Element {
  const classes = `card${className ? ` ${className}` : ''}`;
  const head =
    leading || title || byline ? (
      <div className="card-head">
        {leading ? <CardMark>{leading}</CardMark> : undefined}
        <span className="card-names">
          <strong className="card-title">{title}</strong>
          {byline ? <small className="card-byline">{byline}</small> : undefined}
        </span>
      </div>
    ) : (
      <strong className="card-title">{title}</strong>
    );
  const main = (
    <>
      {head}
      {description ? <Tooltip className="card-description">{description}</Tooltip> : undefined}
    </>
  );
  const body = onOpen ? (
    <button className="card-main" type="button" onClick={onOpen}>
      {main}
    </button>
  ) : (
    main
  );
  return (
    <article className={classes}>
      {topTrailing ? (
        <div className="card-top">
          {body}
          {topTrailing}
        </div>
      ) : (
        body
      )}
      {children}
      {footer ? <div className="card-footer">{footer}</div> : undefined}
    </article>
  );
}
