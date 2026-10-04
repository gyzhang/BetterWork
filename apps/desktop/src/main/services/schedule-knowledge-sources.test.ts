import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ExpertReferenceMaterial, ScheduleKnowledgeSource } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeVault } from './knowledge-vault';
import { ScheduleKnowledgeSourcesService } from './schedule-knowledge-sources';

const temporaryDirectories: string[] = [];
const vaults: KnowledgeVault[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-schedule-knowledge-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createHarness = () => {
  const directory = temporaryDirectory();
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'), {
    async extractor(format, bytes) {
      const content = Buffer.from(bytes).toString('utf8');
      return { format, content, sections: [{ locator: '全文', ordinal: 0, content }] };
    },
  });
  vaults.push(vault);
  return {
    directory,
    vault,
    service: new ScheduleKnowledgeSourcesService(vault),
    async importDocument(name: string, content: string) {
      const sourcePath = path.join(directory, name);
      writeFileSync(sourcePath, content);
      return vault.importSource(sourcePath);
    },
  };
};

const documentSource = (documentId: string, purpose = 'background'): ScheduleKnowledgeSource => ({
  kind: 'document',
  documentId,
  purpose: purpose as ScheduleKnowledgeSource['purpose'],
});

const expertReference = (
  document: Awaited<ReturnType<ReturnType<typeof createHarness>['importDocument']>>,
  purpose = 'template',
  originWorkspaceId?: string,
): ExpertReferenceMaterial => ({
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: document.document.id,
    knowledgeRevisionId: document.revisionId,
    contentHash: document.document.contentHash,
    sourcePath: document.document.sourcePath,
    ...(originWorkspaceId ? { originWorkspaceId } : {}),
  },
  purpose: purpose as ExpertReferenceMaterial['purpose'],
});

afterEach(() => {
  for (const vault of vaults.splice(0)) vault.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ScheduleKnowledgeSourcesService', () => {
  it('follows current revisions and membership while an empty selected collection stays empty', async () => {
    const fixture = createHarness();
    const first = await fixture.importDocument('甲.md', '第一份合成资料 v1');
    const second = await fixture.importDocument('乙.md', '第二份合成资料 v1');
    const direct = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [documentSource(first.document.id)],
      expertReferences: [],
    });
    expect(direct.items.map((item) => item.reference.knowledgeDocumentId)).toEqual([
      first.document.id,
    ]);
    expect(direct.items[0]?.origin).toBe('selected-document');
    expect(direct.items[0]?.reference.knowledgeRevisionId).toBe(first.revisionId);

    const updatedFirst = await fixture.importDocument('甲.md', '第一份合成资料 v2');
    const updatedDirect = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [documentSource(first.document.id)],
      expertReferences: [],
    });
    expect(updatedDirect.items[0]?.reference.knowledgeRevisionId).toBe(updatedFirst.revisionId);

    const emptyCollection = fixture.vault.saveCollection({ mode: 'create', name: '空集合' })[0];
    const empty = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [
        { kind: 'collection', collectionId: emptyCollection?.id ?? '', purpose: 'background' },
      ],
      expertReferences: [],
    });
    expect(empty.items).toEqual([]);

    const populated = fixture.vault.saveCollection({ mode: 'create', name: '月度材料' })[0];
    for (const document of [updatedFirst, second]) {
      fixture.vault.setCollectionMembers({
        documentId: document.document.id,
        expectedMembershipRevision: document.document.membershipRevision,
        collectionIds: [populated?.id ?? ''],
      });
    }
    const collectionSource: ScheduleKnowledgeSource = {
      kind: 'collection',
      collectionId: populated?.id ?? '',
      purpose: 'current-input',
    };
    const firstMembership = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [collectionSource],
      expertReferences: [],
    });
    expect(firstMembership.items.map((item) => item.reference.knowledgeDocumentId)).toEqual(
      [updatedFirst.document.id, second.document.id].sort(),
    );
    expect(firstMembership.items.every((item) => item.origin === 'selected-collection')).toBe(true);

    const membership = fixture.vault.listDocuments().find((item) => item.id === second.document.id);
    if (!membership) throw new Error('合成知识文档未登记');
    fixture.vault.setCollectionMembers({
      documentId: membership.id,
      expectedMembershipRevision: membership.membershipRevision,
      collectionIds: [],
    });
    const nextMembership = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [collectionSource],
      expertReferences: [],
    });
    expect(nextMembership.items.map((item) => item.reference.knowledgeDocumentId)).toEqual([
      updatedFirst.document.id,
    ]);

    const wholeVault = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [{ kind: 'vault', vaultId: 'default', purpose: 'background' }],
      expertReferences: [],
    });
    expect(wholeVault.items).toHaveLength(2);
    expect(wholeVault.items.every((item) => item.origin === 'selected-vault')).toBe(true);
  });

  it('deduplicates matching expert references with expert purpose and rejects stale revisions', async () => {
    const fixture = createHarness();
    const first = await fixture.importDocument('固定参考.md', '固定专家参考 v1');
    const pinned = expertReference(first, 'template');
    const duplicate = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [documentSource(first.document.id, 'background')],
      expertReferences: [pinned],
    });
    expect(duplicate.items).toHaveLength(1);
    expect(duplicate.items[0]).toMatchObject({
      purpose: 'template',
      origin: 'expert-reference',
      reference: { knowledgeRevisionId: first.revisionId },
    });
    fixture.service.assertUnchanged(
      {
        workspaceId: 'workspace-a',
        sources: [documentSource(first.document.id)],
        expertReferences: [pinned],
      },
      duplicate,
    );

    await fixture.importDocument('固定参考.md', '固定专家参考 v2');
    expect(() =>
      fixture.service.resolve({
        workspaceId: 'workspace-a',
        sources: [documentSource(first.document.id)],
        expertReferences: [pinned],
      }),
    ).toThrowError(expect.objectContaining({ code: 'schedule_source_conflict' }));
  });

  it('omits workspace-inapplicable expert references and never widens a missing selected document to the full Vault', async () => {
    const fixture = createHarness();
    const document = await fixture.importDocument('另一空间资料.md', '仅在别处适用');
    const excludedExpertReference = expertReference(document, 'background', 'workspace-b');
    const withoutApplicableSources = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: [],
      expertReferences: [excludedExpertReference],
    });
    expect(withoutApplicableSources.items).toEqual([]);

    expect(() =>
      fixture.service.resolve({
        workspaceId: 'workspace-a',
        sources: [documentSource('removed-document')],
        expertReferences: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'schedule_source_missing' }));
  });

  it('rechecks cross-database scope state before publication and blocks a removed source or collection', async () => {
    const fixture = createHarness();
    const document = await fixture.importDocument('准备期间移除.md', '删除前的合成版本');
    const selectedDocument = [documentSource(document.document.id)];
    const preparedDocument = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources: selectedDocument,
      expertReferences: [],
    });
    fixture.vault.removeDocument(document.document.id);
    expect(() =>
      fixture.service.assertUnchanged(
        { workspaceId: 'workspace-a', sources: selectedDocument, expertReferences: [] },
        preparedDocument,
      ),
    ).toThrowError(expect.objectContaining({ code: 'schedule_source_missing' }));

    const collection = fixture.vault.saveCollection({ mode: 'create', name: '准备期间删除' })[0];
    const sources: ScheduleKnowledgeSource[] = [
      { kind: 'collection', collectionId: collection?.id ?? '', purpose: 'background' },
    ];
    const preparedCollection = fixture.service.resolve({
      workspaceId: 'workspace-a',
      sources,
      expertReferences: [],
    });
    if (!collection) throw new Error('合成知识集合未创建');
    fixture.vault.deleteCollection({ id: collection.id, expectedRevision: collection.revision });
    expect(() =>
      fixture.service.assertUnchanged(
        { workspaceId: 'workspace-a', sources, expertReferences: [] },
        preparedCollection,
      ),
    ).toThrowError(expect.objectContaining({ code: 'schedule_source_missing' }));
  });

  it('blocks over-budget scopes instead of silently truncating selected knowledge', () => {
    const documents = Array.from({ length: 2_001 }, (_unused, index) => ({
      reference: {
        kind: 'knowledge-revision' as const,
        knowledgeDocumentId: `document-${index}`,
        knowledgeRevisionId: `revision-${index}`,
        contentHash: `hash-${index}`,
        sourcePath: `source-${index}.md`,
      },
      displayName: `資料 ${index}`,
    }));
    const readScheduledKnowledgeSources = vi.fn(() => ({
      scopes: [
        {
          source: { kind: 'vault', vaultId: 'default', purpose: 'background' } as const,
          documents,
        },
      ],
      expertReferences: [],
      failures: [],
      overBudget: false,
    }));
    const service = new ScheduleKnowledgeSourcesService({ readScheduledKnowledgeSources });
    expect(() =>
      service.resolve({
        workspaceId: 'workspace-a',
        sources: [{ kind: 'vault', vaultId: 'default', purpose: 'background' }],
        expertReferences: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'schedule_source_budget_exceeded' }));
  });
});
