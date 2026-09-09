import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import {
  createFetchDownloader,
  createNodeFileSystem,
  createNodeProcessRunner,
} from './infrastructure/dependency-adapters';
import type { ExecutionLogSink, ExecutionLogStream } from './infrastructure/mac-process-supervisor';
import {
  createMacProcessSupervisor,
  resolveGuardianRuntime,
} from './infrastructure/mac-process-supervisor';
import { registerIpc } from './ipc/register-ipc';
import { AppStore } from './persistence';
import { KnowledgeVault } from './services/knowledge-vault';
import { NotificationService } from './services/notification-service';
import { RunService } from './services/run-service';
import { SkillDependencyService } from './services/skill-dependency-service';
import { SkillExecutionService } from './services/skill-execution-service';
import { SkillService } from './services/skill-service';
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
    createLogSink: (executionId): ExecutionLogSink => {
      const chunks: string[] = [];
      return {
        key: executionId,
        write(_stream: ExecutionLogStream, text: string) {
          chunks.push(text);
        },
        async close() {
          chunks.length = 0;
        },
      };
    },
  });
  const skillExecutionService = new SkillExecutionService(store, supervisor);
  const interruptedExecutions = skillExecutionService.recoverInterruptedExecutions();
  if (interruptedExecutions > 0) {
    console.warn(`Marked ${interruptedExecutions} interrupted execution(s) as failed on startup`);
  }
  const runs = new RunService(
    store,
    knowledgeVault,
    notifications,
    skillService,
    getWindow,
    skillExecutionService,
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

app.on('before-quit', () => {
  // 设计 §8：正常关闭先取消所有活跃 Run 并等待子进程清理，再关闭存储。
  const shutdown = context?.runs?.shutdown() ?? Promise.resolve();
  shutdown
    .then(() => {
      context?.knowledgeVault.close();
      context?.store.close();
      context = null;
    })
    .catch((error: unknown) => {
      console.error('RunService shutdown failed:', error);
      context?.knowledgeVault.close();
      context?.store.close();
      context = null;
    });
});
