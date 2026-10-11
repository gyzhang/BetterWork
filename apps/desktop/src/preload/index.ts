import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
  BetterWorkDesktopApi,
  EvidenceSummary,
  ExportFileArtifactResult,
  ExportMarkdownArtifactResult,
  FileArtifactDetail,
  OpenFileArtifactResult,
} from '@betterwork/agent-protocol';
import {
  agentRuntimeEventSchema,
  applyScheduleExpertRevisionRequestSchema,
  artifactDetailSchema,
  artifactSummarySchema,
  artifactVersionDetailSchema,
  artifactVersionExecutorSummarySchema,
  artifactVersionSummarySchema,
  cancelDependencyRequestSchema,
  cancelDependencyResultSchema,
  cancelledResultSchema,
  cancelMemoryJobRequestSchema,
  cancelRunRequestSchema,
  cancelScheduleOccurrenceRequestSchema,
  checkKnowledgeSourcesRequestSchema,
  chooseInterpreterResultSchema,
  clearedResultSchema,
  clearNotificationsRequestSchema,
  connectionTestResultSchema,
  copyExpertRequestSchema,
  copySkillRequestSchema,
  createDiscussionCheckpointRequestSchema,
  createdTaskSchema,
  createMemoryRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  declareArtifactSourcesRequestSchema,
  deletedResultSchema,
  deleteExpertRequestSchema,
  deleteKnowledgeCollectionRequestSchema,
  deleteMcpConnectionRequestSchema,
  deleteNotificationRequestSchema,
  deleteSkillRequestSchema,
  deleteToolchainSnapshotRequestSchema,
  deleteToolchainSnapshotResultSchema,
  dependencyOperationSchema,
  dependencyOptionsSchema,
  dependencyPlanRequestSchema,
  dependencyPlanSchema,
  discussionCheckpointMutationResultSchema,
  discussionCheckpointSchema,
  evidenceSummarySchema,
  executeMissedScheduleRequestSchema,
  executeScheduleNowRequestSchema,
  expertDetailSchema,
  expertMutationResultSchema,
  expertRevisionDraftSchema,
  expertSummarySchema,
  exportFileArtifactRequestSchema,
  exportFileArtifactResultSchema,
  exportMarkdownArtifactRequestSchema,
  exportMarkdownArtifactResultSchema,
  exportSkillRequestSchema,
  fileArtifactDetailSchema,
  getArtifactRequestSchema,
  getArtifactThumbnailsRequestSchema,
  getArtifactThumbnailsResultSchema,
  getArtifactVersionExecutorRequestSchema,
  getArtifactVersionRequestSchema,
  getDependencyOperationRequestSchema,
  getExpertRequestSchema,
  getFileArtifactRequestSchema,
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
  listArtifactsRequestSchema,
  listArtifactVersionsRequestSchema,
  listDependencyOptionsRequestSchema,
  listDiscussionCheckpointsRequestSchema,
  listEvidenceRequestSchema,
  listExpertsRequestSchema,
  listKnowledgeJobsRequestSchema,
  listKnowledgeRequestSchema,
  listKnowledgeRevisionsRequestSchema,
  listMemoriesRequestSchema,
  listMemoryJobsRequestSchema,
  listRunEventsRequestSchema,
  listRunsRequestSchema,
  listScheduleOccurrencesRequestSchema,
  listScheduleSourceItemsRequestSchema,
  listSchedulesRequestSchema,
  listTaskMaterialCandidatesRequestSchema,
  listTasksRequestSchema,
  listWorkspaceReferenceVersionsRequestSchema,
  markAllNotificationsReadRequestSchema,
  markNotificationReadRequestSchema,
  materialCandidateSchema,
  mcpConnectionSummarySchema,
  mcpLifecycleRequestSchema,
  mcpLoginContinueRequestSchema,
  mcpMutationResultSchema,
  mcpOAuthPreparationSchema,
  mcpOperationRequestSchema,
  mcpReviewRequestSchema,
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
  modelProfileIdSchema,
  modelProfileSummarySchema,
  modelSaveResultSchema,
  notificationActivatedSchema,
  notificationChangeEventSchema,
  notificationRendererReadyRequestSchema,
  notificationRendererReadyResultSchema,
  notificationSummarySchema,
  openFileArtifactRequestSchema,
  openFileArtifactResultSchema,
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
  registerFileArtifactRequestSchema,
  registerFileArtifactResultSchema,
  registerToolchainRequestSchema,
  registerToolchainResultSchema,
  removeWorkspaceReferenceVersionRequestSchema,
  resolveMemoryConflictRequestSchema,
  resultSchema,
  retryKnowledgeJobRequestSchema,
  retryMemoryJobRequestSchema,
  retryScheduleOutputRequestSchema,
  revealFileArtifactResultSchema,
  revokeSkillTrustRequestSchema,
  runArtifactSourceDeclarationSchema,
  runSettingsSchema,
  runSourcePreviewSchema,
  runSummarySchema,
  runtimeEnvironmentSchema,
  saveExpertRevisionRequestSchema,
  saveKnowledgeCollectionRequestSchema,
  saveKnowledgeSettingsRequestSchema,
  saveMarkdownArtifactRequestSchema,
  saveMcpConnectionRequestSchema,
  saveModelProfileRequestSchema,
  saveRunSettingsRequestSchema,
  saveScheduleRequestSchema,
  saveSearchEngineRequestSchema,
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
  searchEngineSaveResultSchema,
  searchEngineSummarySchema,
  setDefaultModelRequestSchema,
  setExpertLifecycleRequestSchema,
  setKnowledgeCollectionMembersRequestSchema,
  setMemorySettingsRequestSchema,
  setMemoryStatusRequestSchema,
  setModelEnabledRequestSchema,
  setScheduleLifecycleRequestSchema,
  setSkillEnabledRequestSchema,
  setSkillTrustRequestSchema,
  setWorkspaceHiddenRequestSchema,
  setWorkspaceReferenceVersionRequestSchema,
  skillDetailSchema,
  skillExportResultSchema,
  skillImportResultSchema,
  skillMutationResultSchema,
  skillSummarySchema,
  startRunRequestSchema,
  startRunResultSchema,
  taskContextMutationResultSchema,
  taskContextRevisionSchema,
  taskContinuityBriefMutationResultSchema,
  taskContinuityRevisionSchema,
  taskMemoryExclusionsDataSchema,
  taskMemoryExclusionsRequestSchema,
  testModelRequestSchema,
  testSearchEngineRequestSchema,
  testSkillRunRequestSchema,
  testSkillRunResultSchema,
  unreadCountResultSchema,
  updatedResultSchema,
  updateMemoryRequestSchema,
  updateWorkspaceIdentityRequestSchema,
  verifyDependencyEnvironmentRequestSchema,
  workspaceBriefSchema,
  workspaceDirectorySelectionSchema,
  workspaceMemoryBriefRequestSchema,
  workspaceMemorySettingsSchema,
  workspaceReferenceListDataSchema,
  workspaceReferenceSetDataSchema,
  workspaceSummarySchema,
  workspaceTaskGroupsSchema,
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

const evidenceListResponseSchema = evidenceSummarySchema
  .array()
  .transform((summaries) => summaries.map(normalizeEvidenceSummary));

function normalizeEvidenceSummary(
  summary: z.output<typeof evidenceSummarySchema>,
): EvidenceSummary {
  const { knowledgeSource, ...evidence } = summary;
  return { ...evidence, ...(knowledgeSource === undefined ? {} : { knowledgeSource }) };
}

function normalizeArtifactSummary(
  summary: z.output<typeof artifactSummarySchema>,
): ArtifactSummary {
  if (summary.type === 'markdown') {
    const { sourceDeclarationKind, sourceRunId, ...fields } = summary;
    return {
      ...fields,
      ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
      ...(sourceRunId === undefined ? {} : { sourceRunId }),
    };
  }
  const { sourceDeclarationKind, sourceRunId, ...fields } = summary;
  return {
    ...fields,
    ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
  };
}

function normalizeArtifactDetail(detail: z.output<typeof artifactDetailSchema>): ArtifactDetail {
  if (detail.type === 'markdown') {
    const { sourceDeclarationKind, sourceRunId, evidence, inputRelations, ...fields } = detail;
    return {
      ...fields,
      ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
      ...(sourceRunId === undefined ? {} : { sourceRunId }),
      evidence: evidence.map(normalizeEvidenceSummary),
      ...(inputRelations === undefined ? {} : { inputRelations }),
    };
  }
  const { sourceDeclarationKind, sourceRunId, description, evidence, inputRelations, ...fields } =
    detail;
  return {
    ...fields,
    ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
    ...(description === undefined ? {} : { description }),
    evidence: evidence.map(normalizeEvidenceSummary),
    ...(inputRelations === undefined ? {} : { inputRelations }),
  };
}

function normalizeFileArtifactDetail(
  detail: z.output<typeof fileArtifactDetailSchema>,
): FileArtifactDetail {
  const { sourceDeclarationKind, sourceRunId, description, evidence, inputRelations, ...fields } =
    detail;
  return {
    ...fields,
    ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
    ...(description === undefined ? {} : { description }),
    evidence: evidence.map(normalizeEvidenceSummary),
    ...(inputRelations === undefined ? {} : { inputRelations }),
  };
}

function normalizeArtifactVersionSummary(
  summary: z.output<typeof artifactVersionSummarySchema>,
): ArtifactVersionSummary {
  const { sourceDeclarationKind, sourceRunId, ...fields } = summary;
  return {
    ...fields,
    ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
  };
}

function normalizeArtifactVersionDetail(
  detail: z.output<typeof artifactVersionDetailSchema>,
): ArtifactVersionDetail {
  if (detail.type === 'markdown') {
    const { sourceDeclarationKind, sourceRunId, evidence, inputRelations, ...fields } = detail;
    return {
      ...fields,
      ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
      ...(sourceRunId === undefined ? {} : { sourceRunId }),
      evidence: evidence.map(normalizeEvidenceSummary),
      ...(inputRelations === undefined ? {} : { inputRelations }),
    };
  }
  const { sourceDeclarationKind, sourceRunId, description, evidence, inputRelations, ...fields } =
    detail;
  return {
    ...fields,
    ...(sourceDeclarationKind === undefined ? {} : { sourceDeclarationKind }),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
    ...(description === undefined ? {} : { description }),
    evidence: evidence.map(normalizeEvidenceSummary),
    ...(inputRelations === undefined ? {} : { inputRelations }),
  };
}

const artifactSummaryListResponseSchema = artifactSummarySchema
  .array()
  .transform((summaries) => summaries.map(normalizeArtifactSummary));
const artifactSummaryResponseSchema = artifactSummarySchema.transform(normalizeArtifactSummary);
const artifactDetailResponseSchema = artifactDetailSchema
  .nullable()
  .transform((detail) => (detail === null ? null : normalizeArtifactDetail(detail)));
const artifactVersionSummaryListResponseSchema = artifactVersionSummarySchema
  .array()
  .transform((versions) => versions.map(normalizeArtifactVersionSummary));
const artifactVersionDetailResponseSchema = artifactVersionDetailSchema
  .nullable()
  .transform((detail) => (detail === null ? null : normalizeArtifactVersionDetail(detail)));
const fileArtifactDetailResponseSchema = fileArtifactDetailSchema
  .nullable()
  .transform((detail) => (detail === null ? null : normalizeFileArtifactDetail(detail)));
const exportMarkdownArtifactResponseSchema = exportMarkdownArtifactResultSchema.transform(
  ({ cancelled, filePath }): ExportMarkdownArtifactResult => ({
    cancelled,
    ...(filePath === undefined ? {} : { filePath }),
  }),
);
const exportFileArtifactResponseSchema = exportFileArtifactResultSchema.transform(
  ({ cancelled, filePath }): ExportFileArtifactResult => ({
    cancelled,
    ...(filePath === undefined ? {} : { filePath }),
  }),
);
const openFileArtifactResponseSchema = openFileArtifactResultSchema.transform(
  ({ opened, error }): OpenFileArtifactResult => ({
    opened,
    ...(error === undefined ? {} : { error }),
  }),
);

const modelProfileListResponseSchema = modelProfileSummarySchema.array().transform((profiles) =>
  profiles.map(({ lastTestedAt, ...profile }) => ({
    ...profile,
    ...(lastTestedAt === undefined ? {} : { lastTestedAt }),
  })),
);

const searchEngineListResponseSchema = searchEngineSummarySchema.array().transform((engines) =>
  engines.map(({ lastTestedAt, ...engine }) => ({
    ...engine,
    ...(lastTestedAt === undefined ? {} : { lastTestedAt }),
  })),
);

const api: BetterWorkDesktopApi = {
  runs: {
    start: (input) =>
      invokeValidated(
        IpcChannel.StartRun,
        startRunRequestSchema.parse(input),
        startRunResultSchema,
      ),
    cancel: (input) =>
      invokeValidated(
        IpcChannel.CancelRun,
        cancelRunRequestSchema.parse(input),
        cancelledResultSchema,
      ),
    list: (input) =>
      invokeValidated(
        IpcChannel.ListRuns,
        input === undefined ? undefined : listRunsRequestSchema.parse(input),
        runSummarySchema.array(),
      ),
    listEvents: (input) =>
      invokeValidated(
        IpcChannel.ListRunEvents,
        listRunEventsRequestSchema.parse(input),
        agentRuntimeEventSchema.array(),
      ),
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
    getDefault: () => invokeValidated(IpcChannel.GetDefaultWorkspace, {}, workspaceSummarySchema),
    pickDirectory: () =>
      invokeValidated(IpcChannel.PickWorkspaceDirectory, {}, workspaceDirectorySelectionSchema),
    listAll: () => invokeValidated(IpcChannel.ListWorkspaces, {}, workspaceSummarySchema.array()),
    create: (input) =>
      invokeValidated(
        IpcChannel.CreateWorkspace,
        createWorkspaceRequestSchema.parse(input),
        workspaceSummarySchema,
      ),
    updateIdentity: (input) =>
      invokeValidated(
        IpcChannel.UpdateWorkspaceIdentity,
        updateWorkspaceIdentityRequestSchema.parse(input),
        workspaceSummarySchema,
      ),
    setHidden: (input) =>
      invokeValidated(
        IpcChannel.SetWorkspaceHidden,
        setWorkspaceHiddenRequestSchema.parse(input),
        workspaceSummarySchema,
      ),
    listTaskGroups: () =>
      invokeValidated(IpcChannel.ListWorkspaceTaskGroups, {}, workspaceTaskGroupsSchema),
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
    create: (input) =>
      invokeValidated(
        IpcChannel.CreateTask,
        createTaskRequestSchema.parse(input),
        createdTaskSchema,
      ),
    list: (input) =>
      invokeValidated(
        IpcChannel.ListTasks,
        input === undefined ? undefined : listTasksRequestSchema.parse(input),
        recentTaskSummarySchema.array(),
      ),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetTask,
        getTaskRequestSchema.parse(input),
        recentTaskSummarySchema.nullable(),
      ),
  },
  evidence: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListEvidence,
        listEvidenceRequestSchema.parse(input),
        evidenceListResponseSchema,
      ),
  },
  artifacts: {
    list: (input) =>
      invokeValidated(
        IpcChannel.ListArtifacts,
        input === undefined ? undefined : listArtifactsRequestSchema.parse(input),
        artifactSummaryListResponseSchema,
      ),
    get: (input) =>
      invokeValidated(
        IpcChannel.GetArtifact,
        getArtifactRequestSchema.parse(input),
        artifactDetailResponseSchema,
      ),
    listVersions: (input) =>
      invokeValidated(
        IpcChannel.ListArtifactVersions,
        listArtifactVersionsRequestSchema.parse(input),
        artifactVersionSummaryListResponseSchema,
      ),
    getVersionExecutor: (input) =>
      invokeValidated(
        IpcChannel.GetArtifactVersionExecutor,
        getArtifactVersionExecutorRequestSchema.parse(input),
        artifactVersionExecutorSummarySchema.nullable(),
      ),
    getVersion: (input) =>
      invokeValidated(
        IpcChannel.GetArtifactVersion,
        getArtifactVersionRequestSchema.parse(input),
        artifactVersionDetailResponseSchema,
      ),
    saveMarkdown: (input) =>
      invokeValidated(
        IpcChannel.SaveMarkdownArtifact,
        saveMarkdownArtifactRequestSchema.parse(input),
        artifactSummaryResponseSchema,
      ),
    exportMarkdown: (input) =>
      invokeValidated(
        IpcChannel.ExportMarkdownArtifact,
        exportMarkdownArtifactRequestSchema.parse(input),
        exportMarkdownArtifactResponseSchema,
      ),
    registerFile: (input) =>
      invokeValidated(
        IpcChannel.RegisterFileArtifact,
        registerFileArtifactRequestSchema.parse(input),
        registerFileArtifactResultSchema,
      ),
    getFileDetail: (input) =>
      invokeValidated(
        IpcChannel.GetFileArtifact,
        getFileArtifactRequestSchema.parse(input),
        fileArtifactDetailResponseSchema,
      ),
    exportFile: (input) =>
      invokeValidated(
        IpcChannel.ExportFileArtifact,
        exportFileArtifactRequestSchema.parse(input),
        exportFileArtifactResponseSchema,
      ),
    openFile: (input) =>
      invokeValidated(
        IpcChannel.OpenFileArtifact,
        openFileArtifactRequestSchema.parse(input),
        openFileArtifactResponseSchema,
      ),
    revealFile: (input) =>
      invokeValidated(
        IpcChannel.RevealFileArtifact,
        openFileArtifactRequestSchema.parse(input),
        revealFileArtifactResultSchema,
      ),
    getThumbnails: (input) =>
      invokeValidated(
        IpcChannel.GetArtifactThumbnails,
        getArtifactThumbnailsRequestSchema.parse(input),
        getArtifactThumbnailsResultSchema,
      ),
  },
  models: {
    list: () => invokeValidated(IpcChannel.ListModels, {}, modelProfileListResponseSchema),
    save: (input) =>
      invokeValidated(
        IpcChannel.SaveModel,
        saveModelProfileRequestSchema.parse(input),
        modelSaveResultSchema,
      ),
    delete: (input) =>
      invokeValidated(
        IpcChannel.DeleteModel,
        modelProfileIdSchema.parse(input),
        deletedResultSchema,
      ),
    setDefault: (input) =>
      invokeValidated(
        IpcChannel.SetDefaultModel,
        setDefaultModelRequestSchema.parse(input),
        updatedResultSchema,
      ),
    setEnabled: (input) =>
      invokeValidated(
        IpcChannel.SetModelEnabled,
        setModelEnabledRequestSchema.parse(input),
        updatedResultSchema,
      ),
    test: (input) =>
      invokeValidated(
        IpcChannel.TestModel,
        testModelRequestSchema.parse(input),
        connectionTestResultSchema,
      ),
  },
  searchEngines: {
    list: () => invokeValidated(IpcChannel.ListSearchEngines, {}, searchEngineListResponseSchema),
    save: (input) =>
      invokeValidated(
        IpcChannel.SaveSearchEngine,
        saveSearchEngineRequestSchema.parse(input),
        searchEngineSaveResultSchema,
      ),
    test: (input) =>
      invokeValidated(
        IpcChannel.TestSearchEngine,
        testSearchEngineRequestSchema.parse(input),
        connectionTestResultSchema,
      ),
  },
  notifications: {
    list: () =>
      invokeValidated(IpcChannel.ListNotifications, {}, notificationSummarySchema.array()),
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
    markRead: (input) =>
      invokeValidated(
        IpcChannel.MarkNotificationRead,
        markNotificationReadRequestSchema.parse(input),
        unreadCountResultSchema,
      ),
    markAllRead: () =>
      invokeValidated(
        IpcChannel.MarkAllNotificationsRead,
        markAllNotificationsReadRequestSchema.parse({}),
        unreadCountResultSchema,
      ),
    delete: (input) =>
      invokeValidated(
        IpcChannel.DeleteNotification,
        deleteNotificationRequestSchema.parse(input),
        deletedResultSchema,
      ),
    clear: () =>
      invokeValidated(
        IpcChannel.ClearNotifications,
        clearNotificationsRequestSchema.parse({}),
        clearedResultSchema,
      ),
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
        mcpOperationRequestSchema.parse(input),
        mcpTestResultSchema,
      ),
    setLifecycle: (input) =>
      invokeValidated(
        IpcChannel.SetMcpLifecycle,
        mcpLifecycleRequestSchema.parse(input),
        mcpMutationResultSchema,
      ),
    reviewTool: (input) =>
      invokeValidated(
        IpcChannel.ReviewMcpTool,
        mcpReviewRequestSchema.parse(input),
        mcpMutationResultSchema,
      ),
    cancelOperation: (input) =>
      invokeValidated(
        IpcChannel.CancelMcpOperation,
        mcpOperationRequestSchema.parse(input),
        z.object({ cancelled: z.boolean() }),
      ),
    prepareLogin: (input) =>
      invokeValidated(
        IpcChannel.PrepareMcpLogin,
        mcpOperationRequestSchema.parse(input),
        mcpOAuthPreparationSchema,
      ),
    continueLogin: (input) =>
      invokeValidated(
        IpcChannel.ContinueMcpLogin,
        mcpLoginContinueRequestSchema.parse(input),
        mcpTestResultSchema,
      ),
    logout: (input) =>
      invokeValidated(
        IpcChannel.LogoutMcpConnection,
        mcpOperationRequestSchema.parse(input),
        mcpMutationResultSchema,
      ),
  },
  dependencies: {
    listOptions: (input) =>
      invokeValidated(
        IpcChannel.ListDependencyOptions,
        listDependencyOptionsRequestSchema.parse(input ?? {}),
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
