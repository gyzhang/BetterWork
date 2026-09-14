import { describe, expect, it } from 'vitest';

import { createReadOfficeMaterialTool } from './read-office-material';

const context = {
  runId: 'run-1',
  toolCallId: 'tool-1',
  signal: new AbortController().signal,
  workspacePath: '/tmp',
  reportProgress: () => undefined,
};

describe('createReadOfficeMaterialTool', () => {
  it('passes a selected snapshot and locator to the scoped reader', async () => {
    const tool = createReadOfficeMaterialTool(async (input) => ({
      sourceKind: input.sourceKind,
      snapshotId: input.snapshotId,
      locator: input.locator,
    }));
    await expect(
      tool.execute(
        { sourceKind: 'workspace-input-snapshot', snapshotId: 'snapshot-1', locator: 'slide:2' },
        context,
      ),
    ).resolves.toEqual({
      sourceKind: 'workspace-input-snapshot',
      snapshotId: 'snapshot-1',
      locator: 'slide:2',
    });
  });

  it('requires the identifiers belonging to the selected source kind', async () => {
    const tool = createReadOfficeMaterialTool(async () => ({}));
    await expect(tool.execute({ sourceKind: 'artifact-version' }, context)).rejects.toThrow();
  });
});
