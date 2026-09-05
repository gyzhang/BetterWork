import { describe, expect, it } from 'vitest';
import { createWebSearchTool } from './web-search';

const context = { runId: 'run-1', workspacePath: '.', signal: new AbortController().signal, reportProgress() {} };

describe('createWebSearchTool', () => {
  it('returns bounded web results with an optional summary', async () => {
    const tool = createWebSearchTool(async () => ({
      summary: '百度已完成公开回应。',
      results: Array.from({ length: 12 }, (_, index) => ({ title: `网页 ${index}`, url: `https://example.com/${index}`, snippet: '相关片段', site: 'example.com', date: '2026-09-05' })),
    }));
    const output = await tool.execute({ query: '市场动态' }, context) as { query: string; message: string; summary?: string; results: Array<{ title: string; url: string }> };
    expect(output).toMatchObject({ query: '市场动态', message: '搜索到 8 条网页结果。', summary: '百度已完成公开回应。' });
    expect(output.results).toHaveLength(8);
    expect(output.results[0]).toMatchObject({ title: '网页 0', url: 'https://example.com/0' });
  });

  it('reports an empty search without a summary', async () => {
    const tool = createWebSearchTool(async () => ({ results: [] }));
    const output = await tool.execute({ query: '冷门问题' }, context) as { message: string; summary?: string };
    expect(output.message).toBe('没有搜索到相关网页。');
    expect(output.summary).toBeUndefined();
  });

  it('propagates cancellation and rejects invalid input', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const tool = createWebSearchTool(async () => ({ results: [] }));
    await expect(tool.execute({ query: '查询' }, { ...context, signal: abortController.signal })).rejects.toThrow('Run cancelled');
    await expect(tool.execute({ query: '' }, context)).rejects.toThrow();
  });
});
