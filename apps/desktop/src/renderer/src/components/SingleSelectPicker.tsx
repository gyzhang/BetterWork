import type { ReactNode } from 'react';
import { useId } from 'react';

export interface PickerOption<Id extends string = string> {
  /** 与协议枚举同档的稳定 id；选中值就是它。 */
  id: Id;
  /** 选项名称：图标与色块都不承载文字，可及名称只能由它给。 */
  name: string;
  visual: ReactNode;
}

export interface SingleSelectPickerProps<Id extends string> {
  /** 这一组在选什么，例如「工作空间图标」。 */
  label: string;
  value: Id;
  options: readonly PickerOption<Id>[];
  onSelect: (id: Id) => void;
  /** 承载位置自己的钩子（对话框里的内缩之类），不得用来改本基座的几何。 */
  className?: string | undefined;
}

/**
 * 「一组具名选项里选一个」的唯一实现（docs/10 §10.1）。
 *
 * 图标选择器与色板选择器长得不一样，问的却是同一个问题：哪一档是当前档。分开写就会
 * 在对话框里各留一份选中态，那是同一族控件的第二套皮。
 *
 * 底层是**原生 radio**，不是靠切换按下态表达的按钮组：这组选项要的是「互斥取值」，
 * 原生语义自带方向键换档与同名分组，自己拼一套反而要把它重新做一遍，
 * 还会被页签护栏认成第二套 `SegmentedControl`（那个判据是对的）。
 * 换「同一块内容的哪种视图」请走 `SegmentedControl`，换「现在在哪一页」请走 `NavList`。
 */
export function SingleSelectPicker<Id extends string>({
  label,
  value,
  options,
  onSelect,
  className,
}: SingleSelectPickerProps<Id>): React.JSX.Element {
  const groupName = useId();
  return (
    <div
      className={`single-select-picker${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <label
          key={option.id}
          className="single-select-picker-option"
          title={option.name}
          data-checked={option.id === value ? 'true' : undefined}
        >
          <input
            type="radio"
            name={groupName}
            value={option.id}
            checked={option.id === value}
            aria-label={option.name}
            onChange={() => onSelect(option.id)}
          />
          <span aria-hidden="true">{option.visual}</span>
        </label>
      ))}
    </div>
  );
}
