import type { ExpertRevisionDraft, ScheduleConfigDraft } from '@betterwork/agent-protocol';
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
  author: '',
  tags: [],
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
  it('registers a built-in release idempotently, upgrades revisions, and keeps copies independent', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const entry = {
      expertId: 'builtin-research-analyst',
      name: '研究分析专家',
      summary: '整理可验证的分析结论',
      author: '算台团队',
      tags: ['研究分析', '证据梳理'],
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
    // 卡片要按署名与用途标签介绍内置专家：清单里声明的字段必须出现在摘要上。
    expect(service.list()[0]).toMatchObject({
      author: '算台团队',
      tags: ['研究分析', '证据梳理'],
    });
    service.setLifecycle(entry.expertId, 'disabled', registered?.currentRevision ?? 1);
    const copy = service.copy(entry.expertId, '我的研究分析专家');
    const upgraded = service.registerBuiltinRelease([
      { ...entry, summary: '整理可验证的分析结论（新版）' },
    ]);
    expect(upgraded[0]).toMatchObject({
      currentRevision: 2,
      lifecycle: 'disabled',
      summary: '整理可验证的分析结论（新版）',
    });
    expect(service.get(copy.id)).toMatchObject({ currentRevision: 1, summary: entry.summary });
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

  it('allows two experts to choose different tools from one ready connection', () => {
    const store = openStore();
    const connection = store.mcpConnections.save({
      name: '财务服务',
      transport: { kind: 'stdio', command: 'node', args: [] },
    });
    store.mcpConnections.updateDiscovery(connection.id, {
      status: 'ready',
      tools: [
        {
          id: `${connection.id}/revenue`,
          connectionId: connection.id,
          name: 'revenue',
          description: '',
          inputSchema: { type: 'object' },
          schemaHash: 'hash-revenue',
          discoveredAt: 1,
        },
        {
          id: `${connection.id}/cost`,
          connectionId: connection.id,
          name: 'cost',
          description: '',
          inputSchema: { type: 'object' },
          schemaHash: 'hash-cost',
          discoveredAt: 1,
        },
      ],
      lastCheckedAt: 1,
    });
    const service = new ExpertService(store);
    const revenue = service.create(
      draft({
        mcpToolBindings: [{ connectionId: connection.id, toolId: `${connection.id}/revenue` }],
      }),
    );
    const cost = service.create(
      draft({
        mcpToolBindings: [{ connectionId: connection.id, toolId: `${connection.id}/cost` }],
      }),
    );
    expect(revenue.blockedReasons).toEqual([]);
    expect(cost.blockedReasons).toEqual([]);
  });

  it('marks MCP presets unavailable until the connection has discovered the tool', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const expert = service.create(
      draft({
        mcpToolBindings: [{ connectionId: 'finance', toolId: 'finance/monthly_summary' }],
      }),
    );
    expect(expert.blockedReasons).toEqual(['mcp-unavailable']);
  });

  it('rejects duplicate MCP presets at the Expert boundary', () => {
    const store = openStore();
    const service = new ExpertService(store);
    expect(() =>
      service.create(
        draft({
          mcpToolBindings: [
            { connectionId: 'finance', toolId: 'finance/monthly_summary' },
            { connectionId: 'finance', toolId: 'finance/monthly_summary' },
          ],
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_invalid_mcp' }),
    );
    expect(service.list()).toHaveLength(0);
  });

  it('rejects mixed MCP revisions without changing the saved Expert', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const binding = {
      connectionId: 'finance',
      toolId: 'finance/monthly_summary',
      connectionRevisionId: 'revision-1',
      contractHash: 'a'.repeat(64),
    };
    const created = service.create(draft({ mcpToolBindings: [binding] }));
    expect(() =>
      service.saveRevision(
        created.id,
        draft({
          mcpToolBindings: [
            binding,
            {
              ...binding,
              toolId: 'finance/quarterly_summary',
              connectionRevisionId: 'revision-2',
            },
          ],
        }),
        created.currentRevision,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_invalid_mcp' }),
    );
    expect(service.get(created.id)).toMatchObject({
      currentRevision: created.currentRevision,
      revision: { mcpToolBindings: [binding] },
    });
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

  it('carries author and capability tags into the summary and into a copy', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const created = service.create(draft({ author: '财务组', tags: ['经营分析', '月度复盘'] }));
    expect(service.list()[0]).toMatchObject({ author: '财务组', tags: ['经营分析', '月度复盘'] });
    expect(service.copy(created.id)).toMatchObject({
      author: '财务组',
      tags: ['经营分析', '月度复盘'],
    });
  });

  it('rejects duplicate capability tags at the Expert boundary', () => {
    const store = openStore();
    const service = new ExpertService(store);
    expect(() => service.create(draft({ tags: ['经营分析', '经营分析'] }))).toThrow();
  });

  it('deletes an unused expert together with all of its revisions', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const created = service.create(draft());
    service.saveRevision(created.id, draft({ summary: '新规则' }), created.currentRevision);
    expect(service.delete(created.id)).toBe(true);
    expect(service.get(created.id)).toBeUndefined();
    const rows = store.experts.list(true);
    expect(rows.find((row) => row.id === created.id)).toBeUndefined();
  });

  it('refuses to delete a builtin expert and one the run history still references', () => {
    const store = openStore();
    const service = new ExpertService(store);
    service.registerBuiltinRelease([
      {
        expertId: 'builtin-keep-me',
        name: '内置专家',
        summary: '',
        identity: '负责研究分析。',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    ]);
    expect(() => service.delete('builtin-keep-me')).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_builtin_readonly' }),
    );
    expect(() => service.delete('missing-expert')).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_not_found' }),
    );

    const created = service.create(draft());
    const workspace = store.workspaces.getOrCreate('/tmp/expert-delete-guard', '删除守卫');
    const task = store.tasks.create(workspace.id, '历史任务', '验证删除守卫');
    store.runs.create({
      id: 'run-expert-delete',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '测试',
      status: 'completed',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId: 'run-expert-delete',
      taskId: task.task.id,
      workspaceId: workspace.id,
      expertId: created.id,
      expertRevisionId: created.revision.id,
      contextSegmentId: 'segment-delete-guard',
      materials: [],
      createdAt: 2,
    });
    expect(() => service.delete(created.id)).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_in_use' }),
    );
    // 挡下之后原对象必须还在：删除失败不能留下半个库。
    expect(service.get(created.id)?.id).toBe(created.id);
  });

  it('refuses to delete an Expert referenced by any immutable Schedule config version', () => {
    const store = openStore();
    const service = new ExpertService(store);
    const expert = service.create(draft());
    const workspace = store.workspaces.create('/tmp/expert-schedule-reference', '合成工作空间');
    const config: ScheduleConfigDraft = {
      name: '月度经营复盘',
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      requirements: '分析上月经营变化，并给出依据。',
      expectedArtifactTypes: ['markdown'],
      timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'UTC' },
      periodRule: 'previous-month',
      knowledgeSources: [],
      outputSubdirectory: '定时成果',
    };
    const schedule = store.schedules.create({ workspaceId: workspace.id, config, createdAt: 1 });
    store.schedules.appendConfig(schedule.schedule.id, {
      config: { ...config, name: '月度经营复盘（已修订）' },
      expectedRevision: schedule.schedule.revision,
      updatedAt: 2,
    });

    expect(store.experts.countScheduleReferences(expert.id)).toBe(2);
    expect(() => service.delete(expert.id)).toThrowError(
      expect.objectContaining<Partial<ExpertServiceError>>({ code: 'expert_in_use' }),
    );
    expect(() => store.experts.remove(expert.id)).toThrow(
      'Expert is referenced by 2 Schedule configuration(s)',
    );
    expect(store.experts.get(expert.id)).toBeDefined();
  });
});
