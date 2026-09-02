import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import {
  cancelRunRequestSchema,
  IpcChannel,
  listRunEventsRequestSchema,
  startRunRequestSchema,
} from '@betterwork/agent-protocol';
import { RunJournal } from './run-journal';
import { RunService } from './run-service';

let mainWindow: BrowserWindow | null = null;
let journal: RunJournal | null = null;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: '算台 BetterWork',
    backgroundColor: '#f4f1e9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
};

app.whenReady().then(() => {
  journal = new RunJournal(path.join(app.getPath('userData'), 'betterwork.db'));
  createWindow();
  const runs = new RunService(journal, () => mainWindow);

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
  ipcMain.handle(IpcChannel.GetDefaultWorkspace, () => (
    app.isPackaged ? app.getPath('documents') : path.resolve(app.getAppPath(), '../..')
  ));
  ipcMain.handle(IpcChannel.SelectWorkspace, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择工作区',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => journal?.close());
