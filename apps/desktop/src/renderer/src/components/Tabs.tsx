import type { ReactNode } from 'react';
import { useRef } from 'react';

export interface TabItem<K extends string> {
  id: K;
  label: ReactNode;
}

export interface TabsProps<K extends string> {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (id: K) => void;
  /** 页签带的可及名称（`aria-label`）。 */
  label: string;
  /** 均分整条页签带；默认按内容取宽。 */
  fill?: boolean;
  className?: string;
}

/**
 * 页签基座：`tablist` + roving tabindex + 左右方向键。
 *
 * WAI-ARIA 的页签模式要求「Tab 只进出页签带、组内切换交给方向键」。此前
 * `MemoryView` 与 `ContextPanel` 两处都只有 `role` 与 `aria-selected`，键盘
 * 用户只能一个一个 Tab 过去（docs/reviews/2026-09-26-ui-consistency.md §3.3）。
 * 切换采用 automatic activation：方向键直接改选中项，页签带里的筛选面板没有
 * 惰性渲染的必要。
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  fill,
  className,
}: TabsProps<K>): React.JSX.Element {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = items.findIndex((item) => item.id === value);
  // 选中项缺失时（如筛选后该组为空）让首项仍可被 Tab 命中，否则整条页签带进不去。
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const activate = (index: number): void => {
    const item = items[index];
    if (!item) return;
    onChange(item.id);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (items.length === 0) return;
    // 从当前焦点出发而不是从 value 出发：受控父组件重渲染之前连按方向键也应连续走格。
    const focused = tabRefs.current.findIndex((node) => node === document.activeElement);
    const current = focused >= 0 ? focused : tabbableIndex;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        activate((current + 1) % items.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        activate((current - 1 + items.length) % items.length);
        break;
      case 'Home':
        event.preventDefault();
        activate(0);
        break;
      case 'End':
        event.preventDefault();
        activate(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={`tabs${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={label}
      {...(fill ? { 'data-fill': 'true' } : {})}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          tabIndex={index === tabbableIndex ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface SegmentedControlProps<K extends string> {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (id: K) => void;
  /** 分组的可及名称（`aria-label`）。 */
  label: string;
  className?: string;
}

/**
 * 切换按钮组：`role=group` + `aria-pressed`，每个按钮都参与 Tab 顺序。
 *
 * 与页签的区别在于它切换的是「同一片内容的呈现方式」，不是互斥的面板；
 * 技能页的卡片／列表就是这一类。收在这里是为了让这个模式有名字，
 * 不再每次由页面自己拼一组带 `aria-pressed` 的按钮。
 */
export function SegmentedControl<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<K>): React.JSX.Element {
  return (
    <div
      className={`segmented-control${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
