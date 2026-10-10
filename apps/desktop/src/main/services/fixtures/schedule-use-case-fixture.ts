import type {
  ExpertDetail,
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleSourceSnapshot,
  TaskMaterialSelection,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';

import { AppStore, type ScheduleAggregate, scheduleSourceManifestHash } from '../../persistence';
import { resolveSchedulePeriod } from '../schedule-calendar';
import { ScheduleExecutionService, type ScheduleTaskDraft } from '../schedule-execution-service';
import { ScheduleOutcomeService } from '../schedule-outcome-service';
import type { ScheduleService } from '../schedule-service';
import { ScheduleQueries } from '../schedule-use-cases';

export interface ScheduleUseCaseFixture {
  store: AppStore;
  now: number;
  workspace: WorkspaceSummary;
  expert: ExpertDetail;
  expertDraft: ExpertRevisionDraft;
  config: ScheduleConfigDraft;
  schedule: ScheduleAggregate;
  schedules: Pick<ScheduleService, 'get'>;
  outcomes: ScheduleOutcomeService;
  queries: ScheduleQueries;
}

interface DispatchedFixture {
  occurrenceId: string;
  draft: ScheduleTaskDraft;
  runId: string;
  snapshot: ScheduleSourceSnapshot;
}

export function createScheduleUseCaseFixture(): ScheduleUseCaseFixture {
  const store = AppStore.open(':memory:');
  const now = Date.UTC(2026, 8, 20, 10);
  const workspace = store.workspaces.create('/tmp/schedule-use-cases-fixture', '用例合成空间');
  const expertDraft: ExpertRevisionDraft = {
    name: '合成专家',
    summary: '离线用例测试',
    author: '',
    tags: [],
    identity: '读取合成材料。',
    principles: [],
    inputRequirements: [],
    deliveryRequirements: [],
    skillPreset: [],
    builtinToolPolicy: { mode: 'application-defaults' },
    modelReference: { mode: 'application-default' },
  };
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft });
  const config: ScheduleConfigDraft = {
    name: '合成月报',
    expertId: expert.id,
    expertRevisionId: expert.revision.id,
    requirements: '分析上月变化。',
    expectedArtifactTypes: ['markdown'],
    timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
    periodRule: 'previous-month',
    knowledgeSources: [],
    outputSubdirectory: '定时成果',
  };
  const schedule = store.schedules.create({
    id: 'schedule-fixture',
    workspaceId: workspace.id,
    config,
    createdAt: now,
  });
  const schedules = { get: (id: string) => store.schedules.get(id) };
  const outcomes = new ScheduleOutcomeService(store, {
    registerOccurrenceOutputs: () => [],
    saveReceipt: async () => {
      throw new Error('Query fixture does not save files');
    },
  });
  const queries = new ScheduleQueries(store, schedules, outcomes);
  return {
    store,
    now,
    workspace,
    expert,
    expertDraft,
    config,
    schedule,
    schedules,
    outcomes,
    queries,
  };
}

export function dispatchFixtureOccurrence(
  fixture: ScheduleUseCaseFixture,
  materials: TaskMaterialSelection[] = [],
): DispatchedFixture {
  const { store, now, config, workspace } = fixture;
  const claim = store.scheduleOccurrences.claimManual({
    scheduleId: fixture.schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: 'dispatched',
    requestedAt: now,
    period: resolveSchedulePeriod(config.periodRule, config.timing.timeZone, now),
  });
  if (claim.kind !== 'created') throw new Error('Fixture occurrence was not created');
  const preparing = store.scheduleSources.createPreparing({
    occurrenceId: claim.occurrence.id,
    evaluatedAt: now,
    createdAt: now,
  });
  const items = materials.map(({ reference, purpose }) => ({
    reference,
    purpose,
    origin: 'selected-document' as const,
    displayName: '合成材料',
  }));
  const snapshot = store.scheduleSources.publishReady({
    snapshotId: preparing.id,
    items,
    totalFileBytes: 0,
    manifestHash: scheduleSourceManifestHash(
      items.map((item, ordinal) => ({ ...item, ordinal, snapshotId: preparing.id })),
    ),
    completedAt: now + 1,
  });
  store.scheduleOccurrences.attachSourceSnapshot(claim.occurrence.id, snapshot.id);
  const draft = new ScheduleExecutionService(store, { now: () => now + 2 }).prepareTaskDraft(
    claim.occurrence.id,
  );
  const runId = 'run-first-fixture';
  store.transaction(() => {
    store.runs.create({
      id: runId,
      taskId: draft.task.id,
      sessionId: draft.sessionId,
      prompt: draft.task.goal,
      status: 'running',
      createdAt: now + 3,
    });
    store.runContextSnapshots.create({
      runId,
      taskId: draft.task.id,
      workspaceId: workspace.id,
      taskContextRevisionId: draft.context.id,
      expertId: config.expertId,
      expertRevisionId: config.expertRevisionId,
      contextSegmentId: 'fixture-segment',
      materials,
      scheduleSourceSnapshotId: snapshot.id,
      createdAt: now + 3,
    });
    store.scheduleOccurrences.dispatchRun({
      occurrenceId: claim.occurrence.id,
      runId,
      taskId: draft.task.id,
      sessionId: draft.sessionId,
      taskContextRevisionId: draft.context.id,
    });
  });
  return { occurrenceId: claim.occurrence.id, draft, runId, snapshot };
}
