import { contextBridge, ipcRenderer } from 'electron';
import type { AgentRuntimeEvent, BetterWorkDesktopApi, NotificationActivated, NotificationChangeEvent } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema, notificationActivatedSchema, notificationChangeEventSchema, IpcChannel } from '@betterwork/agent-protocol';

const api: BetterWorkDesktopApi = {
  runs: {
    start: (input) => ipcRenderer.invoke(IpcChannel.StartRun, input),
    cancel: (input) => ipcRenderer.invoke(IpcChannel.CancelRun, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.ListRuns, input),
    listEvents: (input) => ipcRenderer.invoke(IpcChannel.ListRunEvents, input),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(agentRuntimeEventSchema.parse(raw) as AgentRuntimeEvent);
      };
      ipcRenderer.on(IpcChannel.RunEvent, handler);
      return () => ipcRenderer.off(IpcChannel.RunEvent, handler);
    },
  },
  workspace: {
    getDefault: () => ipcRenderer.invoke(IpcChannel.GetDefaultWorkspace),
    selectDirectory: () => ipcRenderer.invoke(IpcChannel.SelectWorkspace),
  },
  tasks: {
    create: (input) => ipcRenderer.invoke(IpcChannel.CreateTask, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.ListTasks, input),
  },
  evidence: {
    list: (input) => ipcRenderer.invoke(IpcChannel.ListEvidence, input),
  },
  artifacts: {
    list: (input) => ipcRenderer.invoke(IpcChannel.ListArtifacts, input),
    get: (input) => ipcRenderer.invoke(IpcChannel.GetArtifact, input),
    listVersions: (input) => ipcRenderer.invoke(IpcChannel.ListArtifactVersions, input),
    getVersion: (input) => ipcRenderer.invoke(IpcChannel.GetArtifactVersion, input),
    saveMarkdown: (input) => ipcRenderer.invoke(IpcChannel.SaveMarkdownArtifact, input),
    exportMarkdown: (input) => ipcRenderer.invoke(IpcChannel.ExportMarkdownArtifact, input),
  },
  models: {
    list: () => ipcRenderer.invoke(IpcChannel.ListModels),
    save: (input) => ipcRenderer.invoke(IpcChannel.SaveModel, input),
    delete: (input) => ipcRenderer.invoke(IpcChannel.DeleteModel, input),
    setDefault: (input) => ipcRenderer.invoke(IpcChannel.SetDefaultModel, input),
    setEnabled: (input) => ipcRenderer.invoke(IpcChannel.SetModelEnabled, input),
    test: (input) => ipcRenderer.invoke(IpcChannel.TestModel, input),
  },
  searchEngines: {
    list: () => ipcRenderer.invoke(IpcChannel.ListSearchEngines),
    save: (input) => ipcRenderer.invoke(IpcChannel.SaveSearchEngine, input),
    test: (input) => ipcRenderer.invoke(IpcChannel.TestSearchEngine, input),
  },
  notifications: {
    list: () => ipcRenderer.invoke(IpcChannel.ListNotifications),
    markRead: (input) => ipcRenderer.invoke(IpcChannel.MarkNotificationRead, input),
    markAllRead: () => ipcRenderer.invoke(IpcChannel.MarkAllNotificationsRead, {}),
    clear: () => ipcRenderer.invoke(IpcChannel.ClearNotifications, {}),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(notificationChangeEventSchema.parse(raw) as NotificationChangeEvent);
      };
      ipcRenderer.on(IpcChannel.NotificationChangeEvent, handler);
      return () => ipcRenderer.off(IpcChannel.NotificationChangeEvent, handler);
    },
    onActivate(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(notificationActivatedSchema.parse(raw) as NotificationActivated);
      };
      ipcRenderer.on(IpcChannel.NotificationActivated, handler);
      return () => ipcRenderer.off(IpcChannel.NotificationActivated, handler);
    },
  },
  chrome: {
    updateTheme: (input) => ipcRenderer.invoke(IpcChannel.UpdateWindowTheme, input),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize, {}),
  },
  knowledge: {
    list: () => ipcRenderer.invoke(IpcChannel.ListKnowledge),
    importFromDialog: () => ipcRenderer.invoke(IpcChannel.ImportKnowledge),
    search: (input) => ipcRenderer.invoke(IpcChannel.SearchKnowledge, input),
    openSource: (input) => ipcRenderer.invoke(IpcChannel.OpenKnowledgeSource, input),
    remove: (input) => ipcRenderer.invoke(IpcChannel.RemoveKnowledgeDocument, input),
    refresh: (input) => ipcRenderer.invoke(IpcChannel.RefreshKnowledgeDocument, input),
  },
};

contextBridge.exposeInMainWorld('betterwork', api);
