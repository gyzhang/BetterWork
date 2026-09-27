import type { ReactNode } from 'react';

export interface CheckOption<K extends string> {
  id: K;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean | undefined;
  /** 悬停说明（MCP 工具的描述这类）。原生 `title` 是这里唯一的兜底通道。 */
  hint?: string | undefined;
}

export interface CheckListProps<K extends string> {
  options: readonly CheckOption<K>[];
  onToggle: (id: K, checked: boolean) => void;
  /**
   * 区域名称。给了才写 `role="group"` ＋ `aria-label`；
   * 已经在 `<fieldset><legend>` 里的列表不要再包一层语义，legend 就是它的名字。
   */
  label?: string | undefined;
  /** 一个候选都没有时的那句话——不渲染成空列表。 */
  empty?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * 复选框选项组的唯一结构。
 *
 * 「一行一个 `label` ＋ 复选框 ＋ 名称」这种列表此前在专家编辑与上下文面板里各写一遍，
 * 并且**共用了一个带领域名的类**：上下文面板借 `.expert-option-list`，专家页借
 * 上下文面板的 `.selected-mcp-list`（docs/reviews/2026-09-27-ui-reuse-audit.md §4.5）——
 * 改任何一处外观都会炸到另一个页面。结构与外观收到这里，领域名留在页面自己的容器上。
 *
 * 勾选行不是「标签＋控件」的表单字段，所以它不归 `Field` 管（docs/10 §10.1）；
 * 但多选与全选仍然是原生 `checkbox`，不要为了统一把它们塞进开关控件。
 */
export function CheckList<K extends string>({
  options,
  onToggle,
  label,
  empty,
  className,
}: CheckListProps<K>): React.JSX.Element {
  const classes = `check-list${className ? ` ${className}` : ''}`;
  if (options.length === 0) return <div className={classes}>{empty}</div>;
  return (
    <div className={classes} {...(label ? { role: 'group', 'aria-label': label } : {})}>
      {options.map((option) => (
        <label className="check-list-item" key={option.id}>
          <input
            type="checkbox"
            checked={option.checked}
            {...(option.disabled ? { disabled: true } : {})}
            {...(option.hint ? { title: option.hint } : {})}
            onChange={(event) => onToggle(option.id, event.target.checked)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
