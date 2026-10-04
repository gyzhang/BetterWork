import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakePptxRenderer } from '../infrastructure/fixtures/fake-pptx-renderer';
import {
  AppStore,
  RUN_INTERRUPTED_ON_STARTUP_REASON,
  scheduleSourceManifestHash,
} from '../persistence';
import { FileArtifactService } from './file-artifact-service';
import { NotificationService } from './notification-service';
import { ScheduleExecutionService } from './schedule-execution-service';
import { ScheduleNotificationService } from './schedule-notification-service';
import { ScheduleOutcomeService } from './schedule-outcome-service';
import { ScheduleOutputService } from './schedule-output-service';

const expertDraft: ExpertRevisionDraft = {
  name: '定时回执测试专家',
  summary: '离线来源回执测试',
  author: '',
  tags: [],
  identity: '使用合成来源生成结果。',
  principles: ['不访问外部服务'],
  inputRequirements: ['合成材料'],
  deliveryRequirements: ['登记 ArtifactVersion'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
};

const stores: AppStore[] = [];
const temporaryDirectories: string[] = [];
let nextId = 0;

const makeFixture = (
  options: {
    name?: string;
    expectedArtifactTypes?: ScheduleConfigDraft['expectedArtifactTypes'];
    periodRule?: ScheduleConfigDraft['periodRule'];
  } = {},
) => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const id = ++nextId;
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-schedule-output-'));
  temporaryDirectories.push(root);
  const workspace = store.workspaces.create(root, `回执合成空间 ${id}`);
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft });
  const config: ScheduleConfigDraft = {
    name: options.name ?? '月度经营分析',
    expertId: expert.id,
    expertRevisionId: expert.revision.id,
    requirements: '按固定来源完成分析。',
    expectedArtifactTypes: options.expectedArtifactTypes ?? ['markdown'],
    timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
    periodRule: options.periodRule ?? 'previous-month',
    knowledgeSources: [],
    outputSubdirectory: '定时成果',
  };
  const schedule = store.schedules.create({
    id: `schedule-output-${id}`,
    workspaceId: workspace.id,
    config,
    createdAt: 10,
  });
  const requestedAt = 1_790_000_000_000;
  const period: ScheduleResolvedPeriod =
    config.periodRule === 'none'
      ? { rule: 'none', timeZone: 'Asia/Shanghai', anchorAt: requestedAt, label: '不指定期间' }
      : {
          rule: config.periodRule,
          timeZone: 'Asia/Shanghai',
          anchorAt: requestedAt,
          startAt: requestedAt - 86_400_000,
          endAt: requestedAt,
          label: '2026年9月',
        };
  const claim = store.scheduleOccurrences.claimManual({
    scheduleId: schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: `request-${id}`,
    requestedAt,
    period,
  });
  if (claim.kind !== 'created') throw new Error('test setup: expected a new occurrence');
  const preparing = store.scheduleSources.createPreparing({
    occurrenceId: claim.occurrence.id,
    evaluatedAt: requestedAt,
    createdAt: requestedAt,
  });
  const source = store.scheduleSources.publishReady({
    snapshotId: preparing.id,
    items: [],
    totalFileBytes: 0,
    manifestHash: scheduleSourceManifestHash([]),
    completedAt: requestedAt + 1,
  });
  store.scheduleOccurrences.attachSourceSnapshot(claim.occurrence.id, source.id);
  const execution = new ScheduleExecutionService(store, { now: () => requestedAt + 2 });
  const draft = execution.prepareTaskDraft(claim.occurrence.id);
  const runId = `run-output-${id}`;
  store.transaction(() => {
    store.runs.create({
      id: runId,
      taskId: draft.task.id,
      sessionId: draft.sessionId,
      prompt: draft.task.goal,
      status: 'running',
      createdAt: requestedAt + 3,
    });
    store.runContextSnapshots.create({
      runId,
      taskId: draft.task.id,
      workspaceId: workspace.id,
      taskContextRevisionId: draft.context.id,
      expertId: draft.context.executor.kind === 'expert' ? draft.context.executor.expertId : '',
      expertRevisionId:
        draft.context.executor.kind === 'expert' ? draft.context.executor.expertRevisionId : '',
      contextSegmentId: `segment-${id}`,
      materials: [],
      scheduleSourceSnapshotId: source.id,
      createdAt: requestedAt + 3,
    });
    store.scheduleOccurrences.dispatchRun({
      occurrenceId: claim.occurrence.id,
      runId,
      taskId: draft.task.id,
      sessionId: draft.sessionId,
      taskContextRevisionId: draft.context.id,
    });
  });
  const outputs = new ScheduleOutputService(store, { now: () => requestedAt + 4 });
  return {
    store,
    root,
    workspace,
    schedule,
    occurrence: store.scheduleOccurrences.get(claim.occurrence.id),
    task: draft.task,
    runId,
    requestedAt,
    outputs,
  };
};

const saveMarkdown = (
  fixture: ReturnType<typeof makeFixture>,
  input: { taskId?: string; runId?: string; title: string; content: string },
) =>
  fixture.store.artifacts.saveMarkdown({
    taskId: input.taskId ?? fixture.task.id,
    title: input.title,
    content: input.content,
    origin: 'assistant-run',
    runId: input.runId ?? fixture.runId,
  });

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ScheduleOutputService ArtifactVersion receipts', () => {
  it('selects only the occurrence first Run and keeps callbacks idempotent with attempt CAS', () => {
    const fixture = makeFixture();
    const first = saveMarkdown(fixture, {
      title: '本期结论',
      content: '这是本期首个 Run 的合成结论。',
    });
    const previousRunId = `run-previous-${fixture.runId}`;
    fixture.store.runs.create({
      id: previousRunId,
      taskId: fixture.task.id,
      sessionId: fixture.occurrence?.sessionId ?? '',
      prompt: '前期 Run',
      status: 'completed',
      createdAt: fixture.requestedAt - 10,
      completedAt: fixture.requestedAt - 1,
    });
    const previousRunArtifact = saveMarkdown(fixture, {
      runId: previousRunId,
      title: '前期结论',
      content: '这是上一期间 Run 的结果。',
    });
    const previousMonthTask = fixture.store.tasks.create(
      fixture.workspace.id,
      '2026年8月的月度工作',
      '前一期间的独立任务。',
    );
    const previousMonthRunId = `run-month-${fixture.runId}`;
    fixture.store.runs.create({
      id: previousMonthRunId,
      taskId: previousMonthTask.task.id,
      sessionId: previousMonthTask.sessionId,
      prompt: '处理上一期间材料',
      status: 'completed',
      createdAt: fixture.requestedAt - 20,
      completedAt: fixture.requestedAt - 11,
    });
    const previousMonthArtifact = saveMarkdown(fixture, {
      taskId: previousMonthTask.task.id,
      runId: previousMonthRunId,
      title: '2026年8月报告',
      content: '前一期间独立 Task 的真实结果。',
    });

    const registered = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    const firstDetail = fixture.store.artifacts.getVersionDetail(first.currentVersionId);
    if (!firstDetail || firstDetail.type !== 'markdown') {
      throw new Error('test setup: first ArtifactVersion missing');
    }
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      artifactVersionId: first.currentVersionId,
      contentHash: firstDetail.contentHash,
      status: 'pending',
      attempt: 1,
      relativePath: expect.stringMatching(/^定时成果\/月度经营分析-2026年9月-v1-.+\.md$/u),
    });
    expect(registered[0]?.artifactVersionId).not.toBe(previousRunArtifact.currentVersionId);
    expect(registered[0]?.artifactVersionId).not.toBe(previousMonthArtifact.currentVersionId);
    expect(() =>
      fixture.store.scheduleOutputs.createPending({
        occurrenceId: fixture.occurrence?.id ?? '',
        artifactVersionId: first.currentVersionId,
        relativePath: registered[0]?.relativePath ?? '',
        contentHash: 'f'.repeat(64),
        createdAt: fixture.requestedAt + 5,
      }),
    ).toThrow('回执内容 hash 与登记的 ArtifactVersion 不匹配');
    const claimed = fixture.store.scheduleOutputs.claimSaving({
      receiptId: registered[0]?.id ?? '',
      expectedAttempt: 1,
      updatedAt: fixture.requestedAt + 5,
    });
    expect(claimed).toMatchObject({ status: 'saving', attempt: 1 });
    expect(() =>
      fixture.store.scheduleOutputs.claimSaving({
        receiptId: claimed.id,
        expectedAttempt: 1,
        updatedAt: fixture.requestedAt + 6,
      }),
    ).toThrow('定时成果回执已变化');

    const repeated = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    expect(repeated).toEqual([claimed]);
    expect(fixture.store.scheduleOutputs.listByOccurrence(fixture.occurrence?.id ?? '')).toEqual([
      claimed,
    ]);
  });

  it('includes multiple same-type versions and leaves an absent requested type unrepresented', () => {
    const fixture = makeFixture({ expectedArtifactTypes: ['markdown', 'presentation'] });
    const first = saveMarkdown(fixture, { title: '结论一', content: '第一份 Markdown。' });
    const second = saveMarkdown(fixture, { title: '结论二', content: '第二份 Markdown。' });

    const receipts = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');

    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map((receipt) => receipt.artifactVersionId))).toEqual(
      new Set([first.currentVersionId, second.currentVersionId]),
    );
    expect(receipts.every((receipt) => receipt.relativePath.endsWith('.md'))).toBe(true);
    expect(receipts[0]?.relativePath).not.toBe(receipts[1]?.relativePath);
    expect(receipts.every((receipt) => receipt.status === 'pending')).toBe(true);
  });

  it('cleans and truncates Unicode filename parts while retaining each full version ID', () => {
    const longName = `${'定时分析'.repeat(20)}/内部目录`;
    const fixture = makeFixture({ name: longName, periodRule: 'none' });
    const first = saveMarkdown(fixture, { title: '报告一', content: '第一版内容。' });
    const second = saveMarkdown(fixture, { title: '报告二', content: '第二版内容。' });

    const receipts = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    const firstReceipt = receipts.find(
      (receipt) => receipt.artifactVersionId === first.currentVersionId,
    );
    const secondReceipt = receipts.find(
      (receipt) => receipt.artifactVersionId === second.currentVersionId,
    );
    const firstFilename = firstReceipt?.relativePath.split('/')[1] ?? '';
    const namePart = firstFilename.split('-')[0] ?? '';

    expect(Array.from(namePart)).toHaveLength(60);
    expect(firstReceipt?.relativePath).toContain(first.currentVersionId);
    expect(secondReceipt?.relativePath).toContain(second.currentVersionId);
    expect(firstReceipt?.relativePath).not.toBe(secondReceipt?.relativePath);
    expect(firstReceipt?.relativePath).not.toContain('/内部目录');
    expect(firstReceipt?.relativePath).toMatch(/-\d{8}_\d{4}-v1-/u);
  });

  it('rejects a version from a different Run even when that version belongs to the same Task', () => {
    const fixture = makeFixture();
    const previousRunId = `run-other-${fixture.runId}`;
    fixture.store.runs.create({
      id: previousRunId,
      taskId: fixture.task.id,
      sessionId: fixture.occurrence?.sessionId ?? '',
      prompt: '其他月份的 Run',
      status: 'completed',
      createdAt: fixture.requestedAt - 10,
      completedAt: fixture.requestedAt - 1,
    });
    const other = saveMarkdown(fixture, {
      runId: previousRunId,
      title: '其他月份产物',
      content: '其他月份的真实版本。',
    });
    const detail = fixture.store.artifacts.getVersionDetail(other.currentVersionId);
    if (!detail || detail.type !== 'markdown') throw new Error('test setup: version missing');

    expect(() =>
      fixture.store.scheduleOutputs.createPending({
        occurrenceId: fixture.occurrence?.id ?? '',
        artifactVersionId: detail.id,
        relativePath: `定时成果/错配-v${detail.versionNumber}-${detail.id}.md`,
        contentHash: detail.contentHash,
        createdAt: fixture.requestedAt + 5,
      }),
    ).toThrow('不属于本期首个 Run');
  });

  it('returns no receipts for an occurrence that has no Run', () => {
    const fixture = makeFixture();
    const config = fixture.schedule.config;
    const noRunSchedule = fixture.store.schedules.create({
      id: `no-run-${fixture.runId}`,
      workspaceId: fixture.workspace.id,
      config: {
        name: '尚未派发的规则',
        expertId: config.expertId,
        expertRevisionId: config.expertRevisionId,
        requirements: config.requirements,
        expectedArtifactTypes: config.expectedArtifactTypes,
        timing: config.timing,
        periodRule: config.periodRule,
        knowledgeSources: config.knowledgeSources,
        outputSubdirectory: config.outputSubdirectory,
      },
      createdAt: fixture.requestedAt + 10,
    });
    const claim = fixture.store.scheduleOccurrences.claimManual({
      scheduleId: noRunSchedule.schedule.id,
      trigger: 'manual-now',
      requestKey: `no-run-${fixture.runId}`,
      requestedAt: fixture.requestedAt + 20,
      period: {
        rule: 'previous-month',
        timeZone: 'Asia/Shanghai',
        anchorAt: fixture.requestedAt + 20,
        startAt: fixture.requestedAt,
        endAt: fixture.requestedAt + 20,
        label: '2026年10月',
      },
    });
    if (claim.kind !== 'created') throw new Error('test setup: no-run occurrence missing');

    expect(fixture.outputs.registerOccurrenceOutputs(claim.occurrence.id)).toEqual([]);
  });

  it('publishes exact ArtifactVersion bytes without overwrite and retries only to a new attempt path', async () => {
    const fixture = makeFixture();
    const artifact = saveMarkdown(fixture, { title: '保存测试', content: '不可变版本正文。' });
    const [receipt] = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    if (!receipt) throw new Error('test setup: pending output receipt missing');
    const originalPath = path.join(fixture.root, receipt.relativePath);
    mkdirSync(path.dirname(originalPath), { recursive: true });
    writeFileSync(originalPath, '用户已有文件');

    const failed = await fixture.outputs.saveReceipt(receipt.id);

    expect(failed).toMatchObject({
      status: 'failed',
      attempt: 1,
      failureCode: 'schedule_output_collision',
    });
    expect(readFileSync(originalPath, 'utf8')).toBe('用户已有文件');
    const retried = await fixture.outputs.retryFailedReceipt({
      receiptId: receipt.id,
      expectedAttempt: 1,
    });
    const retryPath = path.join(fixture.root, retried.relativePath);
    expect(retried).toMatchObject({ status: 'saved', attempt: 2 });
    expect(retried.relativePath).toContain('-attempt-2.md');
    expect(readFileSync(retryPath, 'utf8')).toBe('不可变版本正文。');
    expect(readFileSync(originalPath, 'utf8')).toBe('用户已有文件');
    expect(fixture.store.runs.listByTask(fixture.task.id)).toHaveLength(1);

    writeFileSync(retryPath, '用户修改副本');
    await expect(fixture.outputs.saveReceipt(receipt.id)).resolves.toEqual(retried);
    expect(readFileSync(retryPath, 'utf8')).toBe('用户修改副本');
    await expect(
      fixture.outputs.retryFailedReceipt({ receiptId: receipt.id, expectedAttempt: 1 }),
    ).rejects.toThrow('定时成果回执已变化');
    expect(fixture.store.artifacts.getVersionDetail(artifact.currentVersionId)?.type).toBe(
      'markdown',
    );
  });

  it('coalesces concurrent saves for the same receipt into one temporary-file write', async () => {
    const fixture = makeFixture();
    saveMarkdown(fixture, { title: '并发保存', content: '只写一次临时文件。' });
    const [receipt] = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    if (!receipt) throw new Error('test setup: pending output receipt missing');
    let releaseWrite: (() => void) | undefined;
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writeCount = 0;
    const outputs = new ScheduleOutputService(fixture.store, {
      writeTemporary: async (filePath, bytes) => {
        writeCount += 1;
        await blockedWrite;
        writeFileSync(filePath, bytes, { flag: 'wx' });
      },
    });

    const firstSave = outputs.saveReceipt(receipt.id);
    const repeatedSave = outputs.saveReceipt(receipt.id);
    expect(repeatedSave).toBe(firstSave);
    await Promise.resolve();
    if (!releaseWrite) throw new Error('test setup: temporary writer did not initialize');
    releaseWrite();
    const [saved, repeated] = await Promise.all([firstSave, repeatedSave]);

    expect(saved).toMatchObject({ status: 'saved', attempt: 1 });
    expect(repeated).toEqual(saved);
    expect(writeCount).toBe(1);
    expect(readFileSync(path.join(fixture.root, saved.relativePath), 'utf8')).toBe(
      '只写一次临时文件。',
    );
  });

  it('recovers a published file after a simulated database failure before saved receipt commit', async () => {
    const fixture = makeFixture();
    const artifact = saveMarkdown(fixture, {
      title: '断点恢复',
      content: '崩溃后核验的版本字节。',
    });
    const [receipt] = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    if (!receipt) throw new Error('test setup: pending output receipt missing');
    const markSaved = vi
      .spyOn(fixture.store.scheduleOutputs, 'markSaved')
      .mockImplementationOnce(() => {
        throw new Error('simulated crash before receipt commit');
      });

    await expect(fixture.outputs.saveReceipt(receipt.id)).rejects.toThrow(
      'simulated crash before receipt commit',
    );
    expect(fixture.store.scheduleOutputs.get(receipt.id)?.status).toBe('saving');
    expect(readFileSync(path.join(fixture.root, receipt.relativePath), 'utf8')).toBe(
      '崩溃后核验的版本字节。',
    );

    markSaved.mockRestore();
    await expect(fixture.outputs.recoverIncomplete()).resolves.toMatchObject({
      examined: 1,
      saved: 1,
      failed: 0,
      unresolved: 0,
    });
    expect(fixture.store.scheduleOutputs.get(receipt.id)).toMatchObject({
      status: 'saved',
      artifactVersionId: artifact.currentVersionId,
    });
  });

  it('resumes an already flushed receipt temporary file and verifies a same-hash existing target', async () => {
    const fixture = makeFixture();
    const artifact = saveMarkdown(fixture, { title: '已写临时文件', content: '临时字节。' });
    const [receipt] = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    if (!receipt) throw new Error('test setup: pending output receipt missing');
    expect(receipt.artifactVersionId).toBe(artifact.currentVersionId);
    fixture.store.scheduleOutputs.claimSaving({
      receiptId: receipt.id,
      expectedAttempt: 1,
      updatedAt: fixture.requestedAt + 5,
    });
    mkdirSync(path.join(fixture.root, '定时成果'), { recursive: true });
    const temporaryToken = createHash('sha256')
      .update(`${receipt.id}:${receipt.attempt}`)
      .digest('hex')
      .slice(0, 32);
    writeFileSync(
      path.join(fixture.root, '定时成果', `.betterwork-schedule-${temporaryToken}.tmp`),
      '临时字节。',
    );

    await expect(fixture.outputs.recoverIncomplete()).resolves.toMatchObject({ saved: 1 });
    const target = path.join(fixture.root, receipt.relativePath);
    expect(readFileSync(target, 'utf8')).toBe('临时字节。');
    expect(readdirSync(path.dirname(target))).not.toContain(
      `.betterwork-schedule-${temporaryToken}.tmp`,
    );

    const nextFixture = makeFixture();
    const nextArtifact = saveMarkdown(nextFixture, { title: '同 hash', content: '预先存在。' });
    const [nextReceipt] = nextFixture.outputs.registerOccurrenceOutputs(
      nextFixture.occurrence?.id ?? '',
    );
    if (!nextReceipt) throw new Error('test setup: same-hash receipt missing');
    mkdirSync(path.dirname(path.join(nextFixture.root, nextReceipt.relativePath)), {
      recursive: true,
    });
    writeFileSync(path.join(nextFixture.root, nextReceipt.relativePath), '预先存在。');
    await expect(nextFixture.outputs.saveReceipt(nextReceipt.id)).resolves.toMatchObject({
      status: 'saved',
      artifactVersionId: nextArtifact.currentVersionId,
    });
  });

  it('fails safely on workspace/output symlinks and preserves data outside the Workspace', async () => {
    const childFixture = makeFixture();
    const outside = mkdtempSync(path.join(os.tmpdir(), 'betterwork-schedule-output-outside-'));
    temporaryDirectories.push(outside);
    const childArtifact = saveMarkdown(childFixture, { title: '链接目录', content: '不要外写。' });
    const [childReceipt] = childFixture.outputs.registerOccurrenceOutputs(
      childFixture.occurrence?.id ?? '',
    );
    if (!childReceipt) throw new Error('test setup: symlink receipt missing');
    symlinkSync(outside, path.join(childFixture.root, '定时成果'));

    const childFailure = await childFixture.outputs.saveReceipt(childReceipt.id);
    expect(childFailure).toMatchObject({
      status: 'failed',
      failureCode: 'schedule_output_save_failed',
      artifactVersionId: childArtifact.currentVersionId,
    });
    expect(readdirSync(outside)).toEqual([]);

    const rootFixture = makeFixture();
    const rootOutside = mkdtempSync(path.join(os.tmpdir(), 'betterwork-schedule-root-outside-'));
    temporaryDirectories.push(rootOutside);
    saveMarkdown(rootFixture, { title: '链接根', content: '不要跟随根目录符号链接。' });
    const [rootReceipt] = rootFixture.outputs.registerOccurrenceOutputs(
      rootFixture.occurrence?.id ?? '',
    );
    if (!rootReceipt) throw new Error('test setup: root symlink receipt missing');
    rmSync(rootFixture.root, { recursive: true, force: true });
    symlinkSync(rootOutside, rootFixture.root);

    const rootFailure = await rootFixture.outputs.saveReceipt(rootReceipt.id);
    expect(rootFailure).toMatchObject({
      status: 'failed',
      failureCode: 'schedule_workspace_unavailable',
    });
    expect(readdirSync(rootOutside)).toEqual([]);
  });

  it('records a local save timeout as failed and never publishes a partial destination', async () => {
    const fixture = makeFixture();
    const artifact = saveMarkdown(fixture, { title: '保存超时', content: '超时前的版本。' });
    const [receipt] = fixture.outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    if (!receipt) throw new Error('test setup: timeout receipt missing');
    const timedOutputs = new ScheduleOutputService(fixture.store, {
      now: () => fixture.requestedAt + 10,
      saveTimeoutMs: 5,
      writeTemporary: (_filePath, _bytes, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('synthetic write aborted')), {
            once: true,
          });
        }),
    });

    const failed = await timedOutputs.saveReceipt(receipt.id);

    expect(failed).toMatchObject({
      status: 'failed',
      failureCode: 'schedule_output_save_failed',
      failureDetail: '保存定时成果超时，原始 ArtifactVersion 已保留。',
      artifactVersionId: artifact.currentVersionId,
    });
    expect(() => readFileSync(path.join(fixture.root, receipt.relativePath))).toThrow();
  });

  it('reads and publishes exact binary PPTX bytes through FileArtifactService', async () => {
    const fixture = makeFixture({ expectedArtifactTypes: ['presentation'] });
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x7f, 0xff]);
    const version = fixture.store.artifacts.registerFile({
      taskId: fixture.task.id,
      title: '合成 PPTX',
      runId: fixture.runId,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: bytes.length,
      fileHash: createHash('sha256').update(bytes).digest('hex'),
      fileKey: 'synthetic-execution/slides.pptx',
      executionId: 'synthetic-execution',
      validation: {
        structure: 'passed',
        visual: 'not-checked',
        manualEdit: 'not-checked',
      },
    });
    const artifactFilesRoot = path.join(fixture.root, 'artifact-files');
    const storedDirectory = path.join(artifactFilesRoot, version.versionId);
    mkdirSync(storedDirectory, { recursive: true });
    writeFileSync(path.join(storedDirectory, 'output'), bytes);
    const fileArtifacts = new FileArtifactService(
      fixture.store,
      artifactFilesRoot,
      async () => {
        throw new Error('test should read the immutable registered bytes');
      },
      () => true,
      fakePptxRenderer(),
    );
    const outputs = new ScheduleOutputService(fixture.store, { fileArtifacts });
    const [receipt] = outputs.registerOccurrenceOutputs(fixture.occurrence?.id ?? '');
    if (!receipt) throw new Error('test setup: presentation receipt missing');

    const saved = await outputs.saveReceipt(receipt.id);

    expect(saved).toMatchObject({ status: 'saved', artifactVersionId: version.versionId });
    expect(saved.relativePath.endsWith('.pptx')).toBe(true);
    expect(readFileSync(path.join(fixture.root, saved.relativePath))).toEqual(bytes);
  });

  it('closes the scheduled occurrence after bounded saving and projects Run plus artifact facts', async () => {
    const fixture = makeFixture();
    saveMarkdown(fixture, { title: '定时结果', content: '自动生成的中文分析。' });
    fixture.store.runs.appendEvent({
      id: `completed-${fixture.runId}`,
      runId: fixture.runId,
      sequence: 0,
      createdAt: fixture.requestedAt + 10,
      type: 'run.completed',
      finalContent: '自动生成的中文分析。',
    });
    const changed = vi.fn();
    const outcomes = new ScheduleOutcomeService(fixture.store, fixture.outputs, {
      now: () => fixture.requestedAt + 20,
      onChanged: changed,
    });

    const result = await outcomes.finalizeRun(fixture.runId);

    expect(result).toMatchObject({
      status: 'generated',
      occurrence: { phase: 'closed', firstRunId: fixture.runId },
      run: { status: 'completed' },
      outputReceipts: [{ status: 'saved' }],
    });
    expect(fixture.store.scheduleOccurrences.get(fixture.occurrence?.id ?? '')).toMatchObject({
      phase: 'closed',
      firstRunId: fixture.runId,
    });
    expect(changed).toHaveBeenCalledWith({
      scheduleId: fixture.schedule.schedule.id,
      occurrenceId: fixture.occurrence?.id,
      reason: 'occurrence',
    });
    await expect(outcomes.finalizeRun(fixture.runId)).resolves.toEqual(result);
    expect(changed).toHaveBeenCalledOnce();
    expect(fixture.store.runs.list()).toHaveLength(1);
  });

  it('commits a terminal Run close with its notification receipt and publishes after commit', async () => {
    const fixture = makeFixture();
    saveMarkdown(fixture, { title: '原子通知结果', content: '用于通知原子性回归。' });
    fixture.store.runs.appendEvent({
      id: `completed-${fixture.runId}`,
      runId: fixture.runId,
      sequence: 0,
      createdAt: fixture.requestedAt + 10,
      type: 'run.completed',
      finalContent: '用于通知原子性回归。',
    });
    const notices = new NotificationService(fixture.store.notifications, () => null);
    const scheduleNoticesRef: { current?: ScheduleNotificationService } = {};
    const outcomes = new ScheduleOutcomeService(fixture.store, fixture.outputs, {
      now: () => fixture.requestedAt + 20,
      persistOccurrenceNotification: (occurrenceId) =>
        scheduleNoticesRef.current?.persistOccurrenceWithinTransaction(occurrenceId).afterCommit,
    });
    scheduleNoticesRef.current = new ScheduleNotificationService(fixture.store, notices, outcomes);
    const publish = vi.spyOn(notices, 'publish');
    const createReceipt = vi
      .spyOn(fixture.store.scheduleNotifications, 'create')
      .mockImplementation(() => {
        throw new Error('synthetic schedule notification receipt failure');
      });

    await expect(outcomes.finalizeRun(fixture.runId)).rejects.toThrow(
      'synthetic schedule notification receipt failure',
    );
    expect(fixture.store.scheduleOccurrences.get(fixture.occurrence?.id ?? '')?.phase).toBe(
      'dispatched',
    );
    expect(fixture.store.notifications.list()).toEqual([]);
    expect(
      fixture.store.scheduleNotifications.get(fixture.occurrence?.id ?? '', 'initial-outcome'),
    ).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();

    createReceipt.mockRestore();
    const result = await outcomes.finalizeRun(fixture.runId);
    const savedNotice = notices.list()[0];
    expect(result).toMatchObject({ status: 'generated', occurrence: { phase: 'closed' } });
    expect(
      fixture.store.scheduleNotifications.get(fixture.occurrence?.id ?? '', 'initial-outcome'),
    ).toMatchObject({ notificationId: savedNotice?.id });
    expect(savedNotice).toMatchObject({ kind: 'schedule', level: 'success', read: true });
    expect(publish).toHaveBeenCalledOnce();
    await expect(outcomes.finalizeRun(fixture.runId)).resolves.toEqual(result);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('recovers a terminal scheduled Run after startup interruption without dispatching another Run', async () => {
    const fixture = makeFixture();
    saveMarkdown(fixture, { title: '中断前部分成果', content: '保留中断前已登记的版本。' });
    fixture.store.runs.forceFailure(
      fixture.runId,
      RUN_INTERRUPTED_ON_STARTUP_REASON,
      fixture.requestedAt + 10,
    );
    const outcomes = new ScheduleOutcomeService(fixture.store, fixture.outputs, {
      now: () => fixture.requestedAt + 20,
    });

    const recovered = await outcomes.recoverTerminalRuns();

    expect(recovered).toEqual({ examined: 1, finalized: 1, unresolved: 0 });
    expect(outcomes.projectOccurrence(fixture.occurrence?.id ?? '')).toMatchObject({
      status: 'interrupted',
      reasonDetail: RUN_INTERRUPTED_ON_STARTUP_REASON,
      occurrence: { phase: 'closed', firstRunId: fixture.runId },
      outputReceipts: [{ status: 'saved' }],
    });
    expect(fixture.store.runs.list()).toHaveLength(1);
  });

  it('waits for a bounded save attempt before closing a completed Run as save-failed', async () => {
    const fixture = makeFixture();
    saveMarkdown(fixture, { title: '有界保存', content: '应等待保存结论。' });
    fixture.store.runs.appendEvent({
      id: `completed-${fixture.runId}`,
      runId: fixture.runId,
      sequence: 0,
      createdAt: fixture.requestedAt + 10,
      type: 'run.completed',
      finalContent: '应等待保存结论。',
    });
    let phaseDuringWrite: string | undefined;
    const outputs = new ScheduleOutputService(fixture.store, {
      writeTemporary: (_filePath, _bytes, signal) => {
        phaseDuringWrite = fixture.store.scheduleOccurrences.get(
          fixture.occurrence?.id ?? '',
        )?.phase;
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('synthetic write aborted')), {
            once: true,
          });
        });
      },
    });
    const outcomes = new ScheduleOutcomeService(fixture.store, outputs, {
      now: () => fixture.requestedAt + 20,
      outputSaveTimeoutMs: 5,
    });

    const result = await outcomes.finalizeRun(fixture.runId);

    expect(phaseDuringWrite).toBe('dispatched');
    expect(result).toMatchObject({
      status: 'save-failed',
      occurrence: { phase: 'closed' },
      outputReceipts: [{ status: 'failed', failureCode: 'schedule_output_save_failed' }],
    });
  });
});
