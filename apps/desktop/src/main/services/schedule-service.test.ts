import type {
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore, ScheduleRevisionConflictError } from '../persistence';
import { ScheduleService, type ScheduleServiceDependencies } from './schedule-service';

const stores: AppStore[] = [];

const expertDraft = (): ExpertRevisionDraft => ({
  name: '月度分析专家',
  summary: '按固定期间完成来源可追溯的分析',
  author: '',
  tags: [],
  identity: '你负责分析并交付报告。',
  principles: ['区分事实与判断'],
  inputRequirements: ['本期经营数据'],
  deliveryRequirements: ['交付带来源的报告'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

const configDraft = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '月度经营复盘',
  expertId,
  expertRevisionId,
  requirements: '分析上月经营变化，并列出依据。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'previous-month',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const period = (anchorAt: number): ScheduleResolvedPeriod => ({
  rule: 'previous-month',
  timeZone: 'Asia/Shanghai',
  anchorAt,
  startAt: Date.UTC(2026, 0, 1),
  endAt: Date.UTC(2026, 1, 1),
  label: '2026年1月',
});

const makeFixture = () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.create('/tmp/schedule-service-fixture', '定时任务合成空间');
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft() });
  const config = configDraft(expert.id, expert.revision.id);
  let now = Date.UTC(2026, 0, 1, 0, 0);
  const preflight = vi.fn<ScheduleServiceDependencies['preflight']>(async () => ({
    status: 'ready',
    fingerprint: 'fp-v1',
  }));
  const settleDue = vi.fn<ScheduleServiceDependencies['settleDue']>(async () => undefined);
  const cancelPreparations = vi.fn();
  const dependencies: ScheduleServiceDependencies = {
    now: () => now,
    preflight,
    settleDue,
    cancelPreparations,
  };
  const service = new ScheduleService(store, dependencies);
  const createPaused = () =>
    service.save({
      operation: 'create',
      workspaceId: workspace.id,
      config,
      targetLifecycle: 'paused',
    });
  const createEnabled = () =>
    service.save({
      operation: 'create',
      workspaceId: workspace.id,
      config,
      targetLifecycle: 'enabled',
      preflightFingerprint: 'fp-v1',
    });
  const setNow = (value: number) => {
    now = value;
  };
  return {
    store,
    workspace,
    expert,
    config,
    service,
    dependencies,
    preflight,
    settleDue,
    cancelPreparations,
    createPaused,
    createEnabled,
    setNow,
  };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ScheduleService', () => {
  it('creates paused by default and refuses to enable without a matching injected preflight', async () => {
    const { service, config, workspace, preflight, setNow } = makeFixture();
    const created = await service.save({
      operation: 'create',
      workspaceId: workspace.id,
      config,
      targetLifecycle: 'paused',
    });
    expect(created.schedule).toMatchObject({ lifecycle: 'paused', revision: 1 });
    expect(preflight).not.toHaveBeenCalled();

    await expect(
      service.setLifecycle({
        scheduleId: created.schedule.id,
        expectedRevision: created.schedule.revision,
        lifecycle: 'enabled',
        preflightFingerprint: 'stale-fingerprint',
      }),
    ).rejects.toMatchObject({ code: 'schedule_conflict' });
    expect(service.get(created.schedule.id)?.schedule.lifecycle).toBe('paused');
    expect(preflight).toHaveBeenCalledTimes(1);

    const enabledAt = Date.UTC(2026, 1, 1, 0, 0);
    setNow(enabledAt);
    const enabled = await service.setLifecycle({
      scheduleId: created.schedule.id,
      expectedRevision: created.schedule.revision,
      lifecycle: 'enabled',
      preflightFingerprint: 'fp-v1',
    });
    expect(enabled.schedule).toMatchObject({
      lifecycle: 'enabled',
      enabledAt,
      enabledConfigVersion: 1,
      capabilityFingerprint: 'fp-v1',
    });
    expect(enabled.schedule.nextScheduledAt).toBeGreaterThan(enabledAt);
  });

  it('rejects a stale config CAS without appending or changing the current configuration', async () => {
    const { service, store, config, expert, workspace } = makeFixture();
    const created = await service.save({
      operation: 'create',
      workspaceId: workspace.id,
      config,
      targetLifecycle: 'paused',
    });
    await expect(
      service.save({
        operation: 'update',
        scheduleId: created.schedule.id,
        expectedRevision: created.schedule.revision + 1,
        config: { ...config, name: '过期草稿' },
        targetLifecycle: 'paused',
      }),
    ).rejects.toBeInstanceOf(ScheduleRevisionConflictError);
    expect(store.schedules.get(created.schedule.id)).toEqual(created);
    expect(store.schedules.getConfig(created.schedule.id, 2)).toBeUndefined();
    expect(store.experts.get(expert.id)).toBeDefined();
  });

  it('appends a name edit without re-preflight or changing the enabled next time', async () => {
    const fixture = makeFixture();
    const enabled = await fixture.createEnabled();
    const nextScheduledAt = enabled.schedule.nextScheduledAt;
    const historicalOccurrence = fixture.store.scheduleOccurrences.claimManual({
      scheduleId: enabled.schedule.id,
      trigger: 'manual-now',
      requestKey: 'request-before-config-edit',
      requestedAt: enabled.schedule.createdAt,
      period: period(enabled.schedule.createdAt),
    });
    expect(historicalOccurrence.kind).toBe('created');
    if (historicalOccurrence.kind !== 'created') return;
    const changed = await fixture.service.save({
      operation: 'update',
      scheduleId: enabled.schedule.id,
      expectedRevision: enabled.schedule.revision,
      config: { ...fixture.config, name: '上月经营复盘（修订名称）' },
      targetLifecycle: 'enabled',
      preflightFingerprint: 'fp-v1',
    });
    expect(changed.config.version).toBe(2);
    expect(fixture.service.get(enabled.schedule.id)?.schedule.nextScheduledAt).toBe(
      nextScheduledAt,
    );
    expect(fixture.store.schedules.getConfig(enabled.schedule.id, 1)?.name).toBe(
      fixture.config.name,
    );
    expect(fixture.store.scheduleOccurrences.get(historicalOccurrence.occurrence.id)).toMatchObject(
      {
        configVersion: 1,
        phase: 'preparing',
      },
    );
    expect(fixture.preflight).toHaveBeenCalledTimes(1);
    expect(fixture.settleDue).not.toHaveBeenCalled();
  });

  it('settles the old timing before replan and starts resume strictly after its new enable time', async () => {
    const fixture = makeFixture();
    const enabled = await fixture.createEnabled();
    const originalNext = enabled.schedule.nextScheduledAt;
    const later = Date.UTC(2026, 2, 1, 0, 0);
    fixture.setNow(later);
    fixture.settleDue.mockImplementationOnce(async ({ schedule }) => {
      expect(schedule.id).toBe(enabled.schedule.id);
      expect(fixture.store.schedules.get(enabled.schedule.id)?.config.version).toBe(1);
    });
    const changed = await fixture.service.save({
      operation: 'update',
      scheduleId: enabled.schedule.id,
      expectedRevision: enabled.schedule.revision,
      config: {
        ...fixture.config,
        timing: { frequency: 'monthly', day: 7, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
      },
      targetLifecycle: 'enabled',
      preflightFingerprint: 'fp-v1',
    });
    expect(fixture.settleDue).toHaveBeenCalledTimes(1);
    expect(changed.schedule.nextScheduledAt).toBeGreaterThan(later);
    expect(changed.schedule.nextScheduledAt).not.toBe(originalNext);

    const paused = await fixture.service.setLifecycle({
      scheduleId: changed.schedule.id,
      expectedRevision: changed.schedule.revision,
      lifecycle: 'paused',
    });
    expect(paused.schedule).toMatchObject({ lifecycle: 'paused' });
    expect(paused.schedule.nextScheduledAt).toBeUndefined();
    const resumedAt = Date.UTC(2026, 5, 1, 0, 0);
    fixture.setNow(resumedAt);
    const resumed = await fixture.service.setLifecycle({
      scheduleId: paused.schedule.id,
      expectedRevision: paused.schedule.revision,
      lifecycle: 'enabled',
      preflightFingerprint: 'fp-v1',
    });
    expect(resumed.schedule.enabledAt).toBe(resumedAt);
    expect(resumed.schedule.nextScheduledAt).toBeGreaterThan(resumedAt);
    expect(
      fixture.store.scheduleOccurrences.listBySchedule({ scheduleId: resumed.schedule.id }).items,
    ).toHaveLength(0);
  });

  it('cancels only preparing work atomically on pause and preserves prior occurrence history on archive', async () => {
    const fixture = makeFixture();
    const created = await fixture.createEnabled();
    const claim = fixture.store.scheduleOccurrences.claimManual({
      scheduleId: created.schedule.id,
      trigger: 'manual-now',
      requestKey: 'request-before-pause',
      requestedAt: fixture.store.schedules.get(created.schedule.id)?.schedule.createdAt ?? 0,
      period: period(created.schedule.createdAt),
    });
    expect(claim.kind).toBe('created');
    if (claim.kind !== 'created') return;

    const paused = await fixture.service.setLifecycle({
      scheduleId: created.schedule.id,
      expectedRevision: created.schedule.revision,
      lifecycle: 'paused',
    });
    expect(paused.schedule.lifecycle).toBe('paused');
    expect(fixture.store.scheduleOccurrences.get(claim.occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'cancelled',
      reasonCode: 'schedule_cancelled',
    });
    expect(fixture.cancelPreparations).toHaveBeenCalledWith([claim.occurrence.id]);

    const archived = await fixture.service.setLifecycle({
      scheduleId: paused.schedule.id,
      expectedRevision: paused.schedule.revision,
      lifecycle: 'archived',
    });
    expect(fixture.store.schedules.get(archived.schedule.id)?.schedule.lifecycle).toBe('archived');
    expect(fixture.store.schedules.getConfig(archived.schedule.id, 1)).toMatchObject({
      name: fixture.config.name,
    });
    expect(fixture.store.scheduleOccurrences.get(claim.occurrence.id)).toMatchObject({
      preparationOutcome: 'cancelled',
    });
  });

  it('keeps a hidden Workspace schedule enabled because hiddenAt only controls sidebar visibility', async () => {
    const fixture = makeFixture();
    const enabled = await fixture.createEnabled();
    fixture.store.workspaces.setHidden(fixture.workspace.id, true);
    expect(fixture.store.workspaces.get(fixture.workspace.id)?.hiddenAt).toBeDefined();
    expect(fixture.service.get(enabled.schedule.id)?.schedule.lifecycle).toBe('enabled');
  });

  it('fails closed when preflight reports a capability block', async () => {
    const fixture = makeFixture();
    const created = await fixture.createPaused();
    fixture.preflight.mockResolvedValueOnce({
      status: 'blocked',
      message: '没有可用的真实模型配置',
    });
    await expect(
      fixture.service.setLifecycle({
        scheduleId: created.schedule.id,
        expectedRevision: created.schedule.revision,
        lifecycle: 'enabled',
        preflightFingerprint: 'fp-v1',
      }),
    ).rejects.toMatchObject({ code: 'schedule_capability_blocked' });
    expect(fixture.service.get(created.schedule.id)?.schedule.lifecycle).toBe('paused');
  });
});
