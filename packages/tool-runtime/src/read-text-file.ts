import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z.object({ path: z.string().min(1) });
const maxChars = 20_000;

export const readTextFileTool: AgentTool = {
  name: 'read_text_file',
  description: 'Read a UTF-8 text file inside the active workspace.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    const workspace = path.resolve(context.workspacePath);
    const target = path.resolve(workspace, input.path);
    const relative = path.relative(workspace, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File is outside the active workspace');
    if (context.signal.aborted) throw Object.assign(new Error('Run cancelled'), { name: 'AbortError' });
    context.reportProgress(`正在读取 ${relative || path.basename(target)}`);
    const content = await readFile(target, 'utf8');
    return {
      path: relative,
      content: content.slice(0, maxChars),
      truncated: content.length > maxChars,
    };
  },
};
