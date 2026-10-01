import { useCallback, useMemo, useRef, useState } from 'react';

import { ChevronLeftIcon } from '../icons';
import type { ControlSize } from './Button';
import { PopoverMenu } from './PopoverMenu';

export interface FieldSelectOption {
  id: string;
  label: string;
  /** 不可选项（如已停用的模型、即将支持的引擎）：菜单里可见但选不动，与原生 disabled 一致。 */
  disabled?: boolean;
}

export interface FieldSelectProps {
  options: readonly FieldSelectOption[];
  value: string;
  onChange: (id: string) => void;
  /** 可及名称。在 `Field` 的包裹式 label 里可以省略，由标签文字提供。 */
  ariaLabel?: string;
  /** 必填：与同排控件共用 `--control-height-*` 档位（docs/10 §9.10「动作排」）。 */
  size: ControlSize;
  /** 供 `Field` 的 htmlFor 关联。 */
  id?: string;
  disabled?: boolean;
}

/**
 * 基于 PopoverMenu 的下拉选择器，替代浏览器原生下拉框。
 * 触发按钮与表单输入框保持同一高度与边框风格，
 * 弹层走 PopoverMenu 的键盘导航、焦点管理与视口定位。
 */
export function FieldSelect({
  options,
  value,
  onChange,
  ariaLabel,
  size,
  id,
  disabled = false,
}: FieldSelectProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const selectedLabel = useMemo(() => {
    const found = options.find((opt) => opt.id === value);
    return found?.label ?? '';
  }, [options, value]);

  const menuItems = useMemo(
    () =>
      options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        ...(opt.disabled ? { disabled: true } : {}),
      })),
    [options],
  );

  const handleSelect = useCallback(
    (optionId: string) => {
      onChange(optionId);
      setOpen(false);
    },
    [onChange],
  );

  const handleDismiss = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="field-select-trigger"
        data-size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="field-select-label" title={selectedLabel || undefined}>
          {selectedLabel}
        </span>
        <ChevronLeftIcon size={14} className={`field-select-chevron${open ? ' open' : ''}`} />
      </button>
      <PopoverMenu
        open={open}
        anchorRef={triggerRef}
        items={menuItems}
        label={ariaLabel ?? selectedLabel}
        placement="bottom"
        onDismiss={handleDismiss}
        onSelect={handleSelect}
      />
    </>
  );
}
