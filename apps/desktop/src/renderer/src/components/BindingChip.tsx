import type { ReactNode } from 'react';

import { CloseIcon } from '../icons';

/**
 * 组合框上「已绑定的东西」那一枚片：名称 ＋ 可选内联控件 ＋ 移除 ×。
 *
 * 此前它有三份各自一套几何的拷贝（docs/reviews/2026-09-27-ui-reuse-audit.md §4.5）：
 * `.capability-chip`（24px 高、`--selection` 底、`--radius-surface`）、
 * `.material-chip`（28px 高、描边、`--radius-row`）、`.expert-chip`（胶囊、品牌色、粗体），
 * 而且专家片直接借走了能力片的 `.capability-chip-remove`——三枚片排在同一行里，
 * 高度、圆角、底色各不相同，移除按钮却只有一个类拥有样式。
 * 外壳、字号与移除按钮收在这里，差异降成 `tone` 一个维度。
 *
 * 它不是 `Badge`：`Badge` 是**只读状态文字**，这里的片可以带内联控件（材料用途下拉）
 * 并且必定可移除；也不是 `ListRow`：它排在一行里而不是占满一行。
 */
export function BindingChip({
  name,
  onRemove,
  leading,
  children,
  tone = 'default',
  disabled = false,
  removeLabel,
}: {
  /** 绑定对象的名称：同时用作悬停标题与默认的可及名称。 */
  name: string;
  onRemove: () => void;
  /** 名称前的小图标（能力／专家）；纯装饰，不进可及名称。 */
  leading?: ReactNode | undefined;
  /** 名称与移除按钮之间的内联控件，例如材料片的「用途」下拉。 */
  children?: ReactNode | undefined;
  /** brand＝专家这类带身份的主绑定；danger＝绑定还在但来源已不可用。 */
  tone?: 'default' | 'brand' | 'danger' | undefined;
  disabled?: boolean | undefined;
  /** 默认「移除 {name}」；跨语义时给全句，如「移除材料 报价表.xlsx」。 */
  removeLabel?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="binding-chip" role="listitem" data-tone={tone}>
      {leading ? (
        <span className="binding-chip-leading" aria-hidden="true">
          {leading}
        </span>
      ) : undefined}
      <span className="binding-chip-label" title={name}>
        {name}
      </span>
      {children}
      <button
        type="button"
        className="binding-chip-remove"
        aria-label={removeLabel ?? `移除 ${name}`}
        onClick={onRemove}
        disabled={disabled}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

/** 一组绑定片：横向排布、可换行，`role="list"` 让它能被读成「当前绑定了哪几样」。 */
export function BindingChipBar({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  const classes = `binding-chip-bar${className ? ` ${className}` : ''}`;
  return (
    <div className={classes} role="list" aria-label={label}>
      {children}
    </div>
  );
}
