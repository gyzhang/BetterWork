// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextArea, TextField } from './TextField';

afterEach(() => {
  cleanup();
});

describe('TextField 基座', () => {
  it('档位与基座类名由组件带出，页面给的类只做定位钩子', () => {
    const { container } = render(
      <TextField size="sm" className="collection-rename" aria-label="新集合名称" />,
    );
    const input = container.querySelector('input');

    expect(input?.className, '基座类在前，页面钩子在后').toBe('text-field collection-rename');
    expect(input?.getAttribute('data-size'), '高度与内距由同一档决定（docs/10 §9.10）').toBe('sm');
  });

  it('原生输入语义原样透传：类型、占位与必填不参与基座的档位轴', () => {
    const { container } = render(
      <TextField size="md" type="password" placeholder="可留空" required aria-label="API Key" />,
    );
    const input = container.querySelector('input');

    expect(input?.getAttribute('type')).toBe('password');
    expect(input?.getAttribute('placeholder')).toBe('可留空');
    expect(input?.required).toBe(true);
  });

  it('改动交出输入框当前值', () => {
    const onChange = vi.fn();
    const { container } = render(<TextField size="md" aria-label="显示名称" onChange={onChange} />);
    const input = container.querySelector('input');

    if (input) fireEvent.change(input, { target: { value: '公司主力模型' } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]?.target.value).toBe('公司主力模型');
  });
});

describe('TextArea 基座', () => {
  it('不带档位：多行区的高度由 rows 决定，只有内距归控件档位', () => {
    const { container } = render(<TextArea rows={4} aria-label="记忆正文" />);
    const area = container.querySelector('textarea');

    expect(area?.className).toBe('text-area');
    expect(
      area?.hasAttribute('data-size'),
      '`--control-height-*` 管的是单行控件的命中区，套在多行区上会把 rows 变成摆设',
    ).toBe(false);
  });

  it('等宽档只多一个属性，字体栈住在 Token 上', () => {
    const { container } = render(<TextArea mono aria-label="Markdown 内容" />);
    const area = container.querySelector('textarea');

    expect(area?.getAttribute('data-mono')).toBe('true');
    expect(area?.style.fontFamily, '组件不写字体栈，值只住在 `--font-mono`').toBe('');
  });
});
