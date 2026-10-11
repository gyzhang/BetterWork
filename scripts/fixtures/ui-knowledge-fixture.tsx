import type { KnowledgeRevisionSummary, KnowledgeTextPage } from '@betterwork/agent-protocol';
import type React from 'react';
import { useState } from 'react';

import type { KnowledgeLibrary } from '../../apps/desktop/src/renderer/src/hooks/use-knowledge-library';
import { KnowledgePage } from '../../apps/desktop/src/renderer/src/views/KnowledgeView';
import { documentSummary } from './ui-page-fixture-data';

const revision: KnowledgeRevisionSummary = {
  id: 'rev-2',
  documentId: 'doc-1',
  revision: 2,
  title: '合同条款',
  sourcePath: '/tmp/合同条款.md',
  format: 'markdown',
  byteSize: 24,
  contentHash: 'b'.repeat(64),
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  textHash: 'c'.repeat(64),
  sectionCount: 1,
  warnings: [],
  importedAt: 1,
  createdAt: 2,
};

const page: KnowledgeTextPage = {
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-2',
    contentHash: 'b'.repeat(64),
    sourcePath: '/tmp/合同条款.md',
  },
  textHash: 'c'.repeat(64),
  title: '合同条款',
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  warnings: [],
  parts: [
    {
      span: { sectionOrdinal: 0, start: 0, end: 7 },
      locator: '全文',
      text: '第二段保存文本',
      excerptHash: 'd'.repeat(64),
    },
  ],
  returnedCodePoints: 7,
  complete: true,
};

const libraryStub = (overrides: Partial<KnowledgeLibrary> = {}): KnowledgeLibrary => ({
  documents: [],
  results: [],
  query: '',
  setQuery: () => undefined,
  error: '',
  toast: undefined,
  showToast: () => undefined,
  dismissToast: () => undefined,
  issues: [],
  importing: false,
  loading: false,
  loadError: '',
  settings: { semanticEnabled: false, revision: 1, embeddingAvailable: false },
  embeddingModels: [],
  collections: [],
  filter: { kind: 'all' },
  setFilter: () => undefined,
  createCollection: async () => undefined,
  renameCollection: async () => undefined,
  deleteCollection: async () => undefined,
  saveDocumentCollections: async () => undefined,
  activeJobs: [],
  recentJobs: [],
  clearRecentJobs: async () => undefined,
  jobDetail: undefined,
  jobDetailLoading: false,
  jobDetailError: '',
  openJobDetail: async () => undefined,
  searchStatus: undefined,
  retryTarget: undefined,
  refresh: () => undefined,
  onImport: async () => undefined,
  onSearch: async () => undefined,
  onOpenSource: async () => undefined,
  onRefresh: async () => undefined,
  onRemove: async () => undefined,
  selectedMaterials: [],
  isSelected: () => false,
  toggleSelect: () => undefined,
  selectAllResults: () => undefined,
  clearSelection: () => undefined,
  researchBusy: false,
  research: async () => undefined,
  saveSettings: async () => undefined,
  rebuildSemantic: async () => undefined,
  rebuildKeyword: async () => undefined,
  checkAllSources: async () => undefined,
  cancelJob: async () => undefined,
  retryFailedItems: async () => undefined,
  detailDocument: undefined,
  detailRevisions: [],
  detailRevisionId: undefined,
  detailPage: undefined,
  detailLoading: false,
  detailError: '',
  detailCanGoBack: false,
  openDocument: async () => undefined,
  closeDocument: () => undefined,
  selectDetailRevision: async () => undefined,
  loadNextDetailPage: async () => undefined,
  loadPreviousDetailPage: async () => undefined,
  checkDocumentSource: async () => undefined,
  ...overrides,
});

export function KnowledgeScenario(): React.JSX.Element {
  const [detail, setDetail] = useState(false);
  const [failed, setFailed] = useState(true);
  return (
    <KnowledgePage
      onResearch={() => {
        throw new Error('本场景不执行研究');
      }}
      library={libraryStub({
        documents: [documentSummary],
        detailDocument: detail ? documentSummary : undefined,
        detailRevisions: detail ? [revision] : [],
        detailRevisionId: detail ? revision.id : undefined,
        detailPage: detail && !failed ? page : undefined,
        detailError: detail && failed ? '合成故障：保存文本读取失败，可返回列表重新打开' : '',
        openDocument: async () => setDetail(true),
        closeDocument: () => {
          setDetail(false);
          setFailed(false);
        },
      })}
    />
  );
}

export const knowledgeSteps = ['list', 'detail-failed', 'return', 'detail-recovered'];
