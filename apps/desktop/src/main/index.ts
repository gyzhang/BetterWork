import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/register-ipc';
import { AppStore } from './persistence';
import { KnowledgeVault } from './services/knowledge-vault';
import { NotificationService } from './services/notification-service';
import { RunService } from './services/run-service';
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

  // 上次进程被强杀时正在执行的 Run 会停在 running。启动时统一收口为 failed，
  // 维持「每个 Run 都有明确结果」这条不变量，历史列表不会出现永远转圈的任务。
  const interrupted = store.runs.failInterruptedRuns('算台上次退出时这次执行被中断', Date.now());
  if (interrupted > 0) {
    console.warn(`Marked ${interrupted} interrupted run(s) as failed on startup`);
  }

  const started: ApplicationContext = { store, knowledgeVault, window: null };
  const getWindow = (): BrowserWindow | null => {
    const window = started.window;
    return window && !window.isDestroyed() ? window : null;
  };

  started.window = createMainWindow();
  const notifications = new NotificationService(store.notifications, getWindow);
  const runs = new RunService(store, knowledgeVault, notifications, getWindow);

  registerIpc({ store, knowledgeVault, notifications, runs, getWindow, getDefaultWorkspaceRoot });
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
  // 知识库先关：它可能还持有从应用状态库读到的路径引用
  context?.knowledgeVault.close();
  context?.store.close();
  context = null;
});
