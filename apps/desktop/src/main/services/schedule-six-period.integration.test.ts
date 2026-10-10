import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ExpertRevisionDraft,
  MaterialReference,
  ScheduleConfigDraft,
  ScheduleOccurrence,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { InputSnapshotService } from './input-snapshot-service';
import { KnowledgeSearchService } from './knowledge-search';
import { KnowledgeVault } from './knowledge-vault';
import { NotificationService } from './notification-service';
import { RunService } from './run-service';
import { ScheduleDirectorySourcesService } from './schedule-directory-sources';
import { ScheduleDispatchService } from './schedule-dispatch-service';
import { ScheduleExecutionService } from './schedule-execution-service';
import { ScheduleKnowledgeSourcesService } from './schedule-knowledge-sources';
import { ScheduleOutcomeService } from './schedule-outcome-service';
import { ScheduleOutputService } from './schedule-output-service';
import { SchedulePreflightService } from './schedule-preflight';
import { ScheduleScheduler } from './schedule-scheduler';
import { ScheduleSourceService } from './schedule-source-service';
import { SkillService } from './skill-service';
import { TaskMaterialService } from './task-material-service';

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }));

const MODEL_ENDPOINT = 'http://127.0.0.1:18473/v1/chat/completions';
const PERIOD_LABELS = [
  '2026年4月',
  '2026年5月',
  '2026年6月',
  '2026年7月',
  '2026年8月',
  '2026年9月',
] as const;

const expertDraft = (modelProfileId: string): ExpertRevisionDraft => ({
  name: '六期经营分析专家',
  summary: '按本期和历史来源形成可追溯的离线合成报告。',
  author: '',
  tags: ['经营分析'],
  identity: '仅依据本次 Run 实际读取的固定材料工作。',
  principles: ['不把历史数据冒充本期数据。', '资料缺项时请求用户补充。'],
  inputRequirements: ['本期经营数据', '季度与半年度历史对比资料'],
  deliveryRequirements: ['交付 Markdown 报告。'],
  skillPreset: [],
  builtinToolPolicy: {
    mode: 'allow-list',
    toolNames: ['read_text_file', 'read_knowledge', 'artifact_declare_sources'],
  },
  modelReference: { mode: 'profile', modelProfileId },
});

const scheduleConfig = (
  expertId: string,
  expertRevisionId: string,
  collectionId: string,
): ScheduleConfigDraft => ({
  name: '月度经营分析',
  expertId,
  expertRevisionId,
  requirements:
    '请生成并交付 Markdown（.md）经营分析报告。核对本期数据，并与可用的历史季度和半年度资料对比；本期数据缺失时请留在原任务请求用户补充。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'previous-month',
  knowledgeSources: [{ kind: 'collection', collectionId, purpose: 'historical-comparison' }],
  outputSubdirectory: '定时成果',
});

interface WireMessage {
  role?: string;
  content?: unknown;
}

interface ProviderRequest {
  runId: string;
  messages: WireMessage[];
}

interface ProviderToolCall {
  name: string;
  arguments: unknown;
}

const sse = (delta: unknown): Response =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });

const getMessages = (init: RequestInit | undefined): WireMessage[] => {
  const payload: unknown = JSON.parse(String(init?.body ?? '{}'));
  if (!payload || typeof payload !== 'object' || !('messages' in payload)) return [];
  const messages = payload.messages;
  return Array.isArray(messages)
    ? messages.filter((message): message is WireMessage =>
        Boolean(message && typeof message === 'object'),
      )
    : [];
};

const toolResponse = (runId: string, calls: readonly ProviderToolCall[]): Response =>
  sse({
    tool_calls: calls.map((call, index) => ({
      index,
      id: `offline-${runId}-${String(index)}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  });

const finalResponse = (content: string): Response => sse({ content });

const loopbackTarget = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 4));
  }
  throw new Error(message);
};

const periodFromTask = (title: string): string | undefined =>
  PERIOD_LABELS.find((label) => title.includes(label));

const fileMaterialPath = (store: AppStore, reference: MaterialReference): string | undefined =>
  reference.kind === 'workspace-input-snapshot'
    ? store.inputSnapshots.get(reference.snapshotId)?.sourcePath
    : undefined;

describe('Schedule six period offline integration journey', () => {
  const roots: string[] = [];
  const stores: AppStore[] = [];
  const vaults: KnowledgeVault[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const vault of vaults.splice(0)) vault.close();
    for (const store of stores.splice(0)) store.close();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('advances six months with changing directory and collection snapshots, continuation, and missed retry', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'betterwork-schedule-six-period-'));
    roots.push(root);
    const userData = path.join(root, 'user-data');
    const workspaceRoot = path.join(root, '经营分析工作区');
    const knowledgeFiles = path.join(root, 'knowledge-source');
    await Promise.all([
      mkdir(userData, { recursive: true }),
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(knowledgeFiles, { recursive: true }),
    ]);

    let wallNow = Date.parse('2026-04-05T01:00:00.000Z');
    let monotonicNow = 0;
    const clock = {
      wall: (): number => wallNow,
      monotonic: (): number => monotonicNow,
      advanceTo: (timestamp: number): void => {
        monotonicNow += timestamp - wallNow;
        wallNow = timestamp;
      },
    };

    const store = AppStore.open(path.join(userData, 'app.sqlite'));
    stores.push(store);
    const vault = new KnowledgeVault(path.join(userData, 'vault.sqlite'));
    vaults.push(vault);
    const workspace = store.workspaces.create(workspaceRoot, '六期经营分析');
    const inputSnapshots = new InputSnapshotService(store, userData, clock.wall);
    const taskMaterials = new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots });
    const skillService = new SkillService(store, {
      developmentBuiltinRoot: path.join(userData, 'empty-builtins'),
      installedBuiltinRoot: path.join(userData, 'empty-installed'),
      userRoot: path.join(userData, 'skills'),
    });

    const modelProfileId = store.models.save({
      name: '六期离线 HTTP 替身（loopback）',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:18473/v1',
      model: 'six-period-synthetic',
      role: 'language',
      apiKey: '',
      maxContextTokens: 16_384,
      maxOutputTokens: 2_048,
      temperature: 0,
      enabled: true,
    });
    const expert = store.experts.create({
      sourceKind: 'user',
      revision: expertDraft(modelProfileId),
    });

    const collectionResult = vault.saveCollection({ mode: 'create', name: '季度与半年历史对比' });
    const collection = collectionResult[0];
    if (!collection) throw new Error('test setup: comparison collection was not created');

    const importKnowledge = async (
      filename: string,
      content: string,
    ): Promise<{ id: string; path: string }> => {
      const sourcePath = path.join(knowledgeFiles, filename);
      await writeFile(sourcePath, content, 'utf8');
      const receipt = await vault.importPaths([sourcePath]);
      const document = receipt.imported[0];
      if (!document) throw new Error(`test setup: failed to import ${filename}`);
      return { id: document.id, path: sourcePath };
    };
    const setMembership = (documentId: string, collectionIds: string[]): void => {
      const document = vault.listDocuments().find((item) => item.id === documentId);
      if (!document) throw new Error(`test setup: missing Knowledge document ${documentId}`);
      vault.setCollectionMembers({
        documentId,
        expectedMembershipRevision: document.membershipRevision,
        collectionIds,
      });
    };
    const policyDoc = await importKnowledge(
      '经营分析口径.md',
      '# 经营分析口径\n\nPOLICY-REVISION-1：按已回款金额统计。',
    );
    const quarterDoc = await importKnowledge(
      '2026年一季度回顾.md',
      '# 一季度历史回顾\n\nQUARTER-HISTORY-Q1：收入基线 300 万元。',
    );
    const removableDoc = await importKnowledge(
      '已撤下的历史说明.md',
      '# 已撤下说明\n\nREMOVED-COLLECTION-MEMBER：不得用于下一期。',
    );
    setMembership(policyDoc.id, [collection.id]);
    setMembership(quarterDoc.id, [collection.id]);
    setMembership(removableDoc.id, [collection.id]);
    const policyRevision1 = vault.listRevisions(policyDoc.id)[0];
    if (!policyRevision1) throw new Error('test setup: initial policy revision is missing');

    await writeFile(
      path.join(workspaceRoot, '工作口径.md'),
      '# 工作口径\n\nDIRECTORY-POLICY-REVISION-1：按合同约定核对。',
      'utf8',
    );
    await writeFile(
      path.join(workspaceRoot, '已删除的旧目录事实.md'),
      '# 旧事实\n\nDELETED-DIRECTORY-ONLY：后续期间必须不可读。',
      'utf8',
    );

    const config = scheduleConfig(expert.id, expert.revision.id, collection.id);
    const preflight = new SchedulePreflightService(store, {
      verifySkillResource: async () => undefined,
      resolveEnvironmentPython: () => path.join(userData, 'python'),
      pathExists: async () => true,
      verifyToolchainSnapshot: async () => ({ valid: true }),
      resolveSnapshotRoot: () => path.join(userData, 'snapshots'),
    });
    const approved = await preflight.check({ workspaceId: workspace.id, config });
    expect(approved.status).toBe('ready');
    if (approved.status !== 'ready') throw new Error('test setup: offline model preflight blocked');

    const firstScheduledAt = Date.parse('2026-05-05T01:00:00.000Z');
    const created = store.schedules.create({
      workspaceId: workspace.id,
      config,
      createdAt: wallNow,
      activation: {
        enabledAt: wallNow,
        capabilityFingerprint: approved.fingerprint,
        nextScheduledAt: firstScheduledAt,
      },
    });
    const scheduleId = created.schedule.id;

    const sourceService = new ScheduleSourceService(
      store,
      new ScheduleDirectorySourcesService(store, inputSnapshots),
      new ScheduleKnowledgeSourcesService(vault),
      inputSnapshots,
      { now: clock.wall },
    );
    const outputService = new ScheduleOutputService(store, { now: clock.wall });
    const outcomeService = new ScheduleOutcomeService(store, outputService, { now: clock.wall });
    const embedding = {
      defaultSnapshot: () => {
        throw new Error('six period offline journey must not call an embedding provider');
      },
      snapshotOf: () => {
        throw new Error('six period offline journey must not call an embedding provider');
      },
      embed: async () => {
        throw new Error('six period offline journey must not call an embedding provider');
      },
    };
    const knowledgeSearch = new KnowledgeSearchService({
      vault,
      index: vault.index,
      runMaterials: (runId) =>
        (store.runContextSnapshots.get(runId)?.materials ?? []).flatMap((material) =>
          material.reference.kind === 'knowledge-revision' ? [material.reference] : [],
        ),
      embedding,
    });
    const focusedWindow = {
      isDestroyed: () => false,
      isFocused: () => true,
      webContents: { send: () => undefined },
    } as unknown as BrowserWindow;
    const notifications = new NotificationService(store.notifications, () => focusedWindow);
    const runs = new RunService({
      store,
      knowledgeVault: vault,
      notifications,
      skillService,
      getWindow: () => null,
      inputSnapshots,
      taskMaterials,
      knowledgeSearchService: knowledgeSearch,
      onScheduledRunTerminal: (runId) => outcomeService.finalizeRun(runId).then(() => undefined),
    });
    const execution = new ScheduleExecutionService(store, { now: clock.wall });
    const dispatch = new ScheduleDispatchService(store, sourceService, preflight, execution, runs, {
      now: clock.wall,
      preparationTimeoutMs: 5_000,
    });
    const schedulerErrors: unknown[] = [];
    const scheduler = new ScheduleScheduler(store, {
      wallClock: clock.wall,
      monotonicClock: clock.monotonic,
      dispatch: (occurrence, context) => dispatch.dispatch(occurrence, context.signal),
      onError: (error) => schedulerErrors.push(error),
    });

    const requests: ProviderRequest[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(loopbackTarget(input)).toBe(MODEL_ENDPOINT);
      const activeRun = store.runs.list().find((run) => run.status === 'running');
      if (!activeRun) throw new Error('fake Provider request does not belong to a running Run');
      const messages = getMessages(init);
      requests.push({ runId: activeRun.id, messages });
      const references =
        store.runContextSnapshots
          .get(activeRun.id)
          ?.materials.map((material) => material.reference) ?? [];
      const readTools = references.flatMap((reference): ProviderToolCall[] => {
        if (reference.kind === 'workspace-input-snapshot') {
          const filePath = fileMaterialPath(store, reference);
          if (!filePath) throw new Error('fake Provider received a missing file snapshot');
          return [{ name: 'read_text_file', arguments: { path: filePath } }];
        }
        if (reference.kind === 'knowledge-revision') {
          return [{ name: 'read_knowledge', arguments: { reference } }];
        }
        return [];
      });
      const toolMessageCount = messages.filter((message) => message.role === 'tool').length;
      if (readTools.length > 0 && toolMessageCount === 0) {
        return toolResponse(activeRun.id, readTools);
      }
      if (readTools.length > 0 && toolMessageCount === readTools.length) {
        return toolResponse(activeRun.id, [
          {
            name: 'artifact_declare_sources',
            arguments: {
              inputRelations: references.map((input) => ({ input, relation: 'comparison' })),
            },
          },
        ]);
      }
      if (readTools.length > 0 && toolMessageCount !== readTools.length + 1) {
        throw new Error(
          `unexpected tool response count for ${activeRun.id}: ${String(toolMessageCount)}`,
        );
      }

      const task = store.tasks.getSummary(activeRun.taskId);
      const label = task ? periodFromTask(task.title) : undefined;
      const hasAprilData = references.some(
        (reference) =>
          reference.kind === 'workspace-input-snapshot' &&
          fileMaterialPath(store, reference)?.includes('2026年4月经营数据.md'),
      );
      if (label === '2026年4月' && !hasAprilData) {
        return finalResponse(
          '# 2026年4月经营分析\n\n材料未提供 2026 年 4 月当前数据，请在人继续协作时补充。\n',
        );
      }
      const receivedToolText = messages
        .filter((message) => message.role === 'tool')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n');
      const period = label ?? '普通人工任务';
      const digest = createHash('sha256')
        .update(JSON.stringify(references))
        .digest('hex')
        .slice(0, 16);
      return finalResponse(
        `# ${period}经营分析\n\n离线合成成果；本次读取 ${String(references.length)} 项固定来源，材料集合摘要 ${digest}。\n\n补充核对：${receivedToolText.includes('DIRECTORY-POLICY') ? '已包含本期目录口径读取回执。' : '未读取目录口径。'}\n`,
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const waitForOccurrence = async (occurrenceId: string): Promise<ScheduleOccurrence> => {
      await waitFor(
        () => store.scheduleOccurrences.get(occurrenceId)?.phase === 'closed',
        `Schedule occurrence did not close: ${occurrenceId}`,
      );
      const occurrence = store.scheduleOccurrences.get(occurrenceId);
      if (!occurrence) throw new Error(`Schedule occurrence disappeared: ${occurrenceId}`);
      const runId = occurrence.firstRunId;
      if (runId) {
        await waitFor(
          () => store.runs.get(runId)?.status !== 'running',
          `Scheduled Run did not reach a terminal state: ${runId}`,
        );
      }
      return occurrence;
    };

    const waitForManualRun = async (runId: string): Promise<void> => {
      await waitFor(
        () => store.runs.get(runId)?.status !== 'running',
        `Manual Run did not reach a terminal state: ${runId}`,
      );
      expect(store.runs.get(runId)?.status).toBe('completed');
    };

    const runScheduledAt = async (scheduledAt: number): Promise<ScheduleOccurrence> => {
      clock.advanceTo(scheduledAt);
      await scheduler.tick();
      await scheduler.waitForPreparations();
      const occurrencePage = store.scheduleOccurrences.listBySchedule({
        scheduleId,
        limit: 100,
      });
      const occurrence = occurrencePage.items.find((item) => item.scheduledAt === scheduledAt);
      if (!occurrence)
        throw new Error(`Scheduler did not claim ${new Date(scheduledAt).toISOString()}`);
      return waitForOccurrence(occurrence.id);
    };

    const proveSuccessfulOccurrence = async (
      occurrence: ScheduleOccurrence,
      expectedLabel: string,
      expectedTrigger: ScheduleOccurrence['trigger'] = 'scheduled',
    ): Promise<{ runId: string; versionId: string; outputPath: string; outputBytes: Buffer }> => {
      expect(occurrence).toMatchObject({
        trigger: expectedTrigger,
        phase: 'closed',
        period: { label: expectedLabel },
      });
      expect(occurrence.preparationOutcome).toBeUndefined();
      const runId = occurrence.firstRunId;
      const taskId = occurrence.taskId;
      if (!runId || !taskId || !occurrence.sourceSnapshotId) {
        throw new Error('completed occurrence is missing Task, Run, or source snapshot');
      }
      const run = store.runs.get(runId);
      const task = store.tasks.getSummary(taskId);
      const snapshot = store.runContextSnapshots.get(runId);
      expect(run).toMatchObject({ status: 'completed', taskId, sessionId: occurrence.sessionId });
      expect(task?.workspaceId).toBe(workspace.id);
      expect(snapshot?.scheduleSourceSnapshotId).toBe(occurrence.sourceSnapshotId);
      expect(snapshot?.materials.length).toBeGreaterThan(0);
      const materialReads = store.materialReads.listByRun(runId);
      const fixedReferences = snapshot?.materials.map((material) => material.reference) ?? [];
      for (const reference of fixedReferences) {
        expect(materialReads).toContainEqual(
          expect.objectContaining({ material: reference, operation: 'read' }),
        );
      }
      const runRequests = requests.filter((request) => request.runId === runId);
      expect(runRequests.length).toBeGreaterThanOrEqual(3);
      const serializedFirstRequest = JSON.stringify(runRequests[0]?.messages ?? []);
      expect(serializedFirstRequest).toContain(expectedLabel);
      const finalToolMessages = runRequests.at(-1)?.messages ?? [];
      const actualProviderReads = finalToolMessages
        .filter((message) => message.role === 'tool')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('\n');
      for (const reference of fixedReferences) {
        if (reference.kind === 'workspace-input-snapshot') {
          const snapshotFile = store.inputSnapshots.get(reference.snapshotId);
          if (!snapshotFile)
            throw new Error(`Run snapshot input is missing: ${reference.snapshotId}`);
          expect(JSON.stringify(runRequests[0]?.messages ?? [])).toContain(snapshotFile.sourcePath);
          const bytes = await readFile(inputSnapshots.resolvePath(snapshotFile));
          if (bytes.byteLength > 0) {
            expect(actualProviderReads).toContain(
              JSON.stringify(bytes.toString('utf8')).slice(1, -1),
            );
          }
        } else if (reference.kind === 'knowledge-revision') {
          expect(JSON.stringify(runRequests[0]?.messages ?? [])).toContain(
            reference.knowledgeRevisionId,
          );
          const revision = vault.getRevision(reference.knowledgeRevisionId);
          expect(revision).toBeDefined();
          if (revision) {
            expect(actualProviderReads).toContain(JSON.stringify(revision.content).slice(1, -1));
          }
        }
      }
      expect(store.runs.listEvents(runId).some((event) => event.type === 'tool.completed')).toBe(
        true,
      );

      const artifacts = store.artifacts.list(taskId);
      const artifactVersions = artifacts.flatMap((artifact) =>
        store.artifacts.listVersions(artifact.id),
      );
      const version = artifactVersions.find(
        (item) => item.sourceRunId === runId && item.origin === 'assistant-run',
      );
      if (!version) throw new Error(`Run did not register its own ArtifactVersion: ${runId}`);
      expect(store.artifactInputRelations.listByVersion(version.id).length).toBe(
        fixedReferences.length,
      );
      const detail = store.artifacts.getVersionDetail(version.id);
      if (!detail || detail.type !== 'markdown')
        throw new Error('Markdown ArtifactVersion is unavailable');
      const receipts = store.scheduleOutputs.listByOccurrence(occurrence.id);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ status: 'saved', artifactVersionId: version.id });
      const outputPath = path.join(workspaceRoot, receipts[0]?.relativePath ?? '');
      const outputBytes = await readFile(outputPath);
      expect(createHash('sha256').update(outputBytes).digest('hex')).toBe(receipts[0]?.contentHash);
      expect(outputBytes.toString('utf8')).toBe(detail.content);
      expect(receipts[0]?.relativePath).toContain('定时成果/');
      return { runId, versionId: version.id, outputPath, outputBytes };
    };

    const dueTimes = [
      '2026-05-05T01:00:00.000Z',
      '2026-06-05T01:00:00.000Z',
      '2026-07-05T01:00:00.000Z',
      '2026-08-05T01:00:00.000Z',
      '2026-09-05T01:00:00.000Z',
      '2026-10-05T01:00:00.000Z',
    ].map((value) => Date.parse(value));
    const automaticResults: Array<{
      occurrence: ScheduleOccurrence;
      runId: string;
      versionId: string;
      outputPath: string;
      outputBytes: Buffer;
    }> = [];

    const april = await runScheduledAt(dueTimes[0] ?? firstScheduledAt);
    expect(april.period.label).toBe('2026年4月');
    const aprilRunId = april.firstRunId;
    const aprilTaskId = april.taskId;
    if (!aprilRunId || !aprilTaskId || !april.sourceSnapshotId) {
      throw new Error('April scheduled draft is missing its Run, Task, or snapshot');
    }
    expect(store.runs.get(aprilRunId)?.status).toBe('completed');
    const aprilRunRequest = requests.filter((request) => request.runId === aprilRunId).at(-1);
    expect(JSON.stringify(aprilRunRequest?.messages ?? [])).not.toContain('2026年4月经营数据.md');
    const aprilVersion = store.artifacts
      .list(aprilTaskId)
      .flatMap((artifact) => store.artifacts.listVersions(artifact.id))
      .find((version) => version.sourceRunId === aprilRunId);
    if (!aprilVersion)
      throw new Error('April missing-material response did not preserve its ArtifactVersion');
    const aprilReceipt = store.scheduleOutputs.listByOccurrence(april.id)[0];
    if (!aprilReceipt) throw new Error('April initial output receipt is missing');
    const aprilBytesBeforeHumanContinuation = await readFile(
      path.join(workspaceRoot, aprilReceipt.relativePath),
    );
    expect(aprilBytesBeforeHumanContinuation.toString('utf8')).toContain('材料未提供');

    const aprilDataPath = path.join(workspaceRoot, '2026年4月经营数据.md');
    const aprilDataText = '# 2026 年 4 月经营数据\n\nCURRENT-DATA-APRIL：回款 104 万元。';
    await writeFile(aprilDataPath, aprilDataText, 'utf8');
    const aprilSupplement = await inputSnapshots.create({
      workspaceId: workspace.id,
      workspaceRoot,
      sourcePath: aprilDataPath,
    });
    const aprilContext = store.taskContexts.getLatest(aprilTaskId);
    if (!aprilContext) throw new Error('April original TaskContext is missing');
    const aprilSupplementSelection: TaskMaterialSelection = {
      reference: {
        kind: 'workspace-input-snapshot',
        snapshotId: aprilSupplement.snapshot.id,
        workspaceId: workspace.id,
        contentHash: aprilSupplement.snapshot.contentHash,
        format: aprilSupplement.snapshot.format,
        fileKey: aprilSupplement.snapshot.fileKey,
      },
      purpose: 'current-input',
      addedFrom: 'user-input',
    };
    const supplementedContext = store.taskContexts.save(
      aprilTaskId,
      {
        executor: aprilContext.executor,
        skillBindings: aprilContext.skillBindings,
        ...(aprilContext.modelReference === undefined
          ? {}
          : { modelReference: aprilContext.modelReference }),
        ...(aprilContext.builtinToolPolicy === undefined
          ? {}
          : { builtinToolPolicy: aprilContext.builtinToolPolicy }),
        materials: [aprilSupplementSelection],
        ...(aprilContext.excludedMemoryIds === undefined
          ? {}
          : { excludedMemoryIds: aprilContext.excludedMemoryIds }),
        ...(aprilContext.mcpToolBindings === undefined
          ? {}
          : { mcpToolBindings: aprilContext.mcpToolBindings }),
        scheduleSourceSnapshotId: april.sourceSnapshotId,
      },
      aprilContext.revision,
    );
    expect(supplementedContext.scheduleSourceSnapshotId).toBe(april.sourceSnapshotId);
    const continuationRunId = runs.start({
      taskId: aprilTaskId,
      sessionId: april.sessionId ?? '',
      prompt: '已补充 2026 年 4 月当前数据，请在原任务继续生成 Markdown 分析。',
      taskContextRevisionId: supplementedContext.id,
      expectedTaskContextRevision: supplementedContext.revision,
    });
    await waitForManualRun(continuationRunId);
    const continuation = store.runs.get(continuationRunId);
    expect(continuation).toMatchObject({ taskId: aprilTaskId, sessionId: april.sessionId });
    expect(store.scheduleOccurrences.get(april.id)?.firstRunId).toBe(aprilRunId);
    const continuationVersion = store.artifacts
      .list(aprilTaskId)
      .flatMap((artifact) => store.artifacts.listVersions(artifact.id))
      .find((version) => version.sourceRunId === continuationRunId);
    if (!continuationVersion)
      throw new Error('manual continuation did not register a new ArtifactVersion');
    expect(continuationVersion.id).not.toBe(aprilVersion.id);
    expect(store.scheduleOutputs.listByOccurrence(april.id)[0]?.artifactVersionId).toBe(
      aprilVersion.id,
    );
    expect(await readFile(path.join(workspaceRoot, aprilReceipt.relativePath))).toEqual(
      aprilBytesBeforeHumanContinuation,
    );
    expect(
      requests
        .filter((request) => request.runId === continuationRunId)
        .some((request) => JSON.stringify(request.messages).includes('CURRENT-DATA-APRIL')),
    ).toBe(true);
    const aprilProof = await proveSuccessfulOccurrence(april, '2026年4月');
    automaticResults.push({ occurrence: april, ...aprilProof });

    await rm(path.join(workspaceRoot, '已删除的旧目录事实.md'));
    const policyPath = policyDoc.path;
    await writeFile(
      policyPath,
      '# 经营分析口径\n\nPOLICY-REVISION-2：按实际到账并标出退款。',
      'utf8',
    );
    const policyRefresh = await vault.refreshDocument(policyDoc.id);
    if (!('refreshed' in policyRefresh) || !policyRefresh.refreshed) {
      throw new Error('Knowledge source refresh did not register the changed policy revision');
    }
    expect(policyRefresh.refreshed.contentHash).not.toBe(policyRevision1.contentHash);
    const policyRevision2 = vault.currentRevisionOf(policyDoc.id);
    expect(policyRevision2?.content).toContain('POLICY-REVISION-2');
    setMembership(removableDoc.id, []);
    await writeFile(
      path.join(workspaceRoot, '工作口径.md'),
      '# 工作口径\n\nDIRECTORY-POLICY-REVISION-2：退款单独列示。',
      'utf8',
    );
    await writeFile(
      path.join(workspaceRoot, '2026年5月经营数据.md'),
      '# 2026 年 5 月经营数据\n\nCURRENT-DATA-MAY：回款 120 万元。',
      'utf8',
    );
    const may = await runScheduledAt(dueTimes[1] ?? Date.parse('2026-06-05T01:00:00.000Z'));
    const mayProof = await proveSuccessfulOccurrence(may, '2026年5月');
    automaticResults.push({ occurrence: may, ...mayProof });
    const maySnapshotItems = store.scheduleSources.listItems({
      occurrenceId: may.id,
      limit: 100,
    }).items;
    expect(
      maySnapshotItems.some(
        (item) =>
          item.reference.kind === 'knowledge-revision' &&
          item.reference.knowledgeDocumentId === removableDoc.id,
      ),
    ).toBe(false);
    expect(
      maySnapshotItems.some(
        (item) =>
          item.reference.kind === 'workspace-input-snapshot' &&
          fileMaterialPath(store, item.reference)?.includes('已删除的旧目录事实.md'),
      ),
    ).toBe(false);
    const mayPolicy = maySnapshotItems.find(
      (item) =>
        item.reference.kind === 'knowledge-revision' &&
        item.reference.knowledgeDocumentId === policyDoc.id,
    );
    expect(mayPolicy?.reference).toMatchObject({
      kind: 'knowledge-revision',
      knowledgeRevisionId: expect.not.stringMatching(policyRevision1.id),
    });
    expect(
      requests
        .filter((request) => request.runId === mayProof.runId)
        .some((request) => JSON.stringify(request.messages).includes('POLICY-REVISION-2')),
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.runId === mayProof.runId)
        .some((request) => JSON.stringify(request.messages).includes('QUARTER-HISTORY-Q1')),
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.runId === mayProof.runId)
        .some((request) => JSON.stringify(request.messages).includes('REMOVED-COLLECTION-MEMBER')),
    ).toBe(false);

    await writeFile(
      path.join(workspaceRoot, '工作口径.md'),
      '# 工作口径\n\nDIRECTORY-POLICY-REVISION-3：仍按退款单列。',
      'utf8',
    );
    await writeFile(
      path.join(workspaceRoot, '2026年6月经营数据.md'),
      '# 2026 年 6 月经营数据\n\nCURRENT-DATA-JUNE：回款 132 万元。',
      'utf8',
    );
    const june = await runScheduledAt(dueTimes[2] ?? Date.parse('2026-07-05T01:00:00.000Z'));
    const juneProof = await proveSuccessfulOccurrence(june, '2026年6月');
    automaticResults.push({ occurrence: june, ...juneProof });
    expect(
      requests
        .filter((request) => request.runId === juneProof.runId)
        .some((request) =>
          JSON.stringify(request.messages).includes('DIRECTORY-POLICY-REVISION-3'),
        ),
    ).toBe(true);
    const aprilItemsAfterChanges = store.scheduleSources.listItems({
      occurrenceId: april.id,
      limit: 100,
    }).items;
    expect(aprilItemsAfterChanges.map((item) => item.reference)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'knowledge-revision',
          knowledgeRevisionId: policyRevision1.id,
        }),
      ]),
    );
    const aprilDirectoryPolicy = aprilItemsAfterChanges.find(
      (item) =>
        item.reference.kind === 'workspace-input-snapshot' &&
        fileMaterialPath(store, item.reference) === '工作口径.md',
    );
    if (
      !aprilDirectoryPolicy ||
      aprilDirectoryPolicy.reference.kind !== 'workspace-input-snapshot'
    ) {
      throw new Error('April immutable source snapshot is missing its directory policy');
    }
    const aprilDirectoryPolicySnapshot = store.inputSnapshots.get(
      aprilDirectoryPolicy.reference.snapshotId,
    );
    if (!aprilDirectoryPolicySnapshot)
      throw new Error('April directory policy snapshot disappeared');
    const aprilDirectoryPolicyBytes = await readFile(
      inputSnapshots.resolvePath(aprilDirectoryPolicySnapshot),
    );
    expect(aprilDirectoryPolicyBytes.toString('utf8')).toContain('DIRECTORY-POLICY-REVISION-1');
    expect(aprilDirectoryPolicyBytes.toString('utf8')).not.toContain('DIRECTORY-POLICY-REVISION-3');

    const halfYearDoc = await importKnowledge(
      '2026年上半年经营回顾.md',
      '# 上半年历史回顾\n\nHALF-YEAR-HISTORY-H1：上半年回款 680 万元。',
    );
    setMembership(halfYearDoc.id, [collection.id]);
    await writeFile(
      path.join(workspaceRoot, '2026年7月经营数据.md'),
      '# 2026 年 7 月经营数据\n\nCURRENT-DATA-JULY：回款 151 万元。',
      'utf8',
    );
    const julyDue = dueTimes[3] ?? Date.parse('2026-08-05T01:00:00.000Z');
    const missedCutoff = julyDue + 60_001;
    clock.advanceTo(missedCutoff);
    const recovered = await scheduler.recover({ batchKey: 'six-period-july-missed' });
    expect(recovered?.phase).toBe('completed');
    const missed = store.scheduleOccurrences
      .listBySchedule({ scheduleId, limit: 100 })
      .items.find((item) => item.scheduledAt === julyDue);
    expect(missed).toMatchObject({
      trigger: 'scheduled',
      phase: 'closed',
      preparationOutcome: 'missed',
      period: { label: '2026年7月' },
    });
    if (!missed) throw new Error('July missed occurrence was not recorded');
    expect(missed.taskId).toBeUndefined();
    expect(missed.firstRunId).toBeUndefined();
    const currentSchedule = store.schedules.get(scheduleId);
    if (!currentSchedule) throw new Error('Schedule disappeared before manual missed retry');
    const retry = store.scheduleOccurrences.claimManual({
      scheduleId,
      expectedRevision: currentSchedule.schedule.revision,
      trigger: 'manual-missed',
      requestKey: randomUUID(),
      requestedAt: missedCutoff,
      originalOccurrenceId: missed.id,
    });
    if (retry.kind !== 'created') throw new Error('July manual missed retry was not created');
    await dispatch.prepareAndStart(retry.occurrence.id, undefined, approved.fingerprint);
    await dispatch.waitForPreparations();
    const july = await waitForOccurrence(retry.occurrence.id);
    const julyProof = await proveSuccessfulOccurrence(july, '2026年7月', 'manual-missed');
    automaticResults.push({ occurrence: july, ...julyProof });
    expect(july).toMatchObject({ trigger: 'manual-missed', originalOccurrenceId: missed.id });
    expect(july.scheduledAt).toBeUndefined();
    expect(
      requests
        .filter((request) => request.runId === julyProof.runId)
        .some((request) => JSON.stringify(request.messages).includes('QUARTER-HISTORY-Q1')),
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.runId === julyProof.runId)
        .some((request) => JSON.stringify(request.messages).includes('HALF-YEAR-HISTORY-H1')),
    ).toBe(true);

    await writeFile(
      path.join(workspaceRoot, '2026年8月经营数据.md'),
      '# 2026 年 8 月经营数据\n\nCURRENT-DATA-AUGUST：回款 161 万元。',
      'utf8',
    );
    const august = await runScheduledAt(dueTimes[4] ?? Date.parse('2026-09-05T01:00:00.000Z'));
    const augustProof = await proveSuccessfulOccurrence(august, '2026年8月');
    automaticResults.push({ occurrence: august, ...augustProof });
    await writeFile(
      path.join(workspaceRoot, '2026年9月经营数据.md'),
      '# 2026 年 9 月经营数据\n\nCURRENT-DATA-SEPTEMBER：回款 176 万元。',
      'utf8',
    );
    const september = await runScheduledAt(dueTimes[5] ?? Date.parse('2026-10-05T01:00:00.000Z'));
    const septemberProof = await proveSuccessfulOccurrence(september, '2026年9月');
    automaticResults.push({ occurrence: september, ...septemberProof });

    expect(automaticResults).toHaveLength(6);
    expect(automaticResults.map((result) => result.occurrence.period.label)).toEqual(PERIOD_LABELS);
    expect(new Set(automaticResults.map((result) => result.occurrence.id)).size).toBe(6);
    expect(new Set(automaticResults.map((result) => result.occurrence.sourceSnapshotId)).size).toBe(
      6,
    );
    expect(new Set(automaticResults.map((result) => result.runId)).size).toBe(6);
    expect(new Set(automaticResults.map((result) => result.versionId)).size).toBe(6);
    expect(new Set(automaticResults.map((result) => result.outputPath)).size).toBe(6);
    const outputDirectory = path.join(workspaceRoot, '定时成果');
    expect(new Set(automaticResults.map((result) => path.dirname(result.outputPath)))).toEqual(
      new Set([outputDirectory]),
    );
    expect((await readdir(outputDirectory)).sort()).toEqual(
      automaticResults.map((result) => path.basename(result.outputPath)).sort(),
    );
    expect(automaticResults.map((result) => result.occurrence.taskId).every(Boolean)).toBe(true);
    expect(automaticResults.map((result) => result.occurrence.sessionId).every(Boolean)).toBe(true);
    const scheduledTaskIds = automaticResults.map((result) => result.occurrence.taskId ?? '');
    const scheduledSessionIds = automaticResults.map((result) => result.occurrence.sessionId ?? '');
    expect(new Set(scheduledTaskIds).size).toBe(6);
    expect(new Set(scheduledSessionIds).size).toBe(6);
    expect(
      automaticResults.every(
        (result) => store.tasks.getWorkspaceId(result.occurrence.taskId ?? '') === workspace.id,
      ),
    ).toBe(true);
    expect(schedulerErrors).toEqual([]);

    const ordinaryTask = store.tasks.create(
      workspace.id,
      '普通人工任务',
      '验证普通人工任务能力没有被定时执行改变。',
    );
    store.taskContinuity.initializeFromTaskGoal(ordinaryTask.task.id);
    const ordinaryContext = store.taskContexts.save(ordinaryTask.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: [] },
    });
    const ordinaryRunId = runs.start({
      taskId: ordinaryTask.task.id,
      sessionId: ordinaryTask.sessionId,
      prompt: '生成 Markdown（.md）普通人工任务结果。',
      taskContextRevisionId: ordinaryContext.id,
      expectedTaskContextRevision: ordinaryContext.revision,
    });
    await waitForManualRun(ordinaryRunId);
    expect(store.scheduleOccurrences.findByFirstRunId(ordinaryRunId)).toBeUndefined();
    expect(
      store.artifacts
        .list(ordinaryTask.task.id)
        .flatMap((artifact) => store.artifacts.listVersions(artifact.id)),
    ).toContainEqual(
      expect.objectContaining({
        sourceRunId: ordinaryRunId,
        origin: 'assistant-run',
        type: 'markdown',
      }),
    );

    const allOccurrenceRuns = store.scheduleOccurrences
      .listBySchedule({ scheduleId, limit: 100 })
      .items.flatMap((occurrence) => (occurrence.firstRunId ? [occurrence.firstRunId] : []));
    expect(allOccurrenceRuns).not.toContain(continuationRunId);
    expect(fetchMock).toHaveBeenCalled();
  });
});
