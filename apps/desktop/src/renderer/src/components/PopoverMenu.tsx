import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 受控弹层菜单基座（ADR-0012 §UI）。
 *
 * 仓库此前没有任何 Popover / Dropdown，只有 ConfirmationDialog 和 ModelEditorSheet。
 * 本组件一次性满足 Esc 关闭、点击背板关闭、焦点归还触发元素、方向键 + Home/End 导航、
 * aria-expanded / aria-haspopup / role=menu；样式只消费语义 Token，不引入定位库。
 * `+` 菜单是第一个消费者，通知面板等后续浮层应复用同一基座。
 */

export interface PopoverMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** 可选说明行（如 blockedReasons）。 */
  hint?: string;
}

export interface PopoverMenuProps {
  open: boolean;
  /** 触发按钮的 ref，用于定位与焦点归还。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  items: readonly PopoverMenuItem[];
  /** 菜单容器的 aria-label。 */
  label: string;
  /** 对齐边：start = 左对齐触发器，end = 右对齐。 */
  align?: 'start' | 'end';
  /** 浮动方向：bottom = 在触发器下方展开（默认），top = 在上方展开。 */
  placement?: 'bottom' | 'top';
  /** 可选头部，渲染在列表上方（如搜索框）。 */
  header?: React.ReactNode;
  /** 可选底部，渲染在列表下方（如操作链接）。 */
  footer?: React.ReactNode;
  onDismiss: () => void;
  onSelect: (id: string) => void;
}

const GAP = 6;

export function PopoverMenu({
  open,
  anchorRef,
  items,
  label,
  align = 'start',
  placement = 'bottom',
  header,
  footer,
  onDismiss,
  onSelect,
}: PopoverMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 可用项索引列表。
  const enabledIndices = items.reduce<number[]>(
    (acc, item, i) => (item.disabled ? acc : [...acc, i]),
    [],
  );

  // 定位计算（anchor rect → fixed 坐标）。
  const [position, setPosition] = useState<Record<string, number>>({});

  const computePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const next: Record<string, number> = {};
    if (placement === 'bottom') {
      next.top = rect.bottom + GAP;
    } else {
      // 上方展开：bottom 相对于视口底部。
      next.bottom = window.innerHeight - rect.top + GAP;
    }
    if (align === 'start') {
      next.left = rect.left;
    } else {
      next.right = window.innerWidth - rect.right;
    }
    setPosition(next);
  }, [anchorRef, align, placement]);

  useLayoutEffect(() => {
    if (open) computePosition();
  }, [open, computePosition]);

  // 受控开关下的焦点管理：打开时聚焦首个可用项，关闭时归还焦点。
  useEffect(() => {
    if (!open) return;
    const firstEnabled = items.findIndex((item) => !item.disabled);
    const target = firstEnabled >= 0 ? firstEnabled : 0;
    setActiveIndex(target);
    itemRefs.current[target]?.focus();
  }, [open, items]);

  // 键盘导航。
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (enabledIndices.length === 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const current = enabledIndices.indexOf(activeIndex);
        next = enabledIndices[(current + 1) % enabledIndices.length] ?? 0;
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const current = enabledIndices.indexOf(activeIndex);
        next = enabledIndices[(current - 1 + enabledIndices.length) % enabledIndices.length] ?? 0;
        break;
      }
      case 'Home': {
        event.preventDefault();
        next = enabledIndices[0] ?? 0;
        break;
      }
      case 'End': {
        event.preventDefault();
        next = enabledIndices[enabledIndices.length - 1] ?? 0;
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (!items[activeIndex]?.disabled) onSelect(items[activeIndex]?.id ?? '');
        return;
      }
      default:
        return;
    }
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  if (!open) return null;

  return createPortal(
    <>
      <div className="popover-backdrop" role="presentation" onMouseDown={onDismiss} />
      <div
        ref={menuRef}
        className="popover-menu"
        role="menu"
        aria-label={label}
        style={position}
        onKeyDown={handleKeyDown}
      >
        {header ? <div className="popover-menu-header">{header}</div> : undefined}
        {items.map((item, index) => (
          <div
            key={item.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled ? true : undefined}
            className={`popover-menu-item${index === activeIndex ? ' active' : ''}`}
            onClick={() => {
              if (!item.disabled) onSelect(item.id);
            }}
            onMouseEnter={() => {
              if (!item.disabled) setActiveIndex(index);
            }}
          >
            <span className="popover-menu-label">{item.label}</span>
            {item.hint ? <span className="popover-menu-hint">{item.hint}</span> : undefined}
          </div>
        ))}
        {footer ? <div className="popover-menu-footer">{footer}</div> : undefined}
      </div>
    </>,
    document.body,
  );
}
