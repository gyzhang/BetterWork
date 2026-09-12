import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';

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
import { createPptxRenderer } from './infrastructure/pptx-renderer';
import { registerIpc } from './ipc/register-ipc';
import { AppStore } from './persistence';
import { createQuitHandler } from './services/application-shutdown';
import { ExecutionOutputService } from './services/execution-output-service';
import { FileArtifactService } from './services/file-artifact-service';
import { KnowledgeVault } from './services/knowledge-vault';
import { NotificationService } from './services/notification-service';
import {
  pptGenerationAdapterFactory,
  supportedPptContentHashes,
} from './services/ppt-generation-preset';
import { RunService } from './services/run-service';
import { SkillAdapterService } from './services/skill-adapter';
import { SkillDependencyService } from './services/skill-dependency-service';
import { SkillExecutionService } from './services/skill-execution-service';
import { type BuiltinReleaseManifest, SkillService } from './services/skill-service';
import { ToolchainSnapshotService } from './services/toolchain-snapshot-service';
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
  runs?: RunService;
  window: BrowserWindow | null;
}

let context: ApplicationContext | null = null;

/** 开发态把仓库根当工作区；打包后不能把安装目录暴露给用户，改用文档目录。 */
function getDefaultWorkspaceRoot(): string {
  return app.isPackaged ? app.getPath('documents') : path.resolve(app.getAppPath(), '../..');
}

function bootstrap(): ApplicationContext {
  const userData = app.getPath('userData');
  const store = AppStore.open(path.join(userData, 'betterwork.db'));
  const knowledgeVault = new KnowledgeVault(
    path.join(userData, 'vaults', 'default', 'vault.sqlite'),
  );
  const skillService = new SkillService(store, {
    developmentBuiltinRoot: path.resolve(app.getAppPath(), '../../resources/skills'),
    installedBuiltinRoot: path.join(process.resourcesPath, 'skills'),
    userRoot: path.join(userData, 'skills'),
  });

  const builtinRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.resolve(app.getAppPath(), '../../resources/skills');
  readFile(path.join(builtinRoot, 'release-manifest.json'), 'utf8')
    .then((content) => JSON.parse(content) as BuiltinReleaseManifest)
    .then((manifest) => skillService.registerBuiltinRelease(manifest))
    .then((registered) => {
      if (registered.length > 0) {
        console.warn(`Registered ${registered.length} builtin skill(s)`);
      }
    })
    .catch((error: unknown) => {
      console.error('Builtin skill registration failed', error);
    });

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
  const interrupted = store.runs.failInterruptedRuns('算台上次退出时这次执行被中断', Date.now());
  if (interrupted > 0) {
    console.warn(`Marked ${interrupted} interrupted run(s) as failed on startup`);
  }
  // 环境准备作业同样不能停在 preparing：半成品目录会被清掉，不把部分包集当作可用。
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
    });

  const started: ApplicationContext = { store, knowledgeVault, window: null };
  const getWindow = (): BrowserWindow | null => {
    const window = started.window;
    return window && !window.isDestroyed() ? window : null;
  };

  started.window = createMainWindow();
  const notifications = new NotificationService(store.notifications, getWindow);
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
  );
  started.runs = runs;

  registerIpc({
    store,
    knowledgeVault,
    notifications,
    runs,
    skillService,
    dependencies,
    snapshots,
    fileArtifactService,
    dependencyLocksRoot,
    getWindow,
    getDefaultWorkspaceRoot,
  });
  return started;
}

app
  .whenReady()
  .then(() => {
    context = bootstrap();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && context) {
        context.window = createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error('BetterWork failed to start', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on(
  'before-quit',
  createQuitHandler(
    async () => {
      await context?.runs?.shutdown();
    },
    () => {
      context?.knowledgeVault.close();
      context?.store.close();
      context = null;
    },
    () => app.quit(),
    (error) => console.error('RunService shutdown failed:', error),
  ),
);
