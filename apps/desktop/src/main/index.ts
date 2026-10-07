import { mkdirSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  IpcChannel,
  type KnowledgeJobSummary,
  type ScheduleChangedEvent,
  scheduleChangedEventSchema,
} from '@betterwork/agent-protocol';
import { app, BrowserWindow, powerMonitor } from 'electron';

import { ElectronSafeStorageAdapter } from './infrastructure/credential-store';
import {
  createFetchDownloader,
  createNodeFileSystem,
  createNodeProcessRunner,
} from './infrastructure/dependency-adapters';
import { createExecutionLog } from './infrastructure/execution-log';
import {
  createMacProcessSupervisor,
  resolveGuardianRuntime,
} from './infrastructure/mac-process-supervisor';
import { OfficeParserService } from './infrastructure/office-parser';
import { createPptxRenderer } from './infrastructure/pptx-renderer';
import { registerIpc } from './ipc/register-ipc';
import { AppStore, RUN_INTERRUPTED_ON_STARTUP_REASON } from './persistence';
import { createQuitHandler } from './services/application-shutdown';
import { CredentialAccess } from './services/credential-access';
import { CredentialMigrationService } from './services/credential-migration-service';
import { DiscussionCheckpointService } from './services/discussion-checkpoint-service';
import { EmbeddingClient } from './services/embedding-client';
import { ExecutionOutputService } from './services/execution-output-service';
import { type BuiltinExpertReleaseManifest, ExpertService } from './services/expert-service';
import { createStoreExtractionSourceReader } from './services/extraction-source-reader';
import { FileArtifactService } from './services/file-artifact-service';
import { InputSnapshotService } from './services/input-snapshot-service';
import { KnowledgeIndexService } from './services/knowledge-index-service';
import { KnowledgeSearchService } from './services/knowledge-search';
import { KnowledgeVault } from './services/knowledge-vault';
import {
  KnowledgeWorkerRunner,
  resolveKnowledgeWorkerRuntime,
} from './services/knowledge-worker-runner';
import { McpClientService } from './services/mcp-client-service';
import { MemoryExtractionService } from './services/memory-extraction-service';
import { MemoryRecallService } from './services/memory-recall-service';
import { MemoryService } from './services/memory-service';
import { ModelProviderFactory } from './services/model-provider-factory';
import { NotificationActivationService } from './services/notification-activation-service';
import { NotificationService } from './services/notification-service';
import {
  pptGenerationAdapterFactory,
  supportedPptContentHashes,
} from './services/ppt-generation-preset';
import { RunService } from './services/run-service';
import { ScheduleDirectorySourcesService } from './services/schedule-directory-sources';
import { ScheduleDispatchService } from './services/schedule-dispatch-service';
import { ScheduleExecutionService } from './services/schedule-execution-service';
import { ScheduleHostLifecycle, startPrimaryInstance } from './services/schedule-host-lifecycle';
import { ScheduleKnowledgeSourcesService } from './services/schedule-knowledge-sources';
import { ScheduleNotificationService } from './services/schedule-notification-service';
import { ScheduleOutcomeService } from './services/schedule-outcome-service';
import { ScheduleOutputService } from './services/schedule-output-service';
import { SchedulePreflightService } from './services/schedule-preflight';
import { ScheduleScheduler } from './services/schedule-scheduler';
import { ScheduleService } from './services/schedule-service';
import { ScheduleSourceService } from './services/schedule-source-service';
import { SkillAdapterService } from './services/skill-adapter';
import { SkillDependencyService } from './services/skill-dependency-service';
import { SkillExecutionService } from './services/skill-execution-service';
import { type BuiltinReleaseManifest, SkillService } from './services/skill-service';
import { TaskMaterialService } from './services/task-material-service';
import { ToolchainSnapshotService } from './services/toolchain-snapshot-service';
import { WebFetchService } from './services/web-fetch-service';
import { WorkspaceBriefService } from './services/workspace-memory-brief-service';
import { WorkspaceReferenceService } from './services/workspace-reference-service';
import { createMainWindow } from './window';

/**
 * 主进程入口只负责装配：建窗口、组装依赖、注册 IPC、管理生命周期。
 * 业务逻辑不在这里——持久化在 `persistence/`，编排在 `services/`，通道在 `ipc/`。
 *
 * 装配完成后各依赖通过闭包传递，不再有可空模块级单例，
 * 因此不需要任何非空断言。
 */
interface ApplicationContext {
  store: AppStore;
  knowledgeVault: KnowledgeVault;
  knowledgeWorker: KnowledgeWorkerRunner;
  inputSnapshots: InputSnapshotService;
  mcpClientService: McpClientService;
  scheduleHost: ScheduleHostLifecycle;
  scheduleScheduler: ScheduleScheduler;
  scheduleNotifications?: ScheduleNotificationService;
  scheduleDispatch?: ScheduleDispatchService;
  runs?: RunService;
  window: BrowserWindow | null;
  ensureWindow: () => BrowserWindow;
}

let context: ApplicationContext | null = null;

/** 开发态把仓库根当工作区；打包后不能把安装目录暴露给用户，改用文档目录。 */
function getDefaultWorkspaceRoot(): string {
  return app.isPackaged ? app.getPath('documents') : path.resolve(app.getAppPath(), '../..');
}

function bootstrap(initiallySuspended: boolean): ApplicationContext {
  const userData = app.getPath('userData');
  const store = AppStore.open(
    path.join(userData, 'betterwork.db'),
    new ElectronSafeStorageAdapter(),
  );
  const startupReadiness: Promise<unknown>[] = [];
  // CF11：legacy 明文密钥→credentials 的启动迁移；safeStorage 不可用时整体跳过、pending 原样保留。
  const credentialAccess = store.credentials
    ? new CredentialAccess(store.credentials, store.credentialJournal)
    : undefined;
  if (store.credentials) {
    const migration = new CredentialMigrationService(store, store.credentials);
    startupReadiness.push(
      migration
        .runPending()
        .then(async (result) => {
          if (result.done > 0 || result.failed > 0 || result.skipped) {
            console.warn(
              `凭据迁移：done=${result.done} failed=${result.failed} remaining=${result.remaining} skipped=${String(result.skipped)}`,
            );
          }
          // 迁移完成后还要守住不变量：已 done 的 owner 不得再留明文副本。
          const residual = await migration.sweepResidualPlaintext();
          if (residual > 0) {
            console.warn(`凭据明文残留清理：cleared=${residual}`);
          }
        })
        .catch((error: unknown) => {
          console.error('Credential migration failed', error);
          throw error;
        }),
    );
  }
  // 提取在受管 Worker 子进程执行（契约 §8.2）：Main 只给字节、收结果，不占解析 CPU。
  const knowledgeWorker = new KnowledgeWorkerRunner({
    runtime: resolveKnowledgeWorkerRuntime(__dirname),
  });
  const knowledgeVault = new KnowledgeVault(
    path.join(userData, 'vaults', 'default', 'vault.sqlite'),
    { extractor: knowledgeWorker.extractor },
  );
  const inputSnapshots = new InputSnapshotService(store, userData);
  const scheduleNotificationServiceRef: { current?: ScheduleNotificationService } = {};
  const scheduleSourceService = new ScheduleSourceService(
    store,
    new ScheduleDirectorySourcesService(store, inputSnapshots),
    new ScheduleKnowledgeSourcesService(knowledgeVault),
    inputSnapshots,
    {
      onOccurrenceClosed: (occurrenceId) =>
        scheduleNotificationServiceRef.current?.persistOccurrenceWithinTransaction(occurrenceId)
          .afterCommit,
    },
  );
  const memories = new MemoryService(store, userData);
  const modelProviderFactory = new ModelProviderFactory({
    models: store.models,
    ...(credentialAccess ? { credentialAccess } : {}),
  });
  const memoryExtractions = new MemoryExtractionService({
    jobs: store.memoryExtractions,
    memories: store.memories,
    operations: store.memoryOperations,
    transaction: <TBody>(body: () => TBody): TBody => store.transaction(body),
    sources: createStoreExtractionSourceReader(store),
    modelFactory: modelProviderFactory,
  });
  // 启动只做收口：遗留 queued/running 一律转 interrupted，不在启动瞬间触网（契约 §7.3）。
  const interruptedJobs = memoryExtractions.recoverInterruptedJobs();
  if (interruptedJobs > 0) {
    console.warn(`记忆提炼作业启动收口：interrupted=${String(interruptedJobs)}`);
  }
  const mcpClientService = new McpClientService(store);
  const webFetchService = new WebFetchService();
  const officeParser = new OfficeParserService();
  startupReadiness.push(
    memories.rebuildManagedProjection().catch((error: unknown) => {
      console.error('Memory projection rebuild failed', error);
      throw error;
    }),
  );
  const taskMaterials = new TaskMaterialService({ store, knowledgeVault, inputSnapshots });
  const discussionCheckpoints = new DiscussionCheckpointService(store, memoryExtractions);
  const memoryRecall = new MemoryRecallService({ store });
  const workspaceBrief = new WorkspaceBriefService({ store });
  const workspaceReferences = new WorkspaceReferenceService({ store });
  startupReadiness.push(
    inputSnapshots
      .recover()
      .then((recovered) => {
        if (recovered.cancelled > 0 || recovered.failed > 0 || recovered.removedFiles > 0) {
          console.warn(
            `Recovered input snapshots: ${recovered.cancelled} cancelled, ${recovered.failed} failed, ${recovered.removedFiles} orphan file group(s) removed`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error('Input snapshot recovery failed', error);
        throw error;
      }),
  );
  const skillService = new SkillService(store, {
    developmentBuiltinRoot: path.resolve(app.getAppPath(), '../../resources/skills'),
    installedBuiltinRoot: path.join(process.resourcesPath, 'skills'),
    userRoot: path.join(userData, 'skills'),
  });
  const expertService = new ExpertService(store);

  const skipBuiltinRegistration =
    !app.isPackaged && process.env.BETTERWORK_SKIP_BUILTIN_REGISTRATION === '1';
  const runSettings = store.runSettings.get();
  const registerBuiltinSkills = !skipBuiltinRegistration && runSettings.enableBuiltinSkills;
  const registerBuiltinExperts = !skipBuiltinRegistration && runSettings.enableBuiltinExperts;
  if (skipBuiltinRegistration) {
    console.warn('Skipping builtin Skill/Expert registration in development mode');
  } else {
    if (!registerBuiltinSkills) console.warn('Builtin Skills are disabled in settings');
    if (!registerBuiltinExperts) console.warn('Builtin Experts are disabled in settings');

    let builtinSkillsReady: Promise<void> | undefined;
    if (registerBuiltinSkills) {
      const builtinRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'skills')
        : path.resolve(app.getAppPath(), '../../resources/skills');
      builtinSkillsReady = readFile(path.join(builtinRoot, 'release-manifest.json'), 'utf8')
        .then((content) => JSON.parse(content) as BuiltinReleaseManifest)
        .then((manifest) => skillService.registerBuiltinRelease(manifest))
        .then((registered) => {
          if (registered.length > 0) {
            console.warn(`Registered ${registered.length} builtin skill(s)`);
          }
        });
      startupReadiness.push(
        builtinSkillsReady.catch((error: unknown) => {
          console.error('Builtin skill registration failed', error);
          throw error;
        }),
      );
    }

    if (registerBuiltinExperts) {
      const builtinExpertRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'experts')
        : path.resolve(app.getAppPath(), '../../resources/experts');
      const builtinExpertsReady = readFile(
        path.join(builtinExpertRoot, 'release-manifest.json'),
        'utf8',
      )
        .then((content) => JSON.parse(content) as BuiltinExpertReleaseManifest)
        .then(async (manifest) => {
          if (registerBuiltinSkills) {
            if (!builtinSkillsReady) throw new Error('Builtin Skill manifest was not loaded');
            await builtinSkillsReady;
          }
          const experts = runSettings.enableBuiltinSkills
            ? manifest.experts
            : manifest.experts.filter((expert) => expert.skillPreset.length === 0);
          if (experts.length < manifest.experts.length) {
            console.warn(
              `Skipped ${manifest.experts.length - experts.length} builtin Expert(s) because their builtin Skills are disabled`,
            );
          }
          return expertService.registerBuiltinRelease(experts);
        })
        .then((registered) => {
          if (registered.length > 0) {
            console.warn(`Registered ${registered.length} builtin expert(s)`);
          }
        })
        .catch((error: unknown) => {
          console.error('Builtin expert registration failed', error);
          throw error;
        });
      startupReadiness.push(builtinExpertsReady);
    }
  }

  // 受管资产目录（设计 §5）：基础 Python、专属环境与工具链快照都落在用户数据目录，
  // 不进仓库也不随安装包复制整套 venv。
  const dependencyFilesystem = createNodeFileSystem();
  const dependencyProcess = createNodeProcessRunner();
  const dependencyLocksRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'dependency-locks')
    : path.resolve(app.getAppPath(), '../../resources/dependency-locks');
  const dependencies = new SkillDependencyService({
    store,
    paths: {
      userDataRoot: userData,
      pythonRoot: path.join(userData, 'python'),
      environmentsRoot: path.join(userData, 'environments'),
      wheelhouseRoot: app.isPackaged
        ? path.join(process.resourcesPath, 'wheelhouse')
        : path.resolve(app.getAppPath(), '../../resources/wheelhouse'),
    },
    filesystem: dependencyFilesystem,
    process: dependencyProcess,
    download: createFetchDownloader(),
  });
  const snapshots = new ToolchainSnapshotService({
    store,
    userDataRoot: userData,
    assetsRoot: path.join(userData, 'dependency-assets'),
    filesystem: dependencyFilesystem,
    process: dependencyProcess,
  });

  // 上次进程被强杀时正在执行的 Run 会停在 running。启动时统一收口为 failed，
  // 维持「每个 Run 都有明确结果」这条不变量，历史列表不会出现永远转圈的任务。
  const interrupted = store.runs.failInterruptedRuns(RUN_INTERRUPTED_ON_STARTUP_REASON, Date.now());
  if (interrupted > 0) {
    console.warn(`Marked ${interrupted} interrupted run(s) as failed on startup`);
  }
  // 环境准备作业同样不能停在 preparing：半成品目录会被清掉，不把部分包集当作可用。
  startupReadiness.push(
    dependencies
      .recoverInterruptedPreparations()
      .then((recovered) => {
        if (recovered.operations > 0 || recovered.environments > 0) {
          console.warn(
            `Recovered ${recovered.operations} interrupted preparation(s) and ${recovered.environments} environment(s)`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error('Dependency preparation recovery failed', error);
        throw error;
      }),
  );

  const startupReady = Promise.all(startupReadiness).then(() => undefined);
  const scheduleOutputServiceReadyResolvers: Array<(service: ScheduleOutputService) => void> = [];
  const scheduleOutputServiceReady = new Promise<ScheduleOutputService>((resolve) => {
    scheduleOutputServiceReadyResolvers.push(resolve);
  });
  const scheduleOutcomeServiceReadyResolvers: Array<(service: ScheduleOutcomeService) => void> = [];
  const scheduleOutcomeServiceReady = new Promise<ScheduleOutcomeService>((resolve) => {
    scheduleOutcomeServiceReadyResolvers.push(resolve);
  });
  const scheduleNotificationServiceReadyResolvers: Array<
    (service: ScheduleNotificationService) => void
  > = [];
  const scheduleNotificationServiceReady = new Promise<ScheduleNotificationService>((resolve) => {
    scheduleNotificationServiceReadyResolvers.push(resolve);
  });
  const scheduleDispatchRef: { current?: ScheduleDispatchService } = {};
  const scheduleChangePublisherRef: {
    publish: (event: ScheduleChangedEvent) => void;
  } = { publish: () => undefined };
  const scheduler = new ScheduleScheduler(store, {
    dispatch: (occurrence, dispatchContext) => {
      const activeDispatch = scheduleDispatchRef.current;
      if (!activeDispatch) throw new Error('Schedule dispatch service was not initialized');
      return activeDispatch.dispatch(occurrence, dispatchContext.signal);
    },
    recoverPreparations: async () => {
      const recovered = scheduleSourceService.recoverInterrupted();
      if (recovered.closedOccurrences > 0 || recovered.finishedSnapshots > 0) {
        console.warn(
          `定时实例启动收口：occurrences=${String(recovered.closedOccurrences)} snapshots=${String(recovered.finishedSnapshots)}`,
        );
      }
      const outputRecovery = await (await scheduleOutputServiceReady).recoverIncomplete();
      if (outputRecovery.examined > 0) {
        console.warn(
          `定时成果恢复：examined=${String(outputRecovery.examined)} saved=${String(outputRecovery.saved)} failed=${String(outputRecovery.failed)} unresolved=${String(outputRecovery.unresolved)}`,
        );
      }
      const outcomeRecovery = await (await scheduleOutcomeServiceReady).recoverTerminalRuns();
      if (outcomeRecovery.examined > 0) {
        console.warn(
          `定时结果恢复：examined=${String(outcomeRecovery.examined)} finalized=${String(outcomeRecovery.finalized)} unresolved=${String(outcomeRecovery.unresolved)}`,
        );
      }
      const notificationService = await scheduleNotificationServiceReady;
      const notificationRecovery = await notificationService.recoverMissing();
      if (
        notificationRecovery.examinedOccurrences > 0 ||
        notificationRecovery.examinedBatches > 0
      ) {
        console.warn(
          `定时通知恢复：occurrences=${String(notificationRecovery.examinedOccurrences)} restored=${String(notificationRecovery.restoredOccurrences)} batches=${String(notificationRecovery.examinedBatches)} restoredBatches=${String(notificationRecovery.restoredBatches)}`,
        );
      }
      await notificationService.waitForPending();
    },
    onChanged: (event) => scheduleChangePublisherRef.publish(event),
    onOccurrenceClosed: (occurrenceId) =>
      scheduleNotificationServiceRef.current?.persistOccurrenceWithinTransaction(occurrenceId)
        .afterCommit,
    onRecoveryBatchCompleted: (batchKey) =>
      scheduleNotificationServiceRef.current?.persistRecoveryBatchWithinTransaction(batchKey)
        .afterCommit,
    onError: (error) => console.error('Schedule scheduler failed', error),
  });
  const scheduleHost = new ScheduleHostLifecycle({
    ownsInstance: true,
    initiallySuspended,
    readiness: startupReady,
    scheduler,
    onError: (error) => console.error('Schedule host startup failed', error),
  });

  const notificationActivationRef: { current?: NotificationActivationService } = {};
  const started: ApplicationContext = {
    store,
    knowledgeVault,
    knowledgeWorker,
    inputSnapshots,
    mcpClientService,
    scheduleHost,
    scheduleScheduler: scheduler,
    window: null,
    ensureWindow: () => {
      const existing = started.window;
      if (existing && !existing.isDestroyed()) return existing;
      const window = createMainWindow();
      const webContentsId = window.webContents.id;
      started.window = window;
      window.once('closed', () => {
        if (started.window === window) started.window = null;
        notificationActivationRef.current?.windowClosed(webContentsId);
      });
      return window;
    },
  };
  const getWindow = (): BrowserWindow | null => {
    const window = started.window;
    return window && !window.isDestroyed() ? window : null;
  };

  scheduleChangePublisherRef.publish = (event) => {
    const window = getWindow();
    if (window) {
      try {
        window.webContents.send(
          IpcChannel.ScheduleChanged,
          scheduleChangedEventSchema.parse(event),
        );
      } catch (error) {
        console.error('Schedule change event publish failed', error);
      }
    }
    if (event.occurrenceId) {
      scheduleNotificationServiceRef.current?.queueOccurrence(event.occurrenceId);
    }
  };

  notificationActivationRef.current = new NotificationActivationService({
    getWindow,
    ensureWindow: started.ensureWindow,
  });
  const notifications = new NotificationService(store.notifications, getWindow, (notificationId) =>
    notificationActivationRef.current?.activate(notificationId),
  );
  started.ensureWindow();
  const embeddingClient = new EmbeddingClient({
    models: store.models,
    ...(credentialAccess ? { credentialAccess } : {}),
  });
  const knowledgeIndex = new KnowledgeIndexService({
    vault: knowledgeVault,
    onJobCancel: (jobId) => knowledgeWorker.cancelJob(jobId),
    embedding: embeddingClient,
    onEvent: (job) => {
      getWindow()?.webContents.send(IpcChannel.KnowledgeJobEvent, job);
      notifyKnowledgeJob(notifications, job);
    },
  });
  // 索引作业同样只在启动时收口为 interrupted，绝不自动重跑付费向量。
  const interruptedIndexJobs = knowledgeIndex.recoverInterrupted().length;
  if (interruptedIndexJobs > 0) {
    console.warn(`知识索引作业启动收口：interrupted=${String(interruptedIndexJobs)}`);
  }
  const supervisor = createMacProcessSupervisor({
    guardian: resolveGuardianRuntime(__dirname),
    createLogSink: (executionId) =>
      createExecutionLog(path.join(userData, 'execution-logs'), executionId),
  });
  const skillExecutionService = new SkillExecutionService(
    store,
    supervisor,
    new ExecutionOutputService(),
  );
  const interruptedExecutions = skillExecutionService.recoverInterruptedExecutions();
  if (interruptedExecutions > 0) {
    console.warn(`Marked ${interruptedExecutions} interrupted execution(s) as failed on startup`);
  }
  const skillAdapterService = new SkillAdapterService();
  skillAdapterService.register(pptGenerationAdapterFactory, supportedPptContentHashes);
  const artifactFilesRoot = path.join(userData, 'artifact-files');
  mkdirSync(artifactFilesRoot, { recursive: true });
  // 中文幻灯片预览依赖随包的思源黑体：系统自带的中文字体是 TTC + AAT，解析不了。
  const fontResourceRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.resolve(app.getAppPath(), '../../resources/fonts');
  const pptxRenderer = createPptxRenderer(fontResourceRoot);
  const fileArtifactService = new FileArtifactService(
    store,
    artifactFilesRoot,
    async (executionId, outputId) => {
      const execution = store.executions.getExecution(executionId);
      if (!execution) throw new Error(`Execution ${executionId} does not exist`);
      const run = store.runs.get(execution.runId);
      if (!run) throw new Error(`Run ${execution.runId} does not exist`);
      const context = store.tasks.getRunContext(run.taskId, run.sessionId);
      if (!context) throw new Error('Run context is not available');
      const output = store.executions
        .getVerifiedOutputs(executionId)
        .find((entry) => entry.outputId === outputId);
      if (!output) throw new Error('Output has no verified host record');
      return path.join(
        context.workspacePath,
        '.betterwork',
        'tasks',
        run.taskId,
        'runs',
        execution.runId,
        'work',
        output.relativePath,
      );
    },
    (runId) => started.runs?.acceptsOutput(runId) ?? false,
    pptxRenderer,
  );
  const scheduleOutputService = new ScheduleOutputService(store, {
    fileArtifacts: fileArtifactService,
  });
  const resolveScheduleOutputService = scheduleOutputServiceReadyResolvers.shift();
  if (!resolveScheduleOutputService) {
    throw new Error('Schedule output recovery gate was not initialized');
  }
  resolveScheduleOutputService(scheduleOutputService);
  const scheduleOutcomeService = new ScheduleOutcomeService(store, scheduleOutputService, {
    onChanged: (event) => scheduleChangePublisherRef.publish(event),
    persistOccurrenceNotification: (occurrenceId) =>
      scheduleNotificationServiceRef.current?.persistOccurrenceWithinTransaction(occurrenceId)
        .afterCommit,
  });
  const resolveScheduleOutcomeService = scheduleOutcomeServiceReadyResolvers.shift();
  if (!resolveScheduleOutcomeService) {
    throw new Error('Schedule outcome recovery gate was not initialized');
  }
  resolveScheduleOutcomeService(scheduleOutcomeService);
  const scheduleNotificationService = new ScheduleNotificationService(
    store,
    notifications,
    scheduleOutcomeService,
    { systemNotifyOnPublish: true },
  );
  scheduleNotificationServiceRef.current = scheduleNotificationService;
  const resolveScheduleNotificationService = scheduleNotificationServiceReadyResolvers.shift();
  if (!resolveScheduleNotificationService) {
    throw new Error('Schedule notification recovery gate was not initialized');
  }
  resolveScheduleNotificationService(scheduleNotificationService);
  started.scheduleNotifications = scheduleNotificationService;
  // 统一混合检索（契约 §9）：管理页与 knowledge_search 工具共用一条管线。
  const knowledgeSearch = new KnowledgeSearchService({
    vault: knowledgeVault,
    index: knowledgeVault.index,
    runMaterials: (runId) =>
      (store.runContextSnapshots.get(runId)?.materials ?? []).flatMap((material) =>
        material.reference.kind === 'knowledge-revision' ? [material.reference] : [],
      ),
    embedding: embeddingClient,
    scan: (request) => knowledgeWorker.scan(request),
  });

  const runs = new RunService(
    store,
    knowledgeVault,
    notifications,
    skillService,
    getWindow,
    skillExecutionService,
    skillAdapterService,
    snapshots,
    fileArtifactService,
    dependencies,
    inputSnapshots,
    taskMaterials,
    memoryExtractions,
    mcpClientService,
    (url, signal) => webFetchService.fetch(url, signal),
    officeParser,
    credentialAccess,
    knowledgeSearch,
    knowledgeWorker.extractor,
    (runId) => scheduleOutcomeService.finalizeRun(runId),
  );
  started.runs = runs;

  const schedulePreflight = new SchedulePreflightService(store, {
    verifySkillResource: async (skill) => {
      await skillService.verifyResourceRoot(skill);
    },
    resolveEnvironmentPython: (environmentId) =>
      dependencies.resolveEnvironmentPython(environmentId),
    pathExists: async (target) => {
      try {
        await access(target);
        return true;
      } catch {
        return false;
      }
    },
    verifyToolchainSnapshot: async (snapshotId) => ({
      valid: (await snapshots.verifySnapshot(snapshotId)).valid,
    }),
    resolveSnapshotRoot: (snapshot) => snapshots.resolveSnapshotRoot(snapshot),
  });
  const scheduleDispatch = new ScheduleDispatchService(
    store,
    scheduleSourceService,
    schedulePreflight,
    new ScheduleExecutionService(store),
    runs,
    {
      onChanged: (event) => scheduleChangePublisherRef.publish(event),
      onOccurrenceClosed: (occurrenceId) =>
        scheduleNotificationServiceRef.current?.persistOccurrenceWithinTransaction(occurrenceId)
          .afterCommit,
    },
  );
  scheduleDispatchRef.current = scheduleDispatch;
  started.scheduleDispatch = scheduleDispatch;
  const scheduleManager = new ScheduleService(store, {
    now: Date.now,
    preflight: async ({ workspaceId, config }) => {
      const result = await schedulePreflight.check({ workspaceId, config });
      return result.status === 'ready'
        ? { status: 'ready', fingerprint: result.fingerprint }
        : {
            status: 'blocked',
            message: result.problems.map((problem) => problem.message).join('\n'),
          };
    },
    settleDue: (input) => scheduler.settleDue(input),
    cancelPreparations: (occurrenceIds) => {
      for (const occurrenceId of occurrenceIds) {
        scheduler.cancelPreparation(occurrenceId);
        scheduleDispatch.cancelPreparation(occurrenceId);
      }
    },
  });

  registerIpc({
    store,
    knowledgeVault,
    knowledgeIndex,
    knowledgeSearch,
    taskMaterials,
    discussionCheckpoints,
    memories,
    memoryRecall,
    memoryExtractions,
    workspaceBrief,
    workspaceReferences,
    mcpClientService,
    notifications,
    markNotificationRendererReady: (webContentsId) =>
      notificationActivationRef.current?.rendererReady(webContentsId) ?? false,
    runs,
    skillService,
    expertService,
    dependencies,
    snapshots,
    scheduleService: scheduleManager,
    schedulePreflight,
    scheduleDispatch,
    scheduleOutputs: scheduleOutputService,
    scheduleOutcomes: scheduleOutcomeService,
    publishScheduleChange: (event) => scheduleChangePublisherRef.publish(event),
    fileArtifactService,
    dependencyLocksRoot,
    getWindow,
    getDefaultWorkspaceRoot,
    ...(credentialAccess ? { credentialAccess } : {}),
  });
  return started;
}

let systemSuspended = false;
let focusRequestedBeforeReady = false;

const focusMainWindow = (): void => {
  const currentContext = context;
  if (!currentContext) {
    focusRequestedBeforeReady = true;
    return;
  }
  const window = currentContext.ensureWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

startPrimaryInstance(
  {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
  },
  () => {
    app.on('second-instance', focusMainWindow);
    const quitHandler = createQuitHandler(
      async () => {
        await context?.scheduleHost.ready;
        context?.scheduleDispatch?.cancelPreparations();
        await context?.scheduleDispatch?.waitForPreparations();
        await context?.scheduleScheduler.waitForPreparations();
        await context?.runs?.shutdown();
        await context?.scheduleNotifications?.waitForPending();
        await context?.mcpClientService.shutdown();
        await context?.knowledgeWorker.shutdown();
      },
      () => {
        context?.knowledgeVault.close();
        context?.store.close();
        context = null;
      },
      () => app.quit(),
      (error) => console.error('Application shutdown failed:', error),
    );
    app.on('before-quit', (event) => {
      context?.scheduleHost.stopForQuit();
      context?.scheduleScheduler.cancelPreparations();
      quitHandler(event);
    });

    app
      .whenReady()
      .then(() => {
        powerMonitor.on('suspend', () => {
          systemSuspended = true;
          context?.scheduleHost.suspend();
        });
        powerMonitor.on('resume', () => {
          systemSuspended = false;
          const scheduleHost = context?.scheduleHost;
          if (scheduleHost) {
            scheduleHost.resume().catch((error: unknown) => {
              console.error('Schedule host resume failed', error);
            });
          }
        });
        context = bootstrap(systemSuspended);
        if (focusRequestedBeforeReady) {
          focusRequestedBeforeReady = false;
          focusMainWindow();
        }
        // macOS keeps the process and scheduler alive after the last window closes.
        app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0 && context) {
            context.ensureWindow();
          }
        });
      })
      .catch((error: unknown) => {
        console.error('BetterWork failed to start', error);
        app.quit();
      });
  },
);
/**
 * 索引作业终态进消息中心（契约 §12）：取消不发失败通知，部分成功按 warning 呈现，
 * 目标固定为知识页，通知本身不导航、不清空当前任务。
 */
function notifyKnowledgeJob(notifications: NotificationService, job: KnowledgeJobSummary): void {
  if (job.status === 'queued' || job.status === 'running' || job.status === 'cancelled') return;
  const titles: Record<KnowledgeJobSummary['kind'], string> = {
    import: '资料导入',
    refresh: '资料刷新',
    'rebuild-keyword': '关键词索引重建',
    'rebuild-semantic': '向量索引重建',
    'check-source': '来源检查',
  };
  const level =
    job.status === 'succeeded' ? 'success' : job.status === 'partial' ? 'warning' : 'error';
  notifications.create(
    {
      level,
      kind: job.kind === 'import' || job.kind === 'refresh' ? 'knowledge-import' : 'system',
      title: `${titles[job.kind]}${job.status === 'succeeded' ? '完成' : '结束'}（${String(job.completedCount)}/${String(job.totalCount)}）`,
      detail: job.failure?.message ?? `状态：${job.status}`,
      target: { kind: 'knowledge' },
    },
    { systemNotify: level === 'error' },
  );
}
