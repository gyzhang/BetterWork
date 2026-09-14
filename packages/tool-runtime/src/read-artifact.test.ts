import { describe, expect, it } from 'vitest';

import { createArtifactReadTool } from './read-artifact';

describe('createArtifactReadTool', () => {
  it('passes the exact artifact identity to the scoped reader', async () => {
    const tool = createArtifactReadTool(async (input) => ({
      artifactId: input.artifactId,
      versionId: input.versionId,
    }));
    const output = await tool.execute(
      { artifactId: 'artifact-a', versionId: 'version-2' },
      {
        runId: 'run-1',
        toolCallId: 'call-1',
        workspacePath: '/workspace',
        signal: new AbortController().signal,
        reportProgress: () => undefined,
      },
    );
    expect(output).toEqual({ artifactId: 'artifact-a', versionId: 'version-2' });
  });
});
