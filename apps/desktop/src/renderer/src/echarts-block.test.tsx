// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// echarts 只验渲染层接线，不验它真画图：mock 掉 core 与按需注册入口，避免 jsdom 里跑真图表。
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {}, ScatterChart: {} }));
vi.mock('echarts/components', () => ({
  DatasetComponent: {},
  DataZoomComponent: {},
  GridComponent: {},
  LegendComponent: {},
  MarkLineComponent: {},
  MarkPointComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }));

import { EChartsBlock } from './echarts-block';

const VALID_OPTION = '{"xAxis":{"type":"value"},"series":[{"type":"bar","data":[1,2]}]}';

beforeAll(() => {
  // jsdom 没有 ResizeObserver；生产 Electron 有。这里补一个空实现，只为让渲染副作用跑完。
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  cleanup();
});

describe('EChartsBlock（ADR-0048 渲染与回退）', () => {
  it('合法 option 就地渲染画布容器，不报错', () => {
    const { container } = render(<EChartsBlock code={VALID_OPTION} final />);
    expect(container.querySelector('.echarts-block-canvas')).not.toBeNull();
    expect(container.querySelector('.inline-error')).toBeNull();
    expect(container.querySelector('.echarts-block-code')).toBeNull();
  });

  it('终态下非法 option 回退代码块 + InlineError', () => {
    const { container } = render(<EChartsBlock code={'{"series":['} final />);
    expect(container.querySelector('.echarts-block-canvas')).toBeNull();
    expect(container.querySelector('.echarts-block-code')?.textContent).toBe('{"series":[');
    const error = container.querySelector('.inline-error');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain('图表无法渲染');
  });

  it('流式期（final=false）非法 option 只回退代码块，不闪 InlineError', () => {
    const { container } = render(<EChartsBlock code={'{"series":['} final={false} />);
    expect(container.querySelector('.echarts-block-code')?.textContent).toBe('{"series":[');
    expect(container.querySelector('.inline-error')).toBeNull();
  });

  it('含函数的 option 被拒（不是合法 JSON），终态挂 InlineError', () => {
    const { container } = render(
      <EChartsBlock code={'{"tooltip":{"formatter":function(){return 1}}}'} final />,
    );
    expect(container.querySelector('.echarts-block-canvas')).toBeNull();
    expect(container.querySelector('.inline-error')).not.toBeNull();
  });
});
