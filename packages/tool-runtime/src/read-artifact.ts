import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z.object({
  artifactId: z.string().min(1),
  versionId: z.string().min(1),
});

export interface ArtifactReadInput {
  artifactId: string;
  versionId: string;
}

export type ArtifactReader = (
  input: ArtifactReadInput,
  context: Parameters<AgentTool['execute']>[1],
) => Promise<unknown>;

export const createArtifactReadTool = (reader: ArtifactReader): AgentTool => ({
  name: 'read_artifact',
  description: 'Read one exact, user-selected Artifact version.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      versionId: { type: 'string' },
    },
    required: ['artifactId', 'versionId'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    if (context.signal.aborted) throw abortError();
    return reader(inputSchema.parse(rawInput), context);
  },
});
