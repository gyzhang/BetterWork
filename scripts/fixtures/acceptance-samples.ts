import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { CreateMemoryRequest } from '@betterwork/agent-protocol';

import { type AppStore } from '../../apps/desktop/src/main/persistence';
import { MemoryService } from '../../apps/desktop/src/main/services/memory-service';

/** 只走生产服务的写入入口；这些对象是前置样本，不替人工操作作判定。 */
export async function prepareAcceptanceSamples(
  store: AppStore,
  directory: string,
): Promise<unknown> {
  const workspace = store.workspaces.listAll()[0];
  assert.ok(workspace);
  const memories = new MemoryService(store, directory);
  const now = Date.now();
  const requests: Omit<CreateMemoryRequest, 'operationId' | 'scope' | 'asUserInstruction'>[] = [
    { facet: 'fact', content: '虚构事实：本期有三个项目完成。' },
    { facet: 'experience', content: '虚构经验：先检查缺项再整理。' },
    { facet: 'constraint', content: '未来规则：下期开始使用新口径。', validFrom: now + 86_400_000 },
    { facet: 'constraint', content: '过期规则：仅用于上期。', validUntil: now - 86_400_000 },
    { facet: 'constraint', content: '月报按回款统计收入。', topicKey: '合成收入口径' },
    { facet: 'constraint', content: '合同按签约统计收入。', topicKey: '合成收入口径' },
    ...Array.from({ length: 7 }, (_, index) => ({
      facet: 'constraint' as const,
      content: `合成优先规则 ${index + 1}：表格必须附单位说明。`,
    })),
  ];
  for (const request of requests) {
    const outcome = await memories.create({
      ...request,
      operationId: randomUUID(),
      scope: { kind: 'workspace', workspaceId: workspace.id },
      asUserInstruction: true,
    });
    assert.ok(outcome.ok, `合成样本写入被拒：${outcome.ok ? '' : outcome.error.message}`);
  }
  for (const record of store.memories
    .list()
    .filter((item) => item.content.startsWith('合成优先规则'))) {
    const outcome = await memories.update({
      id: record.id,
      expectedRevision: record.revision,
      operationId: randomUUID(),
      patch: { recallPolicy: 'pinned' },
    });
    assert.ok(outcome.ok, '优先样本不能通过生产资格校验');
  }
  const items = memories.list({ workspaceId: workspace.id });
  assert.ok(items.ok);
  assert.equal(store.memories.list().length, 15, '合成前置对象数量不完整');
  assert.equal(items.data.items.filter((item) => item.recallPolicy === 'pinned').length, 8);
  assert.ok(
    items.data.items.some((item) => item.conflicts.some((pair) => pair.state === 'unresolved')),
  );
  assert.ok(items.data.items.some((item) => item.effectiveStatus === 'expired'));
  assert.equal(store.memoryExtractions.getSettings(workspace.id).autoSuggestEnabled, false);
  assert.ok(
    store.memoryExtractions
      .listPage({ workspaceId: workspace.id, limit: 100 })
      .items.every((item) => !['queued', 'running'].includes(item.status)),
  );
  return {
    status: 'prepared-not-accepted',
    workspaceId: workspace.id,
    memoryCount: store.memories.list().length,
    listedMemoryCount: items.data.items.length,
    pinnedCount: 8,
    autoSuggestEnabled: false,
    humanResultsWritten: false,
    prepared: ['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '0.10'],
    additionalPreparationRequired: [],
  };
}
