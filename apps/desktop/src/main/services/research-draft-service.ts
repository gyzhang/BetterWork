import { createHash } from 'node:crypto';

import type {
  KnowledgeCreateResearchDraftRequest,
  KnowledgeResearchDraftResult,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { KnowledgeServiceError } from './knowledge-errors';
import type { KnowledgeVault } from './knowledge-vault';

/**
 * KM03（契约 §4）：以勾选知识修订创建可恢复的研究草稿。
 * 幂等回执先于任何当前登记校验；Task/Session/完整 TaskContext/回执在同一应用库
 * 事务内提交。better-sqlite3 的同步事务与知识移除共用 Main 单线程边界，
 * 「查回执→验证登记→提交」之间不会插入其它写入。
 */
export class ResearchDraftService {
  constructor(
    private readonly store: AppStore,
    private readonly vault: KnowledgeVault,
  ) {}

  create(request: KnowledgeCreateResearchDraftRequest): KnowledgeResearchDraftResult {
    const normalized = this.normalizeMaterials(request);
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify([
          'knowledge-research-draft-v1',
          request.workspaceId,
          request.prompt,
          normalized,
        ]),
      )
      .digest('hex');
    return this.store.transaction((): KnowledgeResearchDraftResult => {
      const receipt = this.store.researchDraftOperations.get(request.operationId);
      if (receipt) {
        if (receipt.inputHash !== inputHash) {
          throw new KnowledgeServiceError(
            'OPERATION_CONFLICT',
            '同一操作标识携带了不同的输入，未创建新草稿。',
          );
        }
        const task = this.store.tasks.getSummary(receipt.taskId);
        const context = this.store.taskContexts.get(receipt.contextId, receipt.taskId);
        if (!task || !context) {
          throw new KnowledgeServiceError(
            'KNOWLEDGE_DOCUMENT_REMOVED',
            '原草稿任务已不可恢复，请重新发起研究。',
          );
        }
        return { task, context, prompt: receipt.prompt };
      }
      for (const material of normalized) {
        const reference = material.reference;
        if (reference.kind !== 'knowledge-revision') {
          throw new KnowledgeServiceError('OPERATION_CONFLICT', '研究草稿只接受知识修订材料。');
        }
        const documents = this.vault
          .listDocuments()
          .filter((document) => document.id === reference.knowledgeDocumentId);
        const registered = documents.some((document) =>
          this.vault
            .listRevisions(document.id)
            .some((revision) => revision.id === reference.knowledgeRevisionId),
        );
        if (!registered) {
          throw new KnowledgeServiceError(
            'KNOWLEDGE_DOCUMENT_REMOVED',
            '所选资料已不在当前资料库中，请重新选择后再创建草稿。',
          );
        }
      }
      // 工作空间不可用时由 tasks.create 抛错并整体回滚。
      const title = request.prompt.split('\n')[0]?.trim() || '研究草稿';
      const created = this.store.tasks.create(
        request.workspaceId,
        title.slice(0, 80),
        request.prompt,
      );
      const context = this.store.taskContexts.save(created.task.id, {
        executor: { kind: 'general' },
        skillBindings: [],
        materials: normalized,
        excludedMemoryIds: [],
        mcpToolBindings: [],
      });
      this.store.researchDraftOperations.insert({
        operationId: request.operationId,
        inputHash,
        taskId: created.task.id,
        contextId: context.id,
        prompt: request.prompt,
        createdAt: Date.now(),
      });
      return { task: created.task, context, prompt: request.prompt };
    });
  }

  private normalizeMaterials(
    request: KnowledgeCreateResearchDraftRequest,
  ): TaskMaterialSelection[] {
    const byIdentity = new Map<string, TaskMaterialSelection>();
    for (const material of request.materials) {
      const reference = material.reference;
      const key = JSON.stringify([
        reference.knowledgeDocumentId,
        reference.knowledgeRevisionId,
        reference.contentHash,
        reference.sourcePath,
      ]);
      const selection: TaskMaterialSelection = {
        reference,
        purpose: material.purpose,
        addedFrom: 'global-search',
      };
      const existing = byIdentity.get(key);
      if (existing) {
        if (existing.purpose !== selection.purpose) {
          throw new KnowledgeServiceError(
            'OPERATION_CONFLICT',
            '同一份资料出现了冲突的用途，请先调整选择。',
          );
        }
        continue;
      }
      byIdentity.set(key, selection);
    }
    return [...byIdentity.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([, selection]) => selection);
  }
}
