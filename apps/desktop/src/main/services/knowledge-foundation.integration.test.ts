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
import { KnowledgeSearchService } from './knowledge-search';
import { KnowledgeVault } from './knowledge-vault';
import { ResearchDraftService } from './research-draft-service';

/**
 * KM14 联合自动验收（契约 §13.3）：一份证据把「导入→固定修订→研究草稿→
 * 范围内检索→分页读取与预算→刷新不改既有材料→移除后历史回看→重开库」
 * 串成一条链；单点矩阵仍由各服务自己的套件负责，这里只证明链路真的连通。
 */

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

const captureError = (run: () => unknown): unknown => {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
};

const referenceOf = (
  documentId: string,
  revisionId: string,
  contentHash: string,
  sourcePath: string,
): KnowledgeMaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: documentId,
  knowledgeRevisionId: revisionId,
  contentHash,
  sourcePath,
});

describe('知识基础闭环联合链路（KM14）', () => {
  it('导入→草稿→范围检索→预算读取→刷新→移除→回看→重开库全程守住身份与范围', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'betterwork-km14-'));
    const vaultPath = path.join(directory, 'vault.sqlite');
    const vault = new KnowledgeVault(vaultPath);
    const store = AppStore.open(':memory:');
    cleanup.push(async () => {
      vault.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    const docPath = path.join(directory, '渠道复盘.md');
    const longBody = Array.from(
      { length: 40 },
      (_, index) => `第 ${index} 段：渠道转化与续约风险。`,
    ).join('\n\n');
    await writeFile(docPath, longBody);
    const otherPath = path.join(directory, '未选资料.md');
    await writeFile(otherPath, '未选资料里也有 渠道转化 四个字。');
    const imported = await vault.importSource(docPath);
    await vault.importSource(otherPath);

    // 语义关闭：hybrid 必须如实降级为关键词，而不是假装混合生效。
    const materialsByRun = new Map<string, readonly KnowledgeMaterialReference[]>();
    const searchService = new KnowledgeSearchService({
      vault,
      index: vault.index,
      runMaterials: (runId) => materialsByRun.get(runId) ?? [],
      embedding: {
        defaultSnapshot: () => {
          throw new Error('本测试不调用嵌入模型');
        },
        snapshotOf: () => {
          throw new Error('本测试不调用嵌入模型');
        },
        embed: async () => {
          throw new Error('本测试不调用嵌入模型');
        },
      },
    });
    const audit = new KnowledgeAudit(store, vault, (input) => searchService.search(input));
    const workspace = store.workspaces.getOrCreate(directory, 'KM14 工作空间');

    // 研究草稿：固定修订＋幂等（同 operationId 同输入返回原任务；改输入报冲突）。
    const drafts = new ResearchDraftService(store, vault);
    const reference = referenceOf(
      imported.document.id,
      imported.revisionId,
      imported.document.contentHash,
      docPath,
    );
    const operationId = randomUUID();
    const request = {
      operationId,
      workspaceId: workspace.id,
      prompt: '整理渠道转化的结论。',
      materials: [{ reference, purpose: 'background' as const }],
    };
    const created = drafts.create(request);
    const replayed = drafts.create(request);
    expect(replayed.task.id).toBe(created.task.id);
    const conflict = captureError(() =>
      drafts.create({ ...request, operationId, prompt: '换一个研究问题。' }),
    );
    expect(conflict).toBeInstanceOf(KnowledgeServiceError);
    if (conflict instanceof KnowledgeServiceError) {
      expect(conflict.code).toBe('OPERATION_CONFLICT');
    }
    const secondDraft = drafts.create({
      operationId: randomUUID(),
      workspaceId: workspace.id,
      prompt: '另一项研究。',
      materials: [{ reference, purpose: 'background' as const }],
    });
    expect(secondDraft.task.id).not.toBe(created.task.id);

    // 范围内检索：run 只带已选修订；同库未选资料绝不出现。
    const runId = randomUUID();
    const taskSession = store.tasks
      .listRecent(workspace.id)
      .find((task) => task.id === created.task.id);
    if (!taskSession) throw new Error('草稿任务应带有所属会话');
    store.runs.create({
      id: runId,
      taskId: created.task.id,
      sessionId: taskSession.sessionId,
      prompt: request.prompt,
      status: 'running',
      createdAt: Date.now(),
    });
    materialsByRun.set(runId, [reference]);
    const context = {
      runId,
      taskId: created.task.id,
      toolCallId: randomUUID(),
      signal: new AbortController().signal,
      materialScope: true,
      materials: [reference] as readonly KnowledgeMaterialReference[],
    };
    const outcome = await audit.searchForRun(context, '渠道转化');
    expect(outcome.results.length).toBeGreaterThan(0);
    for (const hit of outcome.results) {
      expect(hit.reference.knowledgeRevisionId).toBe(imported.revisionId);
    }
    const scopeCheck = await searchService.search({
      scope: { kind: 'run', runId },
      query: '渠道转化',
      mode: 'hybrid',
    });
    expect(scopeCheck.effectiveMode).toBe('keyword');
    expect(scopeCheck.degradedReason).toBe('semantic-disabled');
    // 空选材的 Run 不回退全库（同一查询在零材料 Run 下必须为空）。
    materialsByRun.set(randomUUID(), []);
    const emptyScope = await searchService.search({
      scope: { kind: 'run', runId: randomUUID() },
      query: '渠道转化',
    });
    expect(emptyScope.results).toEqual([]);

    // 分页读取：逐页游标直到 complete；每页计入 Run 预算并各自落 Evidence。
    let cursor: Parameters<typeof vault.previewRevision>[2];
    let readPages = 0;
    let usedCodePoints = 0;
    for (;;) {
      // 每一页对应一次真实工具调用：footprint 槽位按 toolCallId＋partIndex 去重。
      const pageContext: KnowledgeRunAuditContext = {
        ...context,
        toolCallId: randomUUID(),
      };
      const page = audit.readForRun(pageContext, {
        reference,
        maxCodePoints: 200,
        ...(cursor ? { cursor } : {}),
      });
      readPages += 1;
      usedCodePoints += page.returnedCodePoints;
      expect(page.remainingRunCodePoints).toBeLessThanOrEqual(
        KNOWLEDGE_RUN_READ_BUDGET_CODE_POINTS,
      );
      for (const part of page.parts) expect(part.evidenceId).toBeTruthy();
      if (page.complete) break;
      if (!page.nextCursor) throw new Error('未完成页必须给出游标');
      cursor = page.nextCursor;
      expect(readPages).toBeLessThan(500);
    }
    expect(readPages).toBeGreaterThan(1);
    expect(usedCodePoints).toBeGreaterThan(200);

    // 刷新生成新修订；既有草稿与 Run 仍固定旧修订并可继续回读。
    await writeFile(docPath, `${longBody}\n\n新增段落：回款口径变化。`);
    const refreshed = await vault.refreshDocument(imported.document.id);
    expect('refreshed' in refreshed && refreshed.refreshed).toBeTruthy();
    const currentRevisionId = vault.registeredRevisionId(imported.document.id);
    expect(currentRevisionId).not.toBe(imported.revisionId);
    const oldPage = vault.previewRevision(imported.document.id, imported.revisionId);
    expect(oldPage.parts[0]?.text).toContain('渠道转化');
    const replayAfterRefresh = drafts.create(request);
    expect(replayAfterRefresh.task.id).toBe(created.task.id);

    // 移除资料：不再出现在列表，也不能新建草稿；历史修订仍可读、证据仍在。
    expect(vault.removeDocument(imported.document.id)).toBe(true);
    expect(vault.listDocuments().map((document) => document.id)).not.toContain(
      imported.document.id,
    );
    const removedReplay = captureError(() =>
      drafts.create({
        operationId: randomUUID(),
        workspaceId: workspace.id,
        prompt: '移除后再选旧资料。',
        materials: [{ reference, purpose: 'background' as const }],
      }),
    );
    expect(removedReplay).toBeInstanceOf(KnowledgeServiceError);
    if (removedReplay instanceof KnowledgeServiceError) {
      expect(removedReplay.code).toBe('KNOWLEDGE_DOCUMENT_REMOVED');
    }
    const history = vault.previewRevision(imported.document.id, imported.revisionId);
    expect(history.parts.length).toBeGreaterThan(0);
    expect(store.evidence.listByTask(created.task.id).length).toBeGreaterThan(readPages - 1);

    // 重开库（同文件新实例）：既有修订、未选资料与草稿任务都还在原处。
    vault.close();
    const reopened = new KnowledgeVault(vaultPath);
    cleanup.push(async () => {
      reopened.close();
    });
    expect(reopened.listDocuments().map((document) => document.title)).toEqual(['未选资料']);
    expect(
      reopened.previewRevision(imported.document.id, imported.revisionId).parts.length,
    ).toBeGreaterThan(0);
    expect(store.tasks.getSummary(created.task.id)).toBeTruthy();
  });
});
