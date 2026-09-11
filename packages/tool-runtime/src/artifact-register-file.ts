import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const validationSchema = z
  .object({
    structure: z.enum(['pending', 'passed', 'failed', 'not-checked']),
    visual: z.enum(['pending', 'passed', 'failed', 'not-checked']),
    manualEdit: z.enum(['pending', 'passed', 'failed', 'not-checked']),
  })
  .strict();

const inputSchema = z
  .object({
    executionId: z.string().min(1),
    outputId: z.string().min(1),
    title: z.string().trim().min(1).max(160),
    artifactId: z.string().min(1).optional(),
    mimeType: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(10_000).optional(),
    validation: validationSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.validation?.structure === 'failed') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '结构校验失败的成果不可登记为可交付版本',
        path: ['validation', 'structure'],
      });
    }
  });

export interface ArtifactRegisterInput {
  runId: string;
  executionId: string;
  outputId: string;
  artifactId?: string;
  title: string;
  mimeType?: string;
  description?: string;
  validation?: {
    structure: 'pending' | 'passed' | 'failed' | 'not-checked';
    visual: 'pending' | 'passed' | 'failed' | 'not-checked';
    manualEdit: 'pending' | 'passed' | 'failed' | 'not-checked';
  };
}

export interface ArtifactRegisterOutput {
  artifactId: string;
  versionId: string;
  versionNumber: number;
  fileKey: string;
  fileHash: string;
  fileSize: number;
  message: string;
}

export type ArtifactFileRegistrar = (
  input: ArtifactRegisterInput,
) => Promise<ArtifactRegisterOutput>;

export const createArtifactRegisterFileTool = (registrar: ArtifactFileRegistrar): AgentTool => ({
  name: 'artifact_register_file',
  description:
    'Register a file output from a succeeded Skill execution as a versioned Artifact. Validates execution ownership, terminal state, output handle, and file integrity before recording. Structure-failed validations are rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      executionId: {
        type: 'string',
        description: 'The execution ID that produced the output.',
      },
      outputId: {
        type: 'string',
        description: 'The output handle within the execution.',
      },
      title: {
        type: 'string',
        description: 'Human-readable title for the artifact (1–160 characters).',
      },
      artifactId: {
        type: 'string',
        description:
          'Existing artifact ID to create a new version of. Omit to create a new artifact.',
      },
      description: {
        type: 'string',
        description: 'Optional description of this version (max 10,000 characters).',
      },
    },
    required: ['executionId', 'outputId', 'title'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(`正在登记文件成果：${input.title}`);

    const result = await registrar({
      runId: context.runId,
      executionId: input.executionId,
      outputId: input.outputId,
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      title: input.title,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.validation ? { validation: input.validation } : {}),
    });

    if (context.signal.aborted) throw abortError();

    return result;
  },
});
