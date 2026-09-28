// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Card, CardMark } from './Card';

afterEach(cleanup);

describe('Card', () => {
  it('身份块只承载视觉，名称与署名才是可读内容', () => {
    const { container } = render(
      <Card leading={<i data-testid="glyph" />} title="研究顾问" byline="财务组 · v1" />,
    );
    const mark = container.querySelector('.card-mark');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.card-title')?.textContent).toBe('研究顾问');
    expect(container.querySelector('.card-byline')?.textContent).toBe('财务组 · v1');
  });

  it('可点区只包住身份与说明：标签行与页脚动作点了不会误进详情', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <Card
        title="研究顾问"
        description="把材料交给它，它会给出结论与依据。"
        onOpen={onOpen}
        footer={<button type="button">删除</button>}
      >
        <span>用途标签</span>
      </Card>,
    );
    const main = container.querySelector('.card-main');
    expect(main?.textContent).toContain('把材料交给它');
    expect(main?.textContent).not.toContain('用途标签');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(main ?? container);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('不给 onOpen 就不产出按钮：结构特殊的卡只是外壳', () => {
    const { container } = render(
      <Card>
        <p>正文</p>
      </Card>,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.card')?.tagName).toBe('ARTICLE');
  });

  it('右上角主行动与点击区是兄弟，不是嵌套', () => {
    const { container } = render(
      <Card
        title="研究顾问"
        onOpen={() => undefined}
        topTrailing={<button type="button">召唤</button>}
      />,
    );
    const top = container.querySelector('.card-top');
    expect(top?.children).toHaveLength(2);
    expect(top?.querySelector('.card-main button button')).toBeNull();
    expect(screen.getByRole('button', { name: '召唤' }).parentElement).toBe(top);
  });

  it('说明交给 Tooltip 基座补全，页面不再各写一份钳制', () => {
    const { container } = render(<Card title="研究顾问" description="一句说明" />);
    expect(container.querySelector('.card-description')?.textContent).toBe('一句说明');
  });

  it('CardMark 给列表行用：同一块身份底，两处共用', () => {
    const { container } = render(
      <CardMark>
        <b>研</b>
      </CardMark>,
    );
    expect(container.querySelector('.card-mark')).not.toBeNull();
    expect(container.querySelector('.card-mark')?.getAttribute('aria-hidden')).toBe('true');
  });
});
