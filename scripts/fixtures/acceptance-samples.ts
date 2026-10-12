import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { CreateMemoryRequest } from '@betterwork/agent-protocol';

import { type AppStore } from '../../apps/desktop/src/main/persistence';
import { MemoryService } from '../../apps/desktop/src/main/services/memory-service';

export const QI08_RULES_FILE = 'QI08-合成经营口径.md';
export const QI08_OFFICE_FILES = ['QI08-多指标经营数据.csv', 'QI08-多指标经营数据.xlsx'] as const;
export const QI08_KNOWLEDGE_READ_PROOF = '成本只与同月收入对照。';

export interface StagedQi08Input {
  fileName: string;
  relativePath: string;
  byteSize: number;
}

export interface StagedQi08Materials {
  rulesPath: string;
  rulesContent: string;
  officeFiles: StagedQi08Input[];
}

/** 仅把仓库内明确登记的虚构样本复制进本次临时验收工作空间。 */
export async function stageQi08Materials(workspaceRoot: string): Promise<StagedQi08Materials> {
  const sourceRoot = path.resolve(process.cwd(), 'docs/development/qi08-acceptance');
  await mkdir(workspaceRoot, { recursive: true });
  const rulesPath = path.join(workspaceRoot, QI08_RULES_FILE);
  await copyFile(path.join(sourceRoot, '经营口径.md'), rulesPath);
  const rulesContent = await readFile(rulesPath, 'utf8');
  assert.ok(rulesContent.includes(QI08_KNOWLEDGE_READ_PROOF), 'QI08 合成口径样本缺少读取校验句');

  const officeFiles: StagedQi08Input[] = [];
  for (const [index, fileName] of QI08_OFFICE_FILES.entries()) {
    const extension = index === 0 ? 'csv' : 'xlsx';
    const sourceName = extension === 'csv' ? '多指标经营数据.csv' : '多指标经营数据.xlsx';
    const targetPath = path.join(workspaceRoot, fileName);
    await copyFile(path.join(sourceRoot, sourceName), targetPath);
    const fileStat = await stat(targetPath);
    assert.ok(fileStat.isFile() && fileStat.size > 0, `QI08 ${extension.toUpperCase()} 样本为空`);
    officeFiles.push({ fileName, relativePath: fileName, byteSize: fileStat.size });
  }

  return { rulesPath, rulesContent, officeFiles };
}

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
