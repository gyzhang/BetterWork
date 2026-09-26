import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * 模态基座（docs/10 §10.1）。
 *
 * 此前同一件事有四份实现：`ConfirmationDialog` 自带 inert／Esc／焦点归还，
 * `ModelEditorSheet` 只有 `aria-modal` 外壳，放映层自己写键盘，消息中心连
 * `aria-expanded` 都没有。缺的从来不是样式，而是**键盘与焦点语义**——所以这些
 * 全部收在这里，页面只提供面板内容与自己那一层的排版类：
 *
 * - 背板点击与 Esc 关闭（Esc 监听挂在 window 上：焦点可能已经走到面板深处）；
 * - 打开时 inert 掉应用主体，关闭时按原样恢复（模态叠模态不会误清）；
 * - 初始焦点落在指定元素或面板内第一个可聚焦元素，Tab 在面板内循环；
 * - 卸载时把焦点归还给触发它的元素，前提是它还在文档里；
 * - `role=dialog` / `role=alertdialog` + `aria-modal` + `aria-label`。
 *
 * 菜单类浮层（下拉、「更多」）仍归 `PopoverMenu`——那是另一套语义（不夺走整页焦点）。
 * 已经自带锚定排版的覆盖层（消息中心）复用 `useOverlaySemantics`：它缺的从来不是
 * 又一层壳，而是 Esc 能关、焦点能回来。注意被 `inert` 的是整个 `<main>`，
 * 借用者必须把覆盖层 portal 到 body——留在壳内等于把自己的面板也锁死。
 */

export type ModalVariant = 'dialog' | 'sheet' | 'viewer';

export interface ModalProps {
  /** 变体只决定几何与层级：居中对话框／右侧抽屉／全宽放映层。 */
  variant: ModalVariant;
  /** 面板的无障碍名称，中文短语，说明「这是什么」。 */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 破坏性确认走 `role="alertdialog"`，其余默认 `role="dialog"`。 */
  alert?: boolean;
  /** 各表面保留自己的排版类（`.model-sheet` 等），外壳几何仍由基座负责。 */
  className?: string;
  /** 指向描述性正文的 id（确认框用它读 detail）。 */
  describedBy?: string;
  /** 打开时优先聚焦的元素；未提供时聚焦面板内第一个可聚焦元素。 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** 默认 `true`：点背板关闭。未保存内容的抽屉应显式关掉，别让用户误丢。 */
  dismissOnBackdrop?: boolean;
  /**
   * 基座之外的按键（如放映层的左右翻页）。Esc 与 Tab 由基座处理，
   * 这里只接消费者自己的键，避免每个覆盖层再抄一遍键盘逻辑。
   */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableWithin = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('inert'),
  );

/**
 * 覆盖层的键盘与焦点语义：inert 应用主体、初始焦点、Tab 循环、Esc 关闭、卸载归还。
 * `Modal` 用它，消息中心这类锚定覆盖层也用它——语义只有一份。
 */
export function useOverlaySemantics(
  panelRef: React.RefObject<HTMLElement | null>,
  {
    onClose,
    initialFocusRef,
    trapTab = true,
  }: {
    onClose: () => void;
    initialFocusRef?: React.RefObject<HTMLElement | null> | undefined;
    trapTab?: boolean;
  },
): void {
  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement;
    const application = document.querySelector('main');
    // 模态可以叠在别的覆盖层之上：只有本层是第一个 inert 者时才负责解除。
    const wasInert = application?.hasAttribute('inert') ?? false;
    application?.setAttribute('inert', '');
    const target = initialFocusRef?.current ?? (panel ? focusableWithin(panel)[0] : undefined);
    target?.focus();

    return () => {
      if (application && !wasInert) application.removeAttribute('inert');
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [initialFocusRef, panelRef]);

  // 键盘语义单独一个 effect：消费者常传行内箭头函数，把它塞进上面那个 effect 的依赖里
  // 会让每次重渲染都重新抢一次初始焦点。订阅可以便宜地重建，挂载副作用不行。
  useEffect(() => {
    const panel = panelRef.current;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 面板内的浮层已经吃掉这次 Esc（它 preventDefault 过）时只关那一层。
        if (event.defaultPrevented) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (!trapTab || event.key !== 'Tab' || !panel) return;
      // 模态里打开的下拉菜单 portal 在 body 上，焦点落在面板之外是正常状态。
      const active = document.activeElement;
      if (active instanceof Element && active.closest('[data-overlay-layer]')) return;

      const focusable = focusableWithin(panel);
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        // 焦点被程序化移出面板时拉回来，否则 Tab 会走到背板之外。
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, panelRef, trapTab]);
}

export function Modal({
  variant,
  label,
  onClose,
  children,
  alert = false,
  className,
  describedBy,
  initialFocusRef,
  dismissOnBackdrop = true,
  onKeyDown,
}: ModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  useOverlaySemantics(panelRef, { initialFocusRef, onClose });

  return createPortal(
    <div
      className="modal-backdrop"
      data-variant={variant}
      role="presentation"
      onMouseDown={dismissOnBackdrop ? onClose : undefined}
    >
      <section
        ref={panelRef}
        className={`modal-panel${className ? ` ${className}` : ''}`}
        data-variant={variant}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={label}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
