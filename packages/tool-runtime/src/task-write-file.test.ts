import { describe, expect, it } from 'vitest';

import { createTaskWriteFileTool } from './task-write-file';

const context = {
  runId: 'run-1',
  toolCallId: 'tool-1',
  workspacePath: '.',
  signal: new AbortController().signal,
  reportProgress() {},
};

describe('createTaskWriteFileTool', () => {
  it('creates a new file and reports creation', async () => {
    const tool = createTaskWriteFileTool(async () => ({
      relativePath: 'output.svg',
      bytesWritten: 128,
      contentHash: 'abc123',
      created: true,
    }));
    const output = (await tool.execute(
      { path: 'output.svg', content: '<svg></svg>' },
      context,
    )) as { path: string; bytesWritten: number; created: boolean; message: string };
    expect(output).toMatchObject({
      path: 'output.svg',
      bytesWritten: 128,
      created: true,
    });
    expect(output.message).toContain('已创建');
  });

  it('updates an existing file and reports update', async () => {
    const tool = createTaskWriteFileTool(async () => ({
      relativePath: 'output.svg',
      bytesWritten: 256,
      contentHash: 'def456',
      created: false,
    }));
    const output = (await tool.execute(
      { path: 'output.svg', content: '<svg>updated</svg>', expectedHash: 'old-hash' },
      context,
    )) as { created: boolean; message: string };
    expect(output.created).toBe(false);
    expect(output.message).toContain('已更新');
  });

  it('passes runId from context to the writer', async () => {
    let capturedRunId = '';
    const tool = createTaskWriteFileTool(async (input) => {
      capturedRunId = input.runId;
      return { relativePath: 'test.txt', bytesWritten: 4, contentHash: 'h', created: true };
    });
    await tool.execute({ path: 'test.txt', content: 'data' }, context);
    expect(capturedRunId).toBe('run-1');
  });

  it('rejects empty path', async () => {
    const tool = createTaskWriteFileTool(async () => ({
      relativePath: 'x',
      bytesWritten: 0,
      contentHash: '',
      created: true,
    }));
    await expect(tool.execute({ path: '  ', content: 'data' }, context)).rejects.toThrow();
  });
});
