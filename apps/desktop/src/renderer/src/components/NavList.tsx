import type { ComponentType, ReactNode } from 'react';

import { Tooltip } from './Tooltip';

/** 一行的图标：只画字形，名称由按钮自己带。 */
export interface NavItemProps {
  label: ReactNode;
  icon?: ComponentType<{ size?: number }> | undefined;
  /**
   * 图标自己的颜色。工作空间行用它把身份色带进导航行——几何仍然全住在基座，
   * 换的只是一个 `color`，不为一个颜色再抄一份行。
   */
  iconColor?: string | undefined;
  /** 当前项。选中不只靠颜色：`aria-current` 与 `data-selected` 同时给出。 */
  selected?: boolean | undefined;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** 右端小标记（未读数之类）。 */
  trailing?: ReactNode | undefined;
  /** 折叠成窄栏：只留图标，文字仍留在可及名称里。 */
  rail?: boolean | undefined;
  /** 承载位置自己的钩子（侧栏那段 `.primary-nav` 只给它自己的上下内缩）。 */
  className?: string | undefined;
}

/**
 * 导航列表里的一行，也是侧栏那种「单独一颗导航行」的唯一实现。
 *
 * 侧栏一级导航、设置导航、底部「设置」行与「新建任务」此前各自抄了一份行几何
 * （`min-height` 34、`padding` 7px 9px、圆角 `--radius-row`、`font-size` 13），
 * 折叠态再各自用 `font-size: 0` 把文字压没——那会让只剩图标的按钮失去可及名称，
 * 所以窄栏改用裁切隐藏（见 `.nav-list[data-rail]`）。
 *
 * 名称一律由 `Tooltip` 基座承载：侧栏与上下文面板都是定宽列，长名字只能收短不能横滚，
 * 而收短处必须能就地读回全文——没被裁切时基座什么都不弹。
 */
export function NavItem({
  label,
  icon: Icon,
  iconColor,
  selected = false,
  onClick,
  disabled,
  trailing,
  rail = false,
  className,
}: NavItemProps): React.JSX.Element {
  const classes = `nav-item${className ? ` ${className}` : ''}`;
  return (
    <button
      className={classes}
      type="button"
      data-selected={selected ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      {...(rail ? { 'data-rail': 'true' } : {})}
      {...(disabled ? { disabled } : {})}
      {...(onClick ? { onClick } : {})}
    >
      {Icon ? (
        <span
          className="nav-item-icon"
          aria-hidden="true"
          {...(iconColor ? { style: { color: iconColor } } : {})}
        >
          <Icon size={15} />
        </span>
      ) : undefined}
      <Tooltip className="nav-item-label">{label}</Tooltip>
      {trailing}
    </button>
  );
}

/** 一个导航项：`id` 供受控列表比较，其余交给 `NavItem`。 */
export interface NavEntry<K extends string> {
  id: K;
  label: ReactNode;
  icon?: ComponentType<{ size?: number }> | undefined;
  trailing?: ReactNode | undefined;
}

export interface NavListProps<K extends string> {
  items: readonly NavEntry<K>[];
  /** 当前项。 */
  value: K;
  onSelect: (id: K) => void;
  /** 区域的名称。一串按钮没有名字，读屏就听不出它是导航（§3.1 P10）。 */
  label: string;
  /** sidebar＝带图标的窄栏；panel＝设置页那种纯文字列表。 */
  variant?: 'sidebar' | 'panel' | undefined;
  /** 窄栏折叠：只留图标，文字仍在可及名称里。 */
  rail?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 纵向导航列表的唯一实现。
 *
 * 侧栏一级导航与设置导航这类「一行一项、当前项有底色」的结构此前各自靠一个
 * `active` 类名表达选中——**CSS 类不是 ARIA**：读屏用户听到的是一串没有状态的
 * 按钮，也不知道自己在哪一项（2026-09-26 UI 一致性评估 §3.1 P10 记了 5 族 17 个
 * 按钮，全站生产代码里 `aria-current` 当时只有 `ListRow` 一处）。
 *
 * 页签（`Tabs`）与切换组（`SegmentedControl`）是另外两种模式，别拿这里当它们用：
 * 这里换的是「现在在哪一页」，不是「同一块内容的哪种视图」。
 */
export function NavList<K extends string>({
  items,
  value,
  onSelect,
  label,
  variant = 'sidebar',
  rail = false,
  className,
}: NavListProps<K>): React.JSX.Element {
  const classes = `nav-list${className ? ` ${className}` : ''}`;
  return (
    <nav
      className={classes}
      data-variant={variant}
      {...(rail ? { 'data-rail': 'true' } : {})}
      aria-label={label}
    >
      {items.map((item) => (
        <NavItem
          key={item.id}
          label={item.label}
          {...(item.icon ? { icon: item.icon } : {})}
          {...(item.trailing ? { trailing: item.trailing } : {})}
          selected={item.id === value}
          rail={rail}
          onClick={() => onSelect(item.id)}
        />
      ))}
    </nav>
  );
}
