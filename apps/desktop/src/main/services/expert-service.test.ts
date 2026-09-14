import type { ExpertRevisionDraft } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { ExpertService, type ExpertServiceError } from './expert-service';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

const draft = (overrides?: Partial<ExpertRevisionDraft>): ExpertRevisionDraft => ({
  name: '经营分析专家',
  summary: '按公司规则完成经营分析',
  identity: '你负责经营分析和报告交付。',
  principles: ['先核对口径，再分析数据'],
  inputRequirements: ['本期经营数据'],
  deliveryRequirements: ['交付带来源的报告'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
  ...overrides,
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ExpertService', () => {
  it('registers a built-in release idempotently and keeps it read-only', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const entry = {
      expertId: 'builtin-research-analyst',
      name: '研究分析专家',
      summary: '整理可验证的分析结论',
      identity: '你负责研究分析。',
      principles: ['区分事实和推断'],
      inputRequirements: [],
      deliveryRequirements: ['给出依据'],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' as const },
      modelReference: { mode: 'application-default' as const },
    };
    expect(service.registerBuiltinRelease([entry])).toHaveLength(1);
    expect(service.registerBuiltinRelease([entry])).toHaveLength(1);
    const registered = service.get(entry.expertId);
    expect(registered?.sourceKind).toBe('builtin');
    expect(() => service.saveRevision(entry.expertId, draft(), 1)).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_builtin_readonly' }),
    );
  });

  it('reports missing skills without preventing a draft from being saved', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const expert = service.create(
      draft({ skillPreset: [{ skillId: 'missing-skill', revisionId: 'missing-revision' }] }),
    );
    expect(expert.blockedReasons).toEqual(['missing-skill']);
    expect(service.list()[0]?.blockedReasons).toEqual(['missing-skill']);
  });

  it('rejects unknown built-in tools at the management boundary', () => {
    const store = openStore();
    const service = new ExpertService(store);
    expect(() =>
      service.create(
        draft({ builtinToolPolicy: { mode: 'allow-list', toolNames: ['unknown_tool'] } }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_invalid_tool' }),
    );
  });

  it('reports model profile absence and preserves lifecycle changes', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const created = service.create(
      draft({ modelReference: { mode: 'profile', modelProfileId: 'missing-model' } }),
    );
    expect(created.blockedReasons).toEqual(['missing-model']);
    const disabled = service.setLifecycle(created.id, 'disabled', created.currentRevision);
    expect(disabled.lifecycle).toBe('disabled');
    expect(service.get(created.id)?.lifecycle).toBe('disabled');
  });

  it('returns a stable conflict code when a revision was changed concurrently', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const created = service.create(draft());
    service.saveRevision(created.id, draft({ summary: '新规则' }), 1);
    expect(() => service.saveRevision(created.id, draft({ summary: '过期草稿' }), 1)).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_revision_conflict' }),
    );
  });
});
