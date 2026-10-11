// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Welcome } from './Welcome';

afterEach(() => {
  cleanup();
});

describe('Welcome', () => {
  it('没有用户名时显示通用问候', () => {
    render(<Welcome />);

    expect(screen.getByText('今天要处理什么工作？')).toBeTruthy();
    expect(screen.getByText('输入这次任务的具体要求，点击「开始工作」后执行。')).toBeTruthy();
  });

  it('有用户名时问候包含用户名', () => {
    render(<Welcome userName="张三" />);

    expect(screen.getByText('张三，今天要处理什么工作？')).toBeTruthy();
  });

  it('空字符串用户名等同于无用户名', () => {
    render(<Welcome userName="" />);

    expect(screen.getByText('今天要处理什么工作？')).toBeTruthy();
  });
});
