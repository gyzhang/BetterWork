// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SegmentedControl, Tab, TabList, TabPanel, Tabs } from './Tabs';

afterEach(() => {
  cleanup();
});

const ITEMS = [
  { id: 'a', label: '甲' },
  { id: 'b', label: '乙' },
  { id: 'c', label: '丙' },
] as const;

describe('Tabs 基座', () => {
  const renderTabs = (onChange: (value: string) => void = vi.fn(), value: string = 'b'): void => {
    render(
      <Tabs value={value} onChange={onChange}>
        <div>
          <button type="button">页签带之外的控件</button>
          <TabList size="md" label="示例分组">
            {ITEMS.map((item) => (
              <Tab key={item.id} value={item.id}>
                {item.label}
              </Tab>
            ))}
          </TabList>
          {ITEMS.map((item) => (
            <TabPanel key={item.id} value={item.id}>
              {item.label}内容
            </TabPanel>
          ))}
        </div>
      </Tabs>,
    );
  };

  it('档位由调用点写明并落在页签带的 data-size 上（docs/10 §9.10「动作排」）', () => {
    render(
      <div>
        <Tabs value="b" onChange={() => undefined}>
          <TabList size="sm" label="示例分组">
            {ITEMS.map((item) => (
              <Tab key={item.id} value={item.id}>
                {item.label}
              </Tab>
            ))}
          </TabList>
          {ITEMS.map((item) => (
            <TabPanel key={item.id} value={item.id}>
              {item.label}内容
            </TabPanel>
          ))}
        </Tabs>
        <SegmentedControl
          size="lg"
          items={ITEMS}
          value="b"
          onChange={() => undefined}
          label="示例模式"
        />
      </div>,
    );
    expect(screen.getByRole('tablist').getAttribute('data-size')).toBe('sm');
    expect(screen.getByRole('group').getAttribute('data-size')).toBe('lg');
  });

  it('只有选中页签进入 Tab 顺序，其余靠方向键', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');

    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('方向键切换选中项并把焦点带过去，越界回绕', () => {
    const onChange = vi.fn();
    renderTabs(onChange);
    const [first, second, third] = screen.getAllByRole('tab');
    second?.focus();

    fireEvent.keyDown(second as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(document.activeElement).toBe(third);
  });

  it('Home 与 End 直达首尾', () => {
    const onChange = vi.fn();
    renderTabs(onChange);
    const [first, , third] = screen.getAllByRole('tab');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(document.activeElement).toBe(third);
  });

  it('选中值不在清单里时，首项仍可被 Tab 命中', () => {
    renderTabs(() => undefined, 'zzz');

    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });
});

describe('SegmentedControl 基座', () => {
  it('用 aria-pressed 表达当前模式，每个按钮都参与 Tab 顺序', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl size="md" items={ITEMS} value="b" onChange={onChange} label="示例模式" />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);

    fireEvent.click(buttons[2] as HTMLElement);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
  });
});
