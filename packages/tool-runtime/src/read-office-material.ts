import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const inputSchema = z
  .object({
    sourceKind: z.enum(['workspace-input-snapshot', 'artifact-version']),
    snapshotId: z.string().min(1).optional(),
    artifactId: z.string().min(1).optional(),
    versionId: z.string().min(1).optional(),
    locator: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.sourceKind === 'workspace-input-snapshot' && !input.snapshotId) {
      context.addIssue({ code: 'custom', path: ['snapshotId'], message: 'snapshotId is required' });
    }
    if (input.sourceKind === 'artifact-version' && (!input.artifactId || !input.versionId)) {
      context.addIssue({
        code: 'custom',
        path: ['artifactId'],
        message: 'artifactId and versionId are required',
      });
    }
  });

export type OfficeMaterialSourceKind = z.infer<typeof inputSchema>['sourceKind'];
export type ReadOfficeMaterialInput = z.infer<typeof inputSchema>;

export type OfficeMaterialReader = (
  input: ReadOfficeMaterialInput,
  context: Parameters<AgentTool['execute']>[1],
) => Promise<unknown>;

export const createReadOfficeMaterialTool = (reader: OfficeMaterialReader): AgentTool => ({
  name: 'read_office_material',
  description:
    'Read one selected PPTX, XLSX, or CSV material. Use a slide locator such as slide:2, a spreadsheet locator such as Sheet1!A1:D12, or omit locator to read the bounded default sections.',
  inputSchema: {
    type: 'object',
    properties: {
      sourceKind: {
        type: 'string',
        enum: ['workspace-input-snapshot', 'artifact-version'],
        description:
          'Whether the selected material is a workspace input snapshot or an Artifact version.',
      },
      snapshotId: { type: 'string', description: 'The selected workspace input snapshot ID.' },
      artifactId: { type: 'string', description: 'The selected Artifact ID.' },
      versionId: { type: 'string', description: 'The selected Artifact version ID.' },
      locator: {
        type: 'string',
        description: 'Optional slide, notes, Sheet/range, or bounded CSV locator.',
      },
    },
    required: ['sourceKind'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    if (context.signal.aborted) throw abortError();
    context.reportProgress('正在读取已选择的 Office 材料');
    const result = await reader(input, context);
    if (context.signal.aborted) throw abortError();
    return result;
  },
});
