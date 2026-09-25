import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { countCodePoints, MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS } from '@betterwork/agent-protocol';

/**
 * 回答捕获的纯函数（契约 §11.1 Renderer 选择）。
 *
 * 界面拿到的 Markdown 渲染结果不是原文，因此只有两种定位方式：
 * 页面选区能在原文里唯一精确命中时直接换算，否则必须回到只读原文重选。
 * 任何一步都不猜坐标、不取第一次出现的位置、不把「找不到」降级成人工来源。
 */

const TOOL_EVENT_TYPES: readonly AgentRuntimeEvent['type'][] = [
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
];

export interface AssistantAnswerSource {
  readonly eventId: string;
  readonly content: string;
}

/** 与 Main 同口径的最终回答判定；Main 仍是唯一权威，这里只用于阻止无效提交。 */
export const finalAssistantAnswer = (
  events: readonly AgentRuntimeEvent[],
): AssistantAnswerSource | undefined => {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const completed = ordered.filter(
    (event): event is Extract<AgentRuntimeEvent, { type: 'message.completed' }> =>
      event.type === 'message.completed',
  );
  const last = completed[completed.length - 1];
  if (!last || last.content.length === 0) return undefined;
  const toolAfter = ordered.some(
    (event) => event.sequence > last.sequence && TOOL_EVENT_TYPES.includes(event.type),
  );
  if (toolAfter) return undefined;
  const finished = ordered.find((event) => event.type === 'run.completed');
  if (finished && finished.type === 'run.completed' && finished.finalContent !== last.content) {
    return undefined;
  }
  return { eventId: last.id, content: last.content };
};

/** UTF-16 下标换成码点下标；正好落在代理对中间即非法，返回 undefined。 */
export const codePointOffset = (text: string, utf16Index: number): number | undefined => {
  if (!Number.isInteger(utf16Index) || utf16Index < 0 || utf16Index > text.length) return undefined;
  const before = text.charCodeAt(utf16Index - 1);
  const after = text.charCodeAt(utf16Index);
  const splitsPair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  if (splitsPair) return undefined;
  return countCodePoints(text.slice(0, utf16Index));
};

export type ExcerptFailure = 'empty' | 'split' | 'too-long' | 'not-found' | 'ambiguous';

export interface ExcerptRange {
  readonly start: number;
  readonly end: number;
}

export type RangeResult = ExcerptRange | { readonly failure: ExcerptFailure };

export const excerptFailureMessage = (failure: ExcerptFailure): string => {
  switch (failure) {
    case 'empty':
      return '请先在原文里选择要沉淀的片段。';
    case 'split':
      return '选区边界切开了一个汉字编码对，请在原文重新完整选择。';
    case 'too-long':
      return `来源摘录最多 ${MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS} 个字符，请缩短选区。`;
    case 'not-found':
      return '所选内容在这条回答的原文里找不到对应片段（可能选中了渲染后的标记），请在原文重新选择。';
    case 'ambiguous':
      return '所选内容在这条回答里出现多次，无法确定位置，请在原文重新选择。';
  }
};

/** 页面选区只有在原文中唯一精确命中时才可免重选。 */
export const locateExcerpt = (raw: string, selected: string): RangeResult => {
  const needle = [...selected];
  if (needle.length === 0) return { failure: 'empty' };
  if (needle.length > MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS) return { failure: 'too-long' };
  const characters = [...raw];
  const hits: number[] = [];
  for (
    let offset = 0;
    offset + needle.length <= characters.length && hits.length < 2;
    offset += 1
  ) {
    if (characters.slice(offset, offset + needle.length).join('') === selected) hits.push(offset);
  }
  const first = hits[0];
  if (first === undefined) return { failure: 'not-found' };
  if (hits.length > 1) return { failure: 'ambiguous' };
  return { start: first, end: first + needle.length };
};

/** textarea 的 selectionStart/End 是 UTF-16 下标，必须换成原文码点区间。 */
export const excerptRangeFromTextarea = (
  raw: string,
  startUtf16: number,
  endUtf16: number,
): RangeResult => {
  if (endUtf16 <= startUtf16) return { failure: 'empty' };
  const start = codePointOffset(raw, startUtf16);
  const end = codePointOffset(raw, endUtf16);
  if (start === undefined || end === undefined) return { failure: 'split' };
  if (end <= start) return { failure: 'empty' };
  if (end - start > MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS) return { failure: 'too-long' };
  return { start, end };
};

export const excerptOf = (raw: string, range: ExcerptRange): string =>
  [...raw].slice(range.start, range.end).join('');

/**
 * 点击「记住这段经验」时的一次性判定：页面选区唯一命中就直接带上区间，
 * 否则区间留空并给出可操作的提示，让父表单去只读原文里重选（不猜渲染坐标）。
 */
export const planCaptureFromSelection = (
  raw: string,
  selected: string,
): { readonly range: ExcerptRange | undefined; readonly error: string } => {
  if (selected.length === 0) return { range: undefined, error: '' };
  const located = locateExcerpt(raw, selected);
  if ('failure' in located) {
    return { range: undefined, error: excerptFailureMessage(located.failure) };
  }
  return { range: located, error: '' };
};
