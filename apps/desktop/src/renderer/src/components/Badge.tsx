import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'danger' | 'outline';
export type BadgeShape = 'pill' | 'tag';

export interface BadgeProps {
  /** 语义着色：默认中性，强调态用 brand，需要注意用 warning／danger。 */
  tone?: BadgeTone;
  /** 胶囊（默认）或方角标签。 */
  shape?: BadgeShape;
  className?: string;
  children: ReactNode;
}

/**
 * 状态徽标的唯一外观：一小段只读状态文字（已信任／已就绪／已过期）。
 *
 * 此前 6 套 chip 各写一遍 padding、圆角与配色组合，同一个「已启用」在技能卡与
 * 依赖面板里长得不一样（docs/reviews/2026-09-26-ui-consistency.md §3.4）。
 * 图形化标识（格式徽标、未读数角标）不在本基座范围内——它们靠字形与小于 12px
 * 的字号成立，已在字号护栏里按类名登记。
 */
export function Badge({
  tone = 'neutral',
  shape = 'pill',
  className,
  children,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={`badge${className ? ` ${className}` : ''}`}
      data-tone={tone}
      data-shape={shape}
    >
      {children}
    </span>
  );
}
