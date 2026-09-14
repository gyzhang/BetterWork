import { describe, expect, it } from 'vitest';

import { createWebFetchTool } from './web-fetch';

describe('createWebFetchTool', () => {
  it('validates the URL and exposes bounded page output', async () => {
    const tool = createWebFetchTool(async (url) => ({
      url,
      title: '标题',
      content: '正文',
      contentType: 'text/html',
      status: 200,
      retrievedAt: 1,
      truncated: false,
    }));
    const output = await tool.execute(
      { url: 'https://example.com/page' },
      {
        runId: 'run-1',
        toolCallId: 'tool-1',
        signal: new AbortController().signal,
        workspacePath: '/tmp',
        reportProgress: () => undefined,
      },
    );
    expect(output).toMatchObject({ url: 'https://example.com/page', message: '已读取网页正文。' });
    await expect(
      tool.execute(
        { url: 'not-a-url' },
        {
          runId: 'run-1',
          toolCallId: 'tool-2',
          signal: new AbortController().signal,
          workspacePath: '/tmp',
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow();
  });
});
