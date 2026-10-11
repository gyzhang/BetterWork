import { describe, expect, it } from 'vitest';

import { parseEChartsOption } from './echarts-option';

describe('parseEChartsOption（ADR-0048 安全红线）', () => {
  it('合法的 option JSON 对象通过', () => {
    const result = parseEChartsOption(
      '{"xAxis":{"type":"category","data":["一","二"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[1,2]}]}',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.option.series)).toBe(true);
  });

  it('字符串模板 formatter 允许（不是函数，不执行代码）', () => {
    const result = parseEChartsOption('{"tooltip":{"formatter":"{b}: {c}"}}');
    expect(result.ok).toBe(true);
  });

  it('残缺 JSON（流式未闭合的样子）判非法', () => {
    const result = parseEChartsOption('{"series":[{"type":"bar","data":[1,');
    expect(result).toEqual({ ok: false, reason: '图表配置不是合法 JSON。' });
  });

  it('函数体被拒——它在 JSON 里根本不是合法语法', () => {
    const result = parseEChartsOption('{"tooltip":{"formatter":function(){return 1}}}');
    expect(result.ok).toBe(false);
  });

  it('new Date() 之类非 JSON 的可执行内容被拒', () => {
    expect(parseEChartsOption('{"x":new Date()}').ok).toBe(false);
  });

  it('顶层 __proto__ 键被拒（原型污染）', () => {
    const result = parseEChartsOption('{"__proto__":{"polluted":true},"series":[]}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('__proto__');
  });

  it('深层嵌套的 __proto__/constructor 键也被拒', () => {
    expect(parseEChartsOption('{"series":[{"__proto__":{}}]}').ok).toBe(false);
    expect(parseEChartsOption('{"a":{"b":{"constructor":{}}}}').ok).toBe(false);
  });

  it('顶层不是对象（数组/标量）被拒', () => {
    expect(parseEChartsOption('[1,2,3]')).toEqual({
      ok: false,
      reason: '图表配置必须是一个 JSON 对象。',
    });
    expect(parseEChartsOption('42').ok).toBe(false);
    expect(parseEChartsOption('"bar"').ok).toBe(false);
  });

  it('空正文被拒', () => {
    expect(parseEChartsOption('   ')).toEqual({ ok: false, reason: '图表配置为空。' });
  });
});
