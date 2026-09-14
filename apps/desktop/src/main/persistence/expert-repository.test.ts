import type { ExpertRevisionDraft } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

const draft = (
  nameOrOverrides: string | Partial<ExpertRevisionDraft> = '经营分析专家',
): ExpertRevisionDraft => ({
  name: typeof nameOrOverrides === 'string' ? nameOrOverrides : '经营分析专家',
  summary: '按公司规则完成经营分析',
  identity: '你负责经营分析和报告交付。',
  principles: ['先核对口径，再分析数据'],
  inputRequirements: ['本期经营数据'],
  deliveryRequirements: ['交付带来源的报告'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
  ...(typeof nameOrOverrides === 'string' ? {} : nameOrOverrides),
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ExpertRepository', () => {
  it('creates immutable revisions and rejects stale saves', () => {
    const store = openStore();
    const created = store.experts.create({ sourceKind: 'user', revision: draft() });
    expect(created.currentRevision).toBe(1);
    const updated = store.experts.saveRevision(created.id, draft('经营分析专家 v2'), 1);
    expect(updated.currentRevision).toBe(2);
    expect(updated.revision.name).toBe('经营分析专家 v2');
    expect(() => store.experts.saveRevision(created.id, draft('过期写入'), 1)).toThrow(
      'Expert revision conflict',
    );
  });

  it('persists explicit MCP tool presets with immutable revisions', () => {
    const store = openStore();
    const created = store.experts.create({
      sourceKind: 'user',
      revision: draft({
        mcpToolBindings: [{ connectionId: 'finance', toolId: 'finance/monthly_summary' }],
      }),
    });
    expect(created.revision.mcpToolBindings).toEqual([
      { connectionId: 'finance', toolId: 'finance/monthly_summary' },
    ]);
    const copy = store.experts.copy(created.id);
    expect(copy.revision.mcpToolBindings).toEqual(created.revision.mcpToolBindings);
  });

  it('persists expert reference materials and copies them with the expert', () => {
    const store = openStore();
    const reference = {
      reference: {
        kind: 'knowledge-revision' as const,
        knowledgeDocumentId: 'finance-rules',
        knowledgeRevisionId: 'finance-rules-v2',
        contentHash: 'rules-hash',
        sourcePath: '/rules/finance.md',
      },
      purpose: 'rule' as const,
      note: '公司财务口径',
    };
    const created = store.experts.create({
      sourceKind: 'user',
      revision: draft({ referenceMaterials: [reference] }),
    });
    expect(created.revision.referenceMaterials).toEqual([reference]);
    const copy = store.experts.copy(created.id);
    expect(copy.revision.referenceMaterials).toEqual([reference]);
  });

  it('copies a built-in expert as an independent user expert', () => {
    const store = openStore();
    const builtin = store.experts.create({ sourceKind: 'builtin', revision: draft('内置分析') });
    expect(() => store.experts.saveRevision(builtin.id, draft('覆盖内置'), 1)).toThrow(
      'Builtin Expert cannot be overwritten',
    );
    const copy = store.experts.copy(builtin.id, '我的分析专家');
    expect(copy.sourceKind).toBe('user');
    expect(copy.id).not.toBe(builtin.id);
    expect(copy.revision.name).toBe('我的分析专家');
    expect(store.experts.get(builtin.id)?.revision.name).toBe('内置分析');
  });

  it('keeps archived experts out of the default list and preserves history', () => {
    const store = openStore();
    const created = store.experts.create({ sourceKind: 'user', revision: draft() });
    const archived = store.experts.setLifecycle(created.id, 'archived', 1);
    expect(archived.lifecycle).toBe('archived');
    expect(store.experts.list()).toEqual([]);
    expect(store.experts.list(true)).toHaveLength(1);
    expect(store.experts.get(created.id)?.revision.name).toBe('经营分析专家');
  });
});
