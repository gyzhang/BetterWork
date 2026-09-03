import { describe, expect, it } from 'vitest';
import { createKnowledgeSearchTool } from './knowledge-search';

const context = { runId: 'run-1', workspacePath: '.', signal: new AbortController().signal, reportProgress() {} };

describe('createKnowledgeSearchTool', () => {
  it('returns bounded, source-addressable search results', async () => {
    const tool = createKnowledgeSearchTool(() => Array.from({ length: 12 }, (_, index) => ({
      id: String(index), title: `资料 ${index}`, sourcePath: `/notes/${index}.md`, format: 'markdown' as const, locator: '全文', excerpt: '相关片段',
    })));
    const output = await tool.execute({ query: '市场' }, context) as { query: string; message: string; results: Array<{ title: string; sourcePath: string }> };
    expect(output).toMatchObject({ query: '市场', message: '找到 8 份相关资料。' });
    expect(output.results).toHaveLength(8);
    expect(output.results[0]).toMatchObject({ title: '资料 0', sourcePath: '/notes/0.md' });
  });
});
