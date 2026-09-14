import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { IpcChannel } from '@betterwork/agent-protocol';
import type { WebFetch } from '@betterwork/tool-runtime';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfficeParserService } from '../infrastructure/office-parser';
import type { ProcessSupervisor } from '../infrastructure/process-supervisor';
import { AppStore } from '../persistence';
import { InputSnapshotService } from './input-snapshot-service';
import { KnowledgeVault } from './knowledge-vault';
import { McpClientService } from './mcp-client-service';
import { MemoryService } from './memory-service';
import { NotificationService } from './notification-service';
import { createRunTools, RunService } from './run-service';
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
  new Response(`${payloads.map((payload) => `data: ${payload}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });

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

const createService = (
  fixture: Fixture,
  window?: WindowStub,
  skillExecutionService?: SkillExecutionService,
  webFetch?: WebFetch,
  officeParser?: OfficeParserService,
  mcpClientService?: McpClientService,
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
    undefined,
    fixture.inputSnapshots,
    fixture.taskMaterials,
    fixture.memories,
    mcpClientService,
    webFetch,
    officeParser,
  );

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

describe('RunService', () => {
  it('injects confirmed workspace memories and records their exact revisions', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const memory = fixture.store.memories.create({
      scope: { kind: 'workspace', workspaceId },
      kind: 'procedural',
      content: '经营月报必须先核对财务规则。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '准备本月经营分析。',
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.memories.listReads(runId)).toEqual([memory]);
  });

  it('injects only memories applicable to the selected Expert and Workspace', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const expert = fixture.store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '经营分析专家',
        summary: '使用工作区规则完成经营分析',
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
      fixture.store.memories.create({
        scope: { kind: 'workspace', workspaceId },
        kind: 'procedural',
        content: '当前工作区规则。',
        sourceType: 'user-explicit',
        status: 'confirmed',
      }),
      fixture.store.memories.create({
        scope: { kind: 'expert', expertId: expert.id },
        kind: 'semantic',
        content: '经营分析专家通用方法。',
        sourceType: 'user-explicit',
        status: 'confirmed',
      }),
      fixture.store.memories.create({
        scope: { kind: 'expert-workspace', expertId: expert.id, workspaceId },
        kind: 'procedural',
        content: '本公司经营分析方法。',
        sourceType: 'user-explicit',
        status: 'confirmed',
      }),
    ];
    const excluded = [
      fixture.store.memories.create({
        scope: { kind: 'expert', expertId: otherExpert.id },
        kind: 'semantic',
        content: '其他专家的记忆。',
        sourceType: 'user-explicit',
        status: 'confirmed',
      }),
      fixture.store.memories.create({
        scope: { kind: 'expert-workspace', expertId: expert.id, workspaceId: otherWorkspace.id },
        kind: 'procedural',
        content: '其他工作区的记忆。',
        sourceType: 'user-explicit',
        status: 'confirmed',
      }),
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
    expect(fixture.store.memories.listReads(runId).map((memory) => memory.id)).toEqual(
      expect.arrayContaining(applicable.map((memory) => memory.id)),
    );
    expect(fixture.store.memories.listReads(runId).map((memory) => memory.id)).not.toEqual(
      expect.arrayContaining(excluded.map((memory) => memory.id)),
    );
  });

  it('honors a TaskContext memory exclusion for only the next run', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.store.tasks.getWorkspaceId(fixture.taskId);
    if (!workspaceId) throw new Error('workspace missing');
    const memory = fixture.store.memories.create({
      scope: { kind: 'workspace', workspaceId },
      kind: 'semantic',
      content: '本任务暂不参考。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const context = fixture.store.taskContexts.save(fixture.taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      excludedMemoryIds: [memory.id],
    });
    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '不使用这条记忆。',
      taskContextRevisionId: context.id,
      expectedTaskContextRevision: context.revision,
    });
    await waitForCompletion(fixture, runId);

    expect(fixture.store.memories.listReads(runId)).toEqual([]);
  });

  it('records local knowledge search results as task evidence', async () => {
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

    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([
      expect.objectContaining({ runId, title: '客户资料', locator: '全文', sourceUri: note }),
    ]);
    expect(fixture.store.materialReads.listByRun(runId)).toEqual([
      expect.objectContaining({ runId, operation: 'search', locator: '全文' }),
    ]);
    expect(statusOf(fixture, runId)).toBe('completed');
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
    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([
      expect.objectContaining({ runId, sourceUri: selectedPath }),
    ]);
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
      prompt: '读取: secret.txt',
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

    expect(statusOf(fixture, runId)).toBe('completed');
    expect(fixture.store.runs.listEvents(runId)).toContainEqual(
      expect.objectContaining({
        type: 'tool.failed',
        error: expect.stringContaining('多个输入快照'),
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
    const knowledgeSearch = (): [] => [];
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
    const agentTool = (
      await mcp.createAgentTools([{ connectionId: connection.id, toolId: discoveredTool.id }])
    )[0];
    if (!agentTool) throw new Error('MCP AgentTool was not created');

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
      mcpToolBindings: [{ connectionId: connection.id, toolId: discoveredTool.id }],
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
          sourceUri: `mcp:${agentTool.name}`,
          excerpt: expect.stringContaining('fixture-ledger'),
        }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fixture.store.runContextSnapshots.get(runId)).toMatchObject({
        taskContextRevisionId: context.id,
        mcpToolBindings: [{ connectionId: connection.id, toolId: discoveredTool.id }],
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
    const knowledgeSearch = (): [] => [];
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
        read: false,
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
  ): Promise<string> => {
    const contentHash = id.repeat(32).slice(0, 64);
    const resourceKey = `user/${id}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', id, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n指令内容`);
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
    const profileId = fixture.store.skills.saveProfile({
      skillId: id,
      profileHash,
      profile: {
        commands: [],
        environmentRequirements: [],
        outputContract: { outputPaths: [] },
      },
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
    fixture.store.skills.saveTrustGrant({
      skillId: id,
      revisionId,
      profileHash,
      dependencyFingerprint: 'fp',
      scopeHash: 'scope',
      source: 'user',
    });
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
