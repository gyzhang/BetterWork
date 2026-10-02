import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { abortError } from '@betterwork/agent-core';
import { IpcChannel, type MaterialReference, type RunSummary } from '@betterwork/agent-protocol';
import { BrowserWindow, ipcMain, session } from 'electron';

import { registerIpc } from '../../apps/desktop/src/main/ipc/register-ipc';
import { AppStore } from '../../apps/desktop/src/main/persistence';
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
import { SkillDependencyService } from '../../apps/desktop/src/main/services/skill-dependency-service';
import { SkillService } from '../../apps/desktop/src/main/services/skill-service';
import { TaskMaterialService } from '../../apps/desktop/src/main/services/task-material-service';
import { ToolchainSnapshotService } from '../../apps/desktop/src/main/services/toolchain-snapshot-service';
import { WorkspaceBriefService } from '../../apps/desktop/src/main/services/workspace-memory-brief-service';
import { WorkspaceReferenceService } from '../../apps/desktop/src/main/services/workspace-reference-service';

const method = '每次复盘先核对口径，再给结论。';
const inputText = '合成资料：本期工作已完成，交付结论必须可追溯。';
const steps = [
  'ready',
  'navigation',
  'summon',
  'first-run',
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
}

function assemble(directory: string, getWindow: () => BrowserWindow | null): JourneyServices {
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
    dependencies,
    snapshots,
    dependencyLocksRoot: path.join(directory, 'locks'),
    getWindow,
    getDefaultWorkspaceRoot: () => path.join(directory, 'workspace'),
  });
  store.runs.failInterruptedRuns('合成宿主重装配收口', Date.now());
  extractions.recoverInterruptedJobs();
  return { store, vault, runs, extractions };
}

async function seed(services: JourneyServices, directory: string): Promise<void> {
  const root = path.join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const sourcePath = path.join(root, '合成复盘资料.md');
  await writeFile(sourcePath, inputText);
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
  services.store.experts.create({
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
  assert.equal(
    services.store.memoryExtractions.getSettings(workspace.id).autoSuggestEnabled,
    false,
  );
}

function syntheticResponse(delta: unknown): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}
function toolResponse(name: string, input: unknown, ordinal: number): Response {
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
): Promise<unknown> {
  // 输出目录可以复用，但每次合成数据库必须全新，不能继承上轮 Run 或探针的排除项。
  const directory = await mkdtemp(path.join(output, 'app-journey-'));
  const host: { window: BrowserWindow | null } = { window: null };
  let services = assemble(directory, () => host.window);
  const requests: RequestReading[] = [];
  const counters = new Map<string, number>();
  const originalFetch = globalThis.fetch;
  let mode: 'happy' | 'failure' | 'cancel' = 'happy';
  const cancellation = { entered: false, aborted: false };
  const networkAttempts: string[] = [];
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
    if (mode === 'failure') throw new Error('合成故障：离线请求失败');
    if (mode === 'cancel') {
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
    if (ordinal === 2)
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
  const rendererErrors: string[] = [];
  const openWindow = async (): Promise<BrowserWindow> => {
    const instance = new BrowserWindow({
      width: 1380,
      height: 860,
      useContentSize: true,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: path.join(output, 'app-preload.cjs'),
        offscreen: true,
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
    assert.equal(
      await readFile(path.join(directory, 'workspace', '合成复盘资料.md'), 'utf8'),
      inputText,
      '用户资料被修改',
    );
    await capture(host.window, path.join(output, 'screenshots', `app-journey-${step}.png`));
    readings.push({ step, reading, persistedRunCount: services.store.runs.list().length });
    await writeFile(
      path.join(output, 'app-journey.partial.json'),
      JSON.stringify(readings, null, 2),
    );
  };
  try {
    await seed(services, directory);
    await openWindow();
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
    await openWindow();
    await checkStep('restarted');
    return {
      id: 'app-journey-jade-dark-1380',
      coverage: 'production-app-with-real-ipc-and-temporary-sqlite',
      mode: 'dark',
      width: 1380,
      checks: readings,
      model: 'deterministic-fetch-substitute',
      recovery: 'window-destroyed-stores-reopened-services-reassembled',
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
    host.window?.destroy();
    services.store.close();
    services.vault.close();
    globalThis.fetch = originalFetch;
    session.defaultSession.webRequest.onBeforeRequest(null);
  }
}
