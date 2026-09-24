import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { KnowledgeCreateResearchDraftRequest } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeVault } from './knowledge-vault';
import { ResearchDraftService } from './research-draft-service';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

const setup = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'betterwork-draft-'));
  const store = AppStore.open(':memory:');
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  const alpha = path.join(directory, 'alpha.md');
  const beta = path.join(directory, 'beta.md');
  await writeFile(alpha, '甲文档：渠道转化与续约风险。');
  await writeFile(beta, '乙文档：季度复盘口径。');
  await vault.importPaths([alpha, beta]);
  const workspace = store.workspaces.getOrCreate(directory, '草稿工作空间');
  cleanup.push(async () => {
    vault.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const service = new ResearchDraftService(store, vault);
  const referenceFor = (file: string) => {
    const document = vault
      .listDocuments()
      .find((item) => item.sourcePath === path.join(directory, file));
    if (!document) throw new Error(`fixture document missing: ${file}`);
    const revision = vault.listRevisions(document.id)[0];
    if (!revision) throw new Error('fixture revision missing');
    return {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: document.id,
      knowledgeRevisionId: revision.id,
      contentHash: revision.contentHash,
      sourcePath: document.sourcePath,
    };
  };
  return { store, vault, service, workspace, directory, referenceFor };
};

const request = (
  fixture: Awaited<ReturnType<typeof setup>>,
  overrides?: Partial<KnowledgeCreateResearchDraftRequest>,
): KnowledgeCreateResearchDraftRequest => ({
  operationId: randomUUID(),
  workspaceId: fixture.workspace.id,
  prompt: '整理本月渠道转化的研究与结论。',
  materials: [
    { reference: fixture.referenceFor('alpha.md'), purpose: 'background' },
    { reference: fixture.referenceFor('beta.md'), purpose: 'background' },
  ],
  ...overrides,
});

describe('ResearchDraftService', () => {
  it('creates an atomic draft with full TaskContext and receipt in one transaction', async () => {
    const fixture = await setup();
    const input = request(fixture);
    const result = fixture.service.create(input);
    expect(result.task.title).toBe('整理本月渠道转化的研究与结论。');
    const draftMaterials = result.context.materials ?? [];
    expect(draftMaterials).toHaveLength(2);
    expect(result.context.executor).toEqual({ kind: 'general' });
    expect(result.context.skillBindings).toEqual([]);
    expect(result.context.excludedMemoryIds ?? []).toEqual([]);
    expect(draftMaterials.every((item) => item.addedFrom === 'global-search')).toBe(true);
    const receipt = fixture.store.researchDraftOperations.get(input.operationId);
    expect(receipt).toMatchObject({ taskId: result.task.id, contextId: result.context.id });
    // 草稿不自动发送模型：没有任何 Run 产生
    expect(fixture.store.runs.list()).toEqual([]);
  });

  it('returns the original draft on retry even after the materials were removed', async () => {
    const fixture = await setup();
    const input = request(fixture);
    const first = fixture.service.create(input);
    for (const material of input.materials) {
      fixture.vault.removeDocument(material.reference.knowledgeDocumentId);
    }
    const retry = fixture.service.create(input);
    expect(retry.task.id).toBe(first.task.id);
    expect(retry.context.id).toBe(first.context.id);
    expect(retry.prompt).toBe(input.prompt);
    // 不重复创建任务
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toHaveLength(1);
  });

  it('rejects a different input under the same operation id', async () => {
    const fixture = await setup();
    const input = request(fixture);
    fixture.service.create(input);
    try {
      fixture.service.create({ ...input, prompt: '换一个研究问题。' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeServiceError);
      expect((error as KnowledgeServiceError).code).toBe('OPERATION_CONFLICT');
    }
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toHaveLength(1);
  });

  it('refuses removed materials before the first creation without a half draft', async () => {
    const fixture = await setup();
    const input = request(fixture);
    fixture.vault.removeDocument(input.materials[0]?.reference.knowledgeDocumentId ?? '');
    try {
      fixture.service.create(input);
      expect.unreachable();
    } catch (error) {
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_DOCUMENT_REMOVED');
    }
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toEqual([]);
    expect(fixture.store.researchDraftOperations.get(input.operationId)).toBeUndefined();
  });

  it('sorts and dedupes by full material identity and rejects conflicting purposes', async () => {
    const fixture = await setup();
    const alpha = fixture.referenceFor('alpha.md');
    const beta = fixture.referenceFor('beta.md');
    const input = request(fixture, {
      materials: [
        { reference: beta, purpose: 'background' },
        { reference: alpha, purpose: 'current-input' },
        { reference: alpha, purpose: 'current-input' },
      ],
    });
    const result = fixture.service.create(input);
    expect(result.context.materials ?? []).toHaveLength(2);
    const identityKeys = (result.context.materials ?? []).map((item) =>
      item.reference.kind === 'knowledge-revision'
        ? JSON.stringify([
            item.reference.knowledgeDocumentId,
            item.reference.knowledgeRevisionId,
            item.reference.contentHash,
            item.reference.sourcePath,
          ])
        : '',
    );
    expect([...identityKeys].sort((a, b) => (a < b ? -1 : 1))).toEqual(identityKeys);
    expect(() =>
      fixture.service.create(
        request(fixture, {
          operationId: randomUUID(),
          materials: [
            { reference: alpha, purpose: 'current-input' },
            { reference: alpha, purpose: 'background' },
          ],
        }),
      ),
    ).toThrowError(KnowledgeServiceError);
  });

  it('rolls the whole draft back when the receipt insert fails', async () => {
    const fixture = await setup();
    const input = request(fixture);
    const original = fixture.store.researchDraftOperations.insert.bind(
      fixture.store.researchDraftOperations,
    );
    let thrown = false;
    fixture.store.researchDraftOperations.insert = (): void => {
      thrown = true;
      throw new Error('receipt write failed');
    };
    void original;
    expect(() => fixture.service.create(input)).toThrowError('receipt write failed');
    fixture.store.researchDraftOperations.insert = original;
    // 事务回滚：任务与 TaskContext 都不留下半成品
    expect(thrown).toBe(true);
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toEqual([]);
    const again = fixture.service.create(input);
    expect(again.context.materials ?? []).toHaveLength(2);
  });

  it('keeps pinned revisions when the source refreshes afterwards', async () => {
    const fixture = await setup();
    const input = request(fixture, {
      materials: [{ reference: fixture.referenceFor('alpha.md'), purpose: 'background' }],
    });
    const result = fixture.service.create(input);
    await writeFile(path.join(fixture.directory, 'alpha.md'), '甲文档更新后的内容。');
    await fixture.vault.importPaths([path.join(fixture.directory, 'alpha.md')]);
    const pinned = (result.context.materials ?? [])[0]?.reference;
    expect(pinned?.kind).toBe('knowledge-revision');
    if (pinned?.kind === 'knowledge-revision') {
      const latest = fixture.vault.listRevisions(pinned.knowledgeDocumentId)[0];
      expect(latest?.id).not.toBe(pinned.knowledgeRevisionId);
    }
  });
});
