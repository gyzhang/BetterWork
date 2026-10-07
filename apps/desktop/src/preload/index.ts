import type { BetterWorkDesktopApi } from '@betterwork/agent-protocol';
import {
  agentRuntimeEventSchema,
  applyScheduleExpertRevisionRequestSchema,
  artifactVersionExecutorSummarySchema,
  cancelDependencyRequestSchema,
  cancelDependencyResultSchema,
  cancelMemoryJobRequestSchema,
  cancelScheduleOccurrenceRequestSchema,
  checkKnowledgeSourcesRequestSchema,
  chooseInterpreterResultSchema,
  clearedResultSchema,
  copyExpertRequestSchema,
  copySkillRequestSchema,
  createDiscussionCheckpointRequestSchema,
  createMemoryRequestSchema,
  declareArtifactSourcesRequestSchema,
  deletedResultSchema,
  deleteExpertRequestSchema,
  deleteKnowledgeCollectionRequestSchema,
  deleteMcpConnectionRequestSchema,
  deleteSkillRequestSchema,
  deleteToolchainSnapshotRequestSchema,
  deleteToolchainSnapshotResultSchema,
  dependencyOperationSchema,
  dependencyOptionsSchema,
  dependencyPlanRequestSchema,
  dependencyPlanSchema,
  discussionCheckpointMutationResultSchema,
  discussionCheckpointSchema,
  executeMissedScheduleRequestSchema,
  executeScheduleNowRequestSchema,
  expertDetailSchema,
  expertMutationResultSchema,
  expertRevisionDraftSchema,
  expertSummarySchema,
  exportSkillRequestSchema,
  getArtifactThumbnailsRequestSchema,
  getArtifactThumbnailsResultSchema,
  getArtifactVersionExecutorRequestSchema,
  getDependencyOperationRequestSchema,
  getExpertRequestSchema,
  getMcpConnectionRequestSchema,
  getMemoryRequestSchema,
  getMemorySettingsRequestSchema,
  getNotificationRequestSchema,
  getRunArtifactDeclarationsRequestSchema,
  getRunMemoryContextRequestSchema,
  getScheduleOccurrenceRequestSchema,
  getScheduleRequestSchema,
  getSkillRequestSchema,
  getTaskContextRequestSchema,
  getTaskContinuityBriefRequestSchema,
  getTaskRequestSchema,
  importSkillFromUrlRequestSchema,
  importSkillRequestSchema,
  inputSnapshotSchema,
  IpcChannel,
  knowledgeCollectionMembersResultSchema,
  knowledgeCollectionSchema,
  knowledgeCreateResearchDraftRequestSchema,
  knowledgeDocumentSummarySchema,
  knowledgeImportAckSchema,
  knowledgeJobAckSchema,
  knowledgeJobCancelResultSchema,
  knowledgeJobDetailSchema,
  knowledgeJobIdRequestSchema,
  knowledgeJobPageSchema,
  knowledgeJobSummarySchema,
  knowledgeResearchDraftResultSchema,
  knowledgeRevisionSummarySchema,
  knowledgeSearchSettingsSchema,
  knowledgeTextPageSchema,
  listDependencyOptionsRequestSchema,
  listDiscussionCheckpointsRequestSchema,
  listExpertsRequestSchema,
  listKnowledgeJobsRequestSchema,
  listKnowledgeRequestSchema,
  listKnowledgeRevisionsRequestSchema,
  listMemoriesRequestSchema,
  listMemoryJobsRequestSchema,
  listScheduleOccurrencesRequestSchema,
  listScheduleSourceItemsRequestSchema,
  listSchedulesRequestSchema,
  listTaskMaterialCandidatesRequestSchema,
  listWorkspaceReferenceVersionsRequestSchema,
  materialCandidateSchema,
  mcpConnectionSummarySchema,
  mcpMutationResultSchema,
  mcpTestResultSchema,
  memoryConflictResolutionDataSchema,
  memoryJobListDataSchema,
  memoryJobSummarySchema,
  memoryListPageDataSchema,
  memoryPreviewDataSchema,
  memoryProjectionStateDataSchema,
  memoryReferenceWriteReceiptSchema,
  memoryRunContextDataSchema,
  memorySettingsDataSchema,
  memoryViewItemSchema,
  memoryWriteReceiptSchema,
  notificationActivatedSchema,
  notificationChangeEventSchema,
  notificationRendererReadyRequestSchema,
  notificationRendererReadyResultSchema,
  notificationSummarySchema,
  preflightScheduleRequestSchema,
  prepareDependencyRequestSchema,
  prepareDependencyResultSchema,
  prepareWorkspaceInputSnapshotRequestSchema,
  previewKnowledgeRequestSchema,
  previewMemoryRequestSchema,
  previewRunSourceRequestSchema,
  previewScheduleRequestSchema,
  rebuildKnowledgeIndexRequestSchema,
  rebuildMemoryProjectionRequestSchema,
  recentTaskSummarySchema,
  refreshKnowledgeDocumentRequestSchema,
  refreshSkillDependencyGrantRequestSchema,
  refreshSkillDependencyGrantResultSchema,
  registerToolchainRequestSchema,
  registerToolchainResultSchema,
  removeWorkspaceReferenceVersionRequestSchema,
  resolveMemoryConflictRequestSchema,
  resultSchema,
  retryKnowledgeJobRequestSchema,
  retryMemoryJobRequestSchema,
  retryScheduleOutputRequestSchema,
  revokeSkillTrustRequestSchema,
  runArtifactSourceDeclarationSchema,
  runSettingsSchema,
  runSourcePreviewSchema,
  runtimeEnvironmentSchema,
  saveExpertRevisionRequestSchema,
  saveKnowledgeCollectionRequestSchema,
  saveKnowledgeSettingsRequestSchema,
  saveMcpConnectionRequestSchema,
  saveRunSettingsRequestSchema,
  saveScheduleRequestSchema,
  saveSkillRuntimeProfileRequestSchema,
  saveTaskContextRequestSchema,
  saveTaskContinuityBriefRequestSchema,
  scheduleAggregateSchema,
  scheduleCallResultSchema,
  scheduleCancelOccurrenceResultSchema,
  scheduleChangedEventSchema,
  scheduleDetailSchema,
  scheduleManualExecutionResultSchema,
  scheduleOccurrenceDetailSchema,
  scheduleOccurrenceHistoryPageSchema,
  scheduleOutputReceiptSchema,
  schedulePageSchema,
  schedulePreflightViewSchema,
  schedulePreviewResultSchema,
  scheduleSourceItemsPageSchema,
  setExpertLifecycleRequestSchema,
  setKnowledgeCollectionMembersRequestSchema,
  setMemorySettingsRequestSchema,
  setMemoryStatusRequestSchema,
  setScheduleLifecycleRequestSchema,
  setSkillEnabledRequestSchema,
  setSkillTrustRequestSchema,
  setWorkspaceReferenceVersionRequestSchema,
  skillDetailSchema,
  skillExportResultSchema,
  skillImportResultSchema,
  skillMutationResultSchema,
  skillSummarySchema,
  taskContextMutationResultSchema,
  taskContextRevisionSchema,
  taskContinuityBriefMutationResultSchema,
  taskContinuityRevisionSchema,
  taskMemoryExclusionsDataSchema,
  taskMemoryExclusionsRequestSchema,
  testSkillRunRequestSchema,
  testSkillRunResultSchema,
  updateMemoryRequestSchema,
  verifyDependencyEnvironmentRequestSchema,
  workspaceBriefSchema,
  workspaceMemoryBriefRequestSchema,
  workspaceMemorySettingsSchema,
  workspaceReferenceListDataSchema,
  workspaceReferenceSetDataSchema,
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
  runSettings: {
    get: () => invokeValidated(IpcChannel.GetRunSettings, {}, runSettingsSchema),
    save: (input) =>
      invokeValidated(
        IpcChannel.SaveRunSettings,
        saveRunSettingsRequestSchema.parse(input),
        runSettingsSchema,
      ),
  },
  workspace: {
    getDefault: () => ipcRenderer.invoke(IpcChannel.GetDefaultWorkspace),
    pickDirectory: () => ipcRenderer.invoke(IpcChannel.PickWorkspaceDirectory),
    listAll: () => ipcRenderer.invoke(IpcChannel.ListWorkspaces),
    create: (input) => ipcRenderer.invoke(IpcChannel.CreateWorkspace, input),
    updateIdentity: (input) => ipcRenderer.invoke(IpcChannel.UpdateWorkspaceIdentity, input),
    setHidden: (input) => ipcRenderer.invoke(IpcChannel.SetWorkspaceHidden, input),
    listTaskGroups: () => ipcRenderer.invoke(IpcChannel.ListWorkspaceTaskGroups),
    memoryBrief: (input) =>
      invokeValidated(
        IpcChannel.GetWorkspaceMemoryBrief,
        workspaceMemoryBriefRequestSchema.parse(input),
        resultSchema(workspaceBriefSchema),
      ),
    listReferenceVersions: (input) =>
      invokeValidated(
        IpcChannel.ListWorkspaceReferenceVersions,
        listWorkspaceReferenceVersionsRequestSchema.parse(input),
        resultSchema(workspaceReferenceListDataSchema),
      ),
    setReferenceVersion: (input) =>
      invokeValidated(
        IpcChannel.SetWorkspaceReferenceVersion,
        setWorkspaceReferenceVersionRequestSchema.parse(input),
        resultSchema(workspaceReferenceSetDataSchema),
      ),
    removeReferenceVersion: (input) =>
      invokeValidated(
        IpcChannel.RemoveWorkspaceReferenceVersion,
        removeWorkspaceReferenceVersionRequestSchema.parse(input),
        resultSchema(memoryReferenceWriteReceiptSchema),
      ),
  },
  tasks: {
    create: (input) => ipcRenderer.invoke(IpcChannel.CreateTask, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.ListTasks, input),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetTask,
        getTaskRequestSchema.parse(input),
        recentTaskSummarySchema.nullable(),
      ),
  },
  evidence: {
    list: (input) => ipcRenderer.invoke(IpcChannel.ListEvidence, input),
  },
  artifacts: {
    list: (input) => ipcRenderer.invoke(IpcChannel.ListArtifacts, input),
    get: (input) => ipcRenderer.invoke(IpcChannel.GetArtifact, input),
    listVersions: (input) => ipcRenderer.invoke(IpcChannel.ListArtifactVersions, input),
    getVersionExecutor: (input) =>
      invokeValidated(
        IpcChannel.GetArtifactVersionExecutor,
        getArtifactVersionExecutorRequestSchema.parse(input),
        artifactVersionExecutorSummarySchema.nullable(),
      ),
    getVersion: (input) => ipcRenderer.invoke(IpcChannel.GetArtifactVersion, input),
    saveMarkdown: (input) => ipcRenderer.invoke(IpcChannel.SaveMarkdownArtifact, input),
    exportMarkdown: (input) => ipcRenderer.invoke(IpcChannel.ExportMarkdownArtifact, input),
    registerFile: (input) => ipcRenderer.invoke(IpcChannel.RegisterFileArtifact, input),
    getFileDetail: (input) => ipcRenderer.invoke(IpcChannel.GetFileArtifact, input),
    exportFile: (input) => ipcRenderer.invoke(IpcChannel.ExportFileArtifact, input),
    openFile: (input) => ipcRenderer.invoke(IpcChannel.OpenFileArtifact, input),
    getThumbnails: (input) =>
      invokeValidated(
        IpcChannel.GetArtifactThumbnails,
        getArtifactThumbnailsRequestSchema.parse(input),
        getArtifactThumbnailsResultSchema,
      ),
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
    get: (input) =>
      invokeValidated(
        IpcChannel.GetNotification,
        getNotificationRequestSchema.parse(input),
        notificationSummarySchema.nullable(),
      ),
    rendererReady: () =>
      invokeValidated(
        IpcChannel.NotificationRendererReady,
        notificationRendererReadyRequestSchema.parse({}),
        notificationRendererReadyResultSchema,
      ),
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
  schedules: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListSchedules,
        listSchedulesRequestSchema.parse(input ?? {}),
        scheduleCallResultSchema(schedulePageSchema),
      ),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetSchedule,
        getScheduleRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleDetailSchema),
      ),
    save: (input) =>
      invokeValidated(
        IpcChannel.SaveSchedule,
        saveScheduleRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleAggregateSchema),
      ),
    setLifecycle: (input) =>
      invokeValidated(
        IpcChannel.SetScheduleLifecycle,
        setScheduleLifecycleRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleAggregateSchema),
      ),
    preview: (input) =>
      invokeValidated(
        IpcChannel.PreviewSchedule,
        previewScheduleRequestSchema.parse(input),
        scheduleCallResultSchema(schedulePreviewResultSchema),
      ),
    preflight: (input) =>
      invokeValidated(
        IpcChannel.PreflightSchedule,
        preflightScheduleRequestSchema.parse(input),
        scheduleCallResultSchema(schedulePreflightViewSchema),
      ),
    applyExpertRevision: (input) =>
      invokeValidated(
        IpcChannel.ApplyScheduleExpertRevision,
        applyScheduleExpertRevisionRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleAggregateSchema),
      ),
    listOccurrences: (input) =>
      invokeValidated(
        IpcChannel.ListScheduleOccurrences,
        listScheduleOccurrencesRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleOccurrenceHistoryPageSchema),
      ),
    getOccurrence: (input) =>
      invokeValidated(
        IpcChannel.GetScheduleOccurrence,
        getScheduleOccurrenceRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleOccurrenceDetailSchema),
      ),
    listSourceItems: (input) =>
      invokeValidated(
        IpcChannel.ListScheduleSourceItems,
        listScheduleSourceItemsRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleSourceItemsPageSchema),
      ),
    executeNow: (input) =>
      invokeValidated(
        IpcChannel.ExecuteScheduleNow,
        executeScheduleNowRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleManualExecutionResultSchema),
      ),
    executeMissed: (input) =>
      invokeValidated(
        IpcChannel.ExecuteMissedSchedule,
        executeMissedScheduleRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleManualExecutionResultSchema),
      ),
    cancelOccurrence: (input) =>
      invokeValidated(
        IpcChannel.CancelScheduleOccurrence,
        cancelScheduleOccurrenceRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleCancelOccurrenceResultSchema),
      ),
    retryOutput: (input) =>
      invokeValidated(
        IpcChannel.RetryScheduleOutput,
        retryScheduleOutputRequestSchema.parse(input),
        scheduleCallResultSchema(scheduleOutputReceiptSchema),
      ),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(scheduleChangedEventSchema.parse(raw));
      };
      ipcRenderer.on(IpcChannel.ScheduleChanged, handler);
      return () => ipcRenderer.off(IpcChannel.ScheduleChanged, handler);
    },
  },
  chrome: {
    updateTheme: (input) => ipcRenderer.invoke(IpcChannel.UpdateWindowTheme, input),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize, {}),
  },
  knowledge: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListKnowledge,
        listKnowledgeRequestSchema.parse(input ?? {}),
        z.array(knowledgeDocumentSummarySchema),
      ),
    listCollections: () =>
      invokeValidated(IpcChannel.ListKnowledgeCollections, {}, z.array(knowledgeCollectionSchema)),
    saveCollection: (input) =>
      invokeValidated(
        IpcChannel.SaveKnowledgeCollection,
        saveKnowledgeCollectionRequestSchema.parse(input),
        z.array(knowledgeCollectionSchema),
      ),
    deleteCollection: (input) =>
      invokeValidated(
        IpcChannel.DeleteKnowledgeCollection,
        deleteKnowledgeCollectionRequestSchema.parse(input),
        z.array(knowledgeCollectionSchema),
      ),
    setCollectionMembers: (input) =>
      invokeValidated(
        IpcChannel.SetKnowledgeCollectionMembers,
        setKnowledgeCollectionMembersRequestSchema.parse(input),
        knowledgeCollectionMembersResultSchema,
      ),
    importFromDialog: () =>
      invokeValidated(IpcChannel.ImportKnowledge, {}, knowledgeImportAckSchema),
    jobs: (input) =>
      invokeValidated(
        IpcChannel.ListKnowledgeJobs,
        listKnowledgeJobsRequestSchema.parse(input ?? {}),
        knowledgeJobPageSchema,
      ),
    job: (input) =>
      invokeValidated(
        IpcChannel.GetKnowledgeJob,
        knowledgeJobIdRequestSchema.parse(input),
        knowledgeJobDetailSchema.nullable(),
      ),
    cancelJob: (input) =>
      invokeValidated(
        IpcChannel.CancelKnowledgeJob,
        knowledgeJobIdRequestSchema.parse(input),
        knowledgeJobCancelResultSchema,
      ),
    clearJobs: () => invokeValidated(IpcChannel.ClearKnowledgeJobs, {}, clearedResultSchema),
    retryJob: (input) =>
      invokeValidated(
        IpcChannel.RetryKnowledgeJob,
        retryKnowledgeJobRequestSchema.parse(input),
        knowledgeJobAckSchema,
      ),
    onJobEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(knowledgeJobSummarySchema.parse(raw));
      };
      ipcRenderer.on(IpcChannel.KnowledgeJobEvent, handler);
      return () => ipcRenderer.off(IpcChannel.KnowledgeJobEvent, handler);
    },
    settings: () =>
      invokeValidated(IpcChannel.GetKnowledgeSettings, {}, knowledgeSearchSettingsSchema),
    saveSettings: (input) =>
      invokeValidated(
        IpcChannel.SaveKnowledgeSettings,
        saveKnowledgeSettingsRequestSchema.parse(input),
        knowledgeSearchSettingsSchema,
      ),
    rebuildIndex: (input) =>
      invokeValidated(
        IpcChannel.RebuildKnowledgeIndex,
        rebuildKnowledgeIndexRequestSchema.parse(input),
        knowledgeJobAckSchema,
      ),
    checkSources: (input) =>
      invokeValidated(
        IpcChannel.CheckKnowledgeSources,
        checkKnowledgeSourcesRequestSchema.parse(input),
        knowledgeJobAckSchema,
      ),
    search: (input) => ipcRenderer.invoke(IpcChannel.SearchKnowledge, input),
    openSource: (input) => ipcRenderer.invoke(IpcChannel.OpenKnowledgeSource, input),
    remove: (input) => ipcRenderer.invoke(IpcChannel.RemoveKnowledgeDocument, input),
    refresh: (input) =>
      invokeValidated(
        IpcChannel.RefreshKnowledgeDocument,
        refreshKnowledgeDocumentRequestSchema.parse(input),
        knowledgeJobAckSchema,
      ),
    listRevisions: (input) =>
      invokeValidated(
        IpcChannel.ListKnowledgeRevisions,
        listKnowledgeRevisionsRequestSchema.parse(input),
        z.array(knowledgeRevisionSummarySchema),
      ),
    preview: (input) =>
      invokeValidated(
        IpcChannel.PreviewKnowledge,
        previewKnowledgeRequestSchema.parse(input),
        knowledgeTextPageSchema,
      ),
    createResearchDraft: (input) =>
      invokeValidated(
        IpcChannel.CreateResearchDraft,
        knowledgeCreateResearchDraftRequestSchema.parse(input),
        knowledgeResearchDraftResultSchema,
      ),
    previewRunSource: (input) =>
      invokeValidated(
        IpcChannel.PreviewRunSource,
        previewRunSourceRequestSchema.parse(input),
        runSourcePreviewSchema,
      ),
    declareArtifactSources: (input) =>
      invokeValidated(
        IpcChannel.DeclareArtifactSources,
        declareArtifactSourcesRequestSchema.parse(input),
        runArtifactSourceDeclarationSchema,
      ),
    getRunArtifactDeclarations: (input) =>
      invokeValidated(
        IpcChannel.GetRunArtifactDeclarations,
        getRunArtifactDeclarationsRequestSchema.parse(input),
        runArtifactSourceDeclarationSchema.nullable(),
      ),
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
    importFromUrl: (input) =>
      invokeValidated(
        IpcChannel.ImportSkillFromUrl,
        importSkillFromUrlRequestSchema.parse(input),
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
    refreshDependencyGrant: (input) =>
      invokeValidated(
        IpcChannel.RefreshSkillDependencyGrant,
        refreshSkillDependencyGrantRequestSchema.parse(input),
        refreshSkillDependencyGrantResultSchema,
      ),
    testRun: (input) =>
      invokeValidated(
        IpcChannel.TestSkillRun,
        testSkillRunRequestSchema.parse(input),
        testSkillRunResultSchema,
      ),
  },
  experts: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListExperts,
        listExpertsRequestSchema.parse(input ?? {}),
        z.array(expertSummarySchema),
      ),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetExpert,
        getExpertRequestSchema.parse(input),
        expertDetailSchema.nullable(),
      ),
    create: (input) =>
      invokeValidated(
        IpcChannel.CreateExpert,
        expertRevisionDraftSchema.parse(input),
        expertMutationResultSchema,
      ),
    saveRevision: (input) =>
      invokeValidated(
        IpcChannel.SaveExpertRevision,
        saveExpertRevisionRequestSchema.parse(input),
        expertMutationResultSchema,
      ),
    copy: (input) =>
      invokeValidated(
        IpcChannel.CopyExpert,
        copyExpertRequestSchema.parse(input),
        expertMutationResultSchema,
      ),
    setLifecycle: (input) =>
      invokeValidated(
        IpcChannel.SetExpertLifecycle,
        setExpertLifecycleRequestSchema.parse(input),
        expertMutationResultSchema,
      ),
    delete: (input) =>
      invokeValidated(
        IpcChannel.DeleteExpert,
        deleteExpertRequestSchema.parse(input),
        deletedResultSchema,
      ),
  },
  taskContexts: {
    get: (input) =>
      invokeValidated(
        IpcChannel.GetTaskContext,
        getTaskContextRequestSchema.parse(input),
        taskContextRevisionSchema.nullable(),
      ),
    save: (input) =>
      invokeValidated(
        IpcChannel.SaveTaskContext,
        saveTaskContextRequestSchema.parse(input),
        taskContextMutationResultSchema,
      ),
  },
  taskContinuity: {
    getBrief: (input) =>
      invokeValidated(
        IpcChannel.GetTaskContinuityBrief,
        getTaskContinuityBriefRequestSchema.parse(input),
        taskContinuityRevisionSchema.nullable(),
      ),
    saveBrief: (input) =>
      invokeValidated(
        IpcChannel.SaveTaskContinuityBrief,
        saveTaskContinuityBriefRequestSchema.parse(input),
        taskContinuityBriefMutationResultSchema,
      ),
  },
  discussionCheckpoints: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListDiscussionCheckpoints,
        listDiscussionCheckpointsRequestSchema.parse(input),
        discussionCheckpointSchema.array(),
      ),
    create: (input) =>
      invokeValidated(
        IpcChannel.CreateDiscussionCheckpoint,
        createDiscussionCheckpointRequestSchema.parse(input),
        discussionCheckpointMutationResultSchema,
      ),
  },
  materials: {
    listCandidates: (input) =>
      invokeValidated(
        IpcChannel.ListTaskMaterialCandidates,
        listTaskMaterialCandidatesRequestSchema.parse(input),
        materialCandidateSchema.array(),
      ),
    prepareInputSnapshot: (input) =>
      invokeValidated(
        IpcChannel.PrepareWorkspaceInputSnapshot,
        prepareWorkspaceInputSnapshotRequestSchema.parse(input),
        inputSnapshotSchema.nullable(),
      ),
  },
  memories: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListMemories,
        listMemoriesRequestSchema.parse(input ?? {}),
        resultSchema(memoryListPageDataSchema),
      ),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetMemory,
        getMemoryRequestSchema.parse(input),
        resultSchema(memoryViewItemSchema),
      ),
    create: (input) =>
      invokeValidated(
        IpcChannel.CreateMemory,
        createMemoryRequestSchema.parse(input),
        resultSchema(memoryWriteReceiptSchema),
      ),
    update: (input) =>
      invokeValidated(
        IpcChannel.UpdateMemory,
        updateMemoryRequestSchema.parse(input),
        resultSchema(memoryWriteReceiptSchema),
      ),
    setStatus: (input) =>
      invokeValidated(
        IpcChannel.SetMemoryStatus,
        setMemoryStatusRequestSchema.parse(input),
        resultSchema(memoryWriteReceiptSchema),
      ),
    resolveConflict: (input) =>
      invokeValidated(
        IpcChannel.ResolveMemoryConflict,
        resolveMemoryConflictRequestSchema.parse(input),
        resultSchema(memoryConflictResolutionDataSchema),
      ),
    preview: (input) =>
      invokeValidated(
        IpcChannel.PreviewMemory,
        previewMemoryRequestSchema.parse(input),
        resultSchema(memoryPreviewDataSchema),
      ),
    taskExclusions: (input) =>
      invokeValidated(
        IpcChannel.TaskMemoryExclusions,
        taskMemoryExclusionsRequestSchema.parse(input),
        resultSchema(taskMemoryExclusionsDataSchema),
      ),
    runContext: (input) =>
      invokeValidated(
        IpcChannel.GetRunMemoryContext,
        getRunMemoryContextRequestSchema.parse(input),
        resultSchema(memoryRunContextDataSchema),
      ),
    getSettings: (input) =>
      invokeValidated(
        IpcChannel.GetMemorySettings,
        getMemorySettingsRequestSchema.parse(input),
        resultSchema(workspaceMemorySettingsSchema),
      ),
    setSettings: (input) =>
      invokeValidated(
        IpcChannel.SetMemorySettings,
        setMemorySettingsRequestSchema.parse(input),
        resultSchema(memorySettingsDataSchema),
      ),
    listJobs: (input) =>
      invokeValidated(
        IpcChannel.ListMemoryJobs,
        listMemoryJobsRequestSchema.parse(input ?? {}),
        resultSchema(memoryJobListDataSchema),
      ),
    retryJob: (input) =>
      invokeValidated(
        IpcChannel.RetryMemoryJob,
        retryMemoryJobRequestSchema.parse(input),
        resultSchema(memoryJobSummarySchema),
      ),
    cancelJob: (input) =>
      invokeValidated(
        IpcChannel.CancelMemoryJob,
        cancelMemoryJobRequestSchema.parse(input),
        resultSchema(memoryJobSummarySchema),
      ),
    rebuildProjection: (input) =>
      invokeValidated(
        IpcChannel.RebuildMemoryProjection,
        rebuildMemoryProjectionRequestSchema.parse(input),
        resultSchema(memoryProjectionStateDataSchema),
      ),
  },
  mcp: {
    listConnections: () =>
      invokeValidated(IpcChannel.ListMcpConnections, {}, mcpConnectionSummarySchema.array()),
    getConnection: (input) =>
      invokeValidated(
        IpcChannel.GetMcpConnection,
        getMcpConnectionRequestSchema.parse(input),
        mcpConnectionSummarySchema.nullable(),
      ),
    saveConnection: (input) =>
      invokeValidated(
        IpcChannel.SaveMcpConnection,
        saveMcpConnectionRequestSchema.parse(input),
        mcpMutationResultSchema,
      ),
    deleteConnection: (input) =>
      invokeValidated(
        IpcChannel.DeleteMcpConnection,
        deleteMcpConnectionRequestSchema.parse(input),
        deletedResultSchema,
      ),
    testConnection: (input) =>
      invokeValidated(
        IpcChannel.TestMcpConnection,
        getMcpConnectionRequestSchema.parse(input),
        mcpTestResultSchema,
      ),
  },
  dependencies: {
    listOptions: () =>
      invokeValidated(
        IpcChannel.ListDependencyOptions,
        listDependencyOptionsRequestSchema.parse({}),
        dependencyOptionsSchema,
      ),
    inspectPlan: (input) =>
      invokeValidated(
        IpcChannel.InspectDependencyPlan,
        dependencyPlanRequestSchema.parse(input),
        dependencyPlanSchema,
      ),
    verifyEnvironment: (input) =>
      invokeValidated(
        IpcChannel.VerifyDependencyEnvironment,
        verifyDependencyEnvironmentRequestSchema.parse(input),
        runtimeEnvironmentSchema,
      ),
    prepare: (input) =>
      invokeValidated(
        IpcChannel.PrepareDependencyEnvironment,
        prepareDependencyRequestSchema.parse(input),
        prepareDependencyResultSchema,
      ),
    cancel: (input) =>
      invokeValidated(
        IpcChannel.CancelDependencyPreparation,
        cancelDependencyRequestSchema.parse(input),
        cancelDependencyResultSchema,
      ),
    getOperation: (input) =>
      invokeValidated(
        IpcChannel.GetDependencyOperation,
        getDependencyOperationRequestSchema.parse(input),
        dependencyOperationSchema.nullable(),
      ),
    chooseInterpreter: () =>
      invokeValidated(IpcChannel.ChoosePythonInterpreter, {}, chooseInterpreterResultSchema),
    registerToolchain: (input) =>
      invokeValidated(
        IpcChannel.RegisterToolchainSnapshot,
        registerToolchainRequestSchema.parse(input),
        registerToolchainResultSchema,
      ),
    deleteToolchainSnapshot: (input) =>
      invokeValidated(
        IpcChannel.DeleteToolchainSnapshot,
        deleteToolchainSnapshotRequestSchema.parse(input),
        deleteToolchainSnapshotResultSchema,
      ),
  },
};

contextBridge.exposeInMainWorld('betterwork', api);
