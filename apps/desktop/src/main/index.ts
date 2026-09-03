import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type BrowserWindowConstructorOptions } from 'electron';
import {
  cancelRunRequestSchema,
  createTaskRequestSchema,
  IpcChannel,
  listRunEventsRequestSchema,
  listEvidenceRequestSchema,
  listArtifactsRequestSchema,
  modelProfileIdSchema,
  setDefaultModelRequestSchema,
  setModelEnabledRequestSchema,
  saveModelProfileRequestSchema,
  saveMarkdownArtifactRequestSchema,
  testModelRequestSchema,
  startRunRequestSchema,
  searchKnowledgeRequestSchema,
  updateWindowThemeRequestSchema,
} from '@betterwork/agent-protocol';
import { RunJournal } from './run-journal';
import { RunService } from './run-service';
import { KnowledgeVault } from './knowledge-vault';

let mainWindow: BrowserWindow | null = null;
let journal: RunJournal | null = null;
let knowledgeVault: KnowledgeVault | null = null;

const createWindow = (): void => {
  const options: BrowserWindowConstructorOptions = {
    width: 1380,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: '算台 BetterWork',
    backgroundColor: '#F6F7F5',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#F6F7F5', symbolColor: '#1D2420' } } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  mainWindow = new BrowserWindow(options);

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
};

app.whenReady().then(() => {
  journal = new RunJournal(path.join(app.getPath('userData'), 'betterwork.db'));
  knowledgeVault = new KnowledgeVault(path.join(app.getPath('userData'), 'vaults', 'default', 'vault.sqlite'));
  createWindow();
  const runs = new RunService(journal, knowledgeVault, () => mainWindow);

  ipcMain.handle(IpcChannel.StartRun, (_event, raw) => {
    const input = startRunRequestSchema.parse(raw);
    return { runId: runs.start(input) };
  });
  ipcMain.handle(IpcChannel.CancelRun, (_event, raw) => {
    const input = cancelRunRequestSchema.parse(raw);
    return { cancelled: runs.cancel(input.runId) };
  });
  ipcMain.handle(IpcChannel.ListRuns, () => journal!.listRuns());
  ipcMain.handle(IpcChannel.ListRunEvents, (_event, raw) => {
    const input = listRunEventsRequestSchema.parse(raw);
    return journal!.listEvents(input.runId);
  });
  ipcMain.handle(IpcChannel.GetDefaultWorkspace, () => {
    const rootPath = app.isPackaged ? app.getPath('documents') : path.resolve(app.getAppPath(), '../..');
    return journal!.getOrCreateWorkspace(rootPath, '我的工作区');
  });
  ipcMain.handle(IpcChannel.SelectWorkspace, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择工作区',
      properties: ['openDirectory', 'createDirectory'],
    });
    const rootPath = result.filePaths[0];
    return result.canceled || !rootPath ? null : journal!.getOrCreateWorkspace(rootPath, path.basename(rootPath));
  });
  ipcMain.handle(IpcChannel.CreateTask, (_event, raw) => {
    const input = createTaskRequestSchema.parse(raw);
    return journal!.createTask(input.workspaceId, input.title, input.goal);
  });
  ipcMain.handle(IpcChannel.ListEvidence, (_event, raw) => journal!.listEvidence(listEvidenceRequestSchema.parse(raw).taskId));
  ipcMain.handle(IpcChannel.ListArtifacts, (_event, raw) => journal!.listArtifacts(listArtifactsRequestSchema.parse(raw ?? {}).taskId));
  ipcMain.handle(IpcChannel.SaveMarkdownArtifact, (_event, raw) => journal!.saveMarkdownArtifact(saveMarkdownArtifactRequestSchema.parse(raw)));
  ipcMain.handle(IpcChannel.ListModels, () => journal!.listModels());
  ipcMain.handle(IpcChannel.SaveModel, (_event, raw) => {
    const input = saveModelProfileRequestSchema.parse(raw);
    return { id: journal!.saveModel(input) };
  });
  ipcMain.handle(IpcChannel.DeleteModel, (_event, raw) => {
    const input = modelProfileIdSchema.parse(raw);
    return { deleted: journal!.deleteModel(input.id) };
  });
  ipcMain.handle(IpcChannel.SetDefaultModel, (_event, raw) => {
    const input = setDefaultModelRequestSchema.parse(raw);
    return { updated: journal!.setDefaultModel(input.id) };
  });
  ipcMain.handle(IpcChannel.SetModelEnabled, (_event, raw) => {
    const input = setModelEnabledRequestSchema.parse(raw);
    return { updated: journal!.setModelEnabled(input.id, input.enabled) };
  });
  ipcMain.handle(IpcChannel.ListKnowledge, () => knowledgeVault!.listDocuments());
  ipcMain.handle(IpcChannel.ImportKnowledge, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入本地资料',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '资料文件', extensions: ['md', 'markdown', 'txt', 'text', 'pdf', 'docx'] }, { name: '所有文件', extensions: ['*'] }],
    });
    return result.canceled ? { imported: [], skipped: [] } : knowledgeVault!.importPaths(result.filePaths);
  });
  ipcMain.handle(IpcChannel.SearchKnowledge, (_event, raw) => knowledgeVault!.search(searchKnowledgeRequestSchema.parse(raw).query));
  ipcMain.handle(IpcChannel.TestModel, async (_event, raw) => {
    const input = testModelRequestSchema.parse(raw);
    const base = input.baseUrl.replace(/\/$/, '');
    const url = base.endsWith('/embeddings') || base.endsWith('/chat/completions') ? base : `${base}/${input.role === 'embedding' ? 'embeddings' : 'chat/completions'}`;
    const body = input.role === 'embedding' ? { model: input.model, input: '算台连接测试' } : { model: input.model, messages: [{ role: 'user', content: '请只回复：连接成功' }], max_tokens: 8 };
    const stored = input.id ? journal!.getModel(input.id) : undefined;
    const apiKey = input.apiKey || stored?.apiKey || '';
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify(body) });
      if (!response.ok) {
        if (input.id) journal!.recordModelConnection(input.id, 'failed');
        return { ok: false, message: `连接失败（HTTP ${response.status}）` };
      }
      if (input.id) journal!.recordModelConnection(input.id, 'connected');
      return { ok: true, message: input.role === 'embedding' ? 'Embedding 模型连接成功' : '模型连接成功' };
    } catch (error) {
      if (input.id) journal!.recordModelConnection(input.id, 'failed');
      return { ok: false, message: error instanceof Error ? error.message : '连接失败' };
    }
  });
  ipcMain.handle(IpcChannel.UpdateWindowTheme, (_event, raw) => {
    const theme = updateWindowThemeRequestSchema.parse(raw);
    mainWindow?.setBackgroundColor(theme.backgroundColor);
    if (process.platform === 'win32') mainWindow?.setTitleBarOverlay({ color: theme.backgroundColor, symbolColor: theme.symbolColor });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { journal?.close(); knowledgeVault?.close(); });
