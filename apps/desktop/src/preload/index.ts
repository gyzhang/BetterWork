import type { BetterWorkDesktopApi } from '@betterwork/agent-protocol';
import {
  agentRuntimeEventSchema,
  copySkillRequestSchema,
  deletedResultSchema,
  deleteSkillRequestSchema,
  exportSkillRequestSchema,
  getSkillRequestSchema,
  importSkillRequestSchema,
  IpcChannel,
  notificationActivatedSchema,
  notificationChangeEventSchema,
  revokeSkillTrustRequestSchema,
  saveSkillRuntimeProfileRequestSchema,
  setSkillEnabledRequestSchema,
  setSkillTrustRequestSchema,
  skillDetailSchema,
  skillExportResultSchema,
  skillImportResultSchema,
  skillMutationResultSchema,
  skillSummarySchema,
} from '@betterwork/agent-protocol';
import { contextBridge, ipcRenderer } from 'electron';
import { z, type ZodTypeAny } from 'zod';

function invokeValidated<Schema extends ZodTypeAny>(
  channel: string,
  input: unknown,
  schema: Schema,
): Promise<z.output<Schema>> {
  return ipcRenderer.invoke(channel, input).then((raw: unknown) => schema.parse(raw));
}

const api: BetterWorkDesktopApi = {
  runs: {
    start: (input) => ipcRenderer.invoke(IpcChannel.StartRun, input),
    cancel: (input) => ipcRenderer.invoke(IpcChannel.CancelRun, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.ListRuns, input),
    listEvents: (input) => ipcRenderer.invoke(IpcChannel.ListRunEvents, input),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(agentRuntimeEventSchema.parse(raw));
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
        listener(notificationChangeEventSchema.parse(raw));
      };
      ipcRenderer.on(IpcChannel.NotificationChangeEvent, handler);
      return () => ipcRenderer.off(IpcChannel.NotificationChangeEvent, handler);
    },
    onActivate(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(notificationActivatedSchema.parse(raw));
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
  skills: {
    list: () => invokeValidated(IpcChannel.ListSkills, {}, z.array(skillSummarySchema)),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetSkill,
        getSkillRequestSchema.parse(input),
        skillDetailSchema.nullable(),
      ),
    importFromDialog: () =>
      invokeValidated(
        IpcChannel.ImportSkill,
        importSkillRequestSchema.parse({}),
        skillImportResultSchema,
      ),
    saveRuntimeProfile: (input) =>
      invokeValidated(
        IpcChannel.SaveSkillRuntimeProfile,
        saveSkillRuntimeProfileRequestSchema.parse(input),
        skillMutationResultSchema,
      ),
    setTrust: (input) =>
      invokeValidated(
        IpcChannel.SetSkillTrust,
        setSkillTrustRequestSchema.parse(input),
        skillMutationResultSchema,
      ),
    revokeTrust: (input) =>
      invokeValidated(
        IpcChannel.RevokeSkillTrust,
        revokeSkillTrustRequestSchema.parse(input),
        skillMutationResultSchema,
      ),
    setEnabled: (input) =>
      invokeValidated(
        IpcChannel.SetSkillEnabled,
        setSkillEnabledRequestSchema.parse(input),
        skillMutationResultSchema,
      ),
    copy: (input) =>
      invokeValidated(
        IpcChannel.CopySkill,
        copySkillRequestSchema.parse(input),
        skillMutationResultSchema,
      ),
    export: (input) =>
      invokeValidated(
        IpcChannel.ExportSkill,
        exportSkillRequestSchema.parse(input),
        skillExportResultSchema,
      ),
    delete: (input) =>
      invokeValidated(
        IpcChannel.DeleteSkill,
        deleteSkillRequestSchema.parse(input),
        deletedResultSchema,
      ),
  },
};

contextBridge.exposeInMainWorld('betterwork', api);
