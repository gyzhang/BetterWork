import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { abortError, FakeModelProvider } from '@betterwork/agent-core';
import type {
  AgentMessage,
  ExpertRevisionDraft,
  MaterialReference,
  MemoryRecord,
  MemoryScope,
  RuntimeProfileDraft,
  ScheduleConfigDraft,
  ScheduleSourceItem,
} from '@betterwork/agent-protocol';
import { countCodePoints, IpcChannel } from '@betterwork/agent-protocol';
import type { WebFetch } from '@betterwork/tool-runtime';
import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfficeParserService } from '../infrastructure/office-parser';
import type { ProcessSupervisor } from '../infrastructure/process-supervisor';
import { AppStore } from '../persistence';
import { scheduleSourceManifestHash } from '../persistence/schedule-source-repository';
import type { CredentialResolver } from './credential-access';
import { InputSnapshotService } from './input-snapshot-service';
import type { DocumentExtractor } from './knowledge-extract';
import { KnowledgeSearchService } from './knowledge-search';
import { KnowledgeVault } from './knowledge-vault';
import { McpClientService } from './mcp-client-service';
import { mcpModelAlias } from './mcp-tool-contract';
import { MemoryService } from './memory-service';
import { NotificationService } from './notification-service';
import { createRunTools, RunService } from './run-service';
import { ScheduleExecutionService } from './schedule-execution-service';
import { computeDependencyFingerprint } from './skill-dependency-service';
import { SkillExecutionService } from './skill-execution-service';
import { SkillService } from './skill-service';
import { TaskMaterialService } from './task-material-service';

const temporaryDirectories: string[] = [];
const openStores: AppStore[] = [];
const openVaults: KnowledgeVault[] = [];
const mcpFixturePath = path.resolve(
  process.cwd(),
  'scripts/fixtures/mcp-finance-readonly-server.mjs',
);

const sseResponse = (...payloads: string[]): Response =>
  new Response(
    `${payloads
      .map(
        (payload) => `data: ${payload}

`,
      )
      .join('')}data: [DONE]

`,
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const vault of openVaults.splice(0)) vault.close();
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface WindowStub {
  sent: Array<{ channel: string; type: string }>;
  runEventTypes: () => string[];
  notificationEventTypes: () => string[];
  asBrowserWindow: BrowserWindow;
}

const createWindowStub = (options?: { focused?: boolean }): WindowStub => {
  const sent: Array<{ channel: string; type: string }> = [];
  const stub = {
    isDestroyed: () => false,
    isFocused: () => options?.focused ?? true,
    webContents: {
      send: (channel: string, event: { type: string }) => {
        sent.push({ channel, type: event.type });
      },
    },
  };
  const typesOn = (channel: string): string[] =>
    sent.filter((item) => item.channel === channel).map((item) => item.type);
  return {
    sent,
    runEventTypes: () => typesOn(IpcChannel.RunEvent),
    notificationEventTypes: () => typesOn(IpcChannel.NotificationChangeEvent),
    asBrowserWindow: stub as unknown as BrowserWindow,
  };
};

interface Fixture {
  directory: string;
  store: AppStore;
  vault: KnowledgeVault;
  skillService: SkillService;
  inputSnapshots: InputSnapshotService;
  taskMaterials: TaskMaterialService;
  memories: MemoryService;
  taskId: string;
  sessionId: string;
}

/**
 * 外键约束开启后，Run 必须挂在真实存在的 Task 与 Session 上，
 * 因此夹具要走完整链路建库，不能再塞伪造的 id。
 */
const createFixture = async (): Promise<Fixture> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-run-'));
  temporaryDirectories.push(directory);
  const store = AppStore.open(':memory:');
  openStores.push(store);
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  openVaults.push(vault);
  const inputSnapshots = new InputSnapshotService(store, directory);
  const taskMaterials = new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots });
  const memories = new MemoryService(store, directory);
  const skillService = new SkillService(store, {
    developmentBuiltinRoot: path.join(directory, 'builtin-dev'),
    installedBuiltinRoot: path.join(directory, 'builtin-installed'),
    userRoot: path.join(directory, 'skills'),
  });

  const workspace = store.workspaces.getOrCreate(directory, path.basename(directory));
  const created = store.tasks.create(workspace.id, '测试任务', '用于运行编排测试');
  store.taskContinuity.initializeFromTaskGoal(created.task.id);
  return {
    directory,
    store,
    vault,
    skillService,
    inputSnapshots,
    taskMaterials,
    memories,
    taskId: created.task.id,
    sessionId: created.sessionId,
  };
};

const testExpertRevision = (): ExpertRevisionDraft => ({
  name: 'Run 材料测试专家',
  summary: '核对定时来源材料的读取范围',
  author: '',
  tags: [],
  identity: '只读取本期固定材料。',
  principles: [],
  inputRequirements: [],
  deliveryRequirements: ['说明材料依据'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

const createScheduleConfig = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: 'Run 有效材料测试规则',
  expertId,
  expertRevisionId,
  requirements: '读取本期固定材料并完成检查。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'none',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const createScheduledContext = (
  fixture: Fixture,
  references: readonly MaterialReference[],
  supplements: NonNullable<Parameters<AppStore['taskContexts']['save']>[1]['materials']> = [],
) => {
  const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
  if (!workspaceId) throw new Error('workspace missing');
  const expert = fixture.store.experts.create({
    sourceKind: 'user',
    revision: testExpertRevision(),
  });
  const schedule = fixture.store.schedules.create({
    workspaceId,
    config: createScheduleConfig(expert.id, expert.revision.id),
    createdAt: 1,
  });
  const claimed = fixture.store.scheduleOccurrences.claimManual({
    scheduleId: schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: randomUUID(),
    requestedAt: 2,
    period: { rule: 'none', timeZone: 'UTC', anchorAt: 2, label: '无期间' },
  });
  if (claimed.kind !== 'created') throw new Error('schedule occurrence was not created');
  const source = fixture.store.scheduleSources.createPreparing({
    occurrenceId: claimed.occurrence.id,
    evaluatedAt: 3,
    createdAt: 3,
  });
  const sourceItems: ScheduleSourceItem[] = references.map((reference, ordinal) => ({
    snapshotId: source.id,
    ordinal,
    reference,
    purpose: 'current-input',
    origin: 'workspace-directory',
    displayName:
      reference.kind === 'workspace-input-snapshot'
        ? (fixture.store.inputSnapshots.get(reference.snapshotId)?.sourcePath ?? reference.fileKey)
        : `固定来源 ${ordinal + 1}`,
  }));
  const totalFileBytes = references.reduce((total, reference) => {
    if (reference.kind !== 'workspace-input-snapshot') return total;
    return total + (fixture.store.inputSnapshots.get(reference.snapshotId)?.byteSize ?? 0);
  }, 0);
  fixture.store.scheduleSources.publishReady({
    snapshotId: source.id,
    items: sourceItems,
    totalFileBytes,
    manifestHash: scheduleSourceManifestHash(sourceItems),
    completedAt: 4,
  });
  fixture.store.scheduleOccurrences.attachSourceSnapshot(claimed.occurrence.id, source.id);
  const db = (fixture.store as unknown as { db: Database.Database }).db;
  db.prepare(
    `UPDATE schedule_occurrences
     SET task_id = ?, session_id = ?, prepared_at = ? WHERE id = ?`,
  ).run(fixture.taskId, fixture.sessionId, 5, claimed.occurrence.id);
  const context = fixture.store.taskContexts.save(fixture.taskId, {
    executor: { kind: 'general' },
    skillBindings: [],
    builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
    materials: supplements,
    scheduleSourceSnapshotId: source.id,
  });
  return { context, source, schedule: schedule.schedule, occurrence: claimed.occurrence };
};

const createPreparedScheduleDraft = (fixture: Fixture) => {
  const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
  if (!workspaceId) throw new Error('workspace missing');
  const expert = fixture.store.experts.create({
    sourceKind: 'user',
    revision: testExpertRevision(),
  });
  const schedule = fixture.store.schedules.create({
    workspaceId,
    config: createScheduleConfig(expert.id, expert.revision.id),
    createdAt: 1,
  });
  const claimed = fixture.store.scheduleOccurrences.claimManual({
    scheduleId: schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: randomUUID(),
    requestedAt: 2,
    period: { rule: 'none', timeZone: 'UTC', anchorAt: 2, label: '无期间' },
  });
  if (claimed.kind !== 'created') throw new Error('schedule occurrence was not created');
  const source = fixture.store.scheduleSources.createPreparing({
    occurrenceId: claimed.occurrence.id,
    evaluatedAt: 3,
    createdAt: 3,
  });
  fixture.store.scheduleSources.publishReady({
    snapshotId: source.id,
    items: [],
    totalFileBytes: 0,
    manifestHash: scheduleSourceManifestHash([]),
    completedAt: 4,
  });
  fixture.store.scheduleOccurrences.attachSourceSnapshot(claimed.occurrence.id, source.id);
  const service = new ScheduleExecutionService(fixture.store, { now: () => 5 });
  const draft = service.prepareTaskDraft(claimed.occurrence.id);
  return { service, draft, occurrence: claimed.occurrence };
};

const createService = (
  fixture: Fixture,
  window?: WindowStub,
  skillExecutionService?: SkillExecutionService,
  webFetch?: WebFetch,
  officeParser?: OfficeParserService,
  mcpClientService?: McpClientService,
  credentialAccess?: CredentialResolver,
  documentExtractor?: DocumentExtractor,
  onScheduledRunTerminal?: (runId: string) => Promise<unknown>,
): RunService =>
  new RunService(
    fixture.store,
    fixture.vault,
    new NotificationService(fixture.store.notifications, () => window?.asBrowserWindow ?? null),
    fixture.skillService,
    () => window?.asBrowserWindow ?? null,
    skillExecutionService,
    undefined,
    undefined,
    undefined,
    fixture.inputSnapshots,
    fixture.taskMaterials,
    undefined,
    mcpClientService,
    webFetch,
    officeParser,
    credentialAccess,
    new KnowledgeSearchService({
      vault: fixture.vault,
      index: fixture.vault.index,
      // Run 材料只信宿主快照，与 main/index 生产接线一致。
      runMaterials: (runId) =>
        (fixture.store.runContextSnapshots.get(runId)?.materials ?? []).flatMap((material) =>
          material.reference.kind === 'knowledge-revision' ? [material.reference] : [],
        ),
      embedding: {
        defaultSnapshot: () => {
          throw new Error('Run 编排测试不应调用嵌入模型');
        },
        snapshotOf: () => {
          throw new Error('Run 编排测试不应调用嵌入模型');
        },
        embed: async () => {
          throw new Error('Run 编排测试不应调用嵌入模型');
        },
      },
    }),
    documentExtractor,
    onScheduledRunTerminal,
  );

const captureFakeProviderRequests = () => {
  const requests: AgentMessage[][] = [];
  const toolNames: string[][] = [];
  const fake = new FakeModelProvider(0);
  const originalStream = fake.stream.bind(fake);
  let shouldFailNextRequest = false;
  let nextResponse: string | undefined;
  const spy = vi.spyOn(FakeModelProvider.prototype, 'stream').mockImplementation((request) => {
    requests.push(request.messages.slice());
    toolNames.push(request.tools.map((tool) => tool.name));
    if (shouldFailNextRequest) {
      shouldFailNextRequest = false;
      return (async function* () {
        yield { type: 'text-delta' as const, delta: '' };
        throw new Error('synthetic provider connection failure');
      })();
    }
    if (nextResponse !== undefined) {
      const response = nextResponse;
      nextResponse = undefined;
      return (async function* () {
        yield { type: 'text-delta' as const, delta: response };
        yield { type: 'done' as const };
      })();
    }
    return originalStream(request);
  });
  return {
    requests,
    toolNames,
    failNextRequest: (): void => {
      shouldFailNextRequest = true;
    },
    respondNextRequest: (content: string): void => {
      nextResponse = content;
    },
    restore: (): void => spy.mockRestore(),
  };
};

const addFailedRun = (
  fixture: Fixture,
  input: {
    id: string;
    taskId: string;
    sessionId: string;
    prompt: string;
    createdAt: number;
    error?: string;
  },
): void => {
  fixture.store.runs.create({
    id: input.id,
    taskId: input.taskId,
    sessionId: input.sessionId,
    prompt: input.prompt,
    status: 'running',
    createdAt: input.createdAt,
  });
  const event = fixture.store.runs.forceFailure(
    input.id,
    input.error ?? '合成运行失败',
    input.createdAt + 1,
  );
  if (!event) throw new Error('Synthetic Run did not reach its failed terminal');
};

const continuityMessagesOf = (messages: readonly AgentMessage[]): string[] =>
  messages
    .filter(
      (message) => message.role === 'system' && message.content.startsWith('【TASK_CONTINUITY_'),
    )
    .map((message) => message.content);

const statusOf = (fixture: Fixture, runId: string): string | undefined =>
  fixture.store.runs.list().find((run) => run.id === runId)?.status;

const waitForCompletion = async (
  fixture: Fixture,
  runId: string,
  maxAttempts = 200,
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (statusOf(fixture, runId) !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Run did not complete in time');
};

const saveSingleMaterialContext = async (fixture: Fixture, content: string) => {
  const sourcePath = path.join(fixture.directory, 'selected.md');
  await writeFile(sourcePath, content);
  const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
  if (!workspaceId) throw new Error('workspace missing');
  const receipt = await fixture.inputSnapshots.create({
    workspaceId,
    workspaceRoot: fixture.directory,
    sourcePath,
  });
  return fixture.store.taskContexts.save(fixture.taskId, {
    executor: { kind: 'general' },
    skillBindings: [],
    builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
    materials: [
      {
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: receipt.snapshot.id,
          workspaceId,
          contentHash: receipt.snapshot.contentHash,
          format: receipt.snapshot.format,
          fileKey: receipt.snapshot.fileKey,
        },
        purpose: 'current-input',
        addedFrom: 'user-input',
      },
    ],
  });
};

/** 走 memory:create 的真实写入链路：confirmed 记忆必须连同 operation 回执一起落库，来源才可解析。 */
const confirmedMemory = async (
  fixture: Fixture,
  scope: MemoryScope,
  content: string,
): Promise<MemoryRecord> => {
  const receipt = await fixture.memories.create({
    operationId: randomUUID(),
    content,
    facet: 'method',
    scope,
    asUserInstruction: true,
    // §5.4：user / expert 作用域跨工作区生效，必须同时勾选通用声明。
    ...(scope.kind === 'user' || scope.kind === 'expert' ? { genericDeclaration: true } : {}),
  });
  if (!receipt.ok) throw new Error(`记忆写入失败：${receipt.error.code}`);
  const revisionId = receipt.data.committedRevisionIds[0];
  const record =
    revisionId === undefined ? undefined : fixture.store.memories.getRevision(revisionId);
  if (!record) throw new Error('记忆修订未落库。');
  return record;
};

/** 真实 HTTP Provider 的发包体：只看 role/content，别的字段与本卡断言无关。 */
const wireMessages = (init: RequestInit | undefined): { role: string; content: string }[] => {
  const parsed: unknown = JSON.parse(String(init?.body ?? '{}'));
  const messages =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { messages?: unknown }).messages
      : undefined;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (typeof message !== 'object' || message === null) return [];
    const entry = message as { role?: unknown; content?: unknown };
    return typeof entry.role === 'string' && typeof entry.content === 'string'
      ? [{ role: entry.role, content: entry.content }]
      : [];
  });
};

describe('RunService', () => {
  it('keeps the original goal and the failed user request available after continue', async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const captured = captureFakeProviderRequests();
    captured.failNextRequest();
    try {
      const failedRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '首次请求：整理季度经营复盘。',
      });
      await waitForCompletion(fixture, failedRunId);
      expect(statusOf(fixture, failedRunId)).toBe('failed');
      expect(fixture.store.taskContinuity.getLatest(fixture.taskId)?.revision).toBe(1);
      const artifact = fixture.store.artifacts.saveMarkdown({
        taskId: fixture.taskId,
        origin: 'user-edit',
        title: '已登记的季度草稿',
        content: '合成草稿内容',
      });

      const continuedRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '继续',
      });
      const preparedRevision = fixture.store.taskContinuity.getLatest(fixture.taskId);
      if (!preparedRevision) throw new Error('Task continuity revision is missing');
      await waitForCompletion(fixture, continuedRunId);
      expect(statusOf(fixture, continuedRunId)).toBe('completed');

      const secondRequest = captured.requests[1];
      if (!secondRequest) throw new Error('Fake Provider did not capture the continuation request');
      const briefMessage = secondRequest.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_BRIEF_V1】'),
      );
      const recentRequestsMessage = secondRequest.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_RECENT_USER_REQUESTS_V1】'),
      );
      const factsMessage = secondRequest.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_FACTS_V1】'),
      );
      expect(briefMessage?.content).toContain('用于运行编排测试');
      expect(recentRequestsMessage?.content).toContain('首次请求：整理季度经营复盘。');
      expect(recentRequestsMessage?.content).toContain(failedRunId);
      expect(factsMessage?.content).toContain('"errorCategory":"failed"');
      expect(factsMessage?.content).not.toContain('synthetic provider connection failure');
      expect(factsMessage?.content).toContain('"status":"failed"');
      expect(factsMessage?.content).toContain(artifact.currentVersionId);
      expect(factsMessage?.content).toContain('"status":"registered"');
      expect(secondRequest.at(-1)).toMatchObject({ role: 'user', content: '继续' });

      const persisted = fixture.store.taskContinuity.getRunContext(continuedRunId);
      expect(persisted?.firstProviderRequestAt).toBeDefined();
      expect(persisted?.brief).toEqual(preparedRevision.brief);
    } finally {
      captured.restore();
    }
  });

  it('keeps the exact persisted Brief messages in every Fake Provider tool round', async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const captured = captureFakeProviderRequests();
    try {
      const runId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '计算: 6 * 7',
      });
      await waitForCompletion(fixture, runId);

      expect(statusOf(fixture, runId)).toBe('completed');
      expect(captured.requests.length).toBeGreaterThanOrEqual(2);
      const firstContinuity = continuityMessagesOf(captured.requests[0] ?? []);
      expect(firstContinuity.length).toBeGreaterThanOrEqual(2);
      for (const request of captured.requests.slice(1)) {
        expect(continuityMessagesOf(request)).toEqual(firstContinuity);
      }
      const context = fixture.store.taskContinuity.getRunContext(runId);
      expect(context?.firstProviderRequestAt).toBeDefined();
    } finally {
      captured.restore();
    }
  });

  it('records deterministic completed progress and leaves Run completed when the Brief write fails', async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const originalAppend = fixture.store.taskContinuity.append.bind(fixture.store.taskContinuity);
    const appendFailure = vi
      .spyOn(fixture.store.taskContinuity, 'append')
      .mockImplementation((input) => {
        if (input.sourceKind === 'assistant-summary') {
          throw new Error('synthetic continuity write failure');
        }
        return originalAppend(input);
      });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const runId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '整理一份本期分析',
      });
      await waitForCompletion(fixture, runId);

      expect(statusOf(fixture, runId)).toBe('completed');
      expect(fixture.store.runs.getLatestEvent(runId)).toMatchObject({ type: 'run.completed' });
      expect(fixture.store.taskContinuity.getLatest(fixture.taskId)?.revision).toBe(1);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(
          `Task Continuity progress for completed Run ${runId} was not synchronized`,
        ),
      );
    } finally {
      appendFailure.mockRestore();
      warning.mockRestore();
    }
  });

  it('filters completed progress when its source memory is excluded from the next Run', async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const captured = captureFakeProviderRequests();
    try {
      const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
      if (!workspaceId) throw new Error('workspace missing');
      const memory = await confirmedMemory(
        fixture,
        { kind: 'workspace', workspaceId },
        '当前工作区的经营分析口径。',
      );
      const firstContext = fixture.store.taskContexts.save(fixture.taskId, {
        executor: { kind: 'general' },
        skillBindings: [],
      });
      const sourceRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '整理本月经营分析。',
        taskContextRevisionId: firstContext.id,
        expectedTaskContextRevision: firstContext.revision,
      });
      await waitForCompletion(fixture, sourceRunId);
      const sourceTerminal = fixture.store.runs.getLatestEvent(sourceRunId);
      if (sourceTerminal?.type === 'run.failed') throw new Error(sourceTerminal.error);
      expect(sourceTerminal).toMatchObject({ type: 'run.completed' });
      expect(
        fixture.store.runMemoryContexts.get(sourceRunId)?.memoryDependencyUnion,
      ).toContainEqual(
        expect.objectContaining({ memoryId: memory.id, revisionId: memory.revisionId }),
      );
      await vi.waitFor(() =>
        expect(
          fixture.store.taskContinuity.getLatest(fixture.taskId)?.brief.progress?.sourceRunId,
        ).toBe(sourceRunId),
      );

      const currentContext = fixture.store.taskContexts.save(
        fixture.taskId,
        {
          executor: { kind: 'general' },
          skillBindings: [],
          materials: [],
          excludedMemoryIds: [memory.id],
        },
        firstContext.revision,
      );
      const continuationRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '继续整理本月经营分析。',
        taskContextRevisionId: currentContext.id,
        expectedTaskContextRevision: currentContext.revision,
      });
      await waitForCompletion(fixture, continuationRunId);

      const frozen = fixture.store.taskContinuity.getRunContext(continuationRunId);
      expect(frozen?.brief.progress).toBeUndefined();
      expect(frozen?.omissions).toContain('assistant-progress-dependency-unverified');
      const request = captured.requests.find(
        (messages) => messages.at(-1)?.content === '继续整理本月经营分析。',
      );
      const briefMessage = request?.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_BRIEF_V1】'),
      );
      expect(briefMessage?.content).not.toContain(sourceRunId);
    } finally {
      captured.restore();
    }
  });

  it('filters completed progress when its exact source material is removed from the next TaskContext', async () => {
    const fixture = await createFixture();
    const context = await saveSingleMaterialContext(fixture, '本轮选定的合成材料。');
    const service = createService(fixture, createWindowStub());
    const captured = captureFakeProviderRequests();
    try {
      const sourceRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '读取: selected.md',
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
      });
      await waitForCompletion(fixture, sourceRunId);
      expect(statusOf(fixture, sourceRunId)).toBe('completed');
      expect(fixture.store.materialReads.listByRun(sourceRunId)).toHaveLength(1);
      await vi.waitFor(() =>
        expect(
          fixture.store.taskContinuity.getLatest(fixture.taskId)?.brief.progress?.sourceRunId,
        ).toBe(sourceRunId),
      );

      const narrowedContext = fixture.store.taskContexts.save(
        fixture.taskId,
        { executor: { kind: 'general' }, skillBindings: [], materials: [] },
        context.revision,
      );
      const continuationRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '继续',
        taskContextRevisionId: narrowedContext.id,
        expectedTaskContextRevision: narrowedContext.revision,
      });
      await waitForCompletion(fixture, continuationRunId);

      expect(statusOf(fixture, continuationRunId)).toBe('completed');
      const frozen = fixture.store.taskContinuity.getRunContext(continuationRunId);
      expect(frozen?.brief.progress).toBeUndefined();
      expect(frozen?.omissions).toContain('assistant-progress-dependency-unverified');
      const continuationRequest = captured.requests.find(
        (messages) => messages.at(-1)?.content === '继续',
      );
      const continuationBrief = continuationRequest?.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_BRIEF_V1】'),
      );
      expect(continuationBrief?.content).not.toContain(sourceRunId);
    } finally {
      captured.restore();
    }
  });

  it('keeps Task goals, requirements and progress isolated across Workspace and Expert changes', async () => {
    const fixture = await createFixture();
    const currentRevision = fixture.store.taskContinuity.getLatest(fixture.taskId);
    if (!currentRevision) throw new Error('New Task is missing its continuity revision');
    const firstGoal = '第一工作区的季度经营目标';
    const firstRequirement = '只属于第一任务的用户要求';
    fixture.store.taskContinuity.append({
      taskId: fixture.taskId,
      expectedRevision: currentRevision.revision,
      sourceKind: 'user-edit',
      brief: {
        ...currentRevision.brief,
        objective: { text: firstGoal, source: 'user-edit' },
        activeRequirements: [
          { id: 'first-task-requirement', text: firstRequirement, authoredBy: 'user-edit' },
        ],
      },
    });

    const otherWorkspace = fixture.store.workspaces.getOrCreate(
      path.join(fixture.directory, 'second-workspace'),
      '第二个合成工作区',
    );
    const secondTask = fixture.store.tasks.create(
      otherWorkspace.id,
      '第二个合成任务',
      '第二工作区自己的交付目标',
    );
    fixture.store.taskContinuity.initializeFromTaskGoal(secondTask.task.id);
    const firstExpert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: { ...testExpertRevision(), name: '第一工作方式', summary: '第一任务的专家' },
    });
    const secondExpert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: { ...testExpertRevision(), name: '第二工作方式', summary: '第二任务的专家' },
    });
    const firstContext = fixture.store.taskContexts.save(fixture.taskId, {
      executor: {
        kind: 'expert',
        expertId: firstExpert.id,
        expertRevisionId: firstExpert.revision.id,
      },
      skillBindings: [],
    });
    const secondContext = fixture.store.taskContexts.save(secondTask.task.id, {
      executor: {
        kind: 'expert',
        expertId: secondExpert.id,
        expertRevisionId: secondExpert.revision.id,
      },
      skillBindings: [],
    });
    const service = createService(fixture, createWindowStub());
    const captured = captureFakeProviderRequests();
    try {
      const firstRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '第一任务的合成请求',
        taskContextRevisionId: firstContext.id,
        expectedTaskContextRevision: firstContext.revision,
      });
      await waitForCompletion(fixture, firstRunId);
      expect(statusOf(fixture, firstRunId)).toBe('completed');

      const secondRunId = service.start({
        taskId: secondTask.task.id,
        sessionId: secondTask.sessionId,
        prompt: '第二任务的合成请求',
        taskContextRevisionId: secondContext.id,
        expectedTaskContextRevision: secondContext.revision,
      });
      await waitForCompletion(fixture, secondRunId);
      expect(statusOf(fixture, secondRunId)).toBe('completed');

      const request = captured.requests.find(
        (messages) => messages.at(-1)?.content === '第二任务的合成请求',
      );
      if (!request) throw new Error('Fake Provider did not capture the second Task request');
      const continuity = continuityMessagesOf(request).join('\n');
      expect(continuity).toContain('第二工作区自己的交付目标');
      expect(continuity).not.toContain(firstGoal);
      expect(continuity).not.toContain(firstRequirement);
      expect(continuity).not.toContain('第一任务的合成请求');
      expect(continuity).not.toContain(firstRunId);
      expect(fixture.store.runContextSnapshots.get(firstRunId)).toMatchObject({
        expertId: firstExpert.id,
        expertRevisionId: firstExpert.revision.id,
      });
      expect(fixture.store.runContextSnapshots.get(secondRunId)).toMatchObject({
        expertId: secondExpert.id,
        expertRevisionId: secondExpert.revision.id,
      });
    } finally {
      captured.restore();
    }
  });

  it('skips over-budget completed history but keeps its prompt, and applies the prompt tail budget', async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const captured = captureFakeProviderRequests();
    const longAnswer = '合成长回答'.repeat(3_000);
    try {
      captured.respondNextRequest(longAnswer);
      const longHistoryRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '上一轮用户明确要求：整理月度经营结果。',
      });
      await waitForCompletion(fixture, longHistoryRunId);
      expect(statusOf(fixture, longHistoryRunId)).toBe('completed');

      const continuationRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '继续',
      });
      await waitForCompletion(fixture, continuationRunId);
      const continuationRequest = captured.requests[1];
      if (!continuationRequest) throw new Error('Missing continuation Provider request');
      expect(continuationRequest.some((message) => message.content.includes(longAnswer))).toBe(
        false,
      );
      expect(
        continuationRequest.some((message) =>
          message.content.includes('上一轮用户明确要求：整理月度经营结果。'),
        ),
      ).toBe(true);
      expect(fixture.store.runMemoryContexts.get(continuationRunId)?.replay).toContainEqual(
        expect.objectContaining({
          runId: longHistoryRunId,
          replayed: false,
          reason: 'history-budget',
        }),
      );

      addFailedRun(fixture, {
        id: 'tc-old-long-prompt',
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '旧'.repeat(3_000),
        createdAt: Date.now() + 10,
      });
      addFailedRun(fixture, {
        id: 'tc-new-long-prompt',
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '新'.repeat(6_000),
        createdAt: Date.now() + 20,
      });
      const budgetRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: 'CURRENT_PROMPT_TAIL',
      });
      await waitForCompletion(fixture, budgetRunId);
      const budgetRequest = captured.requests.at(-1);
      if (!budgetRequest) throw new Error('Missing budget Provider request');
      const requestsContext = budgetRequest.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_RECENT_USER_REQUESTS_V1】'),
      );
      expect(requestsContext?.content).toContain('新'.repeat(100));
      expect(requestsContext?.content).not.toContain('旧'.repeat(100));
      expect(budgetRequest.at(-1)).toMatchObject({
        role: 'user',
        content: 'CURRENT_PROMPT_TAIL',
      });
      expect(fixture.store.taskContinuity.getRunContext(budgetRunId)?.omissions).toContain(
        'recent-user-prompts-budget',
      );
    } finally {
      captured.restore();
    }
  });

  it('isolates previous Task prompts and keeps historical material references outside the current allowlist', async () => {
    const fixture = await createFixture();
    addFailedRun(fixture, {
      id: 'tc-same-task-old-material-prompt',
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '上一轮提到 /tmp/unselected-private-material.md',
      createdAt: 10,
    });
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const foreignTask = fixture.store.tasks.create(workspaceId, '隔离合成任务', '隔离目标');
    fixture.store.taskContinuity.initializeFromTaskGoal(foreignTask.task.id);
    addFailedRun(fixture, {
      id: 'tc-foreign-task-secret-run',
      taskId: foreignTask.task.id,
      sessionId: foreignTask.sessionId,
      prompt: 'CROSS_TASK_PROMPT_MUST_NOT_LEAK',
      createdAt: 100,
    });
    const context = await saveSingleMaterialContext(fixture, '本轮唯一授权的合成材料。');
    const service = createService(fixture);
    const captured = captureFakeProviderRequests();
    try {
      const runId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '按当前材料继续',
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
      });
      await waitForCompletion(fixture, runId);
      const request = captured.requests[0];
      if (!request) throw new Error('Missing material-scoped Provider request');
      expect(
        request.some((message) => message.content.includes('CROSS_TASK_PROMPT_MUST_NOT_LEAK')),
      ).toBe(false);
      const historical = request.find((message) =>
        message.content.startsWith('【TASK_CONTINUITY_RECENT_USER_REQUESTS_V1】'),
      );
      expect(historical?.content).toContain('/tmp/unselected-private-material.md');
      expect(historical?.content).toContain('不构成本 Run 的材料授权');
      const materialAllowlist = request.find((message) =>
        message.content.includes('以下是用户为本次 Run 明确选择的材料清单。'),
      );
      expect(materialAllowlist?.content).toContain('selected.md');
      expect(materialAllowlist?.content).not.toContain('/tmp/unselected-private-material.md');
    } finally {
      captured.restore();
    }
  });

  it('fails without Provider dispatch when the Brief is missing or dispatch audit cannot be stored', async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const captured = captureFakeProviderRequests();
    try {
      const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
      if (!workspaceId) throw new Error('workspace missing');
      const legacyTask = fixture.store.tasks.create(workspaceId, '无初始简报的旧 Task', '不得回填');
      const missingBriefRunId = service.start({
        taskId: legacyTask.task.id,
        sessionId: legacyTask.sessionId,
        prompt: '继续',
      });
      await waitForCompletion(fixture, missingBriefRunId);
      expect(statusOf(fixture, missingBriefRunId)).toBe('failed');
      expect(fixture.store.taskContinuity.getRunContext(missingBriefRunId)).toBeUndefined();
      expect(captured.requests).toHaveLength(0);

      const dispatchFailure = vi
        .spyOn(fixture.store.taskContinuity, 'markFirstProviderRequest')
        .mockImplementation(() => {
          throw new Error('synthetic dispatch audit write failure');
        });
      const failedAuditRunId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '不可在审计失败时派发',
      });
      await waitForCompletion(fixture, failedAuditRunId);
      dispatchFailure.mockRestore();

      expect(statusOf(fixture, failedAuditRunId)).toBe('failed');
      expect(captured.requests).toHaveLength(0);
      expect(
        fixture.store.taskContinuity.getRunContext(failedAuditRunId)?.firstProviderRequestAt,
      ).toBeUndefined();
      expect(fixture.store.runs.listEvents(failedAuditRunId).at(-1)).toMatchObject({
        type: 'run.failed',
        error: expect.stringContaining('synthetic dispatch audit write failure'),
      });
    } finally {
      captured.restore();
    }
  });

  it('atomically links the scheduled first Run before Provider dispatch and retries T4 idempotently', async () => {
    const fixture = await createFixture();
    const scheduled = createPreparedScheduleDraft(fixture);
    fixture.store.models.save({
      name: '定时 T4 合成模型',
      provider: 'openai-compatible',
      baseUrl: 'https://model.fixture/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: 'synthetic-t4-key',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const fetchMock = vi.fn(async () =>
      sseResponse(JSON.stringify({ choices: [{ delta: { content: '本期自动分析完成。' } }] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const scheduleFinalizer = vi.fn(async () => undefined);
    const runs = createService(
      fixture,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      scheduleFinalizer,
    );

    let failedRunId: string | undefined;
    const failedDispatch = vi
      .spyOn(fixture.store.scheduleOccurrences, 'dispatchRun')
      .mockImplementation((input) => {
        failedRunId = input.runId;
        throw new Error('synthetic T4 association failure');
      });
    expect(() => scheduled.service.startFirstRun(scheduled.occurrence.id, runs)).toThrow(
      'synthetic T4 association failure',
    );
    failedDispatch.mockRestore();

    expect(failedRunId).toBeDefined();
    if (!failedRunId) throw new Error('test setup: T4 did not allocate a Run identity');
    expect(fixture.store.runs.get(failedRunId)).toBeUndefined();
    expect(fixture.store.runContextSnapshots.get(failedRunId)).toBeUndefined();
    expect(runs.isActive(failedRunId)).toBe(false);
    expect(fixture.store.scheduleOccurrences.get(scheduled.occurrence.id)).toMatchObject({
      phase: 'preparing',
      taskId: scheduled.draft.task.id,
      sessionId: scheduled.draft.sessionId,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const dispatchRun = fixture.store.scheduleOccurrences.dispatchRun.bind(
      fixture.store.scheduleOccurrences,
    );
    const committedDispatch = vi
      .spyOn(fixture.store.scheduleOccurrences, 'dispatchRun')
      .mockImplementation((input) => {
        expect(fetchMock).not.toHaveBeenCalled();
        return dispatchRun(input);
      });
    const runId = scheduled.service.startFirstRun(scheduled.occurrence.id, runs);
    expect(scheduled.service.startFirstRun(scheduled.occurrence.id, runs)).toBe(runId);
    expect(fetchMock).not.toHaveBeenCalled();
    await waitForCompletion(fixture, runId);
    await vi.waitFor(() => expect(scheduleFinalizer).toHaveBeenCalledWith(runId));
    committedDispatch.mockRestore();

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.store.notifications.list()).toEqual([]);
    expect(fixture.store.scheduleOccurrences.get(scheduled.occurrence.id)).toMatchObject({
      phase: 'dispatched',
      firstRunId: runId,
      taskId: scheduled.draft.task.id,
      sessionId: scheduled.draft.sessionId,
      sourceSnapshotId: scheduled.draft.occurrence.sourceSnapshotId,
    });
  });

  it('records the recalled revisions and the three-phase request audit', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const memory = await confirmedMemory(
      fixture,
      { kind: 'workspace', workspaceId },
      '经营分析先核对回款金额口径。',
    );
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '准备本月经营分析。',
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    const context = fixture.store.runMemoryContexts.get(runId);
    expect(context?.selectedItems.map((item) => item.revisionId)).toEqual([memory.revisionId]);
    // selected→request-prepared→dispatch-attempted 只由真实发包推进（契约 §6.4）。
    expect(context?.phase).toBe('dispatch-attempted');
    expect((context?.requestHash ?? '').length).toBeGreaterThan(20);
    expect(
      fixture.store.memories.listMemoryReads(runId).map((read) => read.memoryRevisionId),
    ).toEqual([memory.revisionId]);
  });

  it('recalls only memories whose scope applies to the selected Expert and Workspace', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const expert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '经营分析专家',
        summary: '使用工作区规则完成经营分析',
        author: '',
        tags: [],
        identity: '负责经营分析。',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const otherExpert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '其他专家',
        summary: '其他专家',
        author: '',
        tags: [],
        identity: '不应被当前专家读取。',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const otherWorkspace = fixture.store.workspaces.getOrCreate(
      '/tmp/other-memory-workspace',
      '其他工作区',
    );
    const applicable = [
      await confirmedMemory(
        fixture,
        { kind: 'workspace', workspaceId },
        '当前工作区的经营分析口径。',
      ),
      await confirmedMemory(
        fixture,
        { kind: 'expert', expertId: expert.id },
        '专家通用经营分析方法。',
      ),
      await confirmedMemory(
        fixture,
        { kind: 'expert-workspace', expertId: expert.id, workspaceId },
        '本公司经营分析方法沉淀。',
      ),
    ];
    const excluded = [
      await confirmedMemory(
        fixture,
        { kind: 'expert', expertId: otherExpert.id },
        '其他专家的经营分析方法。',
      ),
      await confirmedMemory(
        fixture,
        { kind: 'expert-workspace', expertId: expert.id, workspaceId: otherWorkspace.id },
        '其他工作区的经营分析方法。',
      ),
    ];
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '整理本月经营分析。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    const selected = (fixture.store.runMemoryContexts.get(runId)?.selectedItems ?? []).map(
      (item) => item.revisionId,
    );
    expect(selected.sort()).toEqual(applicable.map((record) => record.revisionId).sort());
    for (const record of excluded) {
      expect(selected).not.toContain(record.revisionId);
    }
  });

  it('honors a TaskContext memory exclusion for only the next run', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const memory = await confirmedMemory(
      fixture,
      { kind: 'workspace', workspaceId },
      '本任务暂不参考的经营分析口径。',
    );
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      excludedMemoryIds: [memory.id],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '不使用这条记忆的经营分析。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    const snapshot = fixture.store.runMemoryContexts.get(runId);
    expect(snapshot?.selectedItems).toEqual([]);
    expect((snapshot?.decisionSummary.exclusions ?? []).map((entry) => entry.reason)).toContain(
      'task-excluded',
    );
    expect(fixture.store.memories.listMemoryReads(runId)).toEqual([]);
  });

  it('replays the previous run and stops when a recalled memory is revised', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const memory = await confirmedMemory(
      fixture,
      { kind: 'workspace', workspaceId },
      '经营分析先核对回款金额口径。',
    );
    const service = createService(fixture);
    const first = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '准备本月经营分析。',
    });
    await waitForCompletion(fixture, first);
    expect(statusOf(fixture, first)).toBe('completed');

    const second = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '把经营分析结论整理成段落。',
    });
    await waitForCompletion(fixture, second);
    const replayed = fixture.store.runMemoryContexts.get(second)?.replay ?? [];
    expect(replayed.map((entry) => (entry.replayed ? entry.runId : 'skipped'))).toEqual([first]);

    // 记忆一换修订，依赖它的历史轮次就不再重放，也不能跨过它拼更早的对话（契约 §6.3）。
    const revised = await fixture.memories.update({
      operationId: randomUUID(),
      id: memory.id,
      expectedRevision: memory.revision,
      patch: { content: '经营分析先核对签约金额口径。' },
    });
    if (!revised.ok) throw new Error(`记忆修订失败：${revised.error.code}`);
    const third = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '再核对一次经营分析口径。',
    });
    await waitForCompletion(fixture, third);
    const blocked = fixture.store.runMemoryContexts.get(third)?.replay ?? [];
    expect(
      blocked.every((entry) => !entry.replayed),
      JSON.stringify(blocked),
    ).toBe(true);
  });

  it('把召回记忆与安全历史后缀真正发进模型请求，记忆换修订后旧历史不再出现', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    // 走真实 HTTP Provider：只有捕获发包体才能断言模型看见了什么（契约 §6.3、§6.4）。
    fixture.store.models.save({
      name: '请求替身模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'x',
      role: 'language',
      apiKey: '',
      enabled: true,
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
    });
    const resolver: CredentialResolver = {
      migrationStatus: (ref) => (ref.ownerKind === 'model-profile' ? 'done' : 'none'),
      resolveSecret: async () => 'SK-FROM-CREDS',
    };
    const requests: { role: string; content: string }[][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        requests.push(wireMessages(init));
        return sseResponse(JSON.stringify({ choices: [{ delta: { content: '已按口径完成。' } }] }));
      }),
    );
    const memory = await confirmedMemory(
      fixture,
      { kind: 'workspace', workspaceId },
      '经营分析先核对回款金额口径。',
    );
    const service = createService(
      fixture,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver,
    );
    const startRun = (prompt: string): string => {
      const runId = service.start({ taskId: fixture.taskId, sessionId: fixture.sessionId, prompt });
      return runId;
    };

    const first = startRun('准备本月经营分析。');
    await waitForCompletion(fixture, first);
    const firstRequest = requests.at(-1) ?? [];
    expect(statusOf(fixture, first)).toBe('completed');
    expect(
      firstRequest.some(
        (message) =>
          message.role === 'system' && message.content.includes('经营分析先核对回款金额口径。'),
      ),
      JSON.stringify(firstRequest),
    ).toBe(true);
    expect(
      firstRequest.some(
        (message) => message.role === 'user' && message.content.includes('准备本月经营分析。'),
      ),
    ).toBe(true);

    const second = startRun('把经营分析结论整理成段落。');
    await waitForCompletion(fixture, second);
    const secondRequest = requests.at(-1) ?? [];
    // 上一轮问答以真实历史消息进入请求，而不是靠 segmentId 推断。
    expect(secondRequest).toContainEqual({ role: 'user', content: '准备本月经营分析。' });
    expect(secondRequest).toContainEqual({ role: 'assistant', content: '已按口径完成。' });

    // 记忆一换修订，依赖它的历史轮次必须从请求里消失（契约 §6.3）。
    const revised = await fixture.memories.update({
      operationId: randomUUID(),
      id: memory.id,
      expectedRevision: memory.revision,
      patch: { content: '经营分析先核对签约金额口径。' },
    });
    if (!revised.ok) throw new Error(`记忆修订失败：${revised.error.code}`);
    const third = startRun('再核对一次经营分析口径。');
    await waitForCompletion(fixture, third);
    const thirdRequest = requests.at(-1) ?? [];
    expect(thirdRequest).not.toContainEqual({ role: 'assistant', content: '已按口径完成。' });
    expect(thirdRequest).not.toContainEqual({ role: 'user', content: '准备本月经营分析。' });
    expect(
      thirdRequest.some(
        (message) =>
          message.role === 'system' && message.content.includes('经营分析先核对签约金额口径。'),
      ),
    ).toBe(true);
  });

  it('registers read_knowledge by default and respects the Expert allow-list', () => {
    const tools = createRunTools({
      knowledgeSearch: async () => ({ results: [] }),
      readKnowledge: () => ({
        reference: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'd',
          knowledgeRevisionId: 'r',
          contentHash: 'h',
          sourcePath: '/a.md',
        },
        textHash: 't',
        title: 'A',
        parserVersion: 'p',
        chunkingVersion: 'c',
        warnings: [],
        parts: [],
        returnedCodePoints: 0,
        complete: true,
        remainingRunCodePoints: 0,
      }),
    });
    expect(tools.map((tool) => tool.name)).toContain('read_knowledge');
    const withDeclarator = createRunTools({
      knowledgeSearch: async () => ({ results: [] }),
      artifactSourceDeclarator: async () => undefined,
    });
    expect(withDeclarator.map((tool) => tool.name)).toContain('artifact_declare_sources');
    const restricted = createRunTools({
      knowledgeSearch: async () => ({ results: [] }),
      readKnowledge: () => ({
        reference: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'd',
          knowledgeRevisionId: 'r',
          contentHash: 'h',
          sourcePath: '/a.md',
        },
        textHash: 't',
        title: 'A',
        parserVersion: 'p',
        chunkingVersion: 'c',
        warnings: [],
        parts: [],
        returnedCodePoints: 0,
        complete: true,
        remainingRunCodePoints: 0,
      }),
      allowedBuiltinToolNames: new Set(['knowledge_search']),
    });
    expect(restricted.map((tool) => tool.name)).not.toContain('read_knowledge');
    expect(
      createRunTools({ knowledgeSearch: async () => ({ results: [] }) }).map((tool) => tool.name),
    ).not.toContain('read_knowledge');
  });

  it('KM02 gives legacy runs without a material scope explained empty search, not full-vault access', async () => {
    const fixture = await createFixture();
    const note = path.join(fixture.directory, '客户资料.md');
    await writeFile(note, '客户续约风险需要在季度复盘中重点跟进。');
    await fixture.vault.importPaths([note]);

    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '搜索知识: 续约风险',
    });
    await waitForCompletion(fixture, runId);

    // 无 TaskContext 的旧兼容 Run 不再隐式全库搜索，也不留下任何证据或足迹。
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([]);
    expect(fixture.store.materialReads.listByRun(runId)).toEqual([]);
    expect(statusOf(fixture, runId)).toBe('completed');
    const toolEvent = fixture.store.runs
      .listEvents(runId)
      .find((event) => event.type === 'tool.completed');
    expect(JSON.stringify(toolEvent?.output ?? '')).toContain('没有固定材料范围');
  });

  it('limits knowledge search to the exact revisions selected in the TaskContext', async () => {
    const fixture = await createFixture();
    const selectedPath = path.join(fixture.directory, 'selected.md');
    const excludedPath = path.join(fixture.directory, 'excluded.md');
    await writeFile(selectedPath, '本月收入增长来自续约客户。');
    await writeFile(excludedPath, '本月收入增长来自新客户。');
    await fixture.vault.importPaths([selectedPath, excludedPath]);
    const selectedDocument = fixture.vault
      .listDocuments()
      .find((document) => document.sourcePath === selectedPath);
    if (!selectedDocument) throw new Error('selected knowledge document missing');
    const selectedRevision = fixture.vault.listRevisions(selectedDocument.id)[0];
    if (!selectedRevision) throw new Error('selected knowledge revision missing');

    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['knowledge_search'] },
      materials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: selectedDocument.id,
            knowledgeRevisionId: selectedRevision.id,
            contentHash: selectedRevision.contentHash,
            sourcePath: selectedRevision.sourcePath,
          },
          purpose: 'current-input',
          addedFrom: 'workspace-candidate',
        },
      ],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '搜索知识: 收入增长',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    const evidence = fixture.store.evidence.listByTask(fixture.taskId);
    expect(evidence).toEqual([
      expect.objectContaining({
        runId,
        sourceUri: selectedPath,
        knowledgeSource: expect.objectContaining({
          operation: 'search',
          reference: expect.objectContaining({ knowledgeRevisionId: selectedRevision.id }),
          textHash: selectedRevision.textHash,
          span: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
        }),
      }),
    ]);
    const footprint = fixture.store.materialReads.listByRun(runId);
    expect(footprint).toEqual([
      expect.objectContaining({
        runId,
        operation: 'search',
        toolCallId: expect.any(String),
        knowledgePartIndex: 0,
        textHash: selectedRevision.textHash,
        evidenceId: evidence[0]?.id,
      }),
    ]);
    // 摘要与 span 严格对应同一修订文本
    if (evidence[0]?.knowledgeSource) {
      const { span } = evidence[0].knowledgeSource;
      const section = selectedRevision
        ? fixture.vault.getRevision(selectedRevision.id)?.chunks[0]
        : undefined;
      expect(evidence[0].excerpt).toBe(
        Array.from(section?.content ?? '')
          .slice(span.start, span.end)
          .join(''),
      );
    }
  });

  it('rejects a direct workspace file read when the file was not selected', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.directory, 'secret.txt'), '不应被材料范围读取');
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
      materials: [],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: `读取: ${path.join(fixture.directory, 'secret.txt')}`,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.failed',
        error: expect.stringContaining('材料范围不允许读取'),
      }),
    );
  });

  it('reads a selected input snapshot through its managed copy', async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.directory, 'selected.txt');
    await writeFile(sourcePath, '已选择的输入内容');
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    await writeFile(sourcePath, '原路径在快照准备后已改写');
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: receipt.snapshot.id,
            workspaceId,
            contentHash: receipt.snapshot.contentHash,
            format: receipt.snapshot.format,
            fileKey: receipt.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取: selected.txt',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        output: expect.objectContaining({ content: '已选择的输入内容' }),
      }),
    );
    expect(fixture.store.materialReads.listByRun(runId)).toEqual([
      expect.objectContaining({ runId, operation: 'read', locator: 'selected.txt' }),
    ]);
  });

  it('keeps the full scheduled material authorization while bounding its model summary', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const references: MaterialReference[] = [];
    for (let index = 0; index < 55; index += 1) {
      const filename = `固定-${String(index + 1).padStart(2, '0')}-${'经营资料'.repeat(18)}.md`;
      const sourcePath = path.join(fixture.directory, filename);
      await writeFile(sourcePath, `合成私密正文-${index + 1}`);
      const receipt = await fixture.inputSnapshots.create({
        workspaceId,
        workspaceRoot: fixture.directory,
        sourcePath,
      });
      references.push({
        kind: 'workspace-input-snapshot',
        snapshotId: receipt.snapshot.id,
        workspaceId,
        contentHash: receipt.snapshot.contentHash,
        format: receipt.snapshot.format,
        fileKey: receipt.snapshot.fileKey,
      });
    }
    const scheduled = createScheduledContext(fixture, references);
    let requestCount = 0;
    let requestMessages: Array<{ role: string; content: string }> = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      requestCount += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages: Array<{ role: string; content: string }>;
      };
      requestMessages = body.messages;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'read-scheduled-material',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({
                          path: '固定-01-经营资料'.concat('经营资料'.repeat(17), '.md'),
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(JSON.stringify({ choices: [{ delta: { content: '已读取固定来源。' } }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '定时材料摘要测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取本期来源。',
      taskContextRevisionId: scheduled.context.id,
      expectedTaskContextRevision: scheduled.context.revision,
    });
    await waitForCompletion(fixture, runId);

    const runSnapshot = fixture.store.runContextSnapshots.get(runId);
    const summary = requestMessages.find(
      (message) => message.role === 'system' && message.content.includes('本次固定可读材料共'),
    );
    expect(runSnapshot?.scheduleSourceSnapshotId).toBe(scheduled.source.id);
    expect(runSnapshot?.materials).toHaveLength(references.length);
    expect(summary).toBeDefined();
    expect(countCodePoints(summary?.content ?? '')).toBeLessThanOrEqual(8_000);
    const listedIdentities = (summary?.content ?? '')
      .split('\n')
      .filter((line) => /^\d+\. 工作空间文件/u.test(line));
    expect(listedIdentities.length).toBeLessThanOrEqual(40);
    expect(summary?.content).not.toContain('合成私密正文');
    expect(statusOf(fixture, runId)).toBe('completed');
  });

  it.each(['pdf', 'docx'] as const)(
    'dispatches selected %s bytes through the deterministic parser and audits source locators',
    async (format) => {
      const fixture = await createFixture();
      const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
      if (!workspaceId) throw new Error('workspace missing');
      const sourcePath = path.join(fixture.directory, `固定材料.${format}`);
      const binary = Buffer.from([0xff, 0x00, 0x80, 0x25, 0x50, 0x44, 0x46]);
      await writeFile(sourcePath, binary);
      const receipt = await fixture.inputSnapshots.create({
        workspaceId,
        workspaceRoot: fixture.directory,
        sourcePath,
      });
      const reference: MaterialReference = {
        kind: 'workspace-input-snapshot',
        snapshotId: receipt.snapshot.id,
        workspaceId,
        contentHash: receipt.snapshot.contentHash,
        format,
        fileKey: receipt.snapshot.fileKey,
      };
      const scheduled = createScheduledContext(fixture, [reference]);
      let extractedBytes: Buffer | undefined;
      const extractor: DocumentExtractor = async (receivedFormat, bytes, job, signal) => {
        expect(receivedFormat).toBe(format);
        expect(job?.jobId).toContain('-');
        expect(signal?.aborted).toBe(false);
        extractedBytes = bytes;
        return {
          format,
          content: '确定性解析正文：收入保持稳定。',
          sections: [
            {
              locator: format === 'pdf' ? '第 2 页' : '段落 1',
              ordinal: 0,
              content: '确定性解析正文：收入保持稳定。',
            },
          ],
        };
      };
      let requestCount = 0;
      let readOutput: unknown;
      const fetchMock = vi.fn(async () => {
        requestCount += 1;
        return requestCount === 1
          ? sseResponse(
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'read-office-source',
                          function: {
                            name: 'read_text_file',
                            arguments: JSON.stringify({ path: `固定材料.${format}` }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            )
          : sseResponse(
              JSON.stringify({ choices: [{ delta: { content: '已按定位读取解析文本。' } }] }),
            );
      });
      vi.stubGlobal('fetch', fetchMock);
      fixture.store.models.save({
        name: `${format} 解析测试模型`,
        provider: 'openai-compatible',
        baseUrl: 'http://model.test/v1',
        model: 'fixture-model',
        role: 'language',
        apiKey: '',
        maxContextTokens: 8_192,
        maxOutputTokens: 1_024,
        temperature: 0,
        enabled: true,
      });
      const service = createService(
        fixture,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        extractor,
      );
      const runId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '读取本期材料。',
        taskContextRevisionId: scheduled.context.id,
        expectedTaskContextRevision: scheduled.context.revision,
      });
      await waitForCompletion(fixture, runId);
      const readEvent = fixture.store.runs
        .listEvents(runId)
        .find(
          (event) => event.type === 'tool.completed' && event.toolCallId === 'read-office-source',
        );
      if (readEvent?.type === 'tool.completed') readOutput = readEvent.output;

      expect(extractedBytes?.equals(binary)).toBe(true);
      expect(readOutput).toMatchObject({
        material: reference,
        format,
        content: '',
        sections: [
          {
            locator: format === 'pdf' ? '第 2 页' : '段落 1',
            content: '确定性解析正文：收入保持稳定。',
          },
        ],
      });
      expect(fixture.store.materialReads.listByRun(runId)).toEqual([
        expect.objectContaining({
          material: reference,
          operation: 'parse',
          locator: format === 'pdf' ? '第 2 页' : '段落 1',
          contentHash: reference.contentHash,
        }),
      ]);
      expect(statusOf(fixture, runId)).toBe('completed');
    },
  );

  it('forwards Run cancellation into an in-flight PDF extraction before recording a read', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const sourcePath = path.join(fixture.directory, '等待取消.pdf');
    await writeFile(sourcePath, Buffer.from([0xff, 0x00, 0x50, 0x44, 0x46]));
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const reference: MaterialReference = {
      kind: 'workspace-input-snapshot',
      snapshotId: receipt.snapshot.id,
      workspaceId,
      contentHash: receipt.snapshot.contentHash,
      format: 'pdf',
      fileKey: receipt.snapshot.fileKey,
    };
    const scheduled = createScheduledContext(fixture, [reference]);
    let announceExtraction: (() => void) | undefined;
    const extractionStarted = new Promise<void>((resolve) => {
      announceExtraction = resolve;
    });
    let extractionSignal: AbortSignal | undefined;
    const extractor: DocumentExtractor = async (_format, _bytes, _job, signal) => {
      if (!signal) throw new Error('expected Run AbortSignal');
      extractionSignal = signal;
      announceExtraction?.();
      await new Promise<void>((_resolve, reject) => {
        const onAbort = (): void => reject(abortError());
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
      throw abortError();
    };
    const fetchMock = vi.fn(async () =>
      sseResponse(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'cancel-parsing-pdf',
                    function: {
                      name: 'read_text_file',
                      arguments: JSON.stringify({ path: '等待取消.pdf' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: 'PDF 取消测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(
      fixture,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      extractor,
    );
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取并取消 PDF 提取。',
      taskContextRevisionId: scheduled.context.id,
      expectedTaskContextRevision: scheduled.context.revision,
    });

    await extractionStarted;
    expect(service.cancel(runId)).toBe(true);
    await waitForCompletion(fixture, runId);

    expect(extractionSignal?.aborted).toBe(true);
    expect(statusOf(fixture, runId)).toBe('cancelled');
    expect(fixture.store.materialReads.listByRun(runId)).toEqual([]);
  });

  it('rejects ambiguous text reads when multiple selected snapshots share a path', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const sourcePath = path.join(fixture.directory, 'versioned.txt');
    await writeFile(sourcePath, '旧版本');
    const first = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    await writeFile(sourcePath, '新版本');
    const second = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const selectionOf = (snapshot: typeof first.snapshot) => ({
      reference: {
        kind: 'workspace-input-snapshot' as const,
        snapshotId: snapshot.id,
        workspaceId: snapshot.workspaceId,
        contentHash: snapshot.contentHash,
        format: snapshot.format,
        fileKey: snapshot.fileKey,
      },
      purpose: 'current-input' as const,
      addedFrom: 'user-input' as const,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
      materials: [selectionOf(first.snapshot), selectionOf(second.snapshot)],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取: versioned.txt',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.failed',
        error: expect.stringContaining('多个输入快照'),
      }),
    );
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'run.failed',
        error: expect.stringContaining('没有成功读取任何材料'),
      }),
    );
  });

  it('rejects an ArtifactVersion that is outside the selected material set', async () => {
    const fixture = await createFixture();
    const artifact = fixture.store.artifacts.saveMarkdown({
      taskId: fixture.taskId,
      origin: 'user-edit',
      title: '月报草稿',
      content: '上月经营结论',
    });
    const version = fixture.store.artifacts.listVersions(artifact.id)[0];
    if (!version) throw new Error('artifact version missing');
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_artifact'] },
      materials: [],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: `读取成果: ${artifact.id}/${version.id}`,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.failed',
        error: expect.stringContaining('材料范围不允许读取该成果版本'),
      }),
    );
  });

  it('starts a new context segment when selected materials shrink', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const firstPath = path.join(fixture.directory, 'first.txt');
    const secondPath = path.join(fixture.directory, 'second.txt');
    await writeFile(firstPath, '第一份材料');
    await writeFile(secondPath, '第二份材料');
    const [firstSnapshot, secondSnapshot] = await Promise.all([
      fixture.inputSnapshots.create({
        workspaceId,
        workspaceRoot: fixture.directory,
        sourcePath: firstPath,
      }),
      fixture.inputSnapshots.create({
        workspaceId,
        workspaceRoot: fixture.directory,
        sourcePath: secondPath,
      }),
    ]);
    const selectionOf = (snapshot: typeof firstSnapshot.snapshot) => ({
      reference: {
        kind: 'workspace-input-snapshot' as const,
        snapshotId: snapshot.id,
        workspaceId,
        contentHash: snapshot.contentHash,
        format: snapshot.format,
        fileKey: snapshot.fileKey,
      },
      purpose: 'current-input' as const,
      addedFrom: 'user-input' as const,
    });
    const first = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [selectionOf(firstSnapshot.snapshot), selectionOf(secondSnapshot.snapshot)],
    });
    const service = createService(fixture);
    const firstRun = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '第一轮',
      taskContextRevisionId: first.id,
      expectedTaskContextRevision: first.revision,
    });
    await waitForCompletion(fixture, firstRun);

    const second = fixture.store.taskContexts.save(
      fixture.taskId,
      {
        executor: { kind: 'general' },
        skillBindings: [],
        materials: [selectionOf(firstSnapshot.snapshot)],
      },
      first.revision,
    );
    const secondRun = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '第二轮',
      taskContextRevisionId: second.id,
      expectedTaskContextRevision: second.revision,
    });
    await waitForCompletion(fixture, secondRun);
    expect(fixture.store.runContextSnapshots.get(firstRun)?.contextSegmentId).not.toBe(
      fixture.store.runContextSnapshots.get(secondRun)?.contextSegmentId,
    );
  });

  it('shrinks a scheduled Task memory/history scope and allows an explicit supplement to restore it', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const sourcePath = path.join(fixture.directory, 'scope-source.md');
    await writeFile(sourcePath, '收入按回款金额统计的当前期间规则。');
    const snapshot = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const reference: MaterialReference = {
      kind: 'workspace-input-snapshot',
      snapshotId: snapshot.snapshot.id,
      workspaceId,
      contentHash: snapshot.snapshot.contentHash,
      format: snapshot.snapshot.format,
      fileKey: snapshot.snapshot.fileKey,
    };
    const scheduled = createScheduledContext(fixture, [reference]);
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1 || requestCount === 4) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id:
                        requestCount === 1
                          ? 'read-schedule-scope-source'
                          : 'read-explicit-supplement',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'scope-source.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(JSON.stringify({ choices: [{ delta: { content: '本期分析已完成。' } }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '定时记忆范围替身模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);
    const firstRun = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请按收入按回款金额统计的口径出月报。',
      taskContextRevisionId: scheduled.context.id,
      expectedTaskContextRevision: scheduled.context.revision,
    });
    await waitForCompletion(fixture, firstRun);
    expect(statusOf(fixture, firstRun)).toBe('completed');
    expect(fixture.store.runMemoryContexts.get(firstRun)?.materialDependencyUnion).toEqual([
      reference,
    ]);
    expect(fixture.store.materialReads.listByRun(firstRun)).toContainEqual(
      expect.objectContaining({ material: reference, operation: 'read' }),
    );

    const artifact = fixture.store.artifacts.saveMarkdown(
      {
        taskId: fixture.taskId,
        origin: 'assistant-run',
        runId: firstRun,
        title: '本期定时参考成果',
        content: '依据：收入按回款金额统计的经营分析口径。',
      },
      'model',
    );
    const version = fixture.store.artifacts.listVersions(artifact.id)[0];
    if (!version) throw new Error('reference artifact version missing');
    fixture.store.artifactInputRelations.saveForRun(
      version.id,
      firstRun,
      [{ input: reference, relation: 'data' }],
      (input, runId) =>
        runId === firstRun &&
        input.kind === 'workspace-input-snapshot' &&
        input.snapshotId === reference.snapshotId,
      'model',
    );
    const operationId = randomUUID();
    const memoryReceipt = await fixture.memories.create({
      operationId,
      content: '收入按回款金额统计的经营分析口径。',
      facet: 'fact',
      scope: { kind: 'workspace', workspaceId },
      sourceSelector: {
        kind: 'artifact-version',
        artifactVersionId: version.id,
        locator: '第 1 段',
        selectedText: '收入按回款金额统计的经营分析口径。',
      },
      asUserInstruction: false,
    });
    if (!memoryReceipt.ok) throw new Error(`参考成果记忆写入失败：${memoryReceipt.error.code}`);
    const memoryRevisionId = memoryReceipt.data.committedRevisionIds[0];
    const memory = memoryRevisionId
      ? fixture.store.memories.getRevision(memoryRevisionId)
      : undefined;
    if (!memory) throw new Error('reference-derived memory missing');
    expect(memory.provenance.verification).toBe('verified');
    if (memory.provenance.verification === 'verified') {
      expect(memory.provenance.materialDependencies).toContainEqual(reference);
    }

    const removedContext = fixture.store.taskContexts.save(
      fixture.taskId,
      {
        executor: { kind: 'general' },
        skillBindings: [],
        materials: [],
        scheduleSourceSnapshotId: null,
      },
      scheduled.context.revision,
    );
    const withoutSourceRun = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请按收入按回款金额统计的口径出月报。',
      taskContextRevisionId: removedContext.id,
      expectedTaskContextRevision: removedContext.revision,
    });
    await waitForCompletion(fixture, withoutSourceRun);
    expect(statusOf(fixture, withoutSourceRun)).toBe('completed');
    expect(fixture.store.runContextSnapshots.get(firstRun)?.contextSegmentId).not.toBe(
      fixture.store.runContextSnapshots.get(withoutSourceRun)?.contextSegmentId,
    );
    expect(fixture.store.runMemoryContexts.get(withoutSourceRun)?.selectedItems).toEqual([]);
    expect(fixture.store.runMemoryContexts.get(withoutSourceRun)?.replay).toContainEqual(
      expect.objectContaining({ runId: firstRun, replayed: false }),
    );

    const supplementedContext = fixture.store.taskContexts.save(
      fixture.taskId,
      {
        executor: { kind: 'general' },
        skillBindings: [],
        materials: [{ reference, purpose: 'current-input', addedFrom: 'user-input' }],
        scheduleSourceSnapshotId: null,
      },
      removedContext.revision,
    );
    const supplementedRun = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请按收入按回款金额统计的口径出月报。',
      taskContextRevisionId: supplementedContext.id,
      expectedTaskContextRevision: supplementedContext.revision,
    });
    await waitForCompletion(fixture, supplementedRun);
    expect(statusOf(fixture, supplementedRun)).toBe('completed');
    expect(
      fixture.store.runMemoryContexts
        .get(supplementedRun)
        ?.selectedItems.map((item) => item.revisionId),
    ).toContain(memory.revisionId);
    expect(fixture.store.runMemoryContexts.get(supplementedRun)?.replay).toContainEqual(
      expect.objectContaining({ runId: firstRun, replayed: true }),
    );

    const continuedArtifact = fixture.store.artifacts.saveMarkdown({
      artifactId: artifact.id,
      taskId: fixture.taskId,
      origin: 'assistant-run',
      runId: supplementedRun,
      title: '本期定时参考成果（人工续作）',
      content: '人工续作后的新版本。',
    });
    expect(continuedArtifact.id).toBe(artifact.id);
    expect(continuedArtifact.versionNumber).toBe(2);
    const preservedAutomaticVersion = fixture.store.artifacts.getVersionDetail(version.id);
    expect(preservedAutomaticVersion).toMatchObject({
      id: version.id,
      artifactId: artifact.id,
      versionNumber: 1,
      sourceRunId: firstRun,
      content: '依据：收入按回款金额统计的经营分析口径。',
    });
    expect(fixture.store.artifacts.listVersions(artifact.id).map((item) => item.id)).toEqual([
      continuedArtifact.currentVersionId,
      version.id,
    ]);
  });

  it('cancels a running run, records the terminal event, and broadcasts every event in order', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
    });
    expect(service.cancel(runId)).toBe(true);
    await waitForCompletion(fixture, runId);

    const events = fixture.store.runs.listEvents(runId).map((event) => event.type);
    expect(events[0]).toBe('run.started');
    expect(events.at(-1)).toBe('run.cancelled');
    expect(window.runEventTypes()).toEqual(events);
    expect(window.notificationEventTypes()).toEqual([]);
    // 取消是用户主动行为，不产生通知
    expect(fixture.store.notifications.list()).toEqual([]);
    expect(fixture.store.taskContinuity.getLatest(fixture.taskId)?.revision).toBe(1);

    expect(service.isActive(runId)).toBe(false);
    expect(service.cancel(runId)).toBe(false);
  });

  it('keeps an Expert snapshot on cancellation and allows a fresh Run to restart', async () => {
    const fixture = await createFixture();
    const expert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '经营分析专家',
        summary: '取消后仍保留本次运行的专家身份',
        author: '',
        tags: [],
        identity: '负责经营分析。',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
    });
    const service = createService(fixture);

    const cancelledRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '取消本期经营分析',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    expect(service.cancel(cancelledRunId)).toBe(true);
    await waitForCompletion(fixture, cancelledRunId);

    expect(statusOf(fixture, cancelledRunId)).toBe('cancelled');
    expect(fixture.store.runContextSnapshots.get(cancelledRunId)).toMatchObject({
      taskContextRevisionId: context.id,
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
    });

    const restartedRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '重新生成本期经营分析',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, restartedRunId);

    expect(restartedRunId).not.toBe(cancelledRunId);
    expect(statusOf(fixture, restartedRunId)).toBe('completed');
    expect(fixture.store.runContextSnapshots.get(restartedRunId)).toMatchObject({
      taskContextRevisionId: context.id,
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
    });
    expect(fixture.store.runs.listEvents(cancelledRunId).at(-1)).toMatchObject({
      type: 'run.cancelled',
    });
  });

  it('does not carry the first period conversation into a new Expert Task', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const secondTask = fixture.store.tasks.create(workspaceId, '第二期报告', '独立的下一期任务');
    fixture.store.taskContinuity.initializeFromTaskGoal(secondTask.task.id);
    const expert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '连续报告专家',
        summary: '每期独立执行的报告专家',
        author: '',
        tags: [],
        identity: '负责连续期间报告。',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const firstContext = fixture.store.taskContexts.save(fixture.taskId, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
    });
    const secondContext = fixture.store.taskContexts.save(secondTask.task.id, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
    });
    const fetchMock = vi.fn(async () =>
      sseResponse(JSON.stringify({ choices: [{ delta: { content: '本期报告已完成。' } }] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '连续报告测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const firstRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '第一期私密经营数据：收入 100',
      taskContextRevisionId: firstContext.id,
      expectedTaskContextRevision: firstContext.revision,
    });
    await waitForCompletion(fixture, firstRunId);
    const secondRunId = service.start({
      taskId: secondTask.task.id,
      sessionId: secondTask.sessionId,
      prompt: '第二期公开经营数据：收入 120',
      taskContextRevisionId: secondContext.id,
      expectedTaskContextRevision: secondContext.revision,
    });
    await waitForCompletion(fixture, secondRunId);

    expect(statusOf(fixture, firstRunId)).toBe('completed');
    expect(statusOf(fixture, secondRunId)).toBe('completed');
    expect(firstRunId).not.toBe(secondRunId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1] as unknown[] | undefined;
    const secondRequest = secondCall?.[1] as RequestInit | undefined;
    const secondBody = JSON.parse(String(secondRequest?.body)) as {
      messages?: Array<{ content?: string }>;
    };
    const secondMessages = secondBody.messages?.map((message) => message.content ?? '') ?? [];
    expect(secondMessages).toContain('第二期公开经营数据：收入 120');
    expect(secondMessages).not.toContain('第一期私密经营数据：收入 100');
    expect(fixture.store.runContextSnapshots.get(firstRunId)).toMatchObject({
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
    });
    expect(fixture.store.runContextSnapshots.get(secondRunId)).toMatchObject({
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
    });
  });

  it('injects a stable read manifest for the materials selected in the TaskContext', async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.directory, 'selected.md');
    await writeFile(sourcePath, '# 本期输入\n收入：130万元，预算：125万元。');
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: receipt.snapshot.id,
            workspaceId,
            contentHash: receipt.snapshot.contentHash,
            format: receipt.snapshot.format,
            fileKey: receipt.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
    });
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'manifest-read',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'selected.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(
        JSON.stringify({
          choices: [{ delta: { content: '已完成，收入 130 万元，预算达成率 104%。' } }],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '材料清单测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取本次选择的材料并完成经营分析。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    const request = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as
      RequestInit | undefined;
    const body = JSON.parse(String(request?.body)) as {
      messages?: Array<{ content?: string }>;
    };
    const messages = body.messages?.map((message) => message.content ?? '') ?? [];
    const manifest = messages.find((message) => message.includes('本次可读材料'));
    expect(manifest).toContain('selected.md');
    expect(manifest).toContain(receipt.snapshot.id);
    expect(manifest).toContain('read_text_file');
    expect(manifest).toContain('本期输入');
    expect(messages.at(-2)).toContain('历史对话和旧助手回复不是本次 Run 的证据');
    expect(messages.at(-2)).toContain('不要把不同期间的客户数相加');
  });

  it('fails a material-scoped run that completes without reading selected materials', async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.directory, 'selected.md');
    await writeFile(sourcePath, '# 本期输入\n收入：130万元。');
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: receipt.snapshot.id,
            workspaceId,
            contentHash: receipt.snapshot.contentHash,
            format: receipt.snapshot.format,
            fileKey: receipt.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
    });
    const fetchMock = vi.fn(async () =>
      sseResponse(
        JSON.stringify({ choices: [{ delta: { content: '已完成，材料读取准备就绪。' } }] }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '材料读取足迹测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取材料并整理经营摘要。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'run.failed',
        error: expect.stringContaining('没有成功读取任何材料'),
      }),
    );
  });

  it('fails a material-scoped run when the final answer invents a customer count', async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.directory, 'selected.md');
    await writeFile(sourcePath, '# 本期输入\n收入：130万元，预算：125万元。客户数量未提供。');
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: receipt.snapshot.id,
            workspaceId,
            contentHash: receipt.snapshot.contentHash,
            format: receipt.snapshot.format,
            fileKey: receipt.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
    });
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-read',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'selected.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(JSON.stringify({ choices: [{ delta: { content: '客户数：3家。' } }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '事实门禁测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取材料并整理经营摘要。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'run.failed',
        error: expect.stringContaining('材料事实校验失败'),
      }),
    );
    expect(fixture.store.materialReads.listByRun(runId)).toEqual([
      expect.objectContaining({ locator: 'selected.md' }),
    ]);
  });

  it.each([
    ['material', '家', ' ', '10'],
    ['material', '户', '\t', '10'],
    ['material', '客户', '　', '10'],
    ['material', '%', ' ', '10'],
    ['material', '％', '　', '10'],
    ['prompt', '家', ' ', '10'],
    ['prompt', '%', '\t', '10'],
    ['material', '％', ' ', '-12.5'],
    ['prompt', '%', '　', '+10.25'],
    ['material', '家', '\n', '10.5'],
  ])(
    'accepts %s facts with whitespace before %s (%j): %s',
    async (source, unit, whitespace, value) => {
      const fixture = await createFixture();
      const fact = `本期记录：${value}${whitespace}${unit}。`;
      const context = await saveSingleMaterialContext(
        fixture,
        source === 'material' ? fact : '本期口径说明。',
      );
      let requestCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          requestCount += 1;
          if (requestCount === 1)
            return sseResponse(
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'read-whitespace-fact',
                          function: {
                            name: 'read_text_file',
                            arguments: JSON.stringify({ path: 'selected.md' }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            );
          return sseResponse(
            JSON.stringify({ choices: [{ delta: { content: `本期记录：${value}${unit}。` } }] }),
          );
        }),
      );
      fixture.store.models.save({
        name: '单位空白回归模型',
        provider: 'openai-compatible',
        baseUrl: 'http://model.test/v1',
        model: 'fixture-model',
        role: 'language',
        apiKey: '',
        maxContextTokens: 8_192,
        maxOutputTokens: 1_024,
        temperature: 0,
        enabled: true,
      });
      const service = createService(fixture);
      const runId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: `读取材料并整理经营摘要。${source === 'prompt' ? fact : ''}`,
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
      });
      await waitForCompletion(fixture, runId);
      expect(fixture.store.runs.listEvents(runId).at(-1)).toMatchObject({ type: 'run.completed' });
      expect(statusOf(fixture, runId)).toBe('completed');
      expect(fixture.store.materialReads.listByRun(runId)).toHaveLength(1);
    },
  );

  it('accepts a customer-count table label with a supported value', async () => {
    const fixture = await createFixture();
    const context = await saveSingleMaterialContext(fixture, '客户数（家） | 本期 | 1');
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-read-count-table',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'selected.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(
        JSON.stringify({ choices: [{ delta: { content: '客户数（家） | 本期 | 1' } }] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '客户数表格测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取材料并整理经营摘要。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
  });

  it('fails a material-scoped run when the final answer invents a qualitative status', async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.directory, 'selected.md');
    await writeFile(sourcePath, '# 本期输入\n续约客户：续约意向待确认。');
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: receipt.snapshot.id,
            workspaceId,
            contentHash: receipt.snapshot.contentHash,
            format: receipt.snapshot.format,
            fileKey: receipt.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
    });
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-read-qualitative',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'selected.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(JSON.stringify({ choices: [{ delta: { content: '该客户已续约。' } }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '定性事实门禁测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取材料并整理续约风险。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'run.failed',
        error: expect.stringContaining('定性事实'),
      }),
    );
  });

  it('does not reuse an amount as a customer count', async () => {
    const fixture = await createFixture();
    const context = await saveSingleMaterialContext(
      fixture,
      '# 本期输入\n收入：130万元，预算：125万元。客户数量未提供。',
    );
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-read-unit-boundary',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'selected.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(JSON.stringify({ choices: [{ delta: { content: '客户数：130家。' } }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '单位边界测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取材料并整理经营摘要。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'run.failed',
        error: expect.stringContaining('材料事实校验失败'),
      }),
    );
  });

  it('does not reuse an amount as a percentage', async () => {
    const fixture = await createFixture();
    const context = await saveSingleMaterialContext(
      fixture,
      '# 本期输入\n收入：130万元，预算：125万元。',
    );
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse(
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-read-percentage-boundary',
                      function: {
                        name: 'read_text_file',
                        arguments: JSON.stringify({ path: 'selected.md' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      return sseResponse(
        JSON.stringify({ choices: [{ delta: { content: '收入增长率：130%。' } }] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '百分比单位边界测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取材料并整理经营摘要。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'run.failed',
        error: expect.stringContaining('材料事实校验失败'),
      }),
    );
  });

  it('rejects a Session that belongs to a different Task before creating a Run', async () => {
    const fixture = await createFixture();
    const otherTask = fixture.store.tasks.create(
      fixture.store.tasks.getWorkspaceId(fixture.taskId) ?? '',
      '另一项任务',
      '不应共享会话',
    );
    const service = createService(fixture);

    expect(() =>
      service.start({
        taskId: fixture.taskId,
        sessionId: otherTask.sessionId,
        prompt: '错误组合的任务与会话',
      }),
    ).toThrow('Session does not belong to task');
    expect(fixture.store.runs.list()).toEqual([]);
  });

  it('registers the web search tool only when a search engine is configured', () => {
    const knowledgeSearch = async () => [];
    expect(createRunTools({ knowledgeSearch }).map((tool) => tool.name)).toEqual([
      'calculator',
      'analyze_business_metrics',
      'read_text_file',
      'knowledge_search',
    ]);
    expect(
      createRunTools({ knowledgeSearch, webSearch: async () => ({ results: [] }) }).map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'calculator',
      'analyze_business_metrics',
      'read_text_file',
      'knowledge_search',
      'web_search',
    ]);
    expect(
      createRunTools({
        knowledgeSearch,
        webFetch: async (url) => ({
          url,
          title: '页面',
          content: '正文',
          contentType: 'text/html',
          status: 200,
          retrievedAt: 1,
          truncated: false,
        }),
      }).map((tool) => tool.name),
    ).toEqual([
      'calculator',
      'analyze_business_metrics',
      'read_text_file',
      'knowledge_search',
      'web_fetch',
    ]);
    expect(
      createRunTools({
        knowledgeSearch,
        officeMaterialReader: async (input) => ({ sourceKind: input.sourceKind }),
      }).map((tool) => tool.name),
    ).toEqual([
      'calculator',
      'analyze_business_metrics',
      'read_text_file',
      'knowledge_search',
      'read_office_material',
    ]);
  });

  it('runs selected web_fetch and records the fetched page as web evidence', async () => {
    const fixture = await createFixture();
    const fetchedUrl = 'https://example.com/finance';
    const service = createService(fixture, undefined, undefined, async (url) => ({
      url,
      title: '财务规则页面',
      content: '公开页面中的财务规则正文。',
      contentType: 'text/html',
      status: 200,
      retrievedAt: 1,
      truncated: false,
    }));
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['web_fetch'] },
      materials: [],
    });

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: `抓取网页: ${fetchedUrl}`,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        output: expect.objectContaining({ url: fetchedUrl, title: '财务规则页面' }),
      }),
    );
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([
      expect.objectContaining({
        runId,
        sourceUri: fetchedUrl,
        title: '财务规则页面',
        locator: 'text/html · HTTP 200',
      }),
    ]);
  });

  it('parses a selected CSV through read_office_material and records its locator', async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.directory, 'monthly.csv');
    await writeFile(sourcePath, 'month,revenue\n2026-09,120\n');
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const receipt = await fixture.inputSnapshots.create({
      workspaceId,
      workspaceRoot: fixture.directory,
      sourcePath,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_office_material'] },
      materials: [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: receipt.snapshot.id,
            workspaceId,
            contentHash: receipt.snapshot.contentHash,
            format: receipt.snapshot.format,
            fileKey: receipt.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ],
    });
    const service = createService(
      fixture,
      undefined,
      undefined,
      undefined,
      new OfficeParserService(),
    );
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: `读取 Office: ${JSON.stringify({
        sourceKind: 'workspace-input-snapshot',
        snapshotId: receipt.snapshot.id,
      })}`,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId, 800);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        output: expect.objectContaining({
          format: 'csv',
          sections: [
            expect.objectContaining({
              locator: 'rows:1-2',
              kind: 'cells',
            }),
          ],
        }),
      }),
    );
    expect(fixture.store.materialReads.listByRun(runId)).toEqual([
      expect.objectContaining({ runId, operation: 'parse', locator: 'rows:1-2' }),
    ]);
  });

  it('runs the deterministic business analysis tool under an Expert allow-list', async () => {
    const fixture = await createFixture();
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['analyze_business_metrics'] },
      materials: [],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: `经营分析: ${JSON.stringify({
        period: '2026-09',
        current: { revenue: 120 },
        previous: { revenue: 100 },
      })}`,
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        output: expect.objectContaining({
          period: '2026-09',
          metrics: [expect.objectContaining({ metric: 'revenue', change: 20, changeRate: 0.2 })],
        }),
      }),
    );
  });

  it('closes cancellation during MCP discovery before model dispatch with one cancelled terminal event', async () => {
    const fixture = await createFixture();
    const mcp = new McpClientService(fixture.store);
    const connection = fixture.store.mcpConnections.save({
      name: 'Cancellation fixture',
      transport: { kind: 'stdio', command: process.execPath, args: [mcpFixturePath] },
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      mcpToolBindings: [
        {
          connectionId: connection.id,
          toolId: `${connection.id}/read`,
          connectionRevisionId: connection.revisionId,
          contractHash: 'a'.repeat(64),
        },
      ],
    });
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(mcp, 'createAgentTools').mockImplementation(
      async (_bindings, _runId, signal) =>
        new Promise((resolve, reject) => {
          entered?.();
          const abort = (): void => reject(abortError());
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
          void resolve;
        }),
    );
    const provider = captureFakeProviderRequests();
    const service = createService(fixture, undefined, undefined, undefined, undefined, mcp);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'Read',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    try {
      await started;
      expect(service.cancel(runId)).toBe(true);
      await waitForCompletion(fixture, runId);
      expect(statusOf(fixture, runId)).toBe('cancelled');
      expect(
        fixture.store.runs
          .listEvents(runId)
          .filter((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)),
      ).toHaveLength(1);
      expect(provider.requests).toHaveLength(0);
      expect(service.isActive(runId)).toBe(false);
    } finally {
      provider.restore();
      await mcp.shutdown();
    }
  });

  it('routes a selected MCP tool through the Run model tool boundary', async () => {
    const fixture = await createFixture();
    const mcp = new McpClientService(fixture.store);
    const connection = fixture.store.mcpConnections.save({
      name: '财务替身',
      transport: { kind: 'stdio', command: process.execPath, args: [mcpFixturePath] },
    });
    const discovered = await mcp.testConnection(connection.id);
    const discoveredTool = discovered.tools[0];
    if (!discoveredTool) throw new Error('MCP tool was not discovered');
    if (!connection.revisionId || !discoveredTool.contractHash)
      throw new Error('Missing MCP revision or contract');
    mcp.reviewTool({
      connectionId: connection.id,
      connectionRevisionId: connection.revisionId,
      toolId: discoveredTool.id,
      contractHash: discoveredTool.contractHash,
      userConfirmed: true,
    });
    mcp.setLifecycle({
      id: connection.id,
      expectedRevisionId: connection.revisionId,
      lifecycle: 'enabled',
    });
    const binding = {
      connectionId: connection.id,
      connectionRevisionId: connection.revisionId,
      toolId: discoveredTool.id,
      contractHash: discoveredTool.contractHash,
    };
    const agentTool = { name: mcpModelAlias(connection.id, discoveredTool.id) };

    const fetchMock = vi.fn(async () =>
      fetchMock.mock.calls.length === 1
        ? sseResponse(
            JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'mcp-call-1',
                        function: {
                          name: agentTool.name,
                          arguments: JSON.stringify({ month: '2026-08' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          )
        : sseResponse(
            JSON.stringify({ choices: [{ delta: { content: '已读取 MCP 财务数据。' } }] }),
          ),
    );
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: '测试兼容模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      mcpToolBindings: [binding],
    });
    const service = createService(fixture, undefined, undefined, undefined, undefined, mcp);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '读取 2026-08 的 MCP 财务数据',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });

    try {
      await waitForCompletion(fixture, runId, 800);
      expect(statusOf(fixture, runId)).toBe('completed');
      expect(fixture.store.runs.listEvents(runId)).toContainEqual(
        expect.objectContaining({
          type: 'tool.completed',
          output: expect.stringContaining('fixture-ledger'),
        }),
      );
      expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([
        expect.objectContaining({
          runId,
          sourceType: 'mcp-tool',
          sourceUri: `mcp:${binding.connectionId}/${binding.toolId}`,
          excerpt: expect.stringContaining('fixture-ledger'),
        }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fixture.store.runContextSnapshots.get(runId)).toMatchObject({
        taskContextRevisionId: context.id,
        mcpToolBindings: [binding],
      });
      const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
      const firstRequest = firstCall?.[1] as RequestInit | undefined;
      const requestBody = JSON.parse(String(firstRequest?.body)) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      expect(requestBody.tools?.map((tool) => tool.function?.name)).toContain(agentTool.name);
    } finally {
      await mcp.shutdown();
    }
  });

  it('applies an Expert built-in tool allow-list without exposing omitted tools', () => {
    const knowledgeSearch = async () => [];
    expect(
      createRunTools({
        knowledgeSearch,
        webSearch: async () => ({ results: [] }),
        allowedBuiltinToolNames: new Set(['calculator']),
      }).map((tool) => tool.name),
    ).toEqual(['calculator']);
  });

  it('routes an Expert TaskContext to its pinned tool policy before a Run starts', async () => {
    const fixture = await createFixture();
    const expert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '只读专家',
        summary: '只允许读取工作区文件',
        author: '',
        tags: [],
        identity: '负责只读检查。',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
        modelReference: { mode: 'application-default' },
      },
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
    });

    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '计算: 1 + 1',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    expect(fixture.store.runContextSnapshots.get(runId)).toMatchObject({
      taskContextRevisionId: context.id,
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['read_text_file'] },
      mcpToolBindings: [],
    });
    expect(fixture.store.runs.listEvents(runId).at(-1)).toMatchObject({
      type: 'run.failed',
      error: 'Unknown tool: calculator',
    });
  });

  it('creates a notification with a task target when a run completes', async () => {
    const fixture = await createFixture();
    const window = createWindowStub({ focused: true });
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '计算: 1 + 1',
    });
    await waitForCompletion(fixture, runId);

    const notifications = fixture.store.notifications.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(
      expect.objectContaining({
        level: 'success',
        kind: 'run',
        // 跑成功照样留档，但落库即已读：铃铛那个数字只数还需要处理的（docs/10 §11.5）。
        read: true,
        target: { kind: 'task', taskId: fixture.taskId },
      }),
    );
    expect(notifications[0]?.title).toContain('任务完成');
    expect(window.notificationEventTypes()).toEqual(['created']);
  });

  it('synthesizes a terminal failure when orchestration breaks before the event loop', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);
    // 模拟编排层在进入事件循环前出错：读模型配置就抛异常。
    // 引擎因此根本不会产出任何事件，终态必须由 RunService 兜底。
    fixture.store.models.getForRun = () => {
      throw new Error('模型配置读取失败');
    };

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '计算: 1 + 1',
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    expect(events.map((event) => event.type)).toEqual(['run.failed']);
    expect(events[0]).toMatchObject({ type: 'run.failed', error: '模型配置读取失败' });
    // 兜底出来的终态同样要广播，否则界面会一直显示「进行中」
    expect(window.runEventTypes()).toEqual(['run.failed']);

    const notifications = fixture.store.notifications.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(
      expect.objectContaining({
        level: 'error',
        kind: 'run',
        target: { kind: 'task', taskId: fixture.taskId },
      }),
    );
    expect(notifications[0]?.detail).toContain('模型配置读取失败');
  });

  it('closes runs left in progress by a previous crashed process', async () => {
    const fixture = await createFixture();
    fixture.store.runs.create({
      id: 'run-interrupted',
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '上次没跑完',
      status: 'running',
      createdAt: Date.now() - 60_000,
    });

    expect(fixture.store.runs.failInterruptedRuns('算台上次退出时这次执行被中断', Date.now())).toBe(
      1,
    );
    expect(statusOf(fixture, 'run-interrupted')).toBe('failed');
    expect(fixture.store.runs.listEvents('run-interrupted').at(-1)).toMatchObject({
      type: 'run.failed',
    });
    // 已经收口的 Run 不会被二次改写
    expect(fixture.store.runs.failInterruptedRuns('再来一次', Date.now())).toBe(0);
  });

  it('refuses to start a run with an untrusted skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const skillId = 'skill-untrusted';
    const contentHash = 'a'.repeat(64);
    const resourceKey = `user/${skillId}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', skillId, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: 测试 Skill\n---\n指令内容');
    fixture.store.skills.save({
      id: skillId,
      name: '测试 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: 'pending',
    });
    const revisionId = fixture.store.skills.saveRevision({
      skillId,
      contentHash,
      resourceKey,
      frontmatter: { name: '测试 Skill' },
    });
    fixture.store.skills.save({
      id: skillId,
      name: '测试 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
    });

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '使用 Skill',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed' });
    const error = (events.at(-1) as { type: 'run.failed'; error: string }).error;
    expect(error).toContain('尚未信任');
  });

  it('refuses to start a run with a disabled skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const skillId = 'skill-disabled';
    const contentHash = 'b'.repeat(64);
    const resourceKey = `user/${skillId}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', skillId, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: 停用 Skill\n---\n指令内容');
    fixture.store.skills.save({
      id: skillId,
      name: '停用 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: 'pending',
    });
    const revisionId = fixture.store.skills.saveRevision({
      skillId,
      contentHash,
      resourceKey,
      frontmatter: { name: '停用 Skill' },
    });
    fixture.store.skills.save({
      id: skillId,
      name: '停用 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
    });
    fixture.store.skills.setEnabled(skillId, false);
    fixture.store.skills.setTrustPreference(skillId, 'trusted');
    fixture.store.skills.saveTrustGrant({
      skillId,
      revisionId,
      profileHash: 'hash',
      dependencyFingerprint: 'fp',
      scopeHash: 'scope',
      source: 'user',
    });

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '使用 Skill',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    const error = (events.at(-1) as { type: 'run.failed'; error: string }).error;
    expect(error).toContain('已停用');
  });

  /** 创建一个已信任且已启用的 Skill，返回 skillId 供后续绑定。 */
  const createTrustedSkill = async (
    fixture: Fixture,
    id: string,
    name = '测试 Skill',
    runtimeProfile: RuntimeProfileDraft = {
      commands: [],
      environmentRequirements: [],
      outputContract: { outputPaths: [] },
    },
  ): Promise<string> => {
    const skillContent = `---\nname: ${name}\n---\n指令内容`;
    const contentHash = createHash('sha256')
      .update('SKILL.md')
      .update('\0')
      .update(skillContent)
      .digest('hex');
    const resourceKey = `user/${id}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', id, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);
    fixture.store.skills.save({
      id,
      name,
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: 'pending',
    });
    const revisionId = fixture.store.skills.saveRevision({
      skillId: id,
      contentHash,
      resourceKey,
      frontmatter: { name },
    });
    const profileHash = `${id}-profile-hash`;
    const lockHash = `${id}-lock`;
    const profileId = fixture.store.skills.saveProfile({
      skillId: id,
      profileHash,
      profile: runtimeProfile,
    });
    fixture.store.skills.save({
      id,
      name,
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
      currentProfileRevisionId: profileId,
    });
    fixture.store.skills.setEnabled(id, true);
    fixture.store.skills.setTrustPreference(id, 'trusted');
    const grantId = fixture.store.skills.saveTrustGrant({
      skillId: id,
      revisionId,
      profileHash,
      dependencyFingerprint:
        runtimeProfile.commands.length > 0 ? computeDependencyFingerprint({ lockHash }) : 'fp',
      scopeHash: 'scope',
      source: 'user',
    });
    if (runtimeProfile.commands.length > 0) {
      const platform = { os: 'darwin', arch: 'arm64', abi: 'cp312' } as const;
      fixture.store.skills.saveDependencySelection(grantId, lockHash, []);
      const environment = fixture.store.environments.createEnvironment({
        environmentKey: `${id}-environment`,
        base: { kind: 'local', path: '/python', version: '3.12.14' },
        platform,
        lockHash,
        lock: {
          lockVersion: 1,
          platform,
          pythonRequirement: '3.12',
          packages: [],
          importProbes: [],
        },
        pathKey: `environments/${id}/instance`,
      });
      fixture.store.environments.updateStatus(environment.id, 'ready');
    }
    return id;
  };

  it('calls finishRun before publishing the terminal event for a skill-bound run', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-a15-order');
    const callOrder: string[] = [];
    // 绑定必须是库里的真行：指令注入现在只读快照，伪造的 bindingId 会被当场拒绝。
    const execution = createRealExecutionService(fixture);
    const mockExecution = {
      createBinding: (bindingInput: { runId: string; skillId: string }) =>
        execution.createBinding(bindingInput),
      async finishRun(): Promise<{ cancelled: number; cleanupFailed: number }> {
        callOrder.push('finishRun');
        return { cancelled: 0, cleanupFailed: 0 };
      },
    } as unknown as SkillExecutionService;
    const service = createService(fixture, window, mockExecution);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, runId);

    const events = fixture.store.runs.listEvents(runId);
    const terminalIndex = events.findIndex(
      (e) => e.type === 'run.completed' || e.type === 'run.failed' || e.type === 'run.cancelled',
    );
    expect(terminalIndex).toBeGreaterThan(0);
    expect(callOrder).toEqual(['finishRun']);
    expect(statusOf(fixture, runId)).toBe('completed');
  });

  it('synthesizes run.failed when finishRun throws during cleanup', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-a15-cleanup');
    const execution = createRealExecutionService(fixture);
    const mockExecution = {
      createBinding: (bindingInput: { runId: string; skillId: string }) =>
        execution.createBinding(bindingInput),
      async finishRun(): Promise<{ cancelled: number; cleanupFailed: number }> {
        throw new Error('子进程清理超时');
      },
    } as unknown as SkillExecutionService;
    const service = createService(fixture, window, mockExecution);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    const error = (events.at(-1) as { type: 'run.failed'; error: string }).error;
    expect(error).toContain('子进程清理失败');
    expect(error).toContain('子进程清理超时');
    expect(window.runEventTypes()).toContain('run.failed');
  });

  it('fails the Run when finishRun returns a cleanup failure report', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const execution = {
      async finishRun() {
        return { cancelled: 1, cleanupFailed: 1 };
      },
    } as unknown as SkillExecutionService;
    const service = createService(fixture, window, execution);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'hello',
    });
    await waitForCompletion(fixture, runId);
    expect(statusOf(fixture, runId)).toBe('failed');
    const terminals = window
      .runEventTypes()
      .filter((type) => ['run.completed', 'run.failed', 'run.cancelled'].includes(type));
    expect(terminals).toEqual(['run.failed']);
  });

  it('shutdown() aborts all active runs and waits for them to settle', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
    });
    expect(service.isActive(runId)).toBe(true);

    await service.shutdown();

    expect(statusOf(fixture, runId)).toBe('cancelled');
    expect(service.isActive(runId)).toBe(false);
    // shutdown 是批量取消，不产生通知
    expect(fixture.store.notifications.list()).toEqual([]);
    await service.shutdown();
    expect(() =>
      service.start({ taskId: fixture.taskId, sessionId: fixture.sessionId, prompt: 'late run' }),
    ).toThrow('退出');
  });

  it('cancelRunsForSkill() only cancels runs bound to the matching skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const targetSkill = await createTrustedSkill(fixture, 'skill-target', '目标 Skill');
    const otherSkill = await createTrustedSkill(fixture, 'skill-other', '其他 Skill');
    const service = createService(fixture, window);

    const targetRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBindings: [{ skillId: targetSkill }],
    });
    const otherRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBindings: [{ skillId: otherSkill }],
    });

    const cancelled = await service.cancelRunsForSkill(targetSkill);
    expect(cancelled).toBe(1);
    await waitForCompletion(fixture, targetRunId);
    await waitForCompletion(fixture, otherRunId);

    expect(statusOf(fixture, targetRunId)).toBe('cancelled');
    expect(statusOf(fixture, otherRunId)).toBe('completed');
  });

  it('cancels a multi-skill run once when one bound skill is revoked', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const targetSkill = await createTrustedSkill(fixture, 'skill-target-multi', '目标 Skill');
    const otherSkill = await createTrustedSkill(fixture, 'skill-other-multi', '其他 Skill');
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '同时使用两个 Skill',
      skillBindings: [{ skillId: targetSkill }, { skillId: otherSkill }],
    });

    expect(await service.cancelRunsForSkill(targetSkill)).toBe(1);
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('cancelled');
    const cancelledEvents = fixture.store.runs
      .listEvents(runId)
      .filter((event) => event.type === 'run.cancelled');
    expect(cancelledEvents).toHaveLength(1);
    const cancelledEvent = cancelledEvents[0];
    expect(cancelledEvent?.type).toBe('run.cancelled');
    if (cancelledEvent?.type === 'run.cancelled') {
      expect(cancelledEvent.reason).toContain('目标 Skill');
      expect(cancelledEvent.reason).toContain('信任已被撤销');
    }
  });

  it('cancelRunsForSkill() includes skill name in cancellation reason', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-ppt', 'PPT 生成专家');
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '生成 PPT',
      skillBindings: [{ skillId }],
    });

    await service.cancelRunsForSkill(skillId);
    await waitForCompletion(fixture, runId);

    const events = fixture.store.runs.listEvents(runId);
    const cancelledEvent = events.find((event) => event.type === 'run.cancelled');
    expect(cancelledEvent).toBeDefined();
    expect(cancelledEvent?.type).toBe('run.cancelled');
    if (cancelledEvent?.type === 'run.cancelled') {
      expect(cancelledEvent.reason).toContain('PPT 生成专家');
      expect(cancelledEvent.reason).toContain('信任已被撤销');
    }
  });

  /** 不启动任何进程的 supervisor：绑定登记不涉及 launch，Fake 模型也不会执行工具。 */
  const createUnusedSupervisor = (): ProcessSupervisor => ({
    launch: () => {
      throw new Error('supervisor must not be used in this test');
    },
  });

  const createRealExecutionService = (fixture: Fixture): SkillExecutionService =>
    new SkillExecutionService(fixture.store, createUnusedSupervisor());

  it('registers an explicitly requested Markdown work file after a successful Run', async () => {
    const fixture = await createFixture();
    const skillId = await createTrustedSkill(fixture, 'skill-markdown-delivery');
    const fetchMock = vi.fn(async () =>
      fetchMock.mock.calls.length === 1
        ? sseResponse(
            JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'write-markdown',
                        function: {
                          name: 'task_write_file',
                          arguments: JSON.stringify({
                            path: '2026-09-经营分析报告.md',
                            content: '# 经营分析报告\n\n收入：120 万元。',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          )
        : sseResponse(
            JSON.stringify({ choices: [{ delta: { content: '已完成 Markdown 交付。' } }] }),
          ),
    );
    vi.stubGlobal('fetch', fetchMock);
    fixture.store.models.save({
      name: 'Markdown 成果测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
      enabled: true,
    });
    const service = createService(fixture, undefined, createRealExecutionService(fixture));

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请完成工作，并把结果保存为 Markdown 成果。',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    const artifacts = fixture.store.artifacts.list(fixture.taskId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      title: '2026-09-经营分析报告',
      sourceRunId: runId,
      origin: 'assistant-run',
    });
    const artifact = artifacts[0];
    if (!artifact) throw new Error('artifact missing');
    expect(fixture.store.artifacts.getDetail(artifact.id)).toMatchObject({
      type: 'markdown',
      content: '# 经营分析报告\n\n收入：120 万元。',
    });
    // 运行访问记录不再自动变成采用声明：模型没调用 artifact_declare_sources 时版本是 none。
    expect(artifact.sourceDeclarationKind).toBe('none');
    expect(fixture.store.artifactInputRelations.listByVersion(artifact.currentVersionId)).toEqual(
      [],
    );
  });

  /** 记录 createBinding 的调用顺序，用于断言绑定建立即注入顺序。 */
  const createRecordingExecutionService = (
    fixture: Fixture,
    onBinding: (skillId: string) => void,
  ): SkillExecutionService => {
    const execution = createRealExecutionService(fixture);
    return {
      createBinding: (input: { runId: string; skillId: string }) => {
        onBinding(input.skillId);
        return execution.createBinding(input);
      },
      finishRun: (runId: string) => execution.finishRun(runId),
    } as unknown as SkillExecutionService;
  };

  it('records one binding snapshot per skill, in the order the user picked them', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const researchSkill = await createTrustedSkill(fixture, 'skill-multi-a', '研究 Skill');
    const reportSkill = await createTrustedSkill(fixture, 'skill-multi-b', '报告 Skill');
    const bindingOrder: string[] = [];
    const service = createService(
      fixture,
      window,
      createRecordingExecutionService(fixture, (skillId) => bindingOrder.push(skillId)),
    );

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '先研究再成稿',
      skillBindings: [{ skillId: researchSkill }, { skillId: reportSkill }],
    });
    await waitForCompletion(fixture, runId);
    expect(statusOf(fixture, runId)).toBe('completed');

    expect(bindingOrder).toEqual([researchSkill, reportSkill]);
    const bindings = fixture.store.executions.listBindingsByRun(runId);
    expect(bindings).toHaveLength(2);
    const snapshotOf = (skillId: string): { revisionId: string; profileId: string } => {
      const skill = fixture.store.skills.get(skillId);
      if (!skill?.runtimeProfile) throw new Error(`测试夹具缺少 Skill ${skillId}`);
      return { revisionId: skill.revision.id, profileId: skill.runtimeProfile.id };
    };
    const byRevision = new Map(
      bindings.map((binding) => [binding.skillRevisionId, binding] as const),
    );
    expect(byRevision.size).toBe(2);
    for (const skillId of [researchSkill, reportSkill]) {
      const { revisionId, profileId } = snapshotOf(skillId);
      const binding = byRevision.get(revisionId);
      // 每个技能必须各自快照，且只能用自己那份 grant，否则一个技能的授权会被另一个继承。
      expect(binding?.profileRevisionId).toBe(profileId);
      expect(fixture.store.executions.isBindingAuthorized(binding?.id ?? '')).toBe(true);
    }
  });

  it('sends the bound skill runtime contract and execution tools to the model', async () => {
    const fixture = await createFixture();
    const skillId = await createTrustedSkill(fixture, 'skill-runtime-tools', '可执行 Skill', {
      commands: [
        {
          commandId: 'project-init',
          label: '初始化项目',
          executableKey: 'managed-python',
          argumentSchema: { type: 'object', properties: { projectDir: { type: 'string' } } },
          timeoutMs: 60_000,
          expectedOutputs: [],
        },
      ],
      environmentRequirements: [],
      outputContract: { outputPaths: [] },
    });
    const captured = captureFakeProviderRequests();
    const service = createService(fixture, undefined, createRealExecutionService(fixture));

    try {
      const runId = service.start({
        taskId: fixture.taskId,
        sessionId: fixture.sessionId,
        prompt: '按技能指令开始工作。',
        skillBindings: [{ skillId }],
      });
      await waitForCompletion(fixture, runId);

      expect(statusOf(fixture, runId), JSON.stringify(fixture.store.runs.listEvents(runId))).toBe(
        'completed',
      );
      const binding = fixture.store.executions.listBindingsByRun(runId)[0];
      expect(binding).toBeDefined();
      expect(captured.toolNames.at(-1)).toEqual(
        expect.arrayContaining(['skill_read_resource', 'task_write_file', 'skill_execute']),
      );
      const runtimeMessage = captured.requests
        .at(-1)
        ?.find((message) => message.role === 'system' && message.content.includes('算台运行约定'));
      expect(runtimeMessage?.content).toContain(binding?.id ?? 'missing-binding');
      expect(runtimeMessage?.content).toContain('project-init');
      expect(runtimeMessage?.content).toContain('skill_execute');
    } finally {
      captured.restore();
    }
  });

  it('fails the whole run and records no binding when a later skill is untrusted', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const trustedSkill = await createTrustedSkill(fixture, 'skill-pair-trusted', '已信任 Skill');
    const untrustedSkill = await createTrustedSkill(
      fixture,
      'skill-pair-untrusted',
      '未信任 Skill',
    );
    fixture.store.skills.setTrustPreference(untrustedSkill, 'untrusted');
    const service = createService(fixture, window, createRealExecutionService(fixture));

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '两个技能一起用',
      skillBindings: [{ skillId: trustedSkill }, { skillId: untrustedSkill }],
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const error = (
      fixture.store.runs.listEvents(runId).at(-1) as { type: 'run.failed'; error: string }
    ).error;
    // 错误必须指名是哪个技能挡住整个 Run，否则用户无法从六个绑定里找出原因。
    expect(error).toContain('未信任 Skill');
    expect(error).toContain('尚未信任');
    expect(fixture.store.executions.listBindingsByRun(runId)).toEqual([]);
  });

  it('rejects a stale revisionId before creating any binding', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-stale-revision');
    const service = createService(fixture, window, createRealExecutionService(fixture));

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '使用旧修订运行',
      skillBindings: [{ skillId, revisionId: 'revision-from-another-skill' }],
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const error = (
      fixture.store.runs.listEvents(runId).at(-1) as { type: 'run.failed'; error: string }
    ).error;
    expect(error).toContain('修订已变化');
    expect(fixture.store.executions.listBindingsByRun(runId)).toEqual([]);
  });

  it('starts a skill-free run in a task whose earlier run was bound to a skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-no-inherit');
    const service = createService(fixture, window, createRealExecutionService(fixture));

    const firstRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请运行 Skill 的完整流程',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, firstRunId);
    expect(fixture.store.executions.listBindingsByRun(firstRunId)).toHaveLength(1);

    // 绑定属于 Run 而不是 Task：后续消息不显式选择技能，就必须什都拿不到。
    const secondRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '把结论改写成图表',
    });
    await waitForCompletion(fixture, secondRunId);

    expect(statusOf(fixture, secondRunId)).toBe('completed');
    expect(fixture.store.executions.listBindingsByRun(secondRunId)).toEqual([]);
  });

  it('keeps a skill-free run alive when an earlier skill was disabled mid-task', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-disabled-unrelated');
    const service = createService(fixture, window, createRealExecutionService(fixture));

    const firstRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请运行 Skill 的完整流程',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, firstRunId);
    fixture.store.skills.setEnabled(skillId, false);

    // 隐式继承曾让停用技能连带阻断同任务里毫不相干的后续 Run。
    const secondRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '把结论改写成图表',
    });
    await waitForCompletion(fixture, secondRunId);

    expect(statusOf(fixture, secondRunId)).toBe('completed');
  });

  it('cancelRunsForSkill() leaves runs that never bound the skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-cancel-unbound');
    const service = createService(fixture, window, createRealExecutionService(fixture));

    const boundRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '请运行 Skill 的完整流程',
      skillBindings: [{ skillId }],
    });
    await waitForCompletion(fixture, boundRunId);

    const unboundRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '把结论改写成图表',
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (service.isActive(unboundRunId)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(await service.cancelRunsForSkill(skillId)).toBe(0);
    await waitForCompletion(fixture, unboundRunId);
    expect(statusOf(fixture, unboundRunId)).toBe('completed');
  });
});

describe('CF11 credential dispatch gate', () => {
  it('fails a new run whose model credential is still pending migration, without a model request or plaintext fallback', async () => {
    const fixture = await createFixture();
    fixture.store.models.save({
      name: '待迁移模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'x',
      role: 'language',
      apiKey: 'sk-plain',
      enabled: true,
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
    });
    const resolveSecret = vi.fn(async () => 'SHOULD-NOT-USE');
    const resolver: CredentialResolver = { migrationStatus: () => 'pending', resolveSecret };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(
      fixture,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver,
    );
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '开始工作',
    });
    await waitForCompletion(fixture, runId);
    expect(statusOf(fixture, runId)).toBe('failed');
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the model secret from credentials (new-read-first) and sends it as Bearer when migration is done', async () => {
    const fixture = await createFixture();
    // 迁移完成后明文列已清空，Key 只在 credentials；旧派发会因空 Key 缺 Authorization。
    fixture.store.models.save({
      name: '已迁移模型',
      provider: 'openai-compatible',
      baseUrl: 'http://model.test/v1',
      model: 'x',
      role: 'language',
      apiKey: '',
      enabled: true,
      maxContextTokens: 8_192,
      maxOutputTokens: 1_024,
      temperature: 0,
    });
    const resolver: CredentialResolver = {
      migrationStatus: (ref) => (ref.ownerKind === 'model-profile' ? 'done' : 'none'),
      resolveSecret: async () => 'SK-FROM-CREDS',
    };
    const fetchMock = vi.fn(async () =>
      sseResponse(JSON.stringify({ choices: [{ delta: { content: '完成。' } }] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(
      fixture,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver,
    );
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '开始工作',
    });
    await waitForCompletion(fixture, runId);
    expect(statusOf(fixture, runId)).toBe('completed');
    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    const headers = (firstCall?.[1] as RequestInit | undefined)?.headers as
      Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer SK-FROM-CREDS');
  });
});
