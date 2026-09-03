import { contextBridge, ipcRenderer } from 'electron';
import type { AgentRuntimeEvent, BetterWorkDesktopApi } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema, IpcChannel } from '@betterwork/agent-protocol';

const api: BetterWorkDesktopApi = {
  runs: {
    start: (input) => ipcRenderer.invoke(IpcChannel.StartRun, input),
    cancel: (input) => ipcRenderer.invoke(IpcChannel.CancelRun, input),
    list: () => ipcRenderer.invoke(IpcChannel.ListRuns),
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
  },
  evidence: {
    list: (input) => ipcRenderer.invoke(IpcChannel.ListEvidence, input),
  },
  models: {
    list: () => ipcRenderer.invoke(IpcChannel.ListModels),
    save: (input) => ipcRenderer.invoke(IpcChannel.SaveModel, input),
    delete: (input) => ipcRenderer.invoke(IpcChannel.DeleteModel, input),
    setDefault: (input) => ipcRenderer.invoke(IpcChannel.SetDefaultModel, input),
    setEnabled: (input) => ipcRenderer.invoke(IpcChannel.SetModelEnabled, input),
    test: (input) => ipcRenderer.invoke(IpcChannel.TestModel, input),
  },
  chrome: {
    updateTheme: (input) => ipcRenderer.invoke(IpcChannel.UpdateWindowTheme, input),
  },
  knowledge: {
    list: () => ipcRenderer.invoke(IpcChannel.ListKnowledge),
    importFromDialog: () => ipcRenderer.invoke(IpcChannel.ImportKnowledge),
    search: (input) => ipcRenderer.invoke(IpcChannel.SearchKnowledge, input),
  },
};

contextBridge.exposeInMainWorld('betterwork', api);
