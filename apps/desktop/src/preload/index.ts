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
    getDefaultPath: () => ipcRenderer.invoke(IpcChannel.GetDefaultWorkspace),
    selectDirectory: () => ipcRenderer.invoke(IpcChannel.SelectWorkspace),
  },
};

contextBridge.exposeInMainWorld('betterwork', api);
