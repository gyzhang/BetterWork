import type { RecallItem } from '../memory-retrieval';

/** `memory-retrieval` 两个用例文件（功能档与计时基准档）共用的最小夹具。 */

export const userScope = { kind: 'user' } as const;
export const workspaceScope = { kind: 'workspace', workspaceId: 'ws-1' } as const;
export const expertScope = { kind: 'expert', expertId: 'ex-1' } as const;
export const expertWorkspaceScope = {
  kind: 'expert-workspace',
  expertId: 'ex-1',
  workspaceId: 'ws-1',
} as const;

export const item = (over: Partial<RecallItem> & { id: string; content: string }): RecallItem => ({
  revisionId: `rev-${over.id}`,
  contentHash: `hash-${over.id}`,
  kind: 'semantic',
  scope: workspaceScope,
  updatedAt: 1_000,
  ...over,
});
