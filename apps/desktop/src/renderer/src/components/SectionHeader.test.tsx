// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SectionHeader } from './SectionHeader';

afterEach(() => {
  cleanup();
});

describe('SectionHeader 基座', () => {
  it('标题渲染成真的标题元素，说明落在自己的槽位里', () => {
    const { container } = render(<SectionHeader title="经验建议" hint="候选不会自动生效" />);

    // 冒充标题的 16 处用的是 `<strong>`：它不进文档大纲，读屏也跳不过去。
    const heading = container.querySelector('h3.section-header-title') as HTMLElement;
    expect(heading.textContent).toBe('经验建议');
    expect(container.querySelector('.section-header-text > strong')).toBeNull();
    expect(container.querySelector('.section-header-hint')?.textContent).toBe('候选不会自动生效');
  });

  it('block 变体给页面区块用 h2，并按 eyebrow＋标题＋说明排序', () => {
    const { container } = render(
      <SectionHeader
        variant="block"
        eyebrow="模型"
        title="让每一种工作使用合适的模型"
        hint="说明"
      />,
    );

    const header = container.querySelector('.section-header') as HTMLElement;
    expect(header.dataset['variant']).toBe('block');
    const text = header.querySelector('.section-header-text') as HTMLElement;
    expect([...text.children].map((child) => child.className)).toEqual([
      'eyebrow',
      'section-header-title',
      'section-header-hint',
    ]);
    expect(text.querySelector('h2')).toBeTruthy();
  });

  it('空插槽不渲染节点，避免基座的 gap 撑出一道看不见的缝', () => {
    const { container } = render(<SectionHeader title="本次 MCP 工具" />);

    expect(container.querySelector('.section-header-hint')).toBeNull();
    expect(container.querySelector('.section-header-actions')).toBeNull();
  });

  it('动作统一进右槽，页面不再各写一份排布', () => {
    const { container } = render(
      <SectionHeader
        title="本空间参考版本"
        actions={
          <>
            <button type="button">取消参考</button>
            <button type="button">引用到当前任务</button>
          </>
        }
      />,
    );

    const actions = container.querySelector('.section-header-actions') as HTMLElement;
    expect(actions.querySelectorAll('button')).toHaveLength(2);
  });

  it('领域钩子类追加在基座类之后，面板内缩仍由页面自己拥有', () => {
    const { container } = render(
      <SectionHeader className="notification-panel-heading" title="消息中心" />,
    );

    const header = container.querySelector('.section-header') as HTMLElement;
    expect(header.className).toBe('section-header notification-panel-heading');
    expect(header.dataset['variant']).toBe('panel');
  });
});
