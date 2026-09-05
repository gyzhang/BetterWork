import { describe, expect, it } from 'vitest';

import { rawToolOutput, summarizeToolOutput } from './tool-summary';

describe('summarizeToolOutput', () => {
  it('renders a calculator result as the expression it evaluated', () => {
    expect(summarizeToolOutput('calculator', { expression: '(12 + 8) * 3', result: 60 })).toBe(
      '(12 + 8) * 3 = 60',
    );
  });

  it('says when a file was only partially read', () => {
    expect(summarizeToolOutput('read_text_file', { path: 'README.md', truncated: false })).toBe(
      '已读取 README.md',
    );
    expect(summarizeToolOutput('read_text_file', { path: 'big.md', truncated: true })).toBe(
      '已读取 big.md（内容较长，只取开头部分）',
    );
  });

  it('prefers the message the tool itself produced', () => {
    expect(
      summarizeToolOutput('knowledge_search', {
        message: '找到 2 份相关资料。',
        results: [{}, {}],
      }),
    ).toBe('找到 2 份相关资料。');
    expect(
      summarizeToolOutput('web_search', { message: '没有搜索到相关网页。', results: [] }),
    ).toBe('没有搜索到相关网页。');
  });

  it('counts results when the tool gave no message', () => {
    expect(summarizeToolOutput('knowledge_search', { results: [{}, {}, {}] })).toBe(
      '找到 3 份相关资料',
    );
    expect(summarizeToolOutput('web_search', { results: [{}] })).toBe('搜索到 1 条网页结果');
  });

  it('never falls back to stringified JSON in the main interface', () => {
    const summary = summarizeToolOutput('some_future_tool', { anything: { nested: true } });
    expect(summary).toBe('已完成这一步');
    expect(summary).not.toContain('{');
  });

  it('survives output that is not an object at all', () => {
    expect(summarizeToolOutput('calculator', null)).toBe('已完成这一步');
    expect(summarizeToolOutput(undefined, 'plain text')).toBe('已完成这一步');
    expect(summarizeToolOutput('knowledge_search', { results: 'not-an-array' })).toBe(
      '已检索个人资料库',
    );
  });

  it('accepts a message from an unknown tool', () => {
    expect(summarizeToolOutput('some_future_tool', { message: '自定义工具已完成' })).toBe(
      '自定义工具已完成',
    );
  });
});

describe('rawToolOutput', () => {
  it('pretty-prints the payload for the collapsed process detail', () => {
    expect(rawToolOutput({ result: 60 })).toBe('{\n  "result": 60\n}');
  });

  it('does not throw on values JSON cannot serialize', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => rawToolOutput(circular)).not.toThrow();
  });
});
