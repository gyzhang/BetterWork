/**
 * 对话内联图表的 option 解析与安全校验（ADR-0048）。
 *
 * 这是纯数据层：不依赖 React，也不依赖 echarts，好让「合法 JSON 才渲染、含函数/可执行
 * 内容一律拒绝」这条安全红线能在 node 环境下被单元测试直接覆盖，无需 jsdom 或画布。
 *
 * 安全立场（不可妥协）：围栏正文只按 JSON 解析。`JSON.parse` 本身就不接受函数体、
 * `new Date()`、`eval` 等——它们在 JSON 里是语法错误，会直接抛错。这里额外拒绝
 * `__proto__`／`constructor`／`prototype` 这类原型污染键：`JSON.parse` 会把 `__proto__`
 * 建成对象自己的可枚举属性，一旦进入 echarts 的合并逻辑就可能改写原型。Renderer 绝不
 * 把模型输出的任何字符串当作 JS 执行。
 */

export type EChartsOptionParseResult =
  { ok: true; option: Record<string, unknown> } | { ok: false; reason: string };

/** 原型污染键：出现在配置的任何一层都拒绝。 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 深度遍历，命中任一原型污染键就返回该键名。 */
function findForbiddenKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) return key;
    const found = findForbiddenKey(record[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 把 ```` ```echarts ```` 围栏正文解析成可交给 echarts 的 option。
 *
 * 失败一律返回 `{ ok: false, reason }`，`reason` 是给用户看的一句话，由调用方决定是否
 * 呈现（流式未闭合时不呈现，终态才挂 `InlineError`）。本函数不抛异常。
 */
export function parseEChartsOption(code: string): EChartsOptionParseResult {
  const trimmed = code.trim();
  if (trimmed.length === 0) return { ok: false, reason: '图表配置为空。' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: '图表配置不是合法 JSON。' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: '图表配置必须是一个 JSON 对象。' };
  }

  const forbidden = findForbiddenKey(parsed);
  if (forbidden !== undefined) {
    return { ok: false, reason: `图表配置含有不允许的键「${forbidden}」。` };
  }

  return { ok: true, option: parsed as Record<string, unknown> };
}
