import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef, useState } from 'react';

import { InlineError } from './components/InlineError';
import { parseEChartsOption } from './lib/echarts-option';

/**
 * 对话内联图表的渲染落点（ADR-0048）。
 *
 * 三层分工里的「渲染层」：模型在回复正文里直出 ```` ```echarts ```` 围栏，围栏内是 ECharts
 * `option` 的 JSON；本组件把它就地画在 Renderer 进程的 SVG 画布上。数据来自确定性工具
 * （calculator／analyze_business_metrics），不来自模型心算；本组件只负责视觉，不产出数据。
 *
 * echarts 是 Renderer 的普通前端依赖，随构建打进 asar，不经过主进程、不碰 managed Node。
 * 按需注册用到的图表与组件以控制包体；用到未注册的类型时 echarts 抛错，走下面的失败回退。
 *
 * 安全红线：option 只按 JSON 解析（见 `lib/echarts-option.ts`），Renderer 绝不 `eval`
 * 模型 JS。渲染用 SVG 而非 canvas——两者都在进程内完成，SVG 不依赖原生 canvas，便于测试。
 */
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

/** 跟随应用外观的明暗档；内联图表是消息面的一部分，文字与轴线要在两种模式下都可辨识。 */
function useColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMode(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

export interface EChartsBlockProps {
  /** 围栏内的原始正文。 */
  code: string;
  /**
   * 正文是否已终态（围栏已闭合、Run 已收尾）。为 `false` 表示仍在流式：解析失败只回退成
   * 代码块、**不**挂 `InlineError`，避免边流边报错的抖动；为 `true` 时才把失败讲给用户。
   */
  final: boolean;
}

export function EChartsBlock({ code, final }: EChartsBlockProps): React.JSX.Element {
  const result = useMemo(() => parseEChartsOption(code), [code]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mode = useColorMode();
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    if (!result.ok) return;
    const element = containerRef.current;
    if (element === null) return;
    let chart: ReturnType<typeof echarts.init> | undefined;
    try {
      setRenderFailed(false);
      chart = echarts.init(element, mode === 'dark' ? 'dark' : undefined, { renderer: 'svg' });
      // backgroundColor 交还宿主表面；模型若显式给了 backgroundColor 以它为准（展开在后）。
      chart.setOption({ backgroundColor: 'transparent', ...result.option });
    } catch {
      chart?.dispose();
      setRenderFailed(true);
      return;
    }
    const observer = new ResizeObserver(() => chart?.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart?.dispose();
    };
  }, [result, mode]);

  if (!result.ok) {
    return (
      <div className="echarts-block">
        <pre className="echarts-block-code">
          <code>{code}</code>
        </pre>
        {final && <InlineError message={`图表无法渲染：${result.reason}`} />}
      </div>
    );
  }

  if (renderFailed) {
    return (
      <div className="echarts-block">
        <pre className="echarts-block-code">
          <code>{code}</code>
        </pre>
        {final && <InlineError tone="warning" message="图表渲染失败，已回退为源码。" />}
      </div>
    );
  }

  return (
    <div className="echarts-block">
      <div className="echarts-block-canvas" ref={containerRef} role="img" aria-label="数据图表" />
    </div>
  );
}
