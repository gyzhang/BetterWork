import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';

export const longTitle = '季度复盘与合同条款核对：跨部门研究资料与长期项目的版本边界';

export const longPath =
  '/synthetic/这是一个用于检验长路径换行的资料目录/' + 'contract-review-'.repeat(12) + '.md';

export const documentSummary: KnowledgeDocumentSummary = {
  id: 'doc-1',
  title: longTitle,
  sourcePath: longPath,
  format: 'markdown',
  byteSize: 24,
  contentHash: 'a'.repeat(64),
  sourceStatus: 'unchanged',
  lexicalState: 'ready',
  semanticState: 'disabled',
  collectionIds: [],
  membershipRevision: 1,
  importedAt: 1,
  updatedAt: 2,
};
