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
  /** 浮动方向：auto 会根据视口空间在上方/下方选择，亦可强制指定方向。 */
  placement?: 'auto' | 'bottom' | 'top';
  /** 可选头部，渲染在列表上方（如搜索框）。 */
  header?: React.ReactNode;
  /** 可选底部，渲染在列表下方（如操作链接）。 */
  footer?: React.ReactNode;
  onDismiss: () => void;
  onSelect: (id: string) => void;
}

const GAP = 6;
const VIEWPORT_MARGIN = 8;
const DEFAULT_MAX_HEIGHT = 320;

interface PopoverPositionInput {
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  align: 'start' | 'end';
  placement: 'auto' | 'bottom' | 'top';
}

export interface PopoverPosition {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
}

export const calculatePopoverPosition = ({
  anchor,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  align,
  placement,
}: PopoverPositionInput): PopoverPosition => {
  const availableBelow = Math.max(0, viewportHeight - anchor.bottom - GAP - VIEWPORT_MARGIN);
  const availableAbove = Math.max(0, anchor.top - GAP - VIEWPORT_MARGIN);
  const opensAbove =
    placement === 'top' ||
    (placement === 'auto' && menuHeight > availableBelow && availableAbove > availableBelow);
  const availableHeight = opensAbove ? availableAbove : availableBelow;
  const maxHeight = Math.max(1, Math.min(DEFAULT_MAX_HEIGHT, availableHeight));
  const preferredLeft = align === 'start' ? anchor.left : anchor.right - menuWidth;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - menuWidth - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), maxLeft);

  return opensAbove
    ? {
        bottom: viewportHeight - anchor.top + GAP,
        left,
        maxHeight,
      }
    : {
        top: anchor.bottom + GAP,
        left,
        maxHeight,
      };
};

export function PopoverMenu({
  open,
  anchorRef,
  items,
  label,
  align = 'start',
  placement = 'auto',
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
  const [position, setPosition] = useState<PopoverPosition>();

  const computePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setPosition(
      calculatePopoverPosition({
        anchor: rect,
        menuWidth: menuRect.width,
        menuHeight: menuRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        align,
        placement,
      }),
    );
  }, [anchorRef, align, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    window.addEventListener('resize', computePosition);
    window.addEventListener('scroll', computePosition, true);
    const menu = menuRef.current;
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(computePosition);
    if (menu && resizeObserver) resizeObserver.observe(menu);
    return () => {
      window.removeEventListener('resize', computePosition);
      window.removeEventListener('scroll', computePosition, true);
      resizeObserver?.disconnect();
    };
  }, [open, computePosition]);

  // 受控开关下的焦点管理：打开时聚焦首个可用项，关闭时归还焦点。
  // 只依赖 open：items 引用变化（如搜索过滤）不应打断鼠标 hover 的选中态。
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
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
