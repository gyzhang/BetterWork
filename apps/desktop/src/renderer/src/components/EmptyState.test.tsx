// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyContext, EmptyNotice } from './EmptyState';

afterEach(() => {
  cleanup();
});

describe('空态基座', () => {
  it('只有一行说明时用 line 变体，不再各页自造占位类', () => {
    const { container } = render(<EmptyNotice title="你的任务会保存在这里。" />);

    const notice = container.querySelector('.empty-notice') as HTMLElement;
    expect(notice.dataset['variant']).toBe('line');
    expect(notice.querySelector('strong')).toBeNull();
  });

  it('标题加解释用 block 变体', () => {
    const { container } = render(<EmptyNotice title="还没有长期记忆" detail="在这里记录偏好。" />);

    const notice = container.querySelector('.empty-notice') as HTMLElement;
    expect(notice.dataset['variant']).toBe('block');
    expect(notice.querySelector('strong')?.textContent).toBe('还没有长期记忆');
  });

  it('贴齐宿主入口的块状空态显式标记 start 布局', () => {
    const { container } = render(
      <EmptyNotice title="暂无简报" detail="确认内容后会显示在这里。" placement="start" />,
    );

    const notice = container.querySelector('.empty-notice') as HTMLElement;
    expect(notice.dataset['variant']).toBe('block');
    expect(notice.dataset['placement']).toBe('start');
  });

  it('区域级空态允许换图标，但图标不进可及名称', () => {
    const { container } = render(
      <EmptyContext title="暂无通知" detail="任务与导入的结果会保存在这里。" icon={<span />} />,
    );

    const icon = container.querySelector('.empty-context > span') as HTMLElement;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
