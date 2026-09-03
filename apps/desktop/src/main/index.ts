import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences, type BrowserWindowConstructorOptions } from 'electron';
import {
  cancelRunRequestSchema,
  createTaskRequestSchema,
  IpcChannel,
  listRunEventsRequestSchema,
  listRunsRequestSchema,
  listEvidenceRequestSchema,
  listArtifactsRequestSchema,
  listArtifactVersionsRequestSchema,
  listTasksRequestSchema,
  getArtifactRequestSchema,
  getArtifactVersionRequestSchema,
  exportMarkdownArtifactRequestSchema,
  modelProfileIdSchema,
  setDefaultModelRequestSchema,
  setModelEnabledRequestSchema,
  saveModelProfileRequestSchema,
  saveMarkdownArtifactRequestSchema,
  testModelRequestSchema,
  startRunRequestSchema,
  searchKnowledgeRequestSchema,
  openKnowledgeSourceRequestSchema,
  removeKnowledgeDocumentRequestSchema,
  refreshKnowledgeDocumentRequestSchema,
  updateWindowThemeRequestSchema,
  windowToggleMaximizeRequestSchema,
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
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
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
  ipcMain.handle(IpcChannel.ListRuns, (_event, raw) => journal!.listRuns(listRunsRequestSchema.parse(raw ?? {}).taskId));
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
  ipcMain.handle(IpcChannel.ListTasks, (_event, raw) => journal!.listTasks(listTasksRequestSchema.parse(raw ?? {}).workspaceId));
  ipcMain.handle(IpcChannel.ListEvidence, (_event, raw) => journal!.listEvidence(listEvidenceRequestSchema.parse(raw).taskId));
  ipcMain.handle(IpcChannel.ListArtifacts, (_event, raw) => journal!.listArtifacts(listArtifactsRequestSchema.parse(raw ?? {}).taskId));
  ipcMain.handle(IpcChannel.GetArtifact, (_event, raw) => journal!.getArtifactDetail(getArtifactRequestSchema.parse(raw).id) ?? null);
  ipcMain.handle(IpcChannel.ListArtifactVersions, (_event, raw) => journal!.listArtifactVersions(listArtifactVersionsRequestSchema.parse(raw).artifactId));
  ipcMain.handle(IpcChannel.GetArtifactVersion, (_event, raw) => journal!.getArtifactVersionDetail(getArtifactVersionRequestSchema.parse(raw).id) ?? null);
  ipcMain.handle(IpcChannel.SaveMarkdownArtifact, (_event, raw) => journal!.saveMarkdownArtifact(saveMarkdownArtifactRequestSchema.parse(raw)));
  ipcMain.handle(IpcChannel.ExportMarkdownArtifact, async (_event, raw) => {
    const input = exportMarkdownArtifactRequestSchema.parse(raw);
    const artifact = journal!.getArtifactDetail(input.artifactId);
    if (!artifact) throw new Error('Artifact does not exist');
    const version = input.versionId ? journal!.getArtifactVersionDetail(input.versionId) : undefined;
    if (input.versionId && (!version || version.artifactId !== artifact.id)) throw new Error('Artifact version does not belong to artifact');
    const safeTitle = artifact.title.replace(/[\\/:*?"<>|]/g, '-').trim() || '算台成果';
    const result = await dialog.showSaveDialog(mainWindow!, { title: '导出 Markdown 成果', defaultPath: `${safeTitle}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await writeFile(result.filePath, version?.content ?? artifact.content, 'utf8');
    return { cancelled: false, filePath: result.filePath };
  });
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
  ipcMain.handle(IpcChannel.OpenKnowledgeSource, async (_event, raw) => {
    const sourcePath = knowledgeVault!.getRegisteredSourcePath(openKnowledgeSourceRequestSchema.parse(raw).sourcePath);
    if (!sourcePath) return { opened: false, error: '该文件不在当前知识库中，无法打开。' };
    const error = await shell.openPath(sourcePath);
    return error ? { opened: false, error } : { opened: true };
  });
  ipcMain.handle(IpcChannel.RemoveKnowledgeDocument, (_event, raw) => ({ removed: knowledgeVault!.removeDocument(removeKnowledgeDocumentRequestSchema.parse(raw).id) }));
  ipcMain.handle(IpcChannel.RefreshKnowledgeDocument, (_event, raw) => knowledgeVault!.refreshDocument(refreshKnowledgeDocumentRequestSchema.parse(raw).id));
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
  ipcMain.handle(IpcChannel.WindowToggleMaximize, () => {
    if (!mainWindow) return { maximized: false };
    if (process.platform === 'darwin') {
      const preference = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
      if (preference === 'Minimize') { mainWindow.minimize(); return { maximized: false }; }
      if (preference === 'None') return { maximized: mainWindow.isMaximized() };
    }
    if (mainWindow.isMaximized()) { mainWindow.unmaximize(); return { maximized: false }; }
    mainWindow.maximize();
    return { maximized: true };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { journal?.close(); knowledgeVault?.close(); });
