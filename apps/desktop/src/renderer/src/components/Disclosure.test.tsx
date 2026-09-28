// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Disclosure } from './Disclosure';

afterEach(cleanup);

describe('Disclosure', () => {
  it('一行名称加展开内容：标记是装饰，名称才是可读内容', () => {
    const { container } = render(
      <Disclosure label="执行记录 · 7 次">
        <p>两次运行</p>
      </Disclosure>,
    );
    const label = container.querySelector('.disclosure-label');
    expect(container.querySelector('details.disclosure')).not.toBeNull();
    expect(label?.tagName).toBe('SUMMARY');
    expect(label?.textContent).toBe('执行记录 · 7 次');
    expect(label?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('默认收起，单字段载荷这类场景用 defaultOpen 摊开', () => {
    const closed = render(
      <Disclosure label="高级参数">
        <p>上下文 Token</p>
      </Disclosure>,
    );
    expect(closed.container.querySelector('details')?.hasAttribute('open')).toBe(false);
    const opened = render(
      <Disclosure label="输入参数" defaultOpen={true}>
        <p>模型名称</p>
      </Disclosure>,
    );
    expect(opened.container.querySelector('details')?.hasAttribute('open')).toBe(true);
  });

  it('点一行展开、再点收起，React 记着的状态跟着 DOM 走', () => {
    const { container } = render(
      <Disclosure label="高级参数">
        <p>上下文 Token</p>
      </Disclosure>,
    );
    const details = container.querySelector('details');
    fireEvent.click(screen.getByText('高级参数'));
    expect(details?.hasAttribute('open')).toBe(true);
    fireEvent.click(screen.getByText('高级参数'));
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('领域钩子只承载位置：类留在 details 上，行本身的类不换', () => {
    const { container } = render(
      <Disclosure className="task-run-history" label="执行记录">
        <p>内容</p>
      </Disclosure>,
    );
    expect(container.querySelector('details')?.className).toBe('disclosure task-run-history');
    expect(container.querySelector('.disclosure-label')?.tagName).toBe('SUMMARY');
  });
});
