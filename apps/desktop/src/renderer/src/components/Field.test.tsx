// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Field } from './Field';
import { FieldSelect } from './FieldSelect';
import { SingleSelectPicker } from './SingleSelectPicker';

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { id: 'a', label: '甲' },
  { id: 'b', label: '乙' },
  { id: 'c', label: '尚未支持', disabled: true },
];

describe('Field 与 FieldSelect', () => {
  it('选择组使用独立名称和说明，不把多个原生标签嵌进一个标签', () => {
    const { container } = render(
      <Field group label="颜色" hint="固定色板">
        <SingleSelectPicker
          label="工作空间颜色"
          value="jade"
          options={[{ id: 'jade', name: '青玉', visual: <span /> }]}
          onSelect={() => undefined}
        />
      </Field>,
    );
    const group = screen.getByRole('group', { name: '颜色' });
    expect(group.getAttribute('aria-describedby')).toBe(screen.getByText('固定色板').id);
    expect(screen.getByRole('radio', { name: '青玉' })).toBeTruthy();
    expect(container.querySelector('label label')).toBeNull();
  });
  it('包裹式标签为控件提供可及名称，点击标签文字也能展开菜单', () => {
    const onChange = vi.fn();
    render(
      <Field label="适用范围">
        <FieldSelect size="md" options={OPTIONS} value="a" onChange={onChange} />
      </Field>,
    );

    const trigger = screen.getByRole('button', { name: '适用范围' });
    expect(trigger.textContent).toContain('甲');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '乙' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('b');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('controlId 模式用 htmlFor 关联，说明文字留在控件之外', () => {
    render(
      <Field controlId="probe-select" label="基础 Python" hint="本机解释器只作为 venv 基础。">
        <FieldSelect
          size="md"
          id="probe-select"
          options={OPTIONS}
          value="a"
          onChange={() => undefined}
          ariaLabel="基础 Python"
        />
      </Field>,
    );

    const trigger = screen.getByRole('button', { name: '基础 Python' });
    expect(trigger).toHaveProperty('id', 'probe-select');
    // 档位挂在触发器上，与按钮同一张高度／内距表（docs/10 §9.10）。
    expect(trigger.getAttribute('data-size')).toBe('md');
    expect(screen.getByLabelText('基础 Python')).toBe(trigger);
    expect(screen.getByText('本机解释器只作为 venv 基础。')).toHaveProperty(
      'className',
      'field-hint',
    );
  });

  it('不可选项在菜单里可见但选不动', () => {
    const onChange = vi.fn();
    render(
      <FieldSelect size="md" options={OPTIONS} value="a" onChange={onChange} ariaLabel="用途" />,
    );

    fireEvent.click(screen.getByRole('button', { name: '用途' }));
    const disabled = screen.getByRole('menuitem', { name: '尚未支持' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disabled);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('禁用时触发器不展开', () => {
    render(
      <FieldSelect
        size="md"
        options={OPTIONS}
        value="a"
        onChange={() => undefined}
        ariaLabel="用途"
        disabled
      />,
    );

    const trigger = screen.getByRole('button', { name: '用途' });
    expect(trigger).toHaveProperty('disabled', true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
