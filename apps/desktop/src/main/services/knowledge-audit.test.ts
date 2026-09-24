import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { KnowledgeMaterialReference, TaskMaterialSelection } from '@betterwork/agent-protocol';
import { KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS } from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { KnowledgeAudit, type KnowledgeRunAuditContext } from './knowledge-audit';
import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeSearchService } from './knowledge-search';
import { KnowledgeVault } from './knowledge-vault';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

const setup = async (fileContent: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'betterwork-audit-'));
  const store = AppStore.open(':memory:');
  const vaultPath = path.join(directory, 'vault.sqlite');
  const vault = new KnowledgeVault(vaultPath);
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
  const audit = new KnowledgeAudit(store, vault, (input) =>
    new KnowledgeSearchService({
      vault,
      index: vault.index,
      // Run 通道测试注入固定材料；语义检索未开启时只会走关键词路径。
      runMaterials: () => [reference],
      embedding: {
        defaultSnapshot: () => {
          throw new Error('审计测试不应调用嵌入模型');
        },
        snapshotOf: () => {
          throw new Error('审计测试不应调用嵌入模型');
        },
        embed: async () => {
          throw new Error('审计测试不应调用嵌入模型');
        },
      },
    }).search(input),
  );
  const context = (overrides?: Partial<KnowledgeRunAuditContext>): KnowledgeRunAuditContext => ({
    runId,
    taskId: created.task.id,
    toolCallId: randomUUID(),
    signal: new AbortController().signal,
    materialScope: true,
    materials: [reference],
    ...overrides,
  });
  return {
    store,
    vault,
    vaultPath,
    audit,
    reference,
    revision,
    runId,
    sessionId: created.sessionId,
    taskId: created.task.id,
    workspaceId: workspace.id,
    context,
  };
};

const longContent = '续'.repeat(300);

describe('KnowledgeAudit.searchForRun', () => {
  it('returns an explained empty result instead of full-vault access', async () => {
    const fixture = await setup('客户续约风险需要跟进。');
    const legacy = await fixture.audit.searchForRun(
      fixture.context({ materialScope: false, materials: [] }),
      '续约',
    );
    expect(legacy.results).toEqual([]);
    expect(legacy.notice).toContain('没有固定材料范围');
    const noneSelected = await fixture.audit.searchForRun(
      fixture.context({ materials: [] }),
      '续约',
    );
    expect(noneSelected.results).toEqual([]);
    expect(noneSelected.notice).toContain('未选择知识资料');
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([]);
  });

  it('audits each returned excerpt with exact span and full footprint group', async () => {
    const fixture = await setup(`${longContent}甲。${longContent}乙。`);
    const ctx = fixture.context({ toolCallId: 'call-search-1' });
    const outcome = await fixture.audit.searchForRun(ctx, '乙');
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
    const first = await fixture.audit.searchForRun(fixture.context(), '续约');
    const second = await fixture.audit.searchForRun(fixture.context(), '续约');
    expect(second.results[0]?.evidenceId).toBe(first.results[0]?.evidenceId);
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toHaveLength(2);
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
  });

  it('fails closed with KNOWLEDGE_AUDIT_FAILED and returns nothing on write error', async () => {
    const fixture = await setup('续约风险跟进。');
    await expect(
      fixture.audit.searchForRun(fixture.context({ taskId: 'not-the-task' }), '续约'),
    ).rejects.toThrowError(KnowledgeServiceError);
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

describe('KnowledgeAudit.previewRunSource', () => {
  const material = (reference: KnowledgeMaterialReference): TaskMaterialSelection => ({
    reference,
    purpose: 'background',
    addedFrom: 'user-input',
  });

  const addSnapshot = (
    fixture: Awaited<ReturnType<typeof setup>>,
    materials: TaskMaterialSelection[],
    runId = fixture.runId,
  ): void => {
    fixture.store.runContextSnapshots.create({
      runId,
      taskId: fixture.taskId,
      workspaceId: fixture.workspaceId,
      contextSegmentId: randomUUID(),
      materials,
      createdAt: Date.now(),
    });
  };

  it('shows the exact searched span again, ending at the span with no continuation', async () => {
    const fixture = await setup(`${longContent}甲。${longContent}乙。`);
    addSnapshot(fixture, [material(fixture.reference)]);
    const outcome = await fixture.audit.searchForRun(fixture.context(), '乙');
    const evidenceId = outcome.results[0]?.evidenceId;
    if (!evidenceId) throw new Error('expected audited search evidence');
    const preview = fixture.audit.previewRunSource(fixture.runId, evidenceId);
    expect(preview.kind).toBe('exact');
    if (preview.kind !== 'exact') return;
    expect(preview.page.complete).toBe(true);
    expect(preview.page.nextCursor).toBeUndefined();
    expect(preview.page.parts).toHaveLength(1);
    const part = preview.page.parts[0];
    expect(part?.text).toBe(outcome.results[0]?.excerpt);
    expect(part?.span).toEqual(outcome.results[0]?.span);
    expect(preview.page.returnedCodePoints).toBe(Array.from(part?.text ?? '').length);
    // 回看只读：不留下新的证据或足迹
    expect(fixture.store.materialReads.listByRun(fixture.runId)).toHaveLength(1);
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
  });

  it('returns legacy evidence unchanged instead of fabricating a span', async () => {
    const fixture = await setup('续约风险跟进。');
    fixture.store.evidence.saveLocal({
      runId: fixture.runId,
      taskId: fixture.taskId,
      sourceUri: '/tmp/旧资料.md',
      title: '旧资料',
      locator: '全文',
      excerpt: '没有精确区间的旧记录',
      contentHash: 'legacy-hash',
    });
    const legacy = fixture.store.evidence.listByTask(fixture.taskId)[0];
    if (!legacy) throw new Error('legacy evidence missing');
    const preview = fixture.audit.previewRunSource(fixture.runId, legacy.id);
    expect(preview.kind).toBe('legacy');
    if (preview.kind !== 'legacy') return;
    expect(preview.evidence.id).toBe(legacy.id);
    expect(preview.evidence.knowledgeSource).toBeUndefined();
  });

  it('rejects evidence from another run and a revision outside the snapshot', async () => {
    const fixture = await setup('续约风险跟进。');
    addSnapshot(fixture, [material(fixture.reference)]);
    const outcome = await fixture.audit.searchForRun(fixture.context(), '续约');
    const evidenceId = outcome.results[0]?.evidenceId;
    if (!evidenceId) throw new Error('expected audited search evidence');
    const otherRunId = randomUUID();
    fixture.store.runs.create({
      id: otherRunId,
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '另一个运行',
      status: 'completed',
      createdAt: Date.now(),
    });
    try {
      fixture.audit.previewRunSource(otherRunId, evidenceId);
      expect.unreachable();
    } catch (error) {
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_REVISION_MISMATCH');
    }
    // 同 Run 但材料快照被换掉：精确来源仍要拒绝，回看不扩大范围
    const emptyScopeRunId = randomUUID();
    fixture.store.runs.create({
      id: emptyScopeRunId,
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '无材料运行',
      status: 'completed',
      createdAt: Date.now(),
    });
    addSnapshot(fixture, [], emptyScopeRunId);
    try {
      fixture.audit.previewRunSource(emptyScopeRunId, evidenceId);
      expect.unreachable();
    } catch (error) {
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_REVISION_MISMATCH');
    }
  });

  it('refuses to fake an exact preview when saved text no longer matches the evidence', async () => {
    const fixture = await setup('续约风险跟进。');
    addSnapshot(fixture, [material(fixture.reference)]);
    const outcome = await fixture.audit.searchForRun(fixture.context(), '续约');
    const evidenceId = outcome.results[0]?.evidenceId;
    if (!evidenceId) throw new Error('expected audited search evidence');
    // 模拟保存文本与证据区间脱节（例如索引库被外部破坏）：只能拒绝，不能拼一个假区间
    const external = new Database(fixture.vaultPath);
    external
      .prepare('UPDATE knowledge_revision_chunks SET content = ? WHERE revision_id = ?')
      .run('这段正文与证据摘录不一致', fixture.revision.id);
    external.close();
    try {
      fixture.audit.previewRunSource(fixture.runId, evidenceId);
      expect.unreachable();
    } catch (error) {
      expect((error as KnowledgeServiceError).code).toBe('KNOWLEDGE_REVISION_MISMATCH');
    }
  });
});
