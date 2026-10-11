// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { MarkdownPreview } from './markdown-preview';

beforeAll(() => {
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

describe('MarkdownPreview 的 echarts 围栏接线（ADR-0048）', () => {
  it('```echarts 围栏渲染成图表，且不套默认 <pre> 外壳', () => {
    const fence = '```echarts\n{"series":[{"type":"bar","data":[1,2]}]}\n```';
    const { container } = render(<MarkdownPreview content={fence} variant="message" />);
    const block = container.querySelector('.echarts-block');
    expect(block).not.toBeNull();
    expect(block?.closest('pre')).toBeNull();
    expect(container.querySelector('.echarts-block-canvas')).not.toBeNull();
  });

  it('非 echarts 围栏仍走语法高亮代码块，包在 <pre> 里', () => {
    const fence = '```js\nconst x = 1;\n```';
    const { container } = render(<MarkdownPreview content={fence} variant="message" />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const x = 1');
    expect(container.querySelector('.echarts-block')).toBeNull();
  });

  it('chartsFinal=false（流式）时非法围栏只回退代码块，不挂 InlineError', () => {
    const fence = '```echarts\n{"series":[\n```';
    const streaming = render(
      <MarkdownPreview content={fence} variant="message" chartsFinal={false} />,
    );
    expect(streaming.container.querySelector('.inline-error')).toBeNull();
    streaming.unmount();

    const final = render(<MarkdownPreview content={fence} variant="message" chartsFinal />);
    expect(final.container.querySelector('.inline-error')).not.toBeNull();
  });
});
