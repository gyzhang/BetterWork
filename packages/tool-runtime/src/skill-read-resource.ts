import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z
  .object({
    bindingId: z.string().min(1),
    path: z.string().trim().min(1),
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().optional(),
  })
  .strict();

const MAX_TEXT_BYTES = 64 * 1024;

export interface SkillResourceReadInput {
  bindingId: string;
  path: string;
}

export interface SkillResourceReadOutput {
  content: Buffer;
  relativePath: string;
}

export type SkillResourceReader = (
  input: SkillResourceReadInput,
) => Promise<SkillResourceReadOutput>;

const isBinaryBuffer = (buffer: Buffer): boolean => {
  const checkLength = Math.min(buffer.length, 8192);
  for (let index = 0; index < checkLength; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return true;
  }
  return false;
};

export const createSkillReadResourceTool = (reader: SkillResourceReader): AgentTool => ({
  name: 'skill_read_resource',
  description:
    'Read a resource file from the bound Skill package (instructions, references, template skeletons). Binary files return metadata only.',
  inputSchema: {
    type: 'object',
    properties: {
      bindingId: {
        type: 'string',
        description: 'The Skill binding ID for the current run.',
      },
      path: {
        type: 'string',
        description: 'Relative path within the Skill resource root.',
      },
      offset: {
        type: 'integer',
        description: 'Byte offset to start reading from (default 0).',
      },
      length: {
        type: 'integer',
        description: 'Maximum number of bytes to read.',
      },
    },
    required: ['bindingId', 'path'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(`正在读取 Skill 资源：${input.path}`);

    const { content, relativePath } = await reader({
      bindingId: input.bindingId,
      path: input.path,
    });

    if (context.signal.aborted) throw abortError();

    if (isBinaryBuffer(content)) {
      return {
        path: relativePath,
        encoding: 'binary',
        size: content.byteLength,
        message: `文件 ${relativePath} 是二进制文件（${content.byteLength} 字节），请使用对应的解析工具处理。`,
      };
    }

    const offset = input.offset ?? 0;
    const sliceEnd = input.length ? offset + input.length : content.byteLength;
    const slice = content.subarray(offset, sliceEnd);
    const text = slice.toString('utf8');
    const truncated = slice.byteLength > MAX_TEXT_BYTES;
    const finalText = truncated ? text.slice(0, MAX_TEXT_BYTES) : text;

    return {
      path: relativePath,
      content: finalText,
      encoding: 'utf8',
      size: content.byteLength,
      truncated,
      message: truncated
        ? `已读取 ${relativePath}（内容较长，只取前 ${MAX_TEXT_BYTES} 字节）`
        : `已读取 ${relativePath}`,
    };
  },
});
