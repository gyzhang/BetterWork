// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsyncButton, InlineLoading } from './AsyncButton';

afterEach(cleanup);

describe('AsyncButton', () => {
  it('忙碌时禁用自己并宣告 busy，文案换成进行中的那一句', () => {
    render(<AsyncButton label="保存修订" busyLabel="正在保存…" busy onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('正在保存…');
  });

  it('不忙碌时可点，且只留 idle 文案一份（隐藏的副本会把文本混进可及名称）', () => {
    const onClick = vi.fn();
    render(<AsyncButton label="保存修订" busyLabel="正在保存…" busy={false} onClick={onClick} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('保存修订');
    expect(button.getAttribute('aria-busy')).toBe('false');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('外观委托给 Button 基座：皮类只有一枚，档位走 data 属性', () => {
    const { rerender } = render(
      <AsyncButton label="导入" busyLabel="正在导入…" busy variant="primary" size="lg" />,
    );
    const button = screen.getByRole('button');
    expect(button.className).toBe('btn');
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(button.getAttribute('data-size')).toBe('lg');
    // 缺省档位由 Button 给（md），AsyncButton 不再自己造一套「无皮」的中间态。
    rerender(<AsyncButton label="导入" busyLabel="正在导入…" busy />);
    const fallback = screen.getByRole('button');
    expect(fallback.className).toBe('btn');
    expect(fallback.getAttribute('data-variant')).toBe('secondary');
    expect(fallback.getAttribute('data-size')).toBe('md');
  });

  it('定位钩子类留在 className 上，与基座的 .btn 并存', () => {
    render(
      <AsyncButton
        label="导入"
        busyLabel="正在导入…"
        busy={false}
        className="expert-card-summon"
      />,
    );
    expect(screen.getByRole('button').className).toBe('btn expert-card-summon');
  });

  it('额外的禁用条件与忙碌同样生效', () => {
    render(
      <AsyncButton label="提交" busyLabel="正在提交…" busy={false} disabled onClick={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  });
});

describe('InlineLoading', () => {
  it('以 status 播报，并带一个不进可及名称的旋转指示器', () => {
    render(<InlineLoading label="正在读取条目…" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('正在读取条目…');
    expect(status.getAttribute('aria-busy')).toBe('true');
    const spinner = status.querySelector('.spinner');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
  });
});
