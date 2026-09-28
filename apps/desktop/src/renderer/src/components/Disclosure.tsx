import type { ReactNode } from 'react';
import { useState } from 'react';

import { ChevronRightIcon } from '../icons';

export interface DisclosureProps {
  /** 收起时也看得见的那一行：名称，计数写在里面（「执行记录 · 7 次」）。 */
  label: ReactNode;
  /** 展开后的内容。 */
  children: ReactNode;
  /** 初次是否展开。只有一个字段的载荷默认摊开，多个字段保持收起。 */
  defaultOpen?: boolean | undefined;
  /** 承载位置的钩子（分隔线与领域内容），不得用来改这一行的几何。 */
  className?: string | undefined;
}

/**
 * 「点一行展开更多」的唯一实现（docs/10 §10.1）。
 *
 * 此前六处 `<details>` 各写一遍：`.model-sheet details` 与 `.search-settings details`
 * 的三条声明**逐字相同**（同一个「高级参数」被抄了两次），另外四处的命中区有 `8px`、
 * `12px 2px 8px` 与无内距三种，展开态的强调色只有一处有。
 *
 * 展开状态由这里自己持有：`<details open>` 是一个受控属性，不接 `onToggle` 就等于让 DOM
 * 走在 React 前面——用户点开或收起之后，React 记着的还是老值，之后任何一次「按 props 改写
 * 这一格」都会被当成没有变化而跳过。
 *
 * 展开标记也画在这里：原生 disclosure 三角在 `summary` 改成 flex 之后会消失，六处里唯一
 * 带了图标的 `.context-details` 一 flex 就没有了三角，剩下五处却还在——与应用里其他展开
 * 控件（导航分组、下拉触发器、工作过程条）一致，改用一枚会转的 SVG chevron。
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
  className,
}: DisclosureProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`disclosure${className ? ` ${className}` : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="disclosure-label">
        <ChevronRightIcon size={13} className="disclosure-marker" />
        {label}
      </summary>
      {children}
    </details>
  );
}
