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

describe('tool result presentation boundaries', () => {
  it.each([
    ['calculator', { expression: '0 - 1', result: -1 }, '0 - 1 = -1'],
    ['calculator', { expression: '0', result: 0 }, '0 = 0'],
    ['calculator', { expression: 'x', result: Infinity }, '已完成这一步'],
    ['calculator', { expression: 'x', result: NaN }, '已完成这一步'],
    ['calculator', { expression: 12, result: 1 }, '已完成这一步'],
    ['calculator', { expression: '', result: 1 }, '已完成这一步'],
    ['read_text_file', { path: 3 }, '已完成这一步'],
    ['read_text_file', null, '已完成这一步'],
    ['read_text_file', { path: 'a.txt', truncated: 'true' }, '已读取 a.txt'],
    ['knowledge_search', null, '已检索个人资料库'],
    ['knowledge_search', { results: [] }, '找到 0 份相关资料'],
    ['web_search', {}, '已完成联网搜索'],
    ['read_knowledge', { parts: [] }, '已读取 0 段资料正文'],
    ['read_knowledge', { parts: [1, 2] }, '已读取 2 段资料正文'],
    ['read_knowledge', { parts: 'secret' }, '已读取资料正文'],
    ['artifact_declare_sources', { declaredCount: 0 }, '已清除采用来源声明'],
    ['artifact_declare_sources', { declaredCount: 2 }, '已声明 2 项采用来源'],
    ['artifact_declare_sources', { declaredCount: '2' }, '已更新采用来源声明'],
    ['analyze_business_metrics', {}, '已完成经营指标计算'],
    ['web_fetch', {}, '已读取网页正文'],
    ['read_office_material', {}, '已读取 Office 材料'],
    ['skill_read_resource', { relativePath: 'guide.md' }, '已读取 guide.md'],
    ['skill_read_resource', {}, '已读取技能资源'],
    ['skill_read_resource', null, '已完成这一步'],
    ['task_write_file', { relativePath: 'report.md', created: true }, '已创建 report.md'],
    ['task_write_file', { relativePath: 'report.md', created: false }, '已更新 report.md'],
    ['task_write_file', {}, '已完成这一步'],
    ['task_write_file', null, '已完成这一步'],
    ['skill_execute', { status: 'succeeded' }, '命令执行成功'],
    ['skill_execute', { status: 'failed', reason: 'invalid input' }, '命令执行失败：invalid input'],
    ['skill_execute', { status: 'failed' }, '命令执行失败：未知原因'],
    ['skill_execute', { status: 'timed-out' }, '命令执行超时'],
    ['skill_execute', { status: 'cancelled' }, '命令已取消'],
    ['skill_execute', { status: 'future-status' }, '已完成这一步'],
    ['skill_execute', null, '已完成这一步'],
    [undefined, { message: 3, secret: 'private payload' }, '已完成这一步'],
  ])('summarizes %s without exposing a raw payload', (name, output, expected) => {
    expect(summarizeToolOutput(name, output)).toBe(expected);
  });

  it.each([
    'analyze_business_metrics',
    'read_knowledge',
    'artifact_declare_sources',
    'web_fetch',
    'read_office_material',
    'skill_read_resource',
    'task_write_file',
    'skill_execute',
  ])('preserves the explicit human message for %s', (name) => {
    expect(summarizeToolOutput(name, { message: 'Result explained', secret: 'hidden' })).toBe(
      'Result explained',
    );
  });

  it('returns a safe type hint for circular and bigint process details', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(rawToolOutput(circular)).toBe('object');
    expect(rawToolOutput(1n)).toBe('bigint');
  });
});
