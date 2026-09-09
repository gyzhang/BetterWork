import { describe, expect, it } from 'vitest';

import type { ArtifactRegisterInput, ArtifactRegisterOutput } from './artifact-register-file';
import { createArtifactRegisterFileTool } from './artifact-register-file';

const passedValidation = {
  structure: 'passed' as const,
  visual: 'passed' as const,
  manualEdit: 'not-checked' as const,
};

const context = {
  runId: 'run-1',
  toolCallId: 'tool-1',
  workspacePath: '.',
  signal: new AbortController().signal,
  reportProgress() {},
};

const defaultInput = {
  executionId: 'exec-1',
  outputId: 'slides.pptx',
  title: '季度报告',
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  validation: passedValidation,
};

const fakeRegistrar = async (input: ArtifactRegisterInput): Promise<ArtifactRegisterOutput> => ({
  artifactId: 'artifact-1',
  versionId: 'version-1',
  versionNumber: 1,
  fileKey: `${input.executionId}/${input.outputId}`,
  fileHash: 'abc123',
  fileSize: 1024,
  message: `文件成果已登记：${input.title}`,
});

describe('createArtifactRegisterFileTool', () => {
  it('passes validation state through to the registrar', async () => {
    let captured: ArtifactRegisterInput | undefined;
    const tool = createArtifactRegisterFileTool(async (input) => {
      captured = input;
      return fakeRegistrar(input);
    });
    await tool.execute(defaultInput, context);
    expect(captured).toMatchObject({
      runId: 'run-1',
      executionId: 'exec-1',
      outputId: 'slides.pptx',
      title: '季度报告',
      validation: passedValidation,
    });
  });

  it('rejects structure=failed registrations', async () => {
    const tool = createArtifactRegisterFileTool(fakeRegistrar);
    await expect(
      tool.execute(
        {
          ...defaultInput,
          validation: { structure: 'failed', visual: 'passed', manualEdit: 'not-checked' },
        },
        context,
      ),
    ).rejects.toThrow(/结构校验失败/);
  });

  it('allows structure=passed with visual=not-checked (draft)', async () => {
    const tool = createArtifactRegisterFileTool(fakeRegistrar);
    const result = (await tool.execute(
      {
        ...defaultInput,
        validation: { structure: 'passed', visual: 'not-checked', manualEdit: 'not-checked' },
      },
      context,
    )) as ArtifactRegisterOutput;
    expect(result.artifactId).toBe('artifact-1');
  });

  it('throws abort error when signal is already aborted before execution', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = createArtifactRegisterFileTool(fakeRegistrar);
    await expect(
      tool.execute(defaultInput, { ...context, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('rejects unknown validation enum values', async () => {
    const tool = createArtifactRegisterFileTool(fakeRegistrar);
    await expect(
      tool.execute(
        {
          ...defaultInput,
          validation: { structure: 'unknown', visual: 'passed', manualEdit: 'not-checked' },
        },
        context,
      ),
    ).rejects.toThrow();
  });

  it('rejects extra properties in input', async () => {
    const tool = createArtifactRegisterFileTool(fakeRegistrar);
    await expect(tool.execute({ ...defaultInput, unexpected: 'field' }, context)).rejects.toThrow();
  });
});
