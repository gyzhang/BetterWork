// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SingleSelectPicker } from './SingleSelectPicker';

const options = [
  { id: 'folder', name: '文件夹', visual: <span data-testid="v-folder" /> },
  { id: 'chart', name: '图表分析', visual: <span data-testid="v-chart" /> },
];

afterEach(() => {
  cleanup();
});

describe('SingleSelectPicker 基座', () => {
  it('一组选项是同名的一组 radio，当前档由 checked 表达', () => {
    const { container } = render(
      <SingleSelectPicker
        label="工作空间图标"
        value="chart"
        options={options}
        onSelect={vi.fn()}
      />,
    );

    const group = container.querySelector('.single-select-picker') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('工作空间图标');

    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(inputs).toHaveLength(2);
    // 同名才互斥：原生分组替我们管住「选了这档就不是那档」。
    expect(inputs[0]?.name).toBe(inputs[1]?.name);
    expect(inputs[0]?.name).not.toBe('');
    expect(inputs[0]?.checked).toBe(false);
    expect(inputs[1]?.checked).toBe(true);
    // 图标与色块不带文字，名称必须由选项给到可及名称。
    expect(inputs[1]?.getAttribute('aria-label')).toBe('图表分析');
    expect(container.querySelector('[data-checked="true"]')).not.toBeNull();
  });

  it('选中一项只回调该档 id，外观不接管状态', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SingleSelectPicker
        label="工作空间颜色"
        value="moss"
        options={options}
        onSelect={onSelect}
      />,
    );

    const second = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    )[1] as HTMLInputElement;
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('chart');
  });

  it('两组之间不串名，位置钩子叠加在基座类之上', () => {
    const { container } = render(
      <div>
        <SingleSelectPicker
          label="工作空间图标"
          value="folder"
          options={options}
          onSelect={vi.fn()}
          className="workspace-identity-picker"
        />
        <SingleSelectPicker
          label="工作空间颜色"
          value="folder"
          options={options}
          onSelect={vi.fn()}
        />
      </div>,
    );

    const groups = container.querySelectorAll('.single-select-picker');
    expect(groups[0]?.className).toBe('single-select-picker workspace-identity-picker');
    const firstName = container.querySelector<HTMLInputElement>('input[type="radio"]')?.name;
    const secondGroupName = groups[1]?.querySelector<HTMLInputElement>('input[type="radio"]')?.name;
    expect(firstName).toBeDefined();
    expect(secondGroupName).toBeDefined();
    expect(firstName).not.toBe(secondGroupName);
  });
});
