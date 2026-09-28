// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TransientToast } from './TransientToast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.getElementById('toast-stack')?.remove();
});

/**
 * 短时确认浮层（docs/10 §11.5.1 第一落点）。
 *
 * 这里守的是「自消」这个承诺本身：计时只能由「换了哪一句、换了哪一档」重启，不能由宿主
 * 重渲染重启。2026-09-28 核实的真缺陷正是后者——`onDismiss` 被列进依赖数组，而调用点写的
 * 是内联箭头函数，运行中每次重渲染都把 4s／6s 清零，浮层可能永远不消失。修法在基座（回调
 * 经 ref 转发），不在调用点：包五个 `useCallback` 拦不住下一个页面。
 */
describe('TransientToast 基座', () => {
  it('宿主重渲染换掉 onDismiss 标识时不重新计时', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <TransientToast tone="success" message="已保存为成果" onDismiss={onDismiss} />,
    );

    vi.advanceTimersByTime(3_000);
    // 调用点写内联箭头时，每次重渲染传进来的都是一个全新的函数对象。
    rerender(
      <TransientToast
        tone="success"
        message="已保存为成果"
        onDismiss={() => {
          onDismiss();
        }}
      />,
    );
    vi.advanceTimersByTime(3_000);

    expect(
      onDismiss,
      '成功档 4s 自消；计时若被重渲染重启，累计 6s 时它一次都没被调用过',
    ).toHaveBeenCalledTimes(1);
  });

  it('成功档 4s、错误档 6s', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <TransientToast tone="success" message="Skill 已导入" onDismiss={onDismiss} />,
    );

    vi.advanceTimersByTime(3_999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<TransientToast tone="error" message="打不开这条任务" onDismiss={onDismiss} />);
    vi.advanceTimersByTime(5_999);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('换一句 message 才重新计时', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <TransientToast tone="success" message="第一句" onDismiss={onDismiss} />,
    );

    vi.advanceTimersByTime(3_000);
    rerender(<TransientToast tone="success" message="第二句" onDismiss={onDismiss} />);
    vi.advanceTimersByTime(3_000);
    expect(onDismiss, '换句那一刻计时归零，此时新计时只走了 3s').not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮立刻收起，卸载后不再补触发', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <TransientToast tone="error" message="跨空间引用被拒" onDismiss={onDismiss} />,
    );

    fireEvent.click(document.querySelector('.icon-button') as HTMLElement);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(10_000);
    expect(
      onDismiss,
      '卸载要清掉计时器，否则会在浮层消失后再清空一次宿主状态',
    ).toHaveBeenCalledTimes(1);
  });

  it('两条浮层共用一枚 #toast-stack，且是礼貌播报不抢读屏', () => {
    render(<TransientToast tone="success" message="已导入" onDismiss={vi.fn()} />);
    render(<TransientToast tone="error" message="打不开" onDismiss={vi.fn()} />);

    const stacks = document.querySelectorAll('#toast-stack');
    expect(stacks, '浮层几何只住一处，页面不得再给自己的提示块写 position: fixed').toHaveLength(1);
    expect(stacks[0]?.querySelectorAll('.toast')).toHaveLength(2);
    expect(stacks[0]?.getAttribute('aria-live')).toBe('polite');
    expect(stacks[0]?.querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(stacks[0]?.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});
