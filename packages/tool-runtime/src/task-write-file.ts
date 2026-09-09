import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z
  .object({
    path: z.string().trim().min(1),
    content: z.string(),
    expectedHash: z.string().min(1).optional(),
  })
  .strict();

export interface TaskFileWriteInput {
  runId: string;
  path: string;
  content: string;
  expectedHash?: string;
}

export interface TaskFileWriteOutput {
  relativePath: string;
  bytesWritten: number;
  contentHash: string;
  created: boolean;
}

export type TaskFileWriter = (input: TaskFileWriteInput) => Promise<TaskFileWriteOutput>;

export const createTaskWriteFileTool = (writer: TaskFileWriter): AgentTool => ({
  name: 'task_write_file',
  description:
    'Write or update a text file in the current task work directory (SVG, JSON, spec, etc.). Provide expectedHash when overwriting to avoid conflicts.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path within the task work directory.',
      },
      content: {
        type: 'string',
        description: 'Text content to write.',
      },
      expectedHash: {
        type: 'string',
        description:
          'SHA-256 hash of the existing file content. Required when overwriting; prevents accidental data loss if the file changed.',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress(`正在写入任务文件：${input.path}`);

    const result = await writer({
      runId: context.runId,
      path: input.path,
      content: input.content,
      ...(input.expectedHash ? { expectedHash: input.expectedHash } : {}),
    });

    if (context.signal.aborted) throw abortError();

    return {
      path: result.relativePath,
      bytesWritten: result.bytesWritten,
      contentHash: result.contentHash,
      created: result.created,
      message: result.created
        ? `已创建 ${result.relativePath}（${result.bytesWritten} 字节）`
        : `已更新 ${result.relativePath}（${result.bytesWritten} 字节）`,
    };
  },
});
