import { describe, expect, it } from 'vitest';

import { createSkillExecuteTool } from './skill-execute';

const context = {
  runId: 'run-1',
  toolCallId: 'tool-1',
  workspacePath: '.',
  signal: new AbortController().signal,
  reportProgress() {},
};

describe('createSkillExecuteTool', () => {
  it('returns the executor result with status and message', async () => {
    const tool = createSkillExecuteTool(async () => ({
      executionId: 'exec-1',
      status: 'succeeded',
      message: '命令执行成功',
    }));
    const output = (await tool.execute(
      { bindingId: 'binding-1', commandId: 'ppt-init', args: { format: 'ppt169' } },
      context,
    )) as { executionId: string; status: string; message: string };
    expect(output).toMatchObject({
      executionId: 'exec-1',
      status: 'succeeded',
      message: '命令执行成功',
    });
  });

  it('passes runId and toolCallId from context', async () => {
    let capturedInput = {};
    const tool = createSkillExecuteTool(async (input) => {
      capturedInput = input;
      return { executionId: 'exec-2', status: 'succeeded', message: 'ok' };
    });
    await tool.execute({ bindingId: 'b-1', commandId: 'cmd-1' }, context);
    expect(capturedInput).toMatchObject({
      runId: 'run-1',
      toolCallId: 'tool-1',
      bindingId: 'b-1',
      commandId: 'cmd-1',
    });
  });

  it('defaults args to empty object when not provided', async () => {
    let capturedArgs: Record<string, unknown> = { sentinel: true };
    const tool = createSkillExecuteTool(async (input) => {
      capturedArgs = input.args;
      return { executionId: 'exec-3', status: 'succeeded', message: 'ok' };
    });
    await tool.execute({ bindingId: 'b-1', commandId: 'cmd-1' }, context);
    expect(capturedArgs).toEqual({});
  });

  it('rejects missing bindingId', async () => {
    const tool = createSkillExecuteTool(async () => ({
      executionId: 'exec-4',
      status: 'succeeded',
      message: 'ok',
    }));
    await expect(tool.execute({ bindingId: '', commandId: 'cmd-1' }, context)).rejects.toThrow();
  });

  it('reports failed status with reason', async () => {
    const tool = createSkillExecuteTool(async () => ({
      executionId: 'exec-5',
      status: 'failed',
      reason: 'spawn-failed',
      message: '命令执行失败：spawn-failed',
    }));
    const output = (await tool.execute({ bindingId: 'b-1', commandId: 'cmd-1' }, context)) as {
      status: string;
      reason: string;
    };
    expect(output.status).toBe('failed');
    expect(output.reason).toBe('spawn-failed');
  });
});
