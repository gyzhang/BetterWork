import type { ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  /** 控件下方的补充说明。只在 controlId 模式下使用：包裹式 <label> 会把说明文字读进控件名称。 */
  hint?: ReactNode;
  /** 控件自身的 id。给出时用 htmlFor 精确关联，Field 退化成普通容器；否则整个 Field 就是 <label>。 */
  controlId?: string;
  className?: string;
  children: ReactNode;
}

/**
 * 表单字段的唯一结构：标签 + 控件 + 可选说明。
 *
 * 此前每个视图各写一份 `label { display: flex; gap: …; font-size: … }`，同一屏里
 * 因此出现两种标签字号与两种标签—控件间距（docs/reviews/2026-09-26-ui-consistency.md §3.2）。
 * 间距由 Field 自己的 gap 拥有，页面不得再给标签或控件补上下 margin（docs/10 §9.8）。
 */
export function Field({
  label,
  hint,
  controlId,
  className,
  children,
}: FieldProps): React.JSX.Element {
  const fieldClass = `field${className ? ` ${className}` : ''}`;
  const hintNode = hint ? <span className="field-hint">{hint}</span> : undefined;
  if (controlId) {
    return (
      <div className={fieldClass}>
        <label className="field-label" htmlFor={controlId}>
          {label}
        </label>
        {children}
        {hintNode}
      </div>
    );
  }
  return (
    <label className={fieldClass}>
      <span className="field-label">{label}</span>
      {children}
      {hintNode}
    </label>
  );
}
