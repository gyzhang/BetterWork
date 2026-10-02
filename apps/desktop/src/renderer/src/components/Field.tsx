import type { ReactNode } from 'react';
import { useId } from 'react';

export interface FieldProps {
  label: ReactNode;
  /** 控件下方的补充说明。只在 controlId 或 group 模式下使用。 */
  hint?: ReactNode;
  /** 单控件自身的 id，用 htmlFor 精确关联；既无 controlId 也无 group 时整个 Field 是 label。 */
  controlId?: string;
  /** 多个控件或已有内部标签的选择组，不能再包进单个 label。 */
  group?: boolean;
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
  group = false,
  className,
  children,
}: FieldProps): React.JSX.Element {
  const labelId = useId();
  const hintId = useId();
  const fieldClass = `field${className ? ` ${className}` : ''}`;
  const hintNode = hint ? (
    <span className="field-hint" id={hintId}>
      {hint}
    </span>
  ) : undefined;
  if (group) {
    return (
      <div
        className={fieldClass}
        role="group"
        aria-labelledby={labelId}
        {...(hint ? { 'aria-describedby': hintId } : {})}
      >
        <span className="field-label" id={labelId}>
          {label}
        </span>
        {children}
        {hintNode}
      </div>
    );
  }
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
