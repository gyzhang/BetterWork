import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  codePointOffset,
  excerptOf,
  excerptRangeFromTextarea,
  finalAssistantAnswer,
  locateExcerpt,
} from './memory-capture';

/** 事件是判别联合，逐条按真实形状写出来比通用夹具更省事。 */
const started: AgentRuntimeEvent = {
  id: 'e-0',
  runId: 'r-1',
  sequence: 0,
  createdAt: 0,
  type: 'run.started',
  taskId: 't-1',
  sessionId: 's-1',
};

const completedMessage = (
  sequence: number,
  content: string,
  messageId = `m-${sequence}`,
): AgentRuntimeEvent => ({
  id: `e-${sequence}`,
  runId: 'r-1',
  sequence,
  createdAt: sequence,
  type: 'message.completed',
  messageId,
  content,
});

const runCompleted = (sequence: number, finalContent: string): AgentRuntimeEvent => ({
  id: `e-${sequence}`,
  runId: 'r-1',
  sequence,
  createdAt: sequence,
  type: 'run.completed',
  finalContent,
});

const toolCompleted = (sequence: number): AgentRuntimeEvent => ({
  id: `e-${sequence}`,
  runId: 'r-1',
  sequence,
  createdAt: sequence,
  type: 'tool.completed',
  toolCallId: 'tc-1',
  output: { ok: true },
});

const answer = (content: string): AgentRuntimeEvent => completedMessage(3, content);

describe('finalAssistantAnswer', () => {
  it('takes the last completed message of a finished run', () => {
    const events = [
      started,
      completedMessage(2, '第一段。'),
      answer('最终回答。'),
      runCompleted(9, '最终回答。'),
    ];
    expect(finalAssistantAnswer(events)).toEqual({ eventId: 'e-3', content: '最终回答。' });
  });

  it('ignores an intermediate answer that a later tool round follows', () => {
    const events = [answer('我先查一下资料。'), toolCompleted(4), runCompleted(5, '')];
    expect(finalAssistantAnswer(events)).toBeUndefined();
  });

  it('refuses a run whose completion content disagrees with the message', () => {
    const events = [answer('已按回款口径完成。'), runCompleted(4, '已按回款口径完成（改写）。')];
    expect(finalAssistantAnswer(events)).toBeUndefined();
  });
});

describe('codePointOffset', () => {
  it('counts code points before a UTF-16 index', () => {
    const text = '分析𠮷祥项目';
    expect(codePointOffset(text, 0)).toBe(0);
    expect(codePointOffset(text, 2)).toBe(2);
    // 「𠮷」占两个 UTF-16 单元：第 4 个单元仍是码点 3 的开始。
    expect(codePointOffset(text, 4)).toBe(3);
  });

  it('rejects an index that splits a surrogate pair', () => {
    const text = '分析𠮷祥';
    expect(codePointOffset(text, 3)).toBeUndefined();
    expect(codePointOffset(text, -1)).toBeUndefined();
    expect(codePointOffset(text, text.length + 1)).toBeUndefined();
  });
});

describe('locateExcerpt', () => {
  it('maps a unique page selection onto code point offsets', () => {
    const raw = '先核对口径，再计算同比。先核对口径说明单位。';
    const located = locateExcerpt(raw, '再计算同比');
    if ('failure' in located) throw new Error(located.failure);
    expect(located).toEqual({ start: 6, end: 11 });
    expect(excerptOf(raw, located)).toBe('再计算同比');
  });

  it('refuses repeated, absent and oversized selections instead of guessing', () => {
    expect(locateExcerpt('重复重复重复', '重复')).toEqual({ failure: 'ambiguous' });
    expect(locateExcerpt('完全不同的原文', '**加粗标记**')).toEqual({ failure: 'not-found' });
    expect(locateExcerpt('原文', '')).toEqual({ failure: 'empty' });
    expect(locateExcerpt('头' + '长'.repeat(600), '长'.repeat(501))).toEqual({
      failure: 'too-long',
    });
  });
});

describe('excerptRangeFromTextarea', () => {
  it('converts textarea selection bounds to code points', () => {
    const raw = '分析𠮷祥项目时，先核对口径。';
    // 「𠮷」占两个 UTF-16 单元：选中「𠮷祥项目」= UTF-16 2..7，码点 2..6。
    const range = excerptRangeFromTextarea(raw, 2, 7);
    if ('failure' in range) throw new Error(range.failure);
    expect(range).toEqual({ start: 2, end: 6 });
    expect(excerptOf(raw, range)).toBe('𠮷祥项目');
  });

  it('rejects a selection whose boundary splits a surrogate pair', () => {
    expect(excerptRangeFromTextarea('分析𠮷祥', 2, 4)).toEqual({
      start: 2,
      end: 3,
    });
    expect(excerptRangeFromTextarea('分析𠮷祥', 2, 3)).toEqual({ failure: 'split' });
    expect(excerptRangeFromTextarea('分析𠮷祥', 4, 3)).toEqual({ failure: 'empty' });
  });
});
