// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionBar } from './ActionBar';

afterEach(() => {
  cleanup();
});

describe('ActionBar 基座', () => {
  it('动作条是一组有名称的按钮，而不是散落的一排', () => {
    const { container } = render(
      <ActionBar label="保存经验">
        <button type="button">取消</button>
        <button type="submit">保存</button>
      </ActionBar>,
    );

    const bar = container.querySelector('footer.action-bar') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-label')).toBe('保存经验');
    expect(bar.querySelectorAll('button')).toHaveLength(2);
  });

  it('说明排在按钮之前，主行动因此留在最右', () => {
    const { container } = render(
      <ActionBar label="保存成果修订" hint="保存后会创建 v4 人工修订版本。">
        <button type="button">取消</button>
        <button type="submit">保存新版本</button>
      </ActionBar>,
    );

    const bar = container.querySelector('footer') as HTMLElement;
    const order = [...bar.children].map((child) =>
      child instanceof HTMLElement ? child.className || child.tagName : child.textContent,
    );
    expect(order).toEqual(['action-bar-hint', 'BUTTON', 'BUTTON']);
    expect(bar.querySelector('.action-bar-hint')?.textContent).toBe(
      '保存后会创建 v4 人工修订版本。',
    );
  });

  it('没有说明时不留空节点，避免 gap 撑出一道空缝', () => {
    const { container } = render(
      <ActionBar label="添加模型">
        <button type="button">测试连接</button>
      </ActionBar>,
    );

    expect(container.querySelector('.action-bar-hint')).toBeNull();
  });

  it('就地动作条用 div，表单与抽屉底部用 footer', () => {
    const { container } = render(
      <ActionBar as="div" className="sheet-footer" label="保存 MCP 连接">
        <button type="button">取消</button>
      </ActionBar>,
    );

    const bar = container.querySelector('div.action-bar') as HTMLElement;
    expect(bar.tagName).toBe('DIV');
    expect(bar.className).toBe('action-bar sheet-footer');
    expect(container.querySelector('footer')).toBeNull();
  });
});
