import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readTextFileTool } from './read-text-file';

describe('readTextFileTool', () => {
  it('rejects paths outside the active workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterwork-read-tool-'));
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(path.join(root, 'secret.txt'), 'private');

    await expect(
      readTextFileTool.execute(
        { path: '../secret.txt' },
        {
          runId: 'run-1',
          workspacePath: workspace,
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow('outside the active workspace');
  });

  it('rejects a workspace symlink that resolves outside the active workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'betterwork-read-tool-'));
    const workspace = path.join(root, 'workspace');
    const secret = path.join(root, 'secret.txt');
    await mkdir(workspace);
    await writeFile(secret, 'private');
    await symlink(secret, path.join(workspace, 'linked-secret.txt'));

    await expect(
      readTextFileTool.execute(
        { path: 'linked-secret.txt' },
        {
          runId: 'run-2',
          workspacePath: workspace,
          signal: new AbortController().signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow('outside the active workspace');
  });
});
