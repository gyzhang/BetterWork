import { useCallback, useMemo, useRef, useState } from 'react';

import { ChevronLeftIcon } from '../icons';
import { PopoverMenu } from './PopoverMenu';

export interface FieldSelectOption {
  id: string;
  label: string;
}

export interface FieldSelectProps {
  options: readonly FieldSelectOption[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

/**
 * 基于 PopoverMenu 的下拉选择器，替代原生 <select>。
 * 触发按钮与表单输入框保持同一高度与边框风格，
 * 弹层走 PopoverMenu 的键盘导航、焦点管理与视口定位。
 */
export function FieldSelect({
  options,
  value,
  onChange,
  ariaLabel,
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
      })),
    [options],
  );

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
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
        type="button"
        className="field-select-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="field-select-label">{selectedLabel}</span>
        <ChevronLeftIcon size={14} className={`field-select-chevron${open ? ' open' : ''}`} />
      </button>
      <PopoverMenu
        open={open}
        anchorRef={triggerRef}
        items={menuItems}
        label={ariaLabel}
        placement="bottom"
        onDismiss={handleDismiss}
        onSelect={handleSelect}
      />
    </>
  );
}
