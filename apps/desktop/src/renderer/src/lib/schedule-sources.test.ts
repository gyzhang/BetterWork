import {
  type KnowledgeCollection,
  type KnowledgeDocumentSummary,
  SCHEDULE_KNOWLEDGE_SOURCE_MAX,
  type ScheduleKnowledgeSource,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  dedupeScheduleKnowledgeSources,
  filterScheduleKnowledgeDocuments,
  formatScheduleSourceBytes,
  scheduleKnowledgeSourceKey,
  scheduleKnowledgeSourceLabel,
  scheduleKnowledgeSourceMissing,
  scheduleVaultBudgetEstimate,
  toggleScheduleKnowledgeSource,
} from './schedule-sources';

const document = (
  id: string,
  overrides: Partial<KnowledgeDocumentSummary> = {},
): KnowledgeDocumentSummary => ({
  id,
  title: `资料 ${id}`,
  sourcePath: `/tmp/合成资料/${id}.md`,
  format: 'markdown',
  byteSize: 100,
  contentHash: `hash-${id}`,
  currentRevisionId: `revision-${id}`,
  sourceStatus: 'unchanged',
  lexicalState: 'ready',
  semanticState: 'disabled',
  collectionIds: [],
  membershipRevision: 1,
  importedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const collection: KnowledgeCollection = {
  id: 'collection-1',
  name: '经营资料',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};

const docSource = (
  documentId: string,
  purpose: ScheduleKnowledgeSource['purpose'] = 'background',
): ScheduleKnowledgeSource => ({
  kind: 'document',
  documentId,
  purpose,
});

describe('schedule source selection helpers', () => {
  it('deduplicates by source kind and stable identity without changing the first purpose', () => {
    const duplicate = docSource('document-1', 'historical-comparison');
    expect(dedupeScheduleKnowledgeSources([docSource('document-1'), duplicate])).toEqual([
      docSource('document-1'),
    ]);
    expect(scheduleKnowledgeSourceKey(duplicate)).toBe('document:document-1');
  });

  it('allows a valid empty collection and prevents mixing the whole Vault with narrower ranges', () => {
    const collectionSource: ScheduleKnowledgeSource = {
      kind: 'collection',
      collectionId: collection.id,
      purpose: 'background',
    };
    expect(toggleScheduleKnowledgeSource([], collectionSource, true)).toEqual([collectionSource]);
    expect(
      toggleScheduleKnowledgeSource(
        [],
        { kind: 'vault', vaultId: 'default', purpose: 'background' },
        true,
      ),
    ).toEqual([{ kind: 'vault', vaultId: 'default', purpose: 'background' }]);
    expect(
      toggleScheduleKnowledgeSource(
        [{ kind: 'vault', vaultId: 'default', purpose: 'background' }],
        collectionSource,
        true,
      ),
    ).toEqual([{ kind: 'vault', vaultId: 'default', purpose: 'background' }]);
  });

  it('caps scope descriptions at the shared contract limit', () => {
    const fiftySources: ScheduleKnowledgeSource[] = Array.from(
      { length: SCHEDULE_KNOWLEDGE_SOURCE_MAX },
      (_, index) => docSource(`document-${index}`),
    );
    expect(
      toggleScheduleKnowledgeSource(fiftySources, docSource('document-over-limit'), true),
    ).toHaveLength(SCHEDULE_KNOWLEDGE_SOURCE_MAX);
  });

  it('filters by title and long source path, and labels removed sources explicitly', () => {
    const path = `/tmp/${'长期目录/'.repeat(24)}月度经营数据.md`;
    const longDocument = document('document-long', { title: '经营月报', sourcePath: path });
    expect(filterScheduleKnowledgeDocuments([longDocument], '月度经营数据')).toEqual([
      longDocument,
    ]);
    expect(filterScheduleKnowledgeDocuments([longDocument], '不存在')).toEqual([]);
    const missing: ScheduleKnowledgeSource = {
      kind: 'document',
      documentId: 'deleted-document',
      purpose: 'background',
    };
    expect(scheduleKnowledgeSourceLabel(missing, [], [])).toBe('资料 deleted-document');
    expect(scheduleKnowledgeSourceMissing(missing, [], [])).toBe(true);
    expect(scheduleKnowledgeSourceMissing(docSource('document-long'), [longDocument], [])).toBe(
      false,
    );
  });

  it('estimates whole-library item and byte overages without truncating the candidate list', () => {
    const estimate = scheduleVaultBudgetEstimate([
      document('large', { byteSize: 600 * 1024 * 1024 }),
    ]);
    expect(estimate).toEqual({
      itemCount: 1,
      byteSize: 600 * 1024 * 1024,
      overItemBudget: false,
      overByteBudget: true,
    });
    expect(formatScheduleSourceBytes(600 * 1024 * 1024)).toBe('600 MiB');

    const overCount = Array.from({ length: 2_001 }, (_, index) => document(`item-${index}`));
    const itemEstimate = scheduleVaultBudgetEstimate(overCount);
    expect(itemEstimate.itemCount).toBe(2_001);
    expect(itemEstimate.overItemBudget).toBe(true);
    expect(itemEstimate.overByteBudget).toBe(false);
  });
});
