// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateTipPosition, Tooltip } from './Tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LONG = '把散落在周报、会议纪要与成果里的事实汇成一份月度复盘，并为每一条结论标注来源。';

/** 浮层刻意对读屏隐藏（全文已在锚点文本里），查询时要把隐藏节点算进来。 */
const tipOf = (): HTMLElement | null => screen.queryByRole('tooltip', { hidden: true });

/** jsdom 不做排版，钳制只能靠伪造滚动盒尺寸来表达。 */
const makeClipped = (element: HTMLElement, clipped: boolean): void => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: clipped ? 60 : 20 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 20 });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 100 });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 100 });
};

const hoverClipped = (container: HTMLElement): HTMLElement => {
  const anchor = container.querySelector('.tooltip-anchor') as HTMLElement;
  makeClipped(anchor, true);
  fireEvent.mouseEnter(anchor);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  return anchor;
};

describe('Tooltip', () => {
  it('opens above the anchor when there is room', () => {
    expect(
      calculateTipPosition({
        anchor: { top: 400, bottom: 424, left: 100, width: 200 },
        tipWidth: 160,
        tipHeight: 40,
        viewportWidth: 1_200,
        viewportHeight: 800,
        placement: 'top',
      }),
    ).toEqual({ top: 354, left: 120 });
  });

  it('flips below when the tip would leave the top of the viewport', () => {
    expect(
      calculateTipPosition({
        anchor: { top: 20, bottom: 44, left: 100, width: 200 },
        tipWidth: 160,
        tipHeight: 40,
        viewportWidth: 1_200,
        viewportHeight: 800,
        placement: 'top',
      }).top,
    ).toBe(50);
  });

  it('keeps the tip inside the viewport horizontally', () => {
    expect(
      calculateTipPosition({
        anchor: { top: 400, bottom: 424, left: 1_150, width: 120 },
        tipWidth: 200,
        tipHeight: 40,
        viewportWidth: 1_200,
        viewportHeight: 800,
        placement: 'top',
      }).left,
    ).toBe(992);
  });

  it('shows the full text only after the hover delay', () => {
    vi.useFakeTimers();
    const { container } = render(<Tooltip className="expert-card-desc">{LONG}</Tooltip>);
    const anchor = container.querySelector('.tooltip-anchor') as HTMLElement;
    makeClipped(anchor, true);

    fireEvent.mouseEnter(anchor);
    expect(tipOf()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(tipOf()?.textContent).toBe(LONG);
  });

  it('never opens for a short description that is not clipped', () => {
    vi.useFakeTimers();
    const { container } = render(<Tooltip className="expert-card-desc">一行就放得下</Tooltip>);
    const anchor = container.querySelector('.tooltip-anchor') as HTMLElement;
    makeClipped(anchor, false);

    fireEvent.mouseEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(tipOf()).toBeNull();
  });

  it('closes when the pointer leaves the anchor', () => {
    vi.useFakeTimers();
    const { container } = render(<Tooltip className="expert-card-desc">{LONG}</Tooltip>);
    const anchor = hoverClipped(container);
    expect(tipOf()).not.toBeNull();

    fireEvent.mouseLeave(anchor);
    expect(tipOf()).toBeNull();
  });

  it('keeps the full text in the anchor and hides the tip from assistive technology', () => {
    vi.useFakeTimers();
    const { container } = render(<Tooltip className="expert-card-desc">{LONG}</Tooltip>);
    const anchor = hoverClipped(container);

    expect(anchor.textContent).toBe(LONG);
    expect(tipOf()?.getAttribute('aria-hidden')).toBe('true');
  });
});
