import type { ComponentProps, ReactNode } from 'react';

/**
 * 八档外观语义。只描述「这颗按钮在这一排里是什么身份」，不描述尺寸——
 * 尺寸是 `size` 的事。ADR-0031 之前这里有 11 套各自带几何的具名皮。
 *
 * `link` 是清点时才补上的一档：`.capability-locate-link`、`.material-global-toggle`、
 * `.back-button` 与错误条里的「重试」写的是同一种「只有文字、悬停才认得出可点」，
 * 但它一直没有名字，于是四处各造一套、`padding` 从 0 到 5px 都有。
 * 一档形态没有名字，就等于没有这一档。
 */
export type ButtonVariant =
  'primary' | 'secondary' | 'text' | 'outline' | 'quiet' | 'chip' | 'danger' | 'link';

/** 三档几何，一对一绑 `--control-height-*`；页面不再用 padding 自己撑高度。 */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** 描边与文字的语义色，只对三档带边框的 variant（secondary／text／outline）生效。 */
export type ButtonTone = 'neutral' | 'brand' | 'danger';

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  /** 可见内容：文字，或「图标＋文字」的片段。 */
  children: ReactNode;
  variant?: ButtonVariant | undefined;
  /** 缺省 `md`。刻意不按 `variant` 给条件缺省：主行动要不要比同排高一档，是页面那一刻的选择。 */
  size?: ButtonSize | undefined;
  tone?: ButtonTone | undefined;
  /** 只承载定位钩子（如 `margin-left: auto`），不得承载外观。 */
  className?: string | undefined;
}

/**
 * 按钮的唯一出口（ADR-0031）。
 *
 * 此前「按钮长什么样」由 11 套具名皮、12 处页面级容器后代规则和 16 种 `padding`
 * 组合共同回答，其中 7 处动作按钮连 `min-height` 都没有——三档高度 Token 对它们
 * 根本不生效。样式类方案的问题不在类本身，在于没有一处能拦住下一个页面再造一档，
 * 所以「不组件化以免多出第二处真相」并没有真的守住唯一性。
 *
 * 这里把颜色（`variant`）与几何（`size`）切成两个正交维度：皮只住在 `.btn`
 * ＋ `[data-variant]`／`[data-size]`／`[data-tone]` 一处，档位集合与
 * `ButtonVariant` 由护栏穷举比对，多一档少一档都编译不过、测不过。
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  tone = 'neutral',
  className,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      className={className ? `btn ${className}` : 'btn'}
      type={type}
      data-variant={variant}
      data-size={size}
      data-tone={tone}
    >
      {children}
    </button>
  );
}
