import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ExpertRevisionDraft, ScheduleConfigDraft } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { InputSnapshotService } from './input-snapshot-service';
import { KnowledgeVault } from './knowledge-vault';
import { ScheduleDirectorySourcesService } from './schedule-directory-sources';
import { ScheduleKnowledgeSourcesService } from './schedule-knowledge-sources';
import { ScheduleSourceService } from './schedule-source-service';

const stores: AppStore[] = [];
const vaults: KnowledgeVault[] = [];
const temporaryDirectories: string[] = [];
let requestSequence = 0;

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const expertDraft = (): ExpertRevisionDraft => ({
  name: '定时来源测试专家',
  summary: '读取固定来源并形成分析',
  author: '',
  tags: [],
  identity: '你负责分析所选工作资料。',
  principles: ['只使用本期固定来源'],
  inputRequirements: [],
  deliveryRequirements: ['说明依据'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

const scheduleConfig = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '来源准备合成规则',
  expertId,
  expertRevisionId,
  requirements: '分析本期输入。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'none',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const createHarness = () => {
  const workspaceRoot = temporaryDirectory('betterwork-schedule-source-workspace-');
  const userDataRoot = temporaryDirectory('betterwork-schedule-source-userdata-');
  const store = AppStore.open(':memory:');
  stores.push(store);
  const vault = new KnowledgeVault(path.join(userDataRoot, 'knowledge.sqlite'));
  vaults.push(vault);
  const workspace = store.workspaces.create(workspaceRoot, '定时来源合成空间');
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft() });
  const config = scheduleConfig(expert.id, expert.revision.id);
  const schedule = store.schedules.create({ workspaceId: workspace.id, config, createdAt: 100 });
  const snapshots = new InputSnapshotService(store, userDataRoot, () => 1_000);
  const directorySources = new ScheduleDirectorySourcesService(store, snapshots);
  const knowledgeSources = new ScheduleKnowledgeSourcesService(vault);
  const createOccurrence = (requestedAt = 2_000) => {
    const claimed = store.scheduleOccurrences.claimManual({
      scheduleId: schedule.schedule.id,
      trigger: 'manual-now',
      requestKey: `request-${requestedAt}-${++requestSequence}`,
      requestedAt,
      period: { rule: 'none', timeZone: 'UTC', anchorAt: requestedAt, label: '无期间' },
    });
    if (claimed.kind !== 'created') throw new Error('Expected a new Schedule occurrence');
    return claimed.occurrence;
  };
  const createService = (
    directory: Pick<ScheduleDirectorySourcesService, 'collect'> = directorySources,
    now: () => number = () => 3_000,
    preparationTimeoutMs?: number,
  ) =>
    new ScheduleSourceService(store, directory, knowledgeSources, snapshots, {
      now,
      ...(preparationTimeoutMs === undefined ? {} : { preparationTimeoutMs }),
    });
  return {
    workspaceRoot,
    userDataRoot,
    store,
    workspace,
    schedule,
    snapshots,
    directorySources,
    createOccurrence,
    createService,
  };
};

afterEach(() => {
  vi.useRealTimers();
  for (const vault of vaults.splice(0)) vault.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ScheduleSourceService', () => {
  it('publishes the whole manifest once and returns the same immutable snapshot on retries', async () => {
    const fixture = createHarness();
    writeFileSync(path.join(fixture.workspaceRoot, '经营摘要.md'), '# 收入\n本期收入增长。');
    const occurrence = fixture.createOccurrence();
    const service = fixture.createService();

    const [first, concurrent] = await Promise.all([
      service.prepare(occurrence.id),
      service.prepare(occurrence.id),
    ]);

    expect(first).toEqual(concurrent);
    expect(first).toMatchObject({
      status: 'ready',
      itemCount: 1,
      totalFileBytes: Buffer.byteLength('# 收入\n本期收入增长。'),
    });
    expect(fixture.store.scheduleOccurrences.get(occurrence.id)?.sourceSnapshotId).toBe(first.id);
    expect(
      fixture.store.scheduleSources.listItems({ occurrenceId: occurrence.id, limit: 1 }).items,
    ).toHaveLength(1);
    await expect(service.prepare(occurrence.id)).resolves.toEqual(first);
    expect(
      fixture.store.scheduleSources.listItems({ occurrenceId: occurrence.id, limit: 1 }).items,
    ).toHaveLength(1);

    const recoveredFiles = await fixture.snapshots.recover();
    expect(recoveredFiles.removedFiles).toBe(0);
    const input = fixture.store.inputSnapshots.list('ready')[0];
    if (!input) throw new Error('Expected the source input snapshot to remain ready');
    expect(await fixture.snapshots.verify(input)).toBe(true);
  });

  it('does not publish a partial manifest when one source fails', async () => {
    const fixture = createHarness();
    const occurrence = fixture.createOccurrence();
    const service = fixture.createService({
      collect: async () => {
        throw new Error('合成目录读取失败');
      },
    });

    await expect(service.prepare(occurrence.id)).rejects.toMatchObject({
      name: 'ScheduleSourceServiceError',
      code: 'schedule_source_missing',
    });
    const snapshot = fixture.store.scheduleSources.getByOccurrence(occurrence.id);
    expect(snapshot).toMatchObject({ status: 'failed', itemCount: 0, totalFileBytes: 0 });
    expect(fixture.store.scheduleOccurrences.get(occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'blocked',
    });
    expect(() =>
      fixture.store.scheduleSources.listItems({ occurrenceId: occurrence.id }),
    ).toThrow();
  });

  it('combines directory and fixed Knowledge revisions into one deterministically ordered manifest', async () => {
    const fixture = createHarness();
    writeFileSync(path.join(fixture.workspaceRoot, '经营数据.md'), '本期数据');
    const occurrence = fixture.createOccurrence();
    const knowledgeReference = {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: 'knowledge-document-1',
      knowledgeRevisionId: 'knowledge-revision-1',
      contentHash: 'a'.repeat(64),
      sourcePath: '制度/经营口径.md',
      originWorkspaceId: fixture.workspace.id,
    };
    const knowledgeSources = {
      resolve: () => ({
        workspaceId: fixture.workspace.id,
        items: [
          {
            reference: knowledgeReference,
            purpose: 'rule' as const,
            origin: 'selected-document' as const,
            displayName: '经营口径',
            sourcePath: knowledgeReference.sourcePath,
          },
        ],
        sources: [],
        expertReferences: [],
      }),
      assertUnchanged: () => undefined,
    };
    const service = new ScheduleSourceService(
      fixture.store,
      fixture.directorySources,
      knowledgeSources,
      fixture.snapshots,
      { now: () => 3_000 },
    );

    const snapshot = await service.prepare(occurrence.id);
    const page = fixture.store.scheduleSources.listItems({ occurrenceId: occurrence.id });

    expect(snapshot).toMatchObject({ status: 'ready', itemCount: 2 });
    expect(page.items.map(({ origin, reference }) => [origin, reference.kind])).toEqual([
      ['selected-document', 'knowledge-revision'],
      ['workspace-directory', 'workspace-input-snapshot'],
    ]);
  });

  it('aborts preparation, records cancellation, and creates no ready manifest', async () => {
    const fixture = createHarness();
    const occurrence = fixture.createOccurrence();
    const controller = new AbortController();
    const service = fixture.createService({
      collect: () =>
        new Promise((resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
          void resolve;
        }),
    });
    const preparation = service.prepare(occurrence.id, controller.signal);
    await vi.waitFor(() =>
      expect(fixture.store.scheduleSources.getByOccurrence(occurrence.id)).toBeDefined(),
    );
    controller.abort();

    await expect(preparation).rejects.toMatchObject({ code: 'schedule_cancelled' });
    expect(fixture.store.scheduleSources.getByOccurrence(occurrence.id)).toMatchObject({
      status: 'cancelled',
      failureCode: 'schedule_cancelled',
      itemCount: 0,
    });
    expect(fixture.store.scheduleOccurrences.get(occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'cancelled',
    });
  });

  it('times out an abort-ignoring source and closes it as blocked without a ready list', async () => {
    vi.useFakeTimers();
    const fixture = createHarness();
    const occurrence = fixture.createOccurrence();
    const service = fixture.createService(
      { collect: async () => new Promise(() => undefined) },
      () => 4_000,
      25,
    );
    const preparation = service.prepare(occurrence.id);
    await vi.advanceTimersByTimeAsync(25);

    await expect(preparation).rejects.toMatchObject({ code: 'schedule_preparation_timeout' });
    expect(fixture.store.scheduleSources.getByOccurrence(occurrence.id)).toMatchObject({
      status: 'failed',
      failureCode: 'schedule_preparation_timeout',
    });
    expect(fixture.store.scheduleOccurrences.get(occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'blocked',
      reasonCode: 'schedule_preparation_timeout',
    });
    expect(() =>
      fixture.store.scheduleSources.listItems({ occurrenceId: occurrence.id }),
    ).toThrow();
  });

  it('recovers an interrupted preparation without replaying it', () => {
    const fixture = createHarness();
    const occurrence = fixture.createOccurrence();
    const snapshot = fixture.store.scheduleSources.createPreparing({
      occurrenceId: occurrence.id,
      evaluatedAt: 2_100,
      createdAt: 2_100,
    });
    const service = fixture.createService();

    expect(service.recoverInterrupted(5_000)).toEqual({
      closedOccurrences: 1,
      finishedSnapshots: 1,
    });
    const recoveredOccurrence = fixture.store.scheduleOccurrences.get(occurrence.id);
    expect(recoveredOccurrence).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'interrupted-before-run',
      reasonCode: 'schedule_preparation_timeout',
    });
    expect(recoveredOccurrence).not.toHaveProperty('taskId');
    expect(recoveredOccurrence).not.toHaveProperty('firstRunId');
    expect(fixture.store.scheduleSources.get(snapshot.id)).toMatchObject({
      status: 'failed',
      failureCode: 'schedule_preparation_timeout',
    });
    expect(service.recoverInterrupted(6_000)).toEqual({
      closedOccurrences: 0,
      finishedSnapshots: 0,
    });
  });

  it('keeps the old ready manifest stable, paginates it, and snapshots edits only for a later occurrence', async () => {
    const fixture = createHarness();
    writeFileSync(path.join(fixture.workspaceRoot, '甲.md'), '甲资料');
    writeFileSync(path.join(fixture.workspaceRoot, '乙.md'), '乙资料');
    writeFileSync(path.join(fixture.workspaceRoot, '丙.md'), '丙资料');
    const firstOccurrence = fixture.createOccurrence(2_000);
    const service = fixture.createService();
    const first = await service.prepare(firstOccurrence.id);
    const firstPage = fixture.store.scheduleSources.listItems({
      occurrenceId: firstOccurrence.id,
      limit: 1,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = fixture.store.scheduleSources.listItems({
      occurrenceId: firstOccurrence.id,
      cursor: firstPage.nextCursor,
      limit: 1,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeDefined();

    fixture.store.scheduleOccurrences.closePreparation({
      occurrenceId: firstOccurrence.id,
      outcome: 'blocked',
      finishedAt: 3_100,
      reasonCode: 'schedule_conflict',
      reasonDetail: '测试释放本期占用。',
    });
    writeFileSync(path.join(fixture.workspaceRoot, '甲.md'), '甲资料已更新');
    const nextOccurrence = fixture.createOccurrence(4_000);
    const next = await service.prepare(nextOccurrence.id);

    expect(next.id).not.toBe(first.id);
    expect(next.manifestHash).not.toBe(first.manifestHash);
    expect(fixture.store.scheduleSources.get(first.id)?.manifestHash).toBe(first.manifestHash);
    expect(
      fixture.store.scheduleSources.listItems({ occurrenceId: firstOccurrence.id }).items,
    ).toHaveLength(3);
  });
});
