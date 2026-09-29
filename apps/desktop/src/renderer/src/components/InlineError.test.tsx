// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineError } from './InlineError';

afterEach(() => {
  cleanup();
  // 下面有一条用例监听 `console.error` 抓 React 的重复 key 警告，必须用完即还原。
  vi.restoreAllMocks();
});

/**
 * 内联反馈的唯一出口（docs/10 §11.5.1 第二落点），全仓 40 处调用共用它，此前零同名测试。
 *
 * 这里钉的是**契约**而不是当时的渲染结果：两档 tone、`message` 可省、动作槽的次序、
 * 没有动作时不长出一个空动作行。它也是护栏「`role="alert"` 只能由 InlineError 与
 * EmptyState 自写」的正向 counterpart——那条护栏只说「别人不许写」，这里说「它必须写」。
 */
describe('InlineError 基座', () => {
  it('自写 role="alert"，缺省是 danger 档', () => {
    render(<InlineError message="保存失败，请重试。" />);

    const alert = screen.getByRole('alert');
    expect(alert.dataset['tone']).toBe('danger');
    expect(alert.classList.contains('inline-error')).toBe(true);
    expect(alert.textContent).toContain('保存失败，请重试。');
  });

  it('warning 档只换语义色，不换结构', () => {
    render(<InlineError tone="warning" message="还能继续，但有风险。" />);

    expect(screen.getByRole('alert').dataset['tone']).toBe('warning');
  });

  it('只有明细、没有结论时也出一块，不硬造一句标题', () => {
    // 契约 §9.1 的「保存成功但带警告」：`message` 是可选的，`problems` 可以独撑一块。
    render(<InlineError tone="warning" problems={['第 2 行缺来源', '第 5 行超出上限']} />);

    const alert = screen.getByRole('alert');
    expect(alert.querySelector('.inline-error-message')).toBeNull();
    expect(
      [...alert.querySelectorAll('.inline-error-problems li')].map((li) => li.textContent),
    ).toEqual(['第 2 行缺来源', '第 5 行超出上限']);
  });

  it('明细排在结论下面，不另起一个块', () => {
    const { container } = render(<InlineError message="校验未通过。" problems={['名称重复']} />);

    expect(container.querySelectorAll('.inline-error')).toHaveLength(1);
    const alert = screen.getByRole('alert');
    expect([...alert.children].map((child) => child.className)).toEqual([
      'inline-error-message',
      'inline-error-problems',
    ]);
  });

  it('三个动作按「领域动作 → 重试 → 关闭」排，且都是按钮', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InlineError
        message="读取失败。"
        onRetry={onRetry}
        onDismiss={onDismiss}
        actions={<button type="button">查看条目</button>}
      />,
    );

    const labels = [
      ...screen.getByRole('alert').querySelectorAll('.inline-error-actions button'),
    ].map((button) => button.textContent);
    expect(labels).toEqual(['查看条目', '重试', '关闭']);
  });

  it('没有任何动作时长不出一个空动作行', () => {
    render(<InlineError message="这条常驻，读完也不会自己消失。" />);

    expect(screen.getByRole('alert').querySelector('.inline-error-actions')).toBeNull();
  });

  it('className 只承载定位钩子，基础类不被替换', () => {
    render(<InlineError message="成果写入失败。" className="artifact-action-error-slot" />);

    const alert = screen.getByRole('alert');
    expect(alert.classList.contains('inline-error')).toBe(true);
    expect(alert.classList.contains('artifact-action-error-slot')).toBe(true);
  });

  it('两条明细文字相同时各自占一行，不撞 React key', () => {
    // 基座此前用 `<li key={problem}>`：两条明细逐字相同就撞 key，React 会警告并可能
    // 丢掉其中一条——而「同一句校验问题出现两次」正是校验类明细最容易出现的形状。
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<InlineError problems={['名称重复', '名称重复']} />);

    // 先证两行都渲染出来了，否则「没有警告」可能只是「没有内容」。
    expect(container.querySelectorAll('.inline-error-problems li')).toHaveLength(2);
    expect(error.mock.calls.map((call) => String(call[0])).join('\n')).not.toMatch(
      /two children with the same key/u,
    );
  });
});
