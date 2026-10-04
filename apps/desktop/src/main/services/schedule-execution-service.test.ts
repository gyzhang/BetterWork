import type {
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore, scheduleSourceManifestHash } from '../persistence';
import { ScheduleExecutionService } from './schedule-execution-service';

const stores: AppStore[] = [];
let nextId = 0;

const expertDraft = (): ExpertRevisionDraft => ({
  name: '固定版本专家',
  summary: '用于定时 Task 草稿测试',
  author: '',
  tags: [],
  identity: '按固定版本完成工作。',
  principles: ['保留已绑定规则'],
  inputRequirements: ['经营材料'],
  deliveryRequirements: ['给出有来源的结果'],
  skillPreset: [{ skillId: 'fixture-skill', revisionId: 'fixture-skill-v1' }],
  builtinToolPolicy: { mode: 'allow-list', toolNames: ['knowledge_search'] },
  modelReference: { mode: 'profile', modelProfileId: 'fixture-model-profile' },
  mcpToolBindings: [{ connectionId: 'fixture-connection', toolId: 'fixture-read-tool' }],
});

const configDraft = (
  expertId: string,
  expertRevisionId: string,
  overrides: Partial<ScheduleConfigDraft> = {},
): ScheduleConfigDraft => ({
  name: '月度经营分析',
  expertId,
  expertRevisionId,
  requirements: '总结经营变化并指出数据依据。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'previous-month',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
  ...overrides,
});

const period = (label: string, anchorAt: number): ScheduleResolvedPeriod => ({
  rule: 'previous-month',
  timeZone: 'Asia/Shanghai',
  anchorAt,
  startAt: anchorAt - 1_000,
  endAt: anchorAt,
  label,
});

const createReadySource = (store: AppStore, occurrenceId: string, createdAt: number): string => {
  const source = store.scheduleSources.createPreparing({
    occurrenceId,
    evaluatedAt: createdAt,
    createdAt,
  });
  const item = {
    reference: {
      kind: 'workspace-input-snapshot' as const,
      snapshotId: `input-${createdAt}`,
      workspaceId:
        store.schedules.get(store.scheduleOccurrences.get(occurrenceId)?.scheduleId ?? '')?.schedule
          .workspaceId ?? 'fixture-workspace',
      contentHash: 'a'.repeat(64),
      format: 'markdown',
      fileKey: 'a'.repeat(64),
    },
    purpose: 'current-input' as const,
    origin: 'workspace-directory' as const,
    displayName: '本期合成材料.md',
  };
  const manifestItems = [{ snapshotId: source.id, ordinal: 0, ...item }];
  const ready = store.scheduleSources.publishReady({
    snapshotId: source.id,
    items: [item],
    totalFileBytes: 123,
    manifestHash: scheduleSourceManifestHash(manifestItems),
    completedAt: createdAt,
  });
  store.scheduleOccurrences.attachSourceSnapshot(occurrenceId, ready.id);
  return ready.id;
};

const makeFixture = (options: { enabled?: boolean } = {}) => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const id = ++nextId;
  const workspace = store.workspaces.create(
    `/tmp/betterwork-schedule-execution-${id}`,
    `定时执行合成空间 ${id}`,
  );
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft() });
  const config = configDraft(expert.id, expert.revision.id);
  const schedule = store.schedules.create({
    id: `schedule-${id}`,
    workspaceId: workspace.id,
    config,
    createdAt: 10,
    ...(options.enabled
      ? {
          activation: {
            enabledAt: 10,
            capabilityFingerprint: 'synthetic-preflight-fingerprint',
            nextScheduledAt: 1_000_000,
          },
        }
      : {}),
  });
  const createNowOccurrence = (label: string, requestedAt: number) => {
    const claim = store.scheduleOccurrences.claimManual({
      scheduleId: schedule.schedule.id,
      trigger: 'manual-now',
      requestKey: `now-${id}-${requestedAt}`,
      requestedAt,
      period: period(label, requestedAt),
    });
    if (claim.kind !== 'created') throw new Error('test setup: expected a new manual occurrence');
    return claim.occurrence;
  };
  return { store, workspace, expert, schedule, config, createNowOccurrence };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ScheduleExecutionService T3 Task draft assembly', () => {
  it('creates one resumable Task/Session/Expert context and links the ready source atomically', () => {
    const fixture = makeFixture();
    const occurrence = fixture.createNowOccurrence('2026年9月', 20_000);
    const sourceSnapshotId = createReadySource(fixture.store, occurrence.id, 20_100);
    const service = new ScheduleExecutionService(fixture.store, { now: () => 20_200 });
    const expertRevision = fixture.store.experts.getRevision(
      fixture.expert.id,
      fixture.expert.revision.id,
    );
    if (!expertRevision) throw new Error('test setup: pinned ExpertRevision is missing');

    const created = service.prepareTaskDraft(occurrence.id);
    const repeated = service.prepareTaskDraft(occurrence.id);

    expect(created).toMatchObject({
      occurrence: {
        id: occurrence.id,
        phase: 'preparing',
        taskId: created.task.id,
        sessionId: created.sessionId,
        sourceSnapshotId,
        preparedAt: 20_200,
      },
      task: { workspaceId: fixture.workspace.id },
      context: {
        taskId: created.task.id,
        executor: {
          kind: 'expert',
          expertId: fixture.expert.id,
          expertRevisionId: expertRevision.id,
        },
        skillBindings: [
          { skillId: 'fixture-skill', revisionId: 'fixture-skill-v1', source: 'expert-preset' },
        ],
        modelReference: { mode: 'profile', modelProfileId: 'fixture-model-profile' },
        builtinToolPolicy: { mode: 'allow-list', toolNames: ['knowledge_search'] },
        mcpToolBindings: [{ connectionId: 'fixture-connection', toolId: 'fixture-read-tool' }],
        materials: [],
        scheduleSourceSnapshotId: sourceSnapshotId,
      },
    });
    expect(created.task.title).toContain('2026年9月');
    expect(created.task.goal).toContain('本期期间（Asia/Shanghai）：2026年9月');
    expect(created.task.goal).toContain('本期来源：1 项');
    expect(created.task.goal).toContain(fixture.config.requirements);
    expect(repeated.task.id).toBe(created.task.id);
    expect(repeated.sessionId).toBe(created.sessionId);
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toHaveLength(1);
    expect(
      fixture.store.tasks.getRunContext(created.task.id, created.sessionId)?.workspacePath,
    ).toBe(fixture.workspace.rootPath);
    expect(fixture.store.runs.listByTask(created.task.id)).toEqual([]);
    expect(fixture.store.experts.get(fixture.expert.id)?.currentRevision).toBe(
      expertRevision.revision,
    );
  });

  it('uses current configuration with the original missed period, and creates a distinct next Task', () => {
    const fixture = makeFixture({ enabled: true });
    const originalPeriod = period('2025年12月', 1_000_000);
    const missedClaim = fixture.store.scheduleOccurrences.claimMissedScheduled({
      scheduleId: fixture.schedule.schedule.id,
      scheduledAt: 1_000_000,
      requestedAt: 1_000_200,
      period: originalPeriod,
      nextScheduledAt: 1_001_000,
      reasonDetail: '测试期间应用未运行。',
    });
    if (missedClaim.kind !== 'created') throw new Error('test setup: expected a missed occurrence');
    const missed = missedClaim.occurrence;
    const updatedConfig = configDraft(fixture.expert.id, fixture.expert.revision.id, {
      name: '新版月度经营分析',
      requirements: '使用当前要求分析旧期间，并保留口径说明。',
    });
    fixture.store.schedules.appendConfig(
      fixture.schedule.schedule.id,
      { config: updatedConfig, expectedRevision: 1, updatedAt: 1_000_250 },
      { kind: 'preserve' },
    );
    const missedExecution = fixture.store.scheduleOccurrences.claimManual({
      scheduleId: fixture.schedule.schedule.id,
      trigger: 'manual-missed',
      requestKey: 'missed-retry-v1',
      requestedAt: 1_000_300,
      originalOccurrenceId: missed.id,
    });
    if (missedExecution.kind !== 'created') {
      throw new Error('test setup: expected a manual missed occurrence');
    }
    const missedSourceId = createReadySource(
      fixture.store,
      missedExecution.occurrence.id,
      1_000_301,
    );
    const service = new ScheduleExecutionService(fixture.store, { now: () => 1_000_302 });
    const recoveredDraft = service.prepareTaskDraft(missedExecution.occurrence.id);

    expect(recoveredDraft.occurrence).toMatchObject({
      configVersion: 2,
      originalOccurrenceId: missed.id,
      period: originalPeriod,
    });
    expect(recoveredDraft.task.title).toContain('新版月度经营分析');
    expect(recoveredDraft.task.title).toContain(originalPeriod.label);
    expect(recoveredDraft.task.goal).toContain(updatedConfig.requirements);
    expect(recoveredDraft.task.goal).not.toContain(fixture.config.requirements);
    expect(recoveredDraft.context.scheduleSourceSnapshotId).toBe(missedSourceId);

    fixture.store.scheduleOccurrences.closePreparation({
      occurrenceId: missedExecution.occurrence.id,
      outcome: 'needs-material',
      finishedAt: 1_000_303,
      reasonCode: 'schedule_source_missing',
      reasonDetail: '合成结构化缺项判定：需补入一份本期数据。',
      taskId: recoveredDraft.task.id,
    });
    expect(fixture.store.runs.listByTask(recoveredDraft.task.id)).toEqual([]);
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)[0]?.id).toBe(
      recoveredDraft.task.id,
    );

    const nowOccurrence = fixture.createNowOccurrence('2026年10月', 1_000_400);
    const nowSourceId = createReadySource(fixture.store, nowOccurrence.id, 1_000_401);
    const nowDraft = service.prepareTaskDraft(nowOccurrence.id);
    expect(nowDraft.occurrence.configVersion).toBe(2);
    expect(nowDraft.occurrence.period.label).toBe('2026年10月');
    expect(nowDraft.task.id).not.toBe(recoveredDraft.task.id);
    expect(nowDraft.sessionId).not.toBe(recoveredDraft.sessionId);
    expect(nowDraft.context.scheduleSourceSnapshotId).toBe(nowSourceId);
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toHaveLength(2);
    expect(fixture.store.runs.listByTask(nowDraft.task.id)).toEqual([]);
  });

  it('rolls back Task, Session, TaskContext, and occurrence links when context persistence fails', () => {
    const fixture = makeFixture();
    const occurrence = fixture.createNowOccurrence('2026年9月', 40_000);
    createReadySource(fixture.store, occurrence.id, 40_100);
    vi.spyOn(fixture.store.taskContexts, 'save').mockImplementation(() => {
      throw new Error('synthetic TaskContext write failure');
    });
    const service = new ScheduleExecutionService(fixture.store, { now: () => 40_200 });

    expect(() => service.prepareTaskDraft(occurrence.id)).toThrow(
      'synthetic TaskContext write failure',
    );
    const rolledBackOccurrence = fixture.store.scheduleOccurrences.get(occurrence.id);
    expect(rolledBackOccurrence?.phase).toBe('preparing');
    expect(rolledBackOccurrence?.taskId).toBeUndefined();
    expect(rolledBackOccurrence?.sessionId).toBeUndefined();
    expect(rolledBackOccurrence?.preparedAt).toBeUndefined();
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toEqual([]);
    expect(fixture.store.taskContexts.getLatest(occurrence.id)).toBeUndefined();
    expect(fixture.store.runs.list()).toEqual([]);
  });

  it('rejects an absent ready source without creating a Task', () => {
    const fixture = makeFixture();
    const occurrence = fixture.createNowOccurrence('2026年9月', 50_000);
    const service = new ScheduleExecutionService(fixture.store, { now: () => 50_100 });

    expect(() => service.prepareTaskDraft(occurrence.id)).toThrow('本期还没有完整的固定来源快照。');
    expect(fixture.store.tasks.listRecent(fixture.workspace.id)).toEqual([]);
    expect(fixture.store.runs.list()).toEqual([]);
  });
});
