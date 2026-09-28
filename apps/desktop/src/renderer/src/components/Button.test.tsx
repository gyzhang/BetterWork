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

  it('缺省是 secondary × md × neutral，不再出现「没有皮」的按钮', () => {
    render(<Button>取消</Button>);
    const button = screen.getByRole('button');
    expect(button.getAttribute('data-variant')).toBe('secondary');
    expect(button.getAttribute('data-size')).toBe('md');
    expect(button.getAttribute('data-tone')).toBe('neutral');
  });

  it('type 缺省 button，提交键要显式声明', () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('className 只作为定位钩子与 .btn 并存，不替换基座皮', () => {
    render(<Button className="latest-message-pill">有新消息</Button>);
    expect(screen.getByRole('button').className).toBe('btn latest-message-pill');
  });

  it('原生属性与 aria 透传，可及名称不因换基座而改变', () => {
    const onClick = vi.fn();
    render(
      <Button aria-label="放大查看第 2 页" aria-expanded disabled onClick={onClick}>
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
      <Button variant="outline" tone="danger">
        删除
      </Button>,
    );
    expect(screen.getByRole('button').getAttribute('data-tone')).toBe('danger');
  });
});
