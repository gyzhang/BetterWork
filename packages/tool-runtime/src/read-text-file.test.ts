import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTextFileTool } from './read-text-file';

describe('readTextFileTool', () => {
  it('rejects paths outside the active workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterwork-read-tool-'));
    const workspace = path.join(root, 'workspace');
    await writeFile(path.join(root, 'secret.txt'), 'private');

    await expect(readTextFileTool.execute(
      { path: '../secret.txt' },
      { runId: 'run-1', workspacePath: workspace, signal: new AbortController().signal, reportProgress: () => undefined },
    )).rejects.toThrow('outside the active workspace');
  });
});
