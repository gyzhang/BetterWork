import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 被裁切文本的悬停浮层（docs/10 §10.1）。
 *
 * 台账里 Tooltip 一直没落地，页面要么把整段描述摊开撑破卡片，要么用 `::after` 自造浮层。
 * 本基座只做一件事：**锚点自己的文字被裁掉了，就把完整文本浮出来**；没被裁切就什么都不发生
 * ——短描述悬停也弹一句全文，读起来像控件坏了。
 *
 * 完整文本一直在 DOM 里（行数钳制只裁视觉，不裁可及名称），所以浮层对读屏是重复信息：
 * 这里显式 `aria-hidden`，不再挂 `aria-describedby`，避免同一段话被念两遍。
 */

const HOVER_DELAY_MS = 300;
const GAP = 6;
const VIEWPORT_MARGIN = 8;

export interface TooltipProps {
  /** 可能被裁切的那段文本。 */
  children: React.ReactNode;
  /** 领域钩子类（如 `.expert-card-desc`）：钳制、字号与高度由它决定。 */
  className?: string | undefined;
  /** 优先朝上还是朝下；空间不够时基座自己翻边。 */
  placement?: 'top' | 'bottom' | undefined;
}

interface TipPosition {
  top: number;
  left: number;
}

interface TipPositionInput {
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>;
  tipWidth: number;
  tipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  placement: 'top' | 'bottom';
}

export const calculateTipPosition = ({
  anchor,
  tipWidth,
  tipHeight,
  viewportWidth,
  viewportHeight,
  placement,
}: TipPositionInput): TipPosition => {
  const fitsAbove = anchor.top - GAP - tipHeight >= VIEWPORT_MARGIN;
  const fitsBelow = anchor.bottom + GAP + tipHeight <= viewportHeight - VIEWPORT_MARGIN;
  const opensAbove = placement === 'bottom' ? !fitsBelow && fitsAbove : fitsAbove || !fitsBelow;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - tipWidth - VIEWPORT_MARGIN);
  const preferredLeft = anchor.left + (anchor.width - tipWidth) / 2;

  return {
    top: opensAbove ? anchor.top - GAP - tipHeight : anchor.bottom + GAP,
    left: Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), maxLeft),
  };
};

/** 钳制只改视觉：内容高度或宽度超出盒子，才算「真的被裁了」。 */
const isClipped = (element: HTMLElement): boolean =>
  element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;

export function Tooltip({
  children,
  className,
  placement = 'top',
}: TooltipProps): React.JSX.Element {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [text, setText] = useState('');
  const [position, setPosition] = useState<TipPosition>();

  const dismiss = useCallback((): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setText('');
    setPosition(undefined);
  }, []);

  const reveal = useCallback((delay: number): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const anchor = anchorRef.current;
    if (!anchor || !isClipped(anchor)) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      const element = anchorRef.current;
      if (!element) return;
      setPosition(undefined);
      setText(element.textContent ?? '');
    }, delay);
  }, []);

  useEffect(() => dismiss, [dismiss]);

  // 浮层尺寸要渲染之后才知道，所以先渲染再量，定位落在同一帧的 layout 阶段。
  useLayoutEffect(() => {
    if (text === '' || position) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    setPosition(
      calculateTipPosition({
        anchor: anchor.getBoundingClientRect(),
        tipWidth: tip.offsetWidth,
        tipHeight: tip.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        placement,
      }),
    );
  }, [text, position, placement]);

  const open = text !== '';

  // 滚动与缩放之后，浮层不留在原地。
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open, dismiss]);

  return (
    <>
      <span
        ref={anchorRef}
        className={`tooltip-anchor${className ? ` ${className}` : ''}`}
        onMouseEnter={() => reveal(HOVER_DELAY_MS)}
        onMouseLeave={dismiss}
        onFocus={() => reveal(0)}
        onBlur={dismiss}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              ref={tipRef}
              className="tooltip"
              role="tooltip"
              aria-hidden="true"
              style={position}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
