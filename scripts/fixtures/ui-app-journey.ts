import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { abortError } from '@betterwork/agent-core';
import {
  IpcChannel,
  type MaterialReference,
  type RunSummary,
  type ScheduleConfigDraft,
} from '@betterwork/agent-protocol';
import { BrowserWindow, ipcMain, session } from 'electron';

import { registerIpc } from '../../apps/desktop/src/main/ipc/register-ipc';
import {
  AppStore,
  RUN_INTERRUPTED_ON_STARTUP_REASON,
} from '../../apps/desktop/src/main/persistence';
import { DiscussionCheckpointService } from '../../apps/desktop/src/main/services/discussion-checkpoint-service';
import { ExpertService } from '../../apps/desktop/src/main/services/expert-service';
import { createStoreExtractionSourceReader } from '../../apps/desktop/src/main/services/extraction-source-reader';
import {
  FakeDownloader,
  FakeFileSystem,
  FakePythonRunner,
  scenarioOf,
} from '../../apps/desktop/src/main/services/fixtures/fake-python-runtime';
import { InputSnapshotService } from '../../apps/desktop/src/main/services/input-snapshot-service';
import { KnowledgeIndexService } from '../../apps/desktop/src/main/services/knowledge-index-service';
import { KnowledgeSearchService } from '../../apps/desktop/src/main/services/knowledge-search';
import { KnowledgeVault } from '../../apps/desktop/src/main/services/knowledge-vault';
import { McpClientService } from '../../apps/desktop/src/main/services/mcp-client-service';
import { MemoryExtractionService } from '../../apps/desktop/src/main/services/memory-extraction-service';
import { MemoryRecallService } from '../../apps/desktop/src/main/services/memory-recall-service';
import { MemoryService } from '../../apps/desktop/src/main/services/memory-service';
import { ModelProviderFactory } from '../../apps/desktop/src/main/services/model-provider-factory';
import { NotificationService } from '../../apps/desktop/src/main/services/notification-service';
import { RunService } from '../../apps/desktop/src/main/services/run-service';
import { ScheduleDirectorySourcesService } from '../../apps/desktop/src/main/services/schedule-directory-sources';
import { ScheduleKnowledgeSourcesService } from '../../apps/desktop/src/main/services/schedule-knowledge-sources';
import { ScheduleNotificationService } from '../../apps/desktop/src/main/services/schedule-notification-service';
import { ScheduleOutcomeService } from '../../apps/desktop/src/main/services/schedule-outcome-service';
import { ScheduleOutputService } from '../../apps/desktop/src/main/services/schedule-output-service';
import { ScheduleService } from '../../apps/desktop/src/main/services/schedule-service';
import { ScheduleSourceService } from '../../apps/desktop/src/main/services/schedule-source-service';
import { SkillDependencyService } from '../../apps/desktop/src/main/services/skill-dependency-service';
import { SkillService } from '../../apps/desktop/src/main/services/skill-service';
import { TaskMaterialService } from '../../apps/desktop/src/main/services/task-material-service';
import { ToolchainSnapshotService } from '../../apps/desktop/src/main/services/toolchain-snapshot-service';
import { WorkspaceBriefService } from '../../apps/desktop/src/main/services/workspace-memory-brief-service';
import { WorkspaceReferenceService } from '../../apps/desktop/src/main/services/workspace-reference-service';
import { prepareAcceptanceSamples } from './acceptance-samples';
import { checkCaptureKeyboard } from './ui-keyboard';

const method = '每次复盘先核对口径，再给结论。';
const inputText = '合成资料：本期工作已完成，交付结论必须可追溯。';
export const bookDraftPath = path.resolve(process.cwd(), 'book/cn/parts/15-ch14.md');
const bookKnowledgeProof = '带坐标的断言';
export const sourceFileName = '第14章 Excel 分析.md';
const steps = [
  'ready',
  'navigation',
  'summon',
  'first-run',
  'capture-keyboard',
  'save-source',
  'save-method',
  'exclude',
  'restore',
  'second-draft',
  'second-run',
  'failed-run',
  'cancelled-run',
];

interface RequestReading {
  runId: string;
  body: string;
}
interface JourneyServices {
  store: AppStore;
  vault: KnowledgeVault;
  runs: RunService;
  extractions: MemoryExtractionService;
  inputSnapshots: InputSnapshotService;
  scheduleService: ScheduleService;
  scheduleSourceService: ScheduleSourceService;
  scheduleOutputs: ScheduleOutputService;
  scheduleOutcomes: ScheduleOutcomeService;
  scheduleNotifications: ScheduleNotificationService;
  seededScheduleId?: string;
}

export function assemble(
  directory: string,
  getWindow: () => BrowserWindow | null,
  recoverRuns = true,
): JourneyServices {
  const store = AppStore.open(path.join(directory, 'app.sqlite'));
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  const inputSnapshots = new InputSnapshotService(store, directory);
  const taskMaterials = new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots });
  const memories = new MemoryService(store, directory);
  const extractions = new MemoryExtractionService({
    jobs: store.memoryExtractions,
    memories: store.memories,
    operations: store.memoryOperations,
    transaction: <T>(body: () => T): T => store.transaction(body),
    sources: createStoreExtractionSourceReader(store),
    modelFactory: new ModelProviderFactory({ models: store.models }),
  });
  const skillService = new SkillService(store, {
    developmentBuiltinRoot: path.join(directory, 'empty-builtins'),
    installedBuiltinRoot: path.join(directory, 'empty-installed'),
    userRoot: path.join(directory, 'skills'),
  });
  // 通知仍真实落库；合成宿主不发操作系统通知、不抢用户焦点。
  const notifications = new NotificationService(store.notifications, () => null);
  const runs = new RunService(
    store,
    vault,
    notifications,
    skillService,
    getWindow,
    undefined,
    undefined,
    undefined,
    undefined,
    inputSnapshots,
    taskMaterials,
    extractions,
  );
  const filesystem = new FakeFileSystem();
  const processRunner = new FakePythonRunner(scenarioOf(), filesystem);
  const dependencies = new SkillDependencyService({
    store,
    paths: {
      userDataRoot: directory,
      pythonRoot: path.join(directory, 'python'),
      environmentsRoot: path.join(directory, 'environments'),
      wheelhouseRoot: path.join(directory, 'wheels'),
    },
    filesystem,
    process: processRunner,
    download: new FakeDownloader(),
  });
  const snapshots = new ToolchainSnapshotService({
    store,
    userDataRoot: directory,
    assetsRoot: path.join(directory, 'assets'),
    filesystem,
    process: processRunner,
  });
  const unavailable = (): never => {
    throw new Error('离线应用旅程禁止调用 Embedding');
  };
  const embedding = {
    defaultSnapshot: unavailable,
    snapshotOf: unavailable,
    embed: async () => unavailable(),
  };
  const knowledgeIndex = new KnowledgeIndexService({ vault, embedding });
  const knowledgeSearch = new KnowledgeSearchService({
    vault,
    index: vault.index,
    runMaterials: () => undefined,
    embedding,
  });
  const scheduleService = new ScheduleService(store, {
    now: Date.now,
    preflight: async () => ({ status: 'blocked', message: '合成 UI 宿主不启动定时规则' }),
    settleDue: async () => undefined,
    cancelPreparations: () => undefined,
  });
  const scheduleSourceService = new ScheduleSourceService(
    store,
    new ScheduleDirectorySourcesService(store, inputSnapshots),
    new ScheduleKnowledgeSourcesService(vault),
    inputSnapshots,
  );
  const scheduleOutputs = new ScheduleOutputService(store);
  const scheduleNotificationsRef: { current?: ScheduleNotificationService } = {};
  const scheduleOutcomes = new ScheduleOutcomeService(store, scheduleOutputs, {
    persistOccurrenceNotification: (occurrenceId) =>
      scheduleNotificationsRef.current?.persistOccurrenceWithinTransaction(occurrenceId)
        .afterCommit,
  });
  const scheduleNotifications = new ScheduleNotificationService(
    store,
    notifications,
    scheduleOutcomes,
  );
  scheduleNotificationsRef.current = scheduleNotifications;
  registerIpc({
    store,
    knowledgeVault: vault,
    knowledgeIndex,
    knowledgeSearch,
    taskMaterials,
    notifications,
    runs,
    skillService,
    expertService: new ExpertService(store),
    discussionCheckpoints: new DiscussionCheckpointService(store, extractions),
    memories,
    memoryRecall: new MemoryRecallService({ store }),
    memoryExtractions: extractions,
    workspaceBrief: new WorkspaceBriefService({ store }),
    workspaceReferences: new WorkspaceReferenceService({ store }),
    mcpClientService: new McpClientService(store),
    markNotificationRendererReady: () => true,
    dependencies,
    snapshots,
    scheduleService,
    schedulePreflight: {
      check: async () => ({ status: 'blocked', fingerprint: 'ui-fixture', problems: [] }),
    },
    scheduleDispatch: {
      prepareAndStart: async () => undefined,
      stopOccurrence: () => 'not-found',
    },
    scheduleOutputs,
    scheduleOutcomes,
    publishScheduleChange: () => undefined,
    dependencyLocksRoot: path.join(directory, 'locks'),
    getWindow,
    getDefaultWorkspaceRoot: () => path.join(directory, 'workspace'),
  });
  if (recoverRuns) store.runs.failInterruptedRuns(RUN_INTERRUPTED_ON_STARTUP_REASON, Date.now());
  extractions.recoverInterruptedJobs();
  return {
    store,
    vault,
    runs,
    extractions,
    inputSnapshots,
    scheduleService,
    scheduleSourceService,
    scheduleOutputs,
    scheduleOutcomes,
    scheduleNotifications,
  };
}

export async function seed(services: JourneyServices, directory: string): Promise<string> {
  const root = path.join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const sourcePath = path.join(root, sourceFileName);
  await copyFile(bookDraftPath, sourcePath);
  const bookText = await readFile(sourcePath, 'utf8');
  assert.ok(bookText.includes(bookKnowledgeProof), '知识夹具未使用中文书稿正文');
  const workspace = services.store.workspaces.getOrCreate(root, '协作旅程测试空间');
  await services.vault.importPaths([sourcePath]);
  const document = services.vault.listDocuments()[0];
  assert.ok(document, '合成知识导入失败');
  const revision = services.vault.listRevisions(document.id)[0];
  assert.ok(revision, '合成知识修订缺失');
  services.store.models.save({
    name: '离线确定性模型替身',
    provider: 'openai-compatible',
    baseUrl: 'http://offline.invalid/v1',
    model: 'synthetic',
    role: 'language',
    apiKey: '',
    enabled: true,
    maxContextTokens: 8192,
    maxOutputTokens: 1024,
    temperature: 0,
  });
  const expert = services.store.experts.create({
    sourceKind: 'user',
    revision: {
      name: '离线复盘专家',
      summary: '核对材料并生成可追溯复盘',
      author: '',
      tags: [],
      identity: '按明确工作口径复盘。',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
      referenceMaterials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: document.id,
            knowledgeRevisionId: revision.id,
            contentHash: revision.contentHash,
            sourcePath,
          },
          purpose: 'rule',
        },
      ],
    },
  });
  const scheduleConfig: ScheduleConfigDraft = {
    name: '离线旅程旁路定时规则',
    expertId: expert.id,
    expertRevisionId: expert.revision.id,
    requirements: '保留为暂停状态，用于普通任务回归隔离。',
    expectedArtifactTypes: ['markdown'],
    timing: {
      frequency: 'monthly',
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    },
    periodRule: 'previous-month',
    knowledgeSources: [],
    outputSubdirectory: '定时成果',
  };
  const schedule = await services.scheduleService.save({
    operation: 'create',
    workspaceId: workspace.id,
    config: scheduleConfig,
    targetLifecycle: 'paused',
  });
  services.seededScheduleId = schedule.schedule.id;
  assert.equal(
    services.store.memoryExtractions.getSettings(workspace.id).autoSuggestEnabled,
    false,
  );
  return bookText;
}

export function syntheticResponse(delta: unknown): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}
export function toolResponse(name: string, input: unknown, ordinal: number): Response {
  return syntheticResponse({
    tool_calls: [
      {
        index: 0,
        id: `offline-tool-${ordinal}`,
        function: { name, arguments: JSON.stringify(input) },
      },
    ],
  });
}

export async function runAppJourney(
  output: string,
  capture: (window: BrowserWindow, filename: string) => Promise<void>,
  probeLostRestore = false,
  journeyOptions: { interactive?: boolean; reopenDirectory?: string; silent?: boolean } = {},
): Promise<unknown> {
  // 输出目录可以复用，但每次合成数据库必须全新，不能继承上轮 Run 或探针的排除项。
  const directory =
    journeyOptions.reopenDirectory ?? (await mkdtemp(path.join(output, 'app-journey-')));
  let handedOff = false;
  const host: { window: BrowserWindow | null } = { window: null };
  let services = assemble(directory, () => host.window);
  const requests: RequestReading[] = [];
  const counters = new Map<string, number>();
  const originalFetch = globalThis.fetch;
  let mode: 'happy' | 'failure' | 'cancel' = 'happy';
  const cancellation = { entered: false, aborted: false };
  const networkAttempts: string[] = [];
  let seededScheduleId: string | undefined;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      networkAttempts.push(details.url);
      callback({ cancel: true });
    },
  );
  globalThis.fetch = async (target, options) => {
    assert.equal(
      typeof target === 'string' ? target : target instanceof URL ? target.href : target.url,
      'http://offline.invalid/v1/chat/completions',
      '非预期网络请求',
    );
    const run = services.store.runs.list().find((item) => item.status === 'running');
    assert.ok(run, '请求必须属于已落库的 Run');
    const body = typeof options?.body === 'string' ? options.body : '';
    requests.push({ runId: run.id, body });
    const payload: unknown = JSON.parse(body);
    const messages: unknown[] =
      payload &&
      typeof payload === 'object' &&
      'messages' in payload &&
      Array.isArray(payload.messages)
        ? (payload.messages as unknown[])
        : [];
    const latestUser = [...messages]
      .reverse()
      .find(
        (message) =>
          message && typeof message === 'object' && 'role' in message && message.role === 'user',
      );
    const prompt =
      latestUser &&
      typeof latestUser === 'object' &&
      'content' in latestUser &&
      typeof latestUser.content === 'string'
        ? latestUser.content
        : '';
    if (mode === 'failure' || (journeyOptions.interactive && prompt.includes('合成故障')))
      throw new Error('合成故障：离线请求失败');
    if (mode === 'cancel' || (journeyOptions.interactive && prompt.includes('合成挂起'))) {
      const signal = options?.signal;
      assert.ok(signal, '取消必须接到真实请求信号');
      cancellation.entered = true;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = (): void => {
          cancellation.aborted = true;
          reject(abortError());
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    const source: MaterialReference | undefined = services.store.runContextSnapshots.get(run.id)
      ?.materials[0]?.reference;
    assert.ok(source, '专家参考或换期精确版本未进入运行快照');
    const ordinal = (counters.get(run.id) ?? 0) + 1;
    counters.set(run.id, ordinal);
    if (ordinal === 1)
      return source.kind === 'knowledge-revision'
        ? toolResponse('read_knowledge', { reference: source }, ordinal)
        : source.kind === 'artifact-version'
          ? toolResponse(
              'read_artifact',
              { artifactId: source.artifactId, versionId: source.artifactVersionId },
              ordinal,
            )
          : (() => {
              throw new Error('非预期材料类型');
            })();
    if (ordinal === 2) {
      if (source.kind === 'knowledge-revision')
        assert.ok(
          body.includes(bookKnowledgeProof),
          '从书稿读取的知识正文未进入后续 Provider 请求',
        );
      return toolResponse(
        'artifact_declare_sources',
        {
          inputRelations: [
            {
              input: source,
              relation: source.kind === 'knowledge-revision' ? 'rule' : 'comparison',
            },
          ],
        },
        ordinal,
      );
    }
    return syntheticResponse({
      content:
        source.kind === 'knowledge-revision'
          ? '# 本期复盘已完成\n\n已核对选定资料与来源。'
          : '# 下期复盘已完成\n\n已读取精确上期成果，按复盘口径工作。',
    });
  };
  const readings: unknown[] = [];
  let first: RunSummary | undefined;
  let second: RunSummary | undefined;
  let firstVersionId: string | undefined;
  let excludedMemoryId: string | undefined;
  const sourcePath = path.join(directory, 'workspace', sourceFileName);
  let expectedSourceContent = '';
  const rendererErrors: string[] = [];
  const openWindow = async (): Promise<BrowserWindow> => {
    const instance = new BrowserWindow({
      width: 1380,
      height: 860,
      useContentSize: true,
      title: 'BetterWork · 离线合成验收（尚未人工验收）',
      minWidth: 980,
      minHeight: 640,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: path.join(output, 'app-preload.cjs'),
        offscreen: !journeyOptions.interactive,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    host.window = instance;
    instance.webContents.on('console-message', (details) => {
      if (details.level === 'error') rendererErrors.push(details.message);
    });
    instance.webContents.on('will-navigate', (event) => event.preventDefault());
    instance.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await instance.loadFile(path.join(output, 'app.html'));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await instance.webContents.executeJavaScript('Boolean(window.uiAppChecks)'))
        return instance;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('应用 Renderer 未安装旅程入口');
  };
  const checkStep = async (step: string): Promise<void> => {
    assert.ok(host.window);
    if (step === 'failed-run') mode = 'failure';
    if (step === 'cancelled-run') mode = 'cancel';
    let reading: unknown = await host.window.webContents.executeJavaScript(
      `window.uiAppChecks.runStep(${JSON.stringify(step)}).catch(error => { throw new Error(${JSON.stringify(step)} + ': ' + error.message); })`,
    );
    if (step === 'capture-keyboard') {
      assert.equal(services.store.memories.list().length, 0);
      host.window.webContents.debugger.attach('1.3');
      reading = await checkCaptureKeyboard(host.window);
      host.window.webContents.debugger.detach();
      assert.equal(services.store.memories.list().length, 0, 'Esc 取消写入了记忆');
    }
    if (step === 'cancelled-run') {
      // 等真实 Provider 请求进入挂起态再点停止，避免只测到 dispatch 前取消。
      for (let attempt = 0; attempt < 100 && !cancellation.entered; attempt += 1)
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      assert.ok(cancellation.entered, '合成取消请求未进入 Provider');
      reading = await host.window.webContents.executeJavaScript(
        'window.uiAppChecks.runStep("cancelled-stop")',
      );
      assert.ok(cancellation.aborted, '界面取消未传到实际请求信号');
    }
    if (step === 'summon' || step === 'second-draft')
      assert.equal(
        services.store.runs.list().length,
        step === 'summon' ? 0 : 1,
        '草稿动作不得自动发起 Run',
      );
    const current = services.store.runs.list()[0];
    if (step === 'first-run' || step === 'second-run') {
      assert.ok(current);
      assert.equal(current.status, 'completed');
      assert.ok(
        services.store.materialReads.listByRun(current.id).length > 0,
        '不能把选入当已读取',
      );
      const artifact = services.store.artifacts.list(current.taskId)[0];
      assert.ok(artifact, '真实 Run 未登记 Markdown 成果');
      assert.equal(
        services.store.artifactInputRelations.listByVersion(artifact.currentVersionId).length,
        1,
        '成果采用来源未持久化',
      );
      if (step === 'first-run') {
        first = current;
        firstVersionId = artifact.currentVersionId;
      } else {
        second = current;
        assert.ok(first);
        assert.notEqual(second.taskId, first.taskId);
        assert.notEqual(second.sessionId, first.sessionId);
        assert.notEqual(second.id, first.id);
        assert.equal(
          services.store.runContextSnapshots.get(second.id)?.materials[0]?.reference.kind,
          'artifact-version',
        );
        const source = services.store.runContextSnapshots.get(second.id)?.materials[0]?.reference;
        assert.ok(source?.kind === 'artifact-version');
        assert.equal(source.artifactVersionId, firstVersionId);
        const memory = services.store.memories.list().find((item) => item.content === method);
        assert.ok(memory);
        assert.ok(
          services.store.runMemoryContexts
            .get(second.id)
            ?.selectedItems.some((item) => item.memoryId === memory.id),
        );
        assert.ok(
          requests.some((item) => item.runId === second?.id && item.body.includes(method)),
          '实际 Provider 请求没有复用工作口径',
        );
      }
    }
    if (step === 'save-source') {
      const derived = services.store.memories
        .list()
        .find(
          (item) =>
            item.provenance.verification === 'verified' && item.provenance.authority === 'derived',
        );
      assert.ok(derived?.provenance.verification === 'verified');
      assert.equal(derived.provenance.sources[0]?.kind, 'run-assistant');
      assert.equal(derived.provenance.materialDependencies.length, 1);
    }
    if (step === 'save-method') {
      const memory = services.store.memories.list().find((item) => item.content === method);
      assert.equal(memory?.recallPolicy, 'pinned');
    }
    if (step === 'exclude' || step === 'restore') {
      assert.ok(first);
      const context = services.store.taskContexts.getLatest(first.taskId);
      assert.ok(context);
      assert.equal(context.materials?.length, 1, '排除动作丢失材料');
      assert.equal(context.executor.kind, 'expert', '排除动作丢失专家');
      if (step === 'exclude') {
        excludedMemoryId = context.excludedMemoryIds?.[0];
        assert.ok(excludedMemoryId);
        assert.equal(
          excludedMemoryId,
          services.store.memories.list().find((item) => item.content === method)?.id,
          '排除的不是明确制定的工作口径',
        );
      } else {
        if (probeLostRestore && excludedMemoryId)
          services.store.taskContexts.save(
            first.taskId,
            {
              executor: context.executor,
              skillBindings: context.skillBindings,
              ...(context.materials ? { materials: context.materials } : {}),
              ...(context.modelReference ? { modelReference: context.modelReference } : {}),
              ...(context.builtinToolPolicy
                ? { builtinToolPolicy: context.builtinToolPolicy }
                : {}),
              ...(context.mcpToolBindings ? { mcpToolBindings: context.mcpToolBindings } : {}),
              excludedMemoryIds: [excludedMemoryId],
            },
            context.revision,
          );
        const restored = services.store.taskContexts.getLatest(first.taskId);
        assert.ok(restored, '恢复后任务上下文丢失');
        assert.deepEqual(restored.excludedMemoryIds ?? [], [], '恢复参与选择未持久化');
      }
    }
    if (step === 'failed-run' || step === 'cancelled-run') {
      assert.ok(current);
      assert.equal(current.status, step === 'failed-run' ? 'failed' : 'cancelled');
    }
    assert.deepEqual(networkAttempts, [], '合成窗口发起了网络请求');
    assert.deepEqual(rendererErrors, [], '应用 Renderer 出现未预期错误');
    if (seededScheduleId) {
      const schedule = services.store.schedules.get(seededScheduleId);
      assert.equal(schedule?.schedule.lifecycle, 'paused', '普通任务改变了旁路定时规则状态');
      assert.deepEqual(
        services.store.scheduleOccurrences.listBySchedule({
          scheduleId: seededScheduleId,
          limit: 10,
        }).items,
        [],
        '暂停的定时规则不得占用或接管普通任务 Run',
      );
      if (current) {
        assert.equal(
          services.store.scheduleOccurrences.findByFirstRunId(current.id),
          undefined,
          '普通任务 Run 被错误关联到 Schedule occurrence',
        );
      }
    }
    assert.equal(await readFile(sourcePath, 'utf8'), expectedSourceContent, '用户资料被修改');
    await capture(host.window, path.join(output, 'screenshots', `app-journey-${step}.png`));
    readings.push({ step, reading, persistedRunCount: services.store.runs.list().length });
    await writeFile(
      path.join(output, 'app-journey.partial.json'),
      JSON.stringify(readings, null, 2),
    );
  };
  try {
    if (journeyOptions.reopenDirectory) {
      expectedSourceContent = await readFile(sourcePath, 'utf8');
    } else {
      expectedSourceContent = await seed(services, directory);
      seededScheduleId = services.seededScheduleId;
      assert.ok(seededScheduleId, '普通任务回归旅程未建立暂停定时规则');
    }
    await openWindow();
    if (journeyOptions.reopenDirectory) {
      assert.ok(host.window);
      await writeFile(
        path.join(output, 'acceptance-ready.json'),
        JSON.stringify(
          {
            status: 'prepared-not-accepted',
            pid: process.pid,
            databaseDirectory: path.basename(directory),
            reopened: true,
            memoryCount: services.store.memories.list().length,
            runCount: services.store.runs.list().length,
            syntheticRequests: requests.length,
            humanResultsWritten: false,
          },
          null,
          2,
        ),
      );
      handedOff = true;
      if (!journeyOptions.silent) host.window.show();
      host.window.on('closed', () => {
        services.store.close();
        services.vault.close();
      });
      return { reopened: true };
    }
    for (const step of steps) await checkStep(step);
    assert.ok(first);
    assert.ok(second);
    const before = services.store.runs.list();
    host.window?.destroy();
    host.window = null;
    services.store.close();
    services.vault.close();
    for (const channel of Object.values(IpcChannel)) ipcMain.removeHandler(channel);
    const requestCount = requests.length;
    services = assemble(directory, () => host.window);
    assert.deepEqual(services.store.runs.list(), before, '重开库改变历史 Run');
    assert.equal(requests.length, requestCount, '重装配自动调用模型');
    if (!first) throw new Error('重启前缺少首个合成 Task Run');
    const restoredBrief = services.store.taskContinuity.getLatest(first.taskId);
    const restoredRunContext = services.store.taskContinuity.getRunContext(first.id);
    assert.ok(restoredBrief, '进程重启后 Task Continuity revision 丢失');
    assert.ok(restoredRunContext, '进程重启后 Run Continuity snapshot 丢失');
    assert.equal(
      restoredRunContext.brief.objective.text,
      restoredBrief.brief.objective.text,
      'Run snapshot 与重启后的 Task Brief 目标不一致',
    );
    assert.ok(restoredRunContext.firstProviderRequestAt, 'Provider 请求审计未从 SQLite 恢复');
    const reopenedWindow = await openWindow();
    await checkStep('restarted');
    const firstArtifact = services.store.artifacts.list(first.taskId)[0];
    assert.ok(firstArtifact);
    const versionPreparation: unknown = await reopenedWindow.webContents
      .executeJavaScript(`(async () => {
      const artifact = await window.betterwork.artifacts.get({ id: ${JSON.stringify(firstArtifact.id)} });
      if (!artifact || artifact.type !== 'markdown') throw new Error('缺合成上期成果');
      const saved = await window.betterwork.artifacts.saveMarkdown({ artifactId: artifact.id, taskId: artifact.taskId, origin: 'user-edit', title: artifact.title, content: artifact.content + '\\n\\n合成修订：下期仍需重新核对资料。' });
      const context = await window.betterwork.taskContexts.get({ taskId: artifact.taskId });
      if (!context || context.executor.kind !== 'expert') throw new Error('缺来源专家上下文');
      const memoryPage = await window.betterwork.memories.list({ workspaceId: artifact.workspaceId });
      if (!memoryPage.ok) throw new Error(memoryPage.error.message);
      const method = memoryPage.data.items.find(item => item.content === ${JSON.stringify(method)});
      if (!method) throw new Error('缺待排除的自主口径');
      const copied = await window.betterwork.experts.copy({ expertId: context.executor.expertId, name: '离线换期专家' });
      await window.betterwork.taskContexts.save({ taskId: artifact.taskId, expectedRevision: context.revision, executor: { kind: 'expert', expertId: copied.expert.id, expertRevisionId: copied.expert.revision.id }, skillBindings: context.skillBindings, materials: context.materials, excludedMemoryIds: [...new Set([...(context.excludedMemoryIds ?? []), method.id])], mcpToolBindings: context.mcpToolBindings, modelReference: context.modelReference, builtinToolPolicy: context.builtinToolPolicy });
      const sourceIdentity = await window.betterwork.artifacts.getVersionExecutor({ artifactId: artifact.id, artifactVersionId: artifact.currentVersionId });
      if (sourceIdentity?.kind !== 'expert' || sourceIdentity.expertId !== context.executor.expertId) throw new Error('上期精确版本丢失原专家身份');
      return { excludedMemoryId: method.id, originalVersionId: artifact.currentVersionId, revisedVersionId: saved.currentVersionId, originalExpertId: context.executor.expertId, replacementExpertId: copied.expert.id };
    })()`);
    assert.equal(services.store.artifacts.listVersions(firstArtifact.id).length, 2);
    assert.ok(firstVersionId);
    assert.ok(services.store.artifacts.getVersionDetail(firstVersionId));
    const sourceDocument = services.vault.listDocuments()[0];
    assert.ok(sourceDocument);
    await writeFile(
      sourcePath,
      `${expectedSourceContent}\n\n${inputText}\n合成换期：下一期有四个项目。`,
    );
    const refreshed = await services.vault.refreshDocument(sourceDocument.id);
    assert.ok('refreshed' in refreshed && refreshed.refreshed, '换期资料刷新失败');
    assert.equal(services.vault.listRevisions(sourceDocument.id).length, 2);
    const prepared = await prepareAcceptanceSamples(services.store, directory);
    assert.ok(services.store.taskContexts.getLatest(first.taskId)?.excludedMemoryIds?.length);
    assert.ok(seededScheduleId);
    const scheduleIsolation = {
      lifecycle: services.store.schedules.get(seededScheduleId)?.schedule.lifecycle,
      occurrenceCount: services.store.scheduleOccurrences.listBySchedule({
        scheduleId: seededScheduleId,
        limit: 10,
      }).items.length,
      ordinaryRunCount: services.store.runs
        .list()
        .filter((run) => services.store.scheduleOccurrences.findByFirstRunId(run.id) === undefined)
        .length,
    };
    assert.equal(scheduleIsolation.lifecycle, 'paused');
    assert.equal(scheduleIsolation.occurrenceCount, 0);
    assert.equal(scheduleIsolation.ordinaryRunCount, services.store.runs.list().length);
    await writeFile(
      path.join(output, 'acceptance-preparation.json'),
      JSON.stringify(
        {
          status: 'prepared-not-accepted',
          databaseDirectory: path.basename(directory),
          preparation: prepared,
          versionPreparation,
          humanResultsWritten: false,
        },
        null,
        2,
      ),
    );
    if (journeyOptions.interactive) {
      mode = 'happy';
      await reopenedWindow.webContents.executeJavaScript(
        'window.uiAppChecks.runStep("acceptance-history")',
      );
      await reopenedWindow.webContents.executeJavaScript(
        'window.uiAppChecks.runStep("process-exclusions")',
      );
      if (journeyOptions.silent) {
        cancellation.entered = false;
        cancellation.aborted = false;
        await reopenedWindow.webContents.executeJavaScript(
          'window.uiAppChecks.runStep("acceptance-hang")',
        );
        for (let attempt = 0; attempt < 100 && !cancellation.entered; attempt += 1)
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        assert.ok(cancellation.entered, '交接窗口的合成挂起未进入真实 Provider 请求');
        await reopenedWindow.webContents.executeJavaScript(
          'window.uiAppChecks.runStep("cancelled-stop")',
        );
        assert.ok(cancellation.aborted, '合成挂起停止未传到请求信号');
        assert.equal(services.store.runs.list()[0]?.status, 'cancelled');
        await reopenedWindow.webContents.executeJavaScript(
          'window.uiAppChecks.runStep("failed-run")',
        );
        assert.equal(services.store.runs.list()[0]?.status, 'failed');
      }
      await writeFile(
        path.join(output, 'acceptance-ready.json'),
        JSON.stringify(
          {
            status: 'prepared-not-accepted',
            pid: process.pid,
            databaseDirectory: path.basename(directory),
            preparation: prepared,
            versionPreparation,
            syntheticRequests: requests.length,
            networkAttempts: networkAttempts.length,
            humanResultsWritten: false,
          },
          null,
          2,
        ),
      );
      handedOff = true;
      if (!journeyOptions.silent) reopenedWindow.show();
      reopenedWindow.on('closed', () => {
        services.store.close();
        services.vault.close();
      });
    }
    return {
      id: 'app-journey-jade-dark-1380',
      coverage: 'production-app-with-real-ipc-and-temporary-sqlite',
      mode: 'dark',
      width: 1380,
      checks: readings,
      acceptancePreparation: prepared,
      versionPreparation,
      model: 'deterministic-fetch-substitute',
      recovery: 'window-destroyed-stores-reopened-services-reassembled',
      scheduleIsolation,
      requests: requests.length,
      networkAttempts: networkAttempts.length,
      databaseDirectory: path.basename(directory),
    };
  } catch (error) {
    if (host.window && !host.window.isDestroyed())
      await writeFile(
        path.join(output, 'screenshots', 'app-journey-failed.png'),
        (await host.window.webContents.capturePage()).toPNG(),
      );
    throw new Error('完整应用离线旅程失败', { cause: error });
  } finally {
    if (!handedOff) {
      host.window?.destroy();
      services.store.close();
      services.vault.close();
      globalThis.fetch = originalFetch;
      session.defaultSession.webRequest.onBeforeRequest(null);
    }
  }
}
