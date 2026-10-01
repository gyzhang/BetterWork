import type { ComponentType, ReactNode, Ref } from 'react';

/** 三档：`sm`＝密集条带里的 23px 方块（字形 12px），`md`＝面板头的 28px 方块（字形 14px），
 *  `row`＝与侧栏导航行同高的 34px 方块（字形 16px）。 */
const GLYPH_SIZE: Record<IconButtonSize, number> = { sm: 12, md: 14, row: 16 };

/** 命中区轴，与文字按钮的高度档（28／32／36）是两张表：方块按内容取档，不参与同排等高。 */
export type IconButtonSize = 'sm' | 'md' | 'row';

export interface IconButtonProps {
  /** 图标按钮没有可读文字，名称只能由这里给——它是必填项，不是可选项。 */
  label: string;
  /** 原生悬停提示；`label` 给可及名称，这句给人看的解释。 */
  title?: string | undefined;
  /** `icons.tsx` 里的图标组件本身。字形尺寸由 `size` 档位决定，页面不再逐处写 `size={14}`。 */
  icon: ComponentType<{ size?: number }>;
  onClick?: (() => void) | undefined;
  /** 必填：省略档位会渲染成 `md` 那一格，而同排里另一颗写了 `sm`，读起来就是「同一排两种大小」。 */
  size: IconButtonSize;
  /** 折叠与浮层触发器要给出展开状态，读屏才听得懂这个按钮在开什么。 */
  expanded?: boolean | undefined;
  disabled?: boolean | undefined;
  /** 面板自己的定位钩子（侧栏折叠按钮要 `margin-left: auto`），不承载方块几何。 */
  className?: string | undefined;
  /** 徽标一类的附加节点（未读数），渲染在方块内图标之后。 */
  trailing?: ReactNode | undefined;
  /** 浮层要拿触发器定位，所以 ref 得能交出去。 */
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  /** 图标按钮当浮层触发器时的语义（消息中心的铃铛、能力选择器）。 */
  hasPopup?: 'menu' | 'dialog' | undefined;
}

/**
 * 面板头关闭／折叠按钮的唯一实现。
 *
 * 同一个「一个小图标、悬停才出底」的方块此前有 5 份写法：24／26／30px 三种边长、
 * `--control-radius` 与 `--radius-tag` 两种圆角、字形 12／14／15px，还有两处用
 * `font-size: 19px／22px` 配合 `×` 字符量高度——那是 Unicode 图标时代的残留
 * （docs/reviews/2026-09-27-ui-reuse-audit.md §3.1 P3）。外观与语义（`aria-label`、
 * `aria-expanded`）收在一处，页面只留定位钩子。
 */
export function IconButton({
  label,
  title,
  icon: Icon,
  onClick,
  size,
  expanded,
  disabled,
  className,
  trailing,
  buttonRef,
  hasPopup,
}: IconButtonProps): React.JSX.Element {
  const classes = `icon-button${className ? ` ${className}` : ''}`;
  return (
    <button
      className={classes}
      type="button"
      data-size={size}
      aria-label={label}
      {...(title ? { title } : {})}
      {...(buttonRef ? { ref: buttonRef } : {})}
      {...(hasPopup ? { 'aria-haspopup': hasPopup } : {})}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(disabled ? { disabled } : {})}
      {...(onClick ? { onClick } : {})}
    >
      <Icon size={GLYPH_SIZE[size]} />
      {trailing}
    </button>
  );
}
