// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

afterEach(cleanup);

describe('Button 基座（ADR-0031）', () => {
  it('皮只有一枚 .btn，档位与颜色走 data 属性', () => {
    render(
      <Button variant="chip" size="sm">
        刷新
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.className).toBe('btn');
    expect(button.getAttribute('data-variant')).toBe('chip');
    expect(button.getAttribute('data-size')).toBe('sm');
  });

  it('颜色与类型有缺省，档位没有缺省：高度只能由调用点写明', () => {
    render(<Button size="md">取消</Button>);
    const button = screen.getByRole('button');
    expect(button.getAttribute('data-variant')).toBe('secondary');
    expect(button.getAttribute('data-tone')).toBe('neutral');
    // `size` 是必填属性（docs/10 §9.10「动作排」）：写了 md 就落在 md 上，
    // 不存在「不写」这第三种高度——原来的隐式 md 让同排两颗按钮能差 4px 而无人报错。
    expect(button.getAttribute('data-size')).toBe('md');
  });

  it('type 缺省 button，提交键要显式声明', () => {
    render(<Button size="md">保存</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('className 只作为定位钩子与 .btn 并存，不替换基座皮', () => {
    render(
      <Button size="md" className="latest-message-pill">
        有新消息
      </Button>,
    );
    expect(screen.getByRole('button').className).toBe('btn latest-message-pill');
  });

  it('原生属性与 aria 透传，可及名称不因换基座而改变', () => {
    const onClick = vi.fn();
    render(
      <Button size="md" aria-label="放大查看第 2 页" aria-expanded disabled onClick={onClick}>
        原文
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('放大查看第 2 页');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('tone 由调用方给出，落在 data-tone 上供描边档读取', () => {
    render(
      <Button size="md" variant="outline" tone="danger">
        删除
      </Button>,
    );
    expect(screen.getByRole('button').getAttribute('data-tone')).toBe('danger');
  });
});
