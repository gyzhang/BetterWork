// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StatusNote } from './StatusNote';

afterEach(() => {
  cleanup();
});

/**
 * 状态轴基座（docs/10 §11.5.2）。
 *
 * 这里守的是两轴的分界：`InlineError` 承载「你刚做的那一下怎么样了」并自写
 * `role="alert"`，`StatusNote` 只交代「这个对象现在是什么」，所以它既不是浮层、
 * 也不该打断读屏。迁移前这十三个字面散在八个自造类名里，一个用例都没有。
 */
describe('StatusNote 基座', () => {
  it('语义只通过 data-tone 表达，外观全在 .status-note 一处', () => {
    const { container } = render(<StatusNote tone="warning" message="有 2 项阻塞原因。" />);

    const note = container.querySelector('.status-note') as HTMLElement;
    expect(note.dataset['tone']).toBe('warning');
    expect(container.querySelector('.status-note-message')?.textContent).toBe('有 2 项阻塞原因。');
  });

  it('默认是中性一行，不带多余类名', () => {
    const { container } = render(<StatusNote message="依赖：资料 3 项。" />);

    const note = container.querySelector('.status-note') as HTMLElement;
    expect(note.getAttribute('class')).toBe('status-note');
    expect(note.dataset['tone']).toBe('neutral');
  });

  it('只有明细时也出一行，不硬造一句结论', () => {
    const { container } = render(
      <StatusNote tone="warning" problems={['尚未信任', '环境未准备']} />,
    );

    expect(container.querySelector('.status-note-message')).toBeNull();
    const items = [...container.querySelectorAll('.status-note-problems li')];
    expect(items.map((item) => item.textContent)).toEqual(['尚未信任', '环境未准备']);
  });

  it('常驻状态不是警报：基座不自写 role="alert"', () => {
    // `role="alert"` 会让读屏在每次渲染时打断用户；一句「现在如此」的说明不该有这待遇。
    // 这条同时是护栏「内联错误必须走 InlineError 基座」的反面证据：全仓只有两处自写它。
    const { container } = render(<StatusNote tone="danger" message="这条记录已过期。" />);

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('className 只承载定位钩子，基础类与档位不被替换', () => {
    const { container } = render(
      <StatusNote tone="success" message="当前依赖已有有效执行授权。" className="grant-state" />,
    );

    const note = container.querySelector('.grant-state') as HTMLElement;
    expect(note.classList.contains('status-note')).toBe(true);
    expect(note.dataset['tone']).toBe('success');
  });
});
