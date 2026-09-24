import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { KnowledgeMaterialReference } from '@betterwork/agent-protocol';
import { KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { KnowledgeAudit, type KnowledgeRunAuditContext } from './knowledge-audit';
import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeVault } from './knowledge-vault';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

const setup = async (fileContent: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'betterwork-audit-'));
  const store = AppStore.open(':memory:');
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  const notePath = path.join(directory, '资料.md');
  await writeFile(notePath, fileContent);
  await vault.importPaths([notePath]);
  const workspace = store.workspaces.getOrCreate(directory, 'audit');
  const created = store.tasks.create(workspace.id, '审计任务', 'KM02');
  const runId = randomUUID();
  store.runs.create({
    id: runId,
    taskId: created.task.id,
    sessionId: created.sessionId,
    prompt: '测试',
    status: 'running',
    createdAt: Date.now(),
  });
  cleanup.push(async () => {
    vault.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const document = vault.listDocuments()[0];
  const revision = document ? vault.listRevisions(document.id)[0] : undefined;
  if (!document || !revision) throw new Error('fixture revision missing');
  const reference: KnowledgeMaterialReference = {
    kind: 'knowledge-revision',
    knowledgeDocumentId: document.id,
    knowledgeRevisionId: revision.id,
    contentHash: revision.contentHash,
    sourcePath: revision.sourcePath,
  };
  const audit = new KnowledgeAudit(store, vault);
  const context = (overrides?: Partial<KnowledgeRunAuditContext>): KnowledgeRunAuditContext => ({
    runId,
    taskId: created.task.id,
    toolCallId: randomUUID(),
    signal: new AbortController().signal,
    materialScope: true,
    materials: [reference],
    ...overrides,
  });
  return { store, vault, audit, reference, revision, runId, taskId: created.task.id, context };
};

const longContent = '续'.repeat(300);

describe('KnowledgeAudit.searchForRun', () => {
  it('returns an explained empty result instead of full-vault access', async () => {
    const fixture = await setup('客户续约风险需要跟进。');
    const legacy = fixture.audit.searchForRun(
      fixture.context({ materialScope: false, materials: [] }),
      '续约',
    );
    expect(legacy.results).toEqual([]);
    expect(legacy.notice).toContain('没有固定材料范围');
    const noneSelected = fixture.audit.searchForRun(fixture.context({ materials: [] }), '续约');
    expect(noneSelected.results).toEqual([]);
    expect(noneSelected.notice).toContain('未选择知识资料');
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([]);
  });

  it('audits each returned excerpt with exact span and full footprint group', async () => {
    const fixture = await setup(`${longContent}甲。${longContent}乙。`);
    const ctx = fixture.context({ toolCallId: 'call-search-1' });
    const outcome = fixture.audit.searchForRun(ctx, '乙');
    expect(outcome.results).toHaveLength(1);
    const hit = outcome.results[0];
    if (!hit?.span) throw new Error('audited hit must carry span');
    const section = fixture.vault.getRevision(fixture.reference.knowledgeRevisionId)?.chunks[0];
    expect(hit.excerpt).toBe(
      Array.from(section?.content ?? '')
        .slice(hit.span.start, hit.span.end)
        .join(''),
    );
    const evidence = fixture.store.evidence.get(hit.evidenceId);
    expect(evidence?.knowledgeSource).toMatchObject({
      operation: 'search',
      textHash: fixture.revision.textHash,
      reference: { knowledgeRevisionId: fixture.revision.id },
    });
    const footprint = fixture.store.materialReads.listByRun(fixture.runId)[0];
    expect(footprint).toMatchObject({
      operation: 'search',
      toolCallId: 'call-search-1',
      knowledgePartIndex: 0,
      textHash: fixture.revision.textHash,
      evidenceId: hit.evidenceId,
    });
    // 搜索摘要不计入正文预算
    expect(fixture.store.materialReads.readCodePointsUsed(fixture.runId)).toBe(0);
  });

  it('reuses one evidence id across tool calls while keeping footprints separate', async () => {
    const fixture = await setup('续约风险跟进。');
    const first = fixture.audit.searchForRun(fixture.context(), '续约');
    const second = fixture.audit.searchForRun(fixture.context(), '续约');
    expect(second.results[0]?.evidenceId).toBe(first.results[0]?.evidenceId);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toHaveLength(2);
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
  });

  it('fails closed with KNOWLEDGE_AUDIT_FAILED and returns nothing on write error', async () => {
    const fixture = await setup('续约风险跟进。');
    expect(() =>
      fixture.audit.searchForRun(fixture.context({ taskId: 'not-the-task' }), '续约'),
    ).toThrowError(KnowledgeServiceError);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([]);
  });
});

describe('KnowledgeAudit.readForRun', () => {
  it('rejects references outside the run snapshot without any body', async () => {
    const fixture = await setup('续约风险跟进。');
    expect(() =>
      fixture.audit.readForRun(fixture.context({ materialScope: false }), {
        reference: fixture.reference,
      }),
    ).toThrowError(KnowledgeServiceError);
    const forged: KnowledgeMaterialReference = {
      ...fixture.reference,
      contentHash: 'forged-hash',
    };
    try {
      fixture.audit.readForRun(fixture.context(), { reference: forged });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeServiceError);
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_NOT_SELECTED');
    }
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toEqual([]);
  });

  it('rejects a revision whose saved text identity diverges, without falling back to latest', async () => {
    const fixture = await setup('续约风险跟进。');
    const stale: KnowledgeMaterialReference = {
      ...fixture.reference,
      knowledgeRevisionId: randomUUID(),
    };
    // 材料里放一个库里不存在的修订身份：必须拒绝而不是按 latest 读取
    try {
      fixture.audit.readForRun(fixture.context({ materials: [stale] }), { reference: stale });
      expect.unreachable();
    } catch (error) {
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_REVISION_MISMATCH');
    }
  });

  it('pages the saved text, records read footprints per part and consumes the run budget', async () => {
    const fixture = await setup(longContent);
    const first = fixture.audit.readForRun(fixture.context({ toolCallId: 'read-1' }), {
      reference: fixture.reference,
      maxCodePoints: 100,
    });
    expect(first.parts).toHaveLength(1);
    expect(first.returnedCodePoints).toBe(100);
    expect(first.remainingRunCodePoints).toBe(KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS - 100);
    if (!first.nextCursor) throw new Error('expected continuation cursor');
    const second = fixture.audit.readForRun(fixture.context({ toolCallId: 'read-2' }), {
      reference: fixture.reference,
      cursor: first.nextCursor,
      maxCodePoints: 100,
    });
    expect(second.returnedCodePoints).toBe(100);
    expect(fixture.store.materialReads.readCodePointsUsed(fixture.runId)).toBe(200);
    const evidenceIds = new Set([
      ...first.parts.map((part) => part.evidenceId),
      ...second.parts.map((part) => part.evidenceId),
    ]);
    expect(evidenceIds.size).toBe(2);
    for (const part of second.parts) {
      const evidence = fixture.store.evidence.get(part.evidenceId);
      expect(evidence?.knowledgeSource).toMatchObject({ operation: 'read' });
    }
    // 不同 toolCall 读相同 span 复用 Evidence 但分别计量
    const reread = fixture.audit.readForRun(fixture.context({ toolCallId: 'read-3' }), {
      reference: fixture.reference,
      maxCodePoints: 100,
    });
    expect(reread.parts[0]?.evidenceId).toBe(first.parts[0]?.evidenceId);
    expect(fixture.store.materialReads.readCodePointsUsed(fixture.runId)).toBe(300);
  });

  it('consumes no extra budget when the same tool call result is re-consumed identically', async () => {
    const fixture = await setup(longContent);
    const context = fixture.context({ toolCallId: 'read-same' });
    const first = fixture.audit.readForRun(context, {
      reference: fixture.reference,
      maxCodePoints: 50,
    });
    const usedAfterFirst = fixture.store.materialReads.readCodePointsUsed(fixture.runId);
    const replay = fixture.audit.readForRun(context, {
      reference: fixture.reference,
      maxCodePoints: 50,
    });
    expect(replay.parts.map((part) => part.evidenceId)).toEqual(
      first.parts.map((part) => part.evidenceId),
    );
    expect(fixture.store.materialReads.readCodePointsUsed(fixture.runId)).toBe(usedAfterFirst);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toHaveLength(1);
  });

  it('refuses further reads with budget exhausted while text remains, without faking completion', async () => {
    const content = '汉'.repeat(KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS + 100);
    const fixture = await setup(content);
    let cursor = undefined;
    let exhausted: KnowledgeServiceError | undefined;
    for (;;) {
      try {
        const page = fixture.audit.readForRun(fixture.context(), {
          reference: fixture.reference,
          ...(cursor ? { cursor } : {}),
          maxCodePoints: 8000,
        });
        cursor = page.nextCursor;
        if (!cursor) break;
      } catch (error) {
        exhausted = error as KnowledgeServiceError;
        break;
      }
    }
    expect(exhausted?.code).toBe('KNOWLEDGE_READ_BUDGET_EXCEEDED');
    // 拒绝发生在超支之前：累计恰好等于预算，正文并未被伪装读完
    expect(fixture.store.materialReads.readCodePointsUsed(fixture.runId)).toBe(
      KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS,
    );
  });
});
