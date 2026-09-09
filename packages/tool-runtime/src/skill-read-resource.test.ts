import { describe, expect, it } from 'vitest';

import { createSkillReadResourceTool } from './skill-read-resource';

const context = {
  runId: 'run-1',
  toolCallId: 'tool-1',
  workspacePath: '.',
  signal: new AbortController().signal,
  reportProgress() {},
};

describe('createSkillReadResourceTool', () => {
  it('returns text content for a text resource', async () => {
    const tool = createSkillReadResourceTool(async () => ({
      content: Buffer.from('# Skill 指令\n这是说明文档', 'utf8'),
      relativePath: 'SKILL.md',
    }));
    const output = (await tool.execute({ bindingId: 'binding-1', path: 'SKILL.md' }, context)) as {
      path: string;
      content: string;
      encoding: string;
      size: number;
      truncated: boolean;
    };
    expect(output).toMatchObject({
      path: 'SKILL.md',
      encoding: 'utf8',
      truncated: false,
    });
    expect(output.content).toContain('Skill 指令');
  });

  it('returns metadata for binary content', async () => {
    const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
    const tool = createSkillReadResourceTool(async () => ({
      content: binaryContent,
      relativePath: 'template/icon.png',
    }));
    const output = (await tool.execute(
      { bindingId: 'binding-1', path: 'template/icon.png' },
      context,
    )) as { encoding: string; size: number; message: string };
    expect(output.encoding).toBe('binary');
    expect(output.size).toBe(binaryContent.byteLength);
    expect(output.message).toContain('二进制文件');
  });

  it('respects offset and length for text content', async () => {
    const tool = createSkillReadResourceTool(async () => ({
      content: Buffer.from('abcdefghij', 'utf8'),
      relativePath: 'data.txt',
    }));
    const output = (await tool.execute(
      { bindingId: 'binding-1', path: 'data.txt', offset: 2, length: 3 },
      context,
    )) as { content: string };
    expect(output.content).toBe('cde');
  });

  it('rejects invalid input', async () => {
    const tool = createSkillReadResourceTool(async () => ({
      content: Buffer.from('test'),
      relativePath: 'test.txt',
    }));
    await expect(tool.execute({ bindingId: '', path: 'test.txt' }, context)).rejects.toThrow();
  });
});
