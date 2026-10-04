import {
  type KnowledgeCollection,
  type KnowledgeDocumentSummary,
  SCHEDULE_KNOWLEDGE_SOURCE_MAX,
  SCHEDULE_SOURCE_ITEM_MAX,
  SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  type ScheduleKnowledgeSource,
} from '@betterwork/agent-protocol';

export const scheduleKnowledgeSourceKey = (source: ScheduleKnowledgeSource): string => {
  if (source.kind === 'vault') return 'vault:default';
  return source.kind === 'document'
    ? `document:${source.documentId}`
    : `collection:${source.collectionId}`;
};

export const dedupeScheduleKnowledgeSources = (
  sources: readonly ScheduleKnowledgeSource[],
): ScheduleKnowledgeSource[] => {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = scheduleKnowledgeSourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const toggleScheduleKnowledgeSource = (
  sources: readonly ScheduleKnowledgeSource[],
  source: ScheduleKnowledgeSource,
  checked: boolean,
): ScheduleKnowledgeSource[] => {
  const current = dedupeScheduleKnowledgeSources(sources);
  const key = scheduleKnowledgeSourceKey(source);
  if (!checked) return current.filter((candidate) => scheduleKnowledgeSourceKey(candidate) !== key);
  if (current.some((candidate) => scheduleKnowledgeSourceKey(candidate) === key)) return current;
  if (current.length >= SCHEDULE_KNOWLEDGE_SOURCE_MAX) return current;
  if (source.kind === 'vault' && current.length > 0) return current;
  if (current.some((candidate) => candidate.kind === 'vault')) return current;
  return [...current, source];
};

export const scheduleKnowledgeSourceLabel = (
  source: ScheduleKnowledgeSource,
  documents: readonly KnowledgeDocumentSummary[],
  collections: readonly KnowledgeCollection[],
): string => {
  if (source.kind === 'vault') return '整个资料库';
  if (source.kind === 'document') {
    const document = documents.find((candidate) => candidate.id === source.documentId);
    return document?.title || document?.sourcePath || `资料 ${source.documentId}`;
  }
  const collection = collections.find((candidate) => candidate.id === source.collectionId);
  return collection?.name || `集合 ${source.collectionId}`;
};

export const scheduleKnowledgeSourceMissing = (
  source: ScheduleKnowledgeSource,
  documents: readonly KnowledgeDocumentSummary[],
  collections: readonly KnowledgeCollection[],
): boolean => {
  if (source.kind === 'vault') return false;
  if (source.kind === 'document') {
    return !documents.some(
      (document) => document.id === source.documentId && document.currentRevisionId,
    );
  }
  return !collections.some((collection) => collection.id === source.collectionId);
};

export const filterScheduleKnowledgeDocuments = (
  documents: readonly KnowledgeDocumentSummary[],
  search: string,
): KnowledgeDocumentSummary[] => {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return [...documents];
  return documents.filter(
    (document) =>
      document.title.toLocaleLowerCase().includes(query) ||
      document.sourcePath.toLocaleLowerCase().includes(query),
  );
};

export const scheduleVaultBudgetEstimate = (
  documents: readonly KnowledgeDocumentSummary[],
): { itemCount: number; byteSize: number; overItemBudget: boolean; overByteBudget: boolean } => {
  const itemCount = documents.length;
  const byteSize = documents.reduce((total, document) => total + document.byteSize, 0);
  return {
    itemCount,
    byteSize,
    overItemBudget: itemCount > SCHEDULE_SOURCE_ITEM_MAX,
    overByteBudget: byteSize > SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  };
};

export const formatScheduleSourceBytes = (byteSize: number): string =>
  `${(byteSize / (1024 * 1024)).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MiB`;
