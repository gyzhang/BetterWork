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
  OpenKnowledgeSourceResult,
  RunDiagnosticsChangedEvent,
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
  clearKnowledgeJobsRequestSchema,
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
  getRunDiagnosticNodeDetailRequestSchema,
  getRunDiagnosticsSummaryRequestSchema,
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
  knowledgeSearchResponseSchema,
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
  listRunDiagnosticsHistoryRequestSchema,
  listRunDiagnosticsPageRequestSchema,
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
  maximizedResultSchema,
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
  openKnowledgeSourceRequestSchema,
  openKnowledgeSourceResultSchema,
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
  removedResultSchema,
  removeKnowledgeDocumentRequestSchema,
  removeWorkspaceReferenceVersionRequestSchema,
  resolveMemoryConflictRequestSchema,
  resultSchema,
  retryKnowledgeJobRequestSchema,
  retryMemoryJobRequestSchema,
  retryScheduleOutputRequestSchema,
  revealFileArtifactResultSchema,
  revokeSkillTrustRequestSchema,
  runArtifactSourceDeclarationSchema,
  runDiagnosticNodeDetailResponseSchema,
  runDiagnosticsChangedEventSchema,
  runDiagnosticsHistoryPageResponseSchema,
  runDiagnosticsPageResponseSchema,
  runDiagnosticsSourcesResponseSchema,
  runDiagnosticsSummaryResponseSchema,
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
  searchKnowledgeRequestSchema,
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
  updateWindowThemeRequestSchema,
  updateWorkspaceIdentityRequestSchema,
  verifyDependencyEnvironmentRequestSchema,
  voidResultSchema,
  windowToggleMaximizeRequestSchema,
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

const runListRequestSchema = listRunsRequestSchema.optional();
const emptyInvokeRequestSchema = z.object({}).strict();
const runSettingsRequestSchema = emptyInvokeRequestSchema;
const runListResponseSchema = runSummarySchema.array();
const runEventsResponseSchema = agentRuntimeEventSchema.array();
const workspaceListResponseSchema = workspaceSummarySchema.array();
const workspaceMemoryBriefResponseSchema = resultSchema(workspaceBriefSchema);
const workspaceReferenceListResponseSchema = resultSchema(workspaceReferenceListDataSchema);
const workspaceReferenceSetResponseSchema = resultSchema(workspaceReferenceSetDataSchema);
const workspaceReferenceRemoveResponseSchema = resultSchema(memoryReferenceWriteReceiptSchema);
const taskListRequestSchema = listTasksRequestSchema.optional();
const taskListResponseSchema = recentTaskSummarySchema.array();
const taskDetailResponseSchema = recentTaskSummarySchema.nullable();

interface IpcInvokeContract {
  channel: string;
  request: ZodTypeAny;
  response: ZodTypeAny;
}

function defineInvokeContracts<const Contracts extends Record<string, IpcInvokeContract>>(
  contracts: Contracts & { [Channel in keyof Contracts]: { channel: Channel } },
): Contracts {
  return contracts;
}

type InvokeMethodsByChannel<Contracts extends Record<string, IpcInvokeContract>> = {
  [Channel in keyof Contracts]: (
    input: z.input<Contracts[Channel]['request']>,
  ) => Promise<z.output<Contracts[Channel]['response']>>;
};

function invokeContract<Request extends ZodTypeAny, Response extends ZodTypeAny>(
  contract: { channel: string; request: Request; response: Response },
  input: z.input<Request>,
): Promise<z.output<Response>> {
  return ipcRenderer
    .invoke(contract.channel, contract.request.parse(input))
    .then((raw: unknown) => contract.response.parse(raw));
}

interface IpcEventContract {
  channel: string;
  event: ZodTypeAny;
}

function defineEventContracts<const Contracts extends Record<string, IpcEventContract>>(
  contracts: Contracts & { [Channel in keyof Contracts]: { channel: Channel } },
): Contracts {
  return contracts;
}

type EventMethodsByChannel<Contracts extends Record<string, IpcEventContract>> = {
  [Channel in keyof Contracts]: (
    listener: (event: z.output<Contracts[Channel]['event']>) => void,
  ) => () => void;
};

function listenContract<Event extends ZodTypeAny>(
  contract: { channel: string; event: Event },
  listener: (event: z.output<Event>) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
    listener(contract.event.parse(raw));
  };
  ipcRenderer.on(contract.channel, handler);
  return () => ipcRenderer.off(contract.channel, handler);
}

const runInvokeContracts = defineInvokeContracts({
  [IpcChannel.StartRun]: {
    channel: IpcChannel.StartRun,
    request: startRunRequestSchema,
    response: startRunResultSchema,
  },
  [IpcChannel.CancelRun]: {
    channel: IpcChannel.CancelRun,
    request: cancelRunRequestSchema,
    response: cancelledResultSchema,
  },
  [IpcChannel.ListRuns]: {
    channel: IpcChannel.ListRuns,
    request: runListRequestSchema,
    response: runListResponseSchema,
  },
  [IpcChannel.ListRunEvents]: {
    channel: IpcChannel.ListRunEvents,
    request: listRunEventsRequestSchema,
    response: runEventsResponseSchema,
  },
  [IpcChannel.GetRunDiagnosticsSummary]: {
    channel: IpcChannel.GetRunDiagnosticsSummary,
    request: getRunDiagnosticsSummaryRequestSchema,
    response: runDiagnosticsSummaryResponseSchema,
  },
  [IpcChannel.GetRunDiagnosticsSources]: {
    channel: IpcChannel.GetRunDiagnosticsSources,
    request: getRunDiagnosticsSummaryRequestSchema,
    response: runDiagnosticsSourcesResponseSchema,
  },
  [IpcChannel.ListRunDiagnosticsPage]: {
    channel: IpcChannel.ListRunDiagnosticsPage,
    request: listRunDiagnosticsPageRequestSchema,
    response: runDiagnosticsPageResponseSchema,
  },
  [IpcChannel.ListRunDiagnosticsHistory]: {
    channel: IpcChannel.ListRunDiagnosticsHistory,
    request: listRunDiagnosticsHistoryRequestSchema,
    response: runDiagnosticsHistoryPageResponseSchema,
  },
  [IpcChannel.GetRunDiagnosticNodeDetail]: {
    channel: IpcChannel.GetRunDiagnosticNodeDetail,
    request: getRunDiagnosticNodeDetailRequestSchema,
    response: runDiagnosticNodeDetailResponseSchema,
  },
  [IpcChannel.GetRunSettings]: {
    channel: IpcChannel.GetRunSettings,
    request: runSettingsRequestSchema,
    response: runSettingsSchema,
  },
  [IpcChannel.SaveRunSettings]: {
    channel: IpcChannel.SaveRunSettings,
    request: saveRunSettingsRequestSchema,
    response: runSettingsSchema,
  },
});

const workspaceTaskInvokeContracts = defineInvokeContracts({
  [IpcChannel.GetDefaultWorkspace]: {
    channel: IpcChannel.GetDefaultWorkspace,
    request: emptyInvokeRequestSchema,
    response: workspaceSummarySchema,
  },
  [IpcChannel.PickWorkspaceDirectory]: {
    channel: IpcChannel.PickWorkspaceDirectory,
    request: emptyInvokeRequestSchema,
    response: workspaceDirectorySelectionSchema,
  },
  [IpcChannel.ListWorkspaces]: {
    channel: IpcChannel.ListWorkspaces,
    request: emptyInvokeRequestSchema,
    response: workspaceListResponseSchema,
  },
  [IpcChannel.CreateWorkspace]: {
    channel: IpcChannel.CreateWorkspace,
    request: createWorkspaceRequestSchema,
    response: workspaceSummarySchema,
  },
  [IpcChannel.UpdateWorkspaceIdentity]: {
    channel: IpcChannel.UpdateWorkspaceIdentity,
    request: updateWorkspaceIdentityRequestSchema,
    response: workspaceSummarySchema,
  },
  [IpcChannel.SetWorkspaceHidden]: {
    channel: IpcChannel.SetWorkspaceHidden,
    request: setWorkspaceHiddenRequestSchema,
    response: workspaceSummarySchema,
  },
  [IpcChannel.ListWorkspaceTaskGroups]: {
    channel: IpcChannel.ListWorkspaceTaskGroups,
    request: emptyInvokeRequestSchema,
    response: workspaceTaskGroupsSchema,
  },
  [IpcChannel.GetWorkspaceMemoryBrief]: {
    channel: IpcChannel.GetWorkspaceMemoryBrief,
    request: workspaceMemoryBriefRequestSchema,
    response: workspaceMemoryBriefResponseSchema,
  },
  [IpcChannel.ListWorkspaceReferenceVersions]: {
    channel: IpcChannel.ListWorkspaceReferenceVersions,
    request: listWorkspaceReferenceVersionsRequestSchema,
    response: workspaceReferenceListResponseSchema,
  },
  [IpcChannel.SetWorkspaceReferenceVersion]: {
    channel: IpcChannel.SetWorkspaceReferenceVersion,
    request: setWorkspaceReferenceVersionRequestSchema,
    response: workspaceReferenceSetResponseSchema,
  },
  [IpcChannel.RemoveWorkspaceReferenceVersion]: {
    channel: IpcChannel.RemoveWorkspaceReferenceVersion,
    request: removeWorkspaceReferenceVersionRequestSchema,
    response: workspaceReferenceRemoveResponseSchema,
  },
  [IpcChannel.CreateTask]: {
    channel: IpcChannel.CreateTask,
    request: createTaskRequestSchema,
    response: createdTaskSchema,
  },
  [IpcChannel.ListTasks]: {
    channel: IpcChannel.ListTasks,
    request: taskListRequestSchema,
    response: taskListResponseSchema,
  },
  [IpcChannel.GetTask]: {
    channel: IpcChannel.GetTask,
    request: getTaskRequestSchema,
    response: taskDetailResponseSchema,
  },
});

const runInvokeMethods: InvokeMethodsByChannel<typeof runInvokeContracts> = {
  [IpcChannel.StartRun]: (input) => invokeContract(runInvokeContracts[IpcChannel.StartRun], input),
  [IpcChannel.CancelRun]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.CancelRun], input),
  [IpcChannel.ListRuns]: (input) => invokeContract(runInvokeContracts[IpcChannel.ListRuns], input),
  [IpcChannel.ListRunEvents]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.ListRunEvents], input),
  [IpcChannel.GetRunDiagnosticsSummary]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.GetRunDiagnosticsSummary], input),
  [IpcChannel.GetRunDiagnosticsSources]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.GetRunDiagnosticsSources], input),
  [IpcChannel.ListRunDiagnosticsPage]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.ListRunDiagnosticsPage], input),
  [IpcChannel.ListRunDiagnosticsHistory]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.ListRunDiagnosticsHistory], input),
  [IpcChannel.GetRunDiagnosticNodeDetail]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.GetRunDiagnosticNodeDetail], input),
  [IpcChannel.GetRunSettings]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.GetRunSettings], input),
  [IpcChannel.SaveRunSettings]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.SaveRunSettings], input),
};

const runEventContracts = defineEventContracts({
  [IpcChannel.RunEvent]: {
    channel: IpcChannel.RunEvent,
    event: agentRuntimeEventSchema,
  },
});
const runEventMethods: EventMethodsByChannel<typeof runEventContracts> = {
  [IpcChannel.RunEvent]: (listener) =>
    listenContract(runEventContracts[IpcChannel.RunEvent], listener),
};

const runDiagnosticsChangedContracts = defineEventContracts({
  [IpcChannel.RunDiagnosticsChanged]: {
    channel: IpcChannel.RunDiagnosticsChanged,
    event: runDiagnosticsChangedEventSchema,
  },
});
const runDiagnosticsChangedMethods: EventMethodsByChannel<typeof runDiagnosticsChangedContracts> = {
  [IpcChannel.RunDiagnosticsChanged]: (listener) =>
    listenContract(runDiagnosticsChangedContracts[IpcChannel.RunDiagnosticsChanged], listener),
};

const workspaceTaskInvokeMethods: InvokeMethodsByChannel<typeof workspaceTaskInvokeContracts> = {
  [IpcChannel.GetDefaultWorkspace]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.GetDefaultWorkspace], input),
  [IpcChannel.PickWorkspaceDirectory]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.PickWorkspaceDirectory], input),
  [IpcChannel.ListWorkspaces]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.ListWorkspaces], input),
  [IpcChannel.CreateWorkspace]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.CreateWorkspace], input),
  [IpcChannel.UpdateWorkspaceIdentity]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.UpdateWorkspaceIdentity], input),
  [IpcChannel.SetWorkspaceHidden]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.SetWorkspaceHidden], input),
  [IpcChannel.ListWorkspaceTaskGroups]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.ListWorkspaceTaskGroups], input),
  [IpcChannel.GetWorkspaceMemoryBrief]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.GetWorkspaceMemoryBrief], input),
  [IpcChannel.ListWorkspaceReferenceVersions]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.ListWorkspaceReferenceVersions], input),
  [IpcChannel.SetWorkspaceReferenceVersion]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.SetWorkspaceReferenceVersion], input),
  [IpcChannel.RemoveWorkspaceReferenceVersion]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.RemoveWorkspaceReferenceVersion], input),
  [IpcChannel.CreateTask]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.CreateTask], input),
  [IpcChannel.ListTasks]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.ListTasks], input),
  [IpcChannel.GetTask]: (input) =>
    invokeContract(workspaceTaskInvokeContracts[IpcChannel.GetTask], input),
};

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
const openKnowledgeSourceResponseSchema = openKnowledgeSourceResultSchema.transform(
  ({ opened, error }): OpenKnowledgeSourceResult => ({
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

const artifactEvidenceListRequestSchema = listArtifactsRequestSchema.optional();
const artifactEvidenceInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListEvidence]: {
    channel: IpcChannel.ListEvidence,
    request: listEvidenceRequestSchema,
    response: evidenceListResponseSchema,
  },
  [IpcChannel.ListArtifacts]: {
    channel: IpcChannel.ListArtifacts,
    request: artifactEvidenceListRequestSchema,
    response: artifactSummaryListResponseSchema,
  },
  [IpcChannel.GetArtifact]: {
    channel: IpcChannel.GetArtifact,
    request: getArtifactRequestSchema,
    response: artifactDetailResponseSchema,
  },
  [IpcChannel.ListArtifactVersions]: {
    channel: IpcChannel.ListArtifactVersions,
    request: listArtifactVersionsRequestSchema,
    response: artifactVersionSummaryListResponseSchema,
  },
  [IpcChannel.GetArtifactVersionExecutor]: {
    channel: IpcChannel.GetArtifactVersionExecutor,
    request: getArtifactVersionExecutorRequestSchema,
    response: artifactVersionExecutorSummarySchema.nullable(),
  },
  [IpcChannel.GetArtifactVersion]: {
    channel: IpcChannel.GetArtifactVersion,
    request: getArtifactVersionRequestSchema,
    response: artifactVersionDetailResponseSchema,
  },
  [IpcChannel.SaveMarkdownArtifact]: {
    channel: IpcChannel.SaveMarkdownArtifact,
    request: saveMarkdownArtifactRequestSchema,
    response: artifactSummaryResponseSchema,
  },
  [IpcChannel.ExportMarkdownArtifact]: {
    channel: IpcChannel.ExportMarkdownArtifact,
    request: exportMarkdownArtifactRequestSchema,
    response: exportMarkdownArtifactResponseSchema,
  },
  [IpcChannel.RegisterFileArtifact]: {
    channel: IpcChannel.RegisterFileArtifact,
    request: registerFileArtifactRequestSchema,
    response: registerFileArtifactResultSchema,
  },
  [IpcChannel.GetFileArtifact]: {
    channel: IpcChannel.GetFileArtifact,
    request: getFileArtifactRequestSchema,
    response: fileArtifactDetailResponseSchema,
  },
  [IpcChannel.ExportFileArtifact]: {
    channel: IpcChannel.ExportFileArtifact,
    request: exportFileArtifactRequestSchema,
    response: exportFileArtifactResponseSchema,
  },
  [IpcChannel.OpenFileArtifact]: {
    channel: IpcChannel.OpenFileArtifact,
    request: openFileArtifactRequestSchema,
    response: openFileArtifactResponseSchema,
  },
  [IpcChannel.RevealFileArtifact]: {
    channel: IpcChannel.RevealFileArtifact,
    request: openFileArtifactRequestSchema,
    response: revealFileArtifactResultSchema,
  },
  [IpcChannel.GetArtifactThumbnails]: {
    channel: IpcChannel.GetArtifactThumbnails,
    request: getArtifactThumbnailsRequestSchema,
    response: getArtifactThumbnailsResultSchema,
  },
});
const artifactEvidenceInvokeMethods: InvokeMethodsByChannel<
  typeof artifactEvidenceInvokeContracts
> = {
  [IpcChannel.ListEvidence]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.ListEvidence], input),
  [IpcChannel.ListArtifacts]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.ListArtifacts], input),
  [IpcChannel.GetArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.GetArtifact], input),
  [IpcChannel.ListArtifactVersions]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.ListArtifactVersions], input),
  [IpcChannel.GetArtifactVersionExecutor]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.GetArtifactVersionExecutor], input),
  [IpcChannel.GetArtifactVersion]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.GetArtifactVersion], input),
  [IpcChannel.SaveMarkdownArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.SaveMarkdownArtifact], input),
  [IpcChannel.ExportMarkdownArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.ExportMarkdownArtifact], input),
  [IpcChannel.RegisterFileArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.RegisterFileArtifact], input),
  [IpcChannel.GetFileArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.GetFileArtifact], input),
  [IpcChannel.ExportFileArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.ExportFileArtifact], input),
  [IpcChannel.OpenFileArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.OpenFileArtifact], input),
  [IpcChannel.RevealFileArtifact]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.RevealFileArtifact], input),
  [IpcChannel.GetArtifactThumbnails]: (input) =>
    invokeContract(artifactEvidenceInvokeContracts[IpcChannel.GetArtifactThumbnails], input),
};

const modelSearchNotificationInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListModels]: {
    channel: IpcChannel.ListModels,
    request: emptyInvokeRequestSchema,
    response: modelProfileListResponseSchema,
  },
  [IpcChannel.SaveModel]: {
    channel: IpcChannel.SaveModel,
    request: saveModelProfileRequestSchema,
    response: modelSaveResultSchema,
  },
  [IpcChannel.DeleteModel]: {
    channel: IpcChannel.DeleteModel,
    request: modelProfileIdSchema,
    response: deletedResultSchema,
  },
  [IpcChannel.SetDefaultModel]: {
    channel: IpcChannel.SetDefaultModel,
    request: setDefaultModelRequestSchema,
    response: updatedResultSchema,
  },
  [IpcChannel.SetModelEnabled]: {
    channel: IpcChannel.SetModelEnabled,
    request: setModelEnabledRequestSchema,
    response: updatedResultSchema,
  },
  [IpcChannel.TestModel]: {
    channel: IpcChannel.TestModel,
    request: testModelRequestSchema,
    response: connectionTestResultSchema,
  },
  [IpcChannel.ListSearchEngines]: {
    channel: IpcChannel.ListSearchEngines,
    request: emptyInvokeRequestSchema,
    response: searchEngineListResponseSchema,
  },
  [IpcChannel.SaveSearchEngine]: {
    channel: IpcChannel.SaveSearchEngine,
    request: saveSearchEngineRequestSchema,
    response: searchEngineSaveResultSchema,
  },
  [IpcChannel.TestSearchEngine]: {
    channel: IpcChannel.TestSearchEngine,
    request: testSearchEngineRequestSchema,
    response: connectionTestResultSchema,
  },
  [IpcChannel.ListNotifications]: {
    channel: IpcChannel.ListNotifications,
    request: emptyInvokeRequestSchema,
    response: notificationSummarySchema.array(),
  },
  [IpcChannel.GetNotification]: {
    channel: IpcChannel.GetNotification,
    request: getNotificationRequestSchema,
    response: notificationSummarySchema.nullable(),
  },
  [IpcChannel.NotificationRendererReady]: {
    channel: IpcChannel.NotificationRendererReady,
    request: notificationRendererReadyRequestSchema,
    response: notificationRendererReadyResultSchema,
  },
  [IpcChannel.MarkNotificationRead]: {
    channel: IpcChannel.MarkNotificationRead,
    request: markNotificationReadRequestSchema,
    response: unreadCountResultSchema,
  },
  [IpcChannel.MarkAllNotificationsRead]: {
    channel: IpcChannel.MarkAllNotificationsRead,
    request: markAllNotificationsReadRequestSchema,
    response: unreadCountResultSchema,
  },
  [IpcChannel.DeleteNotification]: {
    channel: IpcChannel.DeleteNotification,
    request: deleteNotificationRequestSchema,
    response: deletedResultSchema,
  },
  [IpcChannel.ClearNotifications]: {
    channel: IpcChannel.ClearNotifications,
    request: clearNotificationsRequestSchema,
    response: clearedResultSchema,
  },
});
const modelSearchNotificationInvokeMethods: InvokeMethodsByChannel<
  typeof modelSearchNotificationInvokeContracts
> = {
  [IpcChannel.ListModels]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.ListModels], input),
  [IpcChannel.SaveModel]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.SaveModel], input),
  [IpcChannel.DeleteModel]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.DeleteModel], input),
  [IpcChannel.SetDefaultModel]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.SetDefaultModel], input),
  [IpcChannel.SetModelEnabled]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.SetModelEnabled], input),
  [IpcChannel.TestModel]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.TestModel], input),
  [IpcChannel.ListSearchEngines]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.ListSearchEngines], input),
  [IpcChannel.SaveSearchEngine]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.SaveSearchEngine], input),
  [IpcChannel.TestSearchEngine]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.TestSearchEngine], input),
  [IpcChannel.ListNotifications]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.ListNotifications], input),
  [IpcChannel.GetNotification]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.GetNotification], input),
  [IpcChannel.NotificationRendererReady]: (input) =>
    invokeContract(
      modelSearchNotificationInvokeContracts[IpcChannel.NotificationRendererReady],
      input,
    ),
  [IpcChannel.MarkNotificationRead]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.MarkNotificationRead], input),
  [IpcChannel.MarkAllNotificationsRead]: (input) =>
    invokeContract(
      modelSearchNotificationInvokeContracts[IpcChannel.MarkAllNotificationsRead],
      input,
    ),
  [IpcChannel.DeleteNotification]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.DeleteNotification], input),
  [IpcChannel.ClearNotifications]: (input) =>
    invokeContract(modelSearchNotificationInvokeContracts[IpcChannel.ClearNotifications], input),
};

const notificationEventContracts = defineEventContracts({
  [IpcChannel.NotificationChangeEvent]: {
    channel: IpcChannel.NotificationChangeEvent,
    event: notificationChangeEventSchema,
  },
  [IpcChannel.NotificationActivated]: {
    channel: IpcChannel.NotificationActivated,
    event: notificationActivatedSchema,
  },
});
const notificationEventMethods: EventMethodsByChannel<typeof notificationEventContracts> = {
  [IpcChannel.NotificationChangeEvent]: (listener) =>
    listenContract(notificationEventContracts[IpcChannel.NotificationChangeEvent], listener),
  [IpcChannel.NotificationActivated]: (listener) =>
    listenContract(notificationEventContracts[IpcChannel.NotificationActivated], listener),
};

const knowledgeListRequestSchema = listKnowledgeRequestSchema;
const knowledgeJobsRequestSchema = listKnowledgeJobsRequestSchema;
const knowledgeInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListKnowledge]: {
    channel: IpcChannel.ListKnowledge,
    request: knowledgeListRequestSchema,
    response: knowledgeDocumentSummarySchema.array(),
  },
  [IpcChannel.ListKnowledgeCollections]: {
    channel: IpcChannel.ListKnowledgeCollections,
    request: emptyInvokeRequestSchema,
    response: knowledgeCollectionSchema.array(),
  },
  [IpcChannel.SaveKnowledgeCollection]: {
    channel: IpcChannel.SaveKnowledgeCollection,
    request: saveKnowledgeCollectionRequestSchema,
    response: knowledgeCollectionSchema.array(),
  },
  [IpcChannel.DeleteKnowledgeCollection]: {
    channel: IpcChannel.DeleteKnowledgeCollection,
    request: deleteKnowledgeCollectionRequestSchema,
    response: knowledgeCollectionSchema.array(),
  },
  [IpcChannel.SetKnowledgeCollectionMembers]: {
    channel: IpcChannel.SetKnowledgeCollectionMembers,
    request: setKnowledgeCollectionMembersRequestSchema,
    response: knowledgeCollectionMembersResultSchema,
  },
  [IpcChannel.ImportKnowledge]: {
    channel: IpcChannel.ImportKnowledge,
    request: emptyInvokeRequestSchema,
    response: knowledgeImportAckSchema,
  },
  [IpcChannel.ListKnowledgeJobs]: {
    channel: IpcChannel.ListKnowledgeJobs,
    request: knowledgeJobsRequestSchema,
    response: knowledgeJobPageSchema,
  },
  [IpcChannel.GetKnowledgeJob]: {
    channel: IpcChannel.GetKnowledgeJob,
    request: knowledgeJobIdRequestSchema,
    response: knowledgeJobDetailSchema.nullable(),
  },
  [IpcChannel.CancelKnowledgeJob]: {
    channel: IpcChannel.CancelKnowledgeJob,
    request: knowledgeJobIdRequestSchema,
    response: knowledgeJobCancelResultSchema,
  },
  [IpcChannel.ClearKnowledgeJobs]: {
    channel: IpcChannel.ClearKnowledgeJobs,
    request: clearKnowledgeJobsRequestSchema,
    response: clearedResultSchema,
  },
  [IpcChannel.RetryKnowledgeJob]: {
    channel: IpcChannel.RetryKnowledgeJob,
    request: retryKnowledgeJobRequestSchema,
    response: knowledgeJobAckSchema,
  },
  [IpcChannel.GetKnowledgeSettings]: {
    channel: IpcChannel.GetKnowledgeSettings,
    request: emptyInvokeRequestSchema,
    response: knowledgeSearchSettingsSchema,
  },
  [IpcChannel.SaveKnowledgeSettings]: {
    channel: IpcChannel.SaveKnowledgeSettings,
    request: saveKnowledgeSettingsRequestSchema,
    response: knowledgeSearchSettingsSchema,
  },
  [IpcChannel.RebuildKnowledgeIndex]: {
    channel: IpcChannel.RebuildKnowledgeIndex,
    request: rebuildKnowledgeIndexRequestSchema,
    response: knowledgeJobAckSchema,
  },
  [IpcChannel.CheckKnowledgeSources]: {
    channel: IpcChannel.CheckKnowledgeSources,
    request: checkKnowledgeSourcesRequestSchema,
    response: knowledgeJobAckSchema,
  },
  [IpcChannel.SearchKnowledge]: {
    channel: IpcChannel.SearchKnowledge,
    request: searchKnowledgeRequestSchema,
    response: knowledgeSearchResponseSchema,
  },
  [IpcChannel.OpenKnowledgeSource]: {
    channel: IpcChannel.OpenKnowledgeSource,
    request: openKnowledgeSourceRequestSchema,
    response: openKnowledgeSourceResponseSchema,
  },
  [IpcChannel.RemoveKnowledgeDocument]: {
    channel: IpcChannel.RemoveKnowledgeDocument,
    request: removeKnowledgeDocumentRequestSchema,
    response: removedResultSchema,
  },
  [IpcChannel.RefreshKnowledgeDocument]: {
    channel: IpcChannel.RefreshKnowledgeDocument,
    request: refreshKnowledgeDocumentRequestSchema,
    response: knowledgeJobAckSchema,
  },
  [IpcChannel.ListKnowledgeRevisions]: {
    channel: IpcChannel.ListKnowledgeRevisions,
    request: listKnowledgeRevisionsRequestSchema,
    response: knowledgeRevisionSummarySchema.array(),
  },
  [IpcChannel.PreviewKnowledge]: {
    channel: IpcChannel.PreviewKnowledge,
    request: previewKnowledgeRequestSchema,
    response: knowledgeTextPageSchema,
  },
  [IpcChannel.CreateResearchDraft]: {
    channel: IpcChannel.CreateResearchDraft,
    request: knowledgeCreateResearchDraftRequestSchema,
    response: knowledgeResearchDraftResultSchema,
  },
  [IpcChannel.PreviewRunSource]: {
    channel: IpcChannel.PreviewRunSource,
    request: previewRunSourceRequestSchema,
    response: runSourcePreviewSchema,
  },
  [IpcChannel.DeclareArtifactSources]: {
    channel: IpcChannel.DeclareArtifactSources,
    request: declareArtifactSourcesRequestSchema,
    response: runArtifactSourceDeclarationSchema,
  },
  [IpcChannel.GetRunArtifactDeclarations]: {
    channel: IpcChannel.GetRunArtifactDeclarations,
    request: getRunArtifactDeclarationsRequestSchema,
    response: runArtifactSourceDeclarationSchema.nullable(),
  },
});
const knowledgeInvokeMethods: InvokeMethodsByChannel<typeof knowledgeInvokeContracts> = {
  [IpcChannel.ListKnowledge]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.ListKnowledge], input),
  [IpcChannel.ListKnowledgeCollections]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.ListKnowledgeCollections], input),
  [IpcChannel.SaveKnowledgeCollection]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.SaveKnowledgeCollection], input),
  [IpcChannel.DeleteKnowledgeCollection]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.DeleteKnowledgeCollection], input),
  [IpcChannel.SetKnowledgeCollectionMembers]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.SetKnowledgeCollectionMembers], input),
  [IpcChannel.ImportKnowledge]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.ImportKnowledge], input),
  [IpcChannel.ListKnowledgeJobs]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.ListKnowledgeJobs], input),
  [IpcChannel.GetKnowledgeJob]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.GetKnowledgeJob], input),
  [IpcChannel.CancelKnowledgeJob]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.CancelKnowledgeJob], input),
  [IpcChannel.ClearKnowledgeJobs]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.ClearKnowledgeJobs], input),
  [IpcChannel.RetryKnowledgeJob]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.RetryKnowledgeJob], input),
  [IpcChannel.GetKnowledgeSettings]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.GetKnowledgeSettings], input),
  [IpcChannel.SaveKnowledgeSettings]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.SaveKnowledgeSettings], input),
  [IpcChannel.RebuildKnowledgeIndex]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.RebuildKnowledgeIndex], input),
  [IpcChannel.CheckKnowledgeSources]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.CheckKnowledgeSources], input),
  [IpcChannel.SearchKnowledge]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.SearchKnowledge], input),
  [IpcChannel.OpenKnowledgeSource]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.OpenKnowledgeSource], input),
  [IpcChannel.RemoveKnowledgeDocument]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.RemoveKnowledgeDocument], input),
  [IpcChannel.RefreshKnowledgeDocument]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.RefreshKnowledgeDocument], input),
  [IpcChannel.ListKnowledgeRevisions]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.ListKnowledgeRevisions], input),
  [IpcChannel.PreviewKnowledge]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.PreviewKnowledge], input),
  [IpcChannel.CreateResearchDraft]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.CreateResearchDraft], input),
  [IpcChannel.PreviewRunSource]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.PreviewRunSource], input),
  [IpcChannel.DeclareArtifactSources]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.DeclareArtifactSources], input),
  [IpcChannel.GetRunArtifactDeclarations]: (input) =>
    invokeContract(knowledgeInvokeContracts[IpcChannel.GetRunArtifactDeclarations], input),
};
const knowledgeEventContracts = defineEventContracts({
  [IpcChannel.KnowledgeJobEvent]: {
    channel: IpcChannel.KnowledgeJobEvent,
    event: knowledgeJobSummarySchema,
  },
});
const knowledgeEventMethods: EventMethodsByChannel<typeof knowledgeEventContracts> = {
  [IpcChannel.KnowledgeJobEvent]: (listener) =>
    listenContract(knowledgeEventContracts[IpcChannel.KnowledgeJobEvent], listener),
};

const scheduleListRequestSchema = listSchedulesRequestSchema;
const scheduleInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListSchedules]: {
    channel: IpcChannel.ListSchedules,
    request: scheduleListRequestSchema,
    response: scheduleCallResultSchema(schedulePageSchema),
  },
  [IpcChannel.GetSchedule]: {
    channel: IpcChannel.GetSchedule,
    request: getScheduleRequestSchema,
    response: scheduleCallResultSchema(scheduleDetailSchema),
  },
  [IpcChannel.SaveSchedule]: {
    channel: IpcChannel.SaveSchedule,
    request: saveScheduleRequestSchema,
    response: scheduleCallResultSchema(scheduleAggregateSchema),
  },
  [IpcChannel.SetScheduleLifecycle]: {
    channel: IpcChannel.SetScheduleLifecycle,
    request: setScheduleLifecycleRequestSchema,
    response: scheduleCallResultSchema(scheduleAggregateSchema),
  },
  [IpcChannel.PreviewSchedule]: {
    channel: IpcChannel.PreviewSchedule,
    request: previewScheduleRequestSchema,
    response: scheduleCallResultSchema(schedulePreviewResultSchema),
  },
  [IpcChannel.PreflightSchedule]: {
    channel: IpcChannel.PreflightSchedule,
    request: preflightScheduleRequestSchema,
    response: scheduleCallResultSchema(schedulePreflightViewSchema),
  },
  [IpcChannel.ApplyScheduleExpertRevision]: {
    channel: IpcChannel.ApplyScheduleExpertRevision,
    request: applyScheduleExpertRevisionRequestSchema,
    response: scheduleCallResultSchema(scheduleAggregateSchema),
  },
  [IpcChannel.ListScheduleOccurrences]: {
    channel: IpcChannel.ListScheduleOccurrences,
    request: listScheduleOccurrencesRequestSchema,
    response: scheduleCallResultSchema(scheduleOccurrenceHistoryPageSchema),
  },
  [IpcChannel.GetScheduleOccurrence]: {
    channel: IpcChannel.GetScheduleOccurrence,
    request: getScheduleOccurrenceRequestSchema,
    response: scheduleCallResultSchema(scheduleOccurrenceDetailSchema),
  },
  [IpcChannel.ListScheduleSourceItems]: {
    channel: IpcChannel.ListScheduleSourceItems,
    request: listScheduleSourceItemsRequestSchema,
    response: scheduleCallResultSchema(scheduleSourceItemsPageSchema),
  },
  [IpcChannel.ExecuteScheduleNow]: {
    channel: IpcChannel.ExecuteScheduleNow,
    request: executeScheduleNowRequestSchema,
    response: scheduleCallResultSchema(scheduleManualExecutionResultSchema),
  },
  [IpcChannel.ExecuteMissedSchedule]: {
    channel: IpcChannel.ExecuteMissedSchedule,
    request: executeMissedScheduleRequestSchema,
    response: scheduleCallResultSchema(scheduleManualExecutionResultSchema),
  },
  [IpcChannel.CancelScheduleOccurrence]: {
    channel: IpcChannel.CancelScheduleOccurrence,
    request: cancelScheduleOccurrenceRequestSchema,
    response: scheduleCallResultSchema(scheduleCancelOccurrenceResultSchema),
  },
  [IpcChannel.RetryScheduleOutput]: {
    channel: IpcChannel.RetryScheduleOutput,
    request: retryScheduleOutputRequestSchema,
    response: scheduleCallResultSchema(scheduleOutputReceiptSchema),
  },
});
const scheduleInvokeMethods: InvokeMethodsByChannel<typeof scheduleInvokeContracts> = {
  [IpcChannel.ListSchedules]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.ListSchedules], input),
  [IpcChannel.GetSchedule]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.GetSchedule], input),
  [IpcChannel.SaveSchedule]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.SaveSchedule], input),
  [IpcChannel.SetScheduleLifecycle]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.SetScheduleLifecycle], input),
  [IpcChannel.PreviewSchedule]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.PreviewSchedule], input),
  [IpcChannel.PreflightSchedule]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.PreflightSchedule], input),
  [IpcChannel.ApplyScheduleExpertRevision]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.ApplyScheduleExpertRevision], input),
  [IpcChannel.ListScheduleOccurrences]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.ListScheduleOccurrences], input),
  [IpcChannel.GetScheduleOccurrence]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.GetScheduleOccurrence], input),
  [IpcChannel.ListScheduleSourceItems]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.ListScheduleSourceItems], input),
  [IpcChannel.ExecuteScheduleNow]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.ExecuteScheduleNow], input),
  [IpcChannel.ExecuteMissedSchedule]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.ExecuteMissedSchedule], input),
  [IpcChannel.CancelScheduleOccurrence]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.CancelScheduleOccurrence], input),
  [IpcChannel.RetryScheduleOutput]: (input) =>
    invokeContract(scheduleInvokeContracts[IpcChannel.RetryScheduleOutput], input),
};
const scheduleEventContracts = defineEventContracts({
  [IpcChannel.ScheduleChanged]: {
    channel: IpcChannel.ScheduleChanged,
    event: scheduleChangedEventSchema,
  },
});
const scheduleEventMethods: EventMethodsByChannel<typeof scheduleEventContracts> = {
  [IpcChannel.ScheduleChanged]: (listener) =>
    listenContract(scheduleEventContracts[IpcChannel.ScheduleChanged], listener),
};

const skillInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListSkills]: {
    channel: IpcChannel.ListSkills,
    request: emptyInvokeRequestSchema,
    response: skillSummarySchema.array(),
  },
  [IpcChannel.GetSkill]: {
    channel: IpcChannel.GetSkill,
    request: getSkillRequestSchema,
    response: skillDetailSchema.nullable(),
  },
  [IpcChannel.ImportSkill]: {
    channel: IpcChannel.ImportSkill,
    request: importSkillRequestSchema,
    response: skillImportResultSchema,
  },
  [IpcChannel.ImportSkillFromUrl]: {
    channel: IpcChannel.ImportSkillFromUrl,
    request: importSkillFromUrlRequestSchema,
    response: skillImportResultSchema,
  },
  [IpcChannel.SaveSkillRuntimeProfile]: {
    channel: IpcChannel.SaveSkillRuntimeProfile,
    request: saveSkillRuntimeProfileRequestSchema,
    response: skillMutationResultSchema,
  },
  [IpcChannel.SetSkillTrust]: {
    channel: IpcChannel.SetSkillTrust,
    request: setSkillTrustRequestSchema,
    response: skillMutationResultSchema,
  },
  [IpcChannel.RevokeSkillTrust]: {
    channel: IpcChannel.RevokeSkillTrust,
    request: revokeSkillTrustRequestSchema,
    response: skillMutationResultSchema,
  },
  [IpcChannel.SetSkillEnabled]: {
    channel: IpcChannel.SetSkillEnabled,
    request: setSkillEnabledRequestSchema,
    response: skillMutationResultSchema,
  },
  [IpcChannel.CopySkill]: {
    channel: IpcChannel.CopySkill,
    request: copySkillRequestSchema,
    response: skillMutationResultSchema,
  },
  [IpcChannel.ExportSkill]: {
    channel: IpcChannel.ExportSkill,
    request: exportSkillRequestSchema,
    response: skillExportResultSchema,
  },
  [IpcChannel.DeleteSkill]: {
    channel: IpcChannel.DeleteSkill,
    request: deleteSkillRequestSchema,
    response: deletedResultSchema,
  },
  [IpcChannel.RefreshSkillDependencyGrant]: {
    channel: IpcChannel.RefreshSkillDependencyGrant,
    request: refreshSkillDependencyGrantRequestSchema,
    response: refreshSkillDependencyGrantResultSchema,
  },
  [IpcChannel.TestSkillRun]: {
    channel: IpcChannel.TestSkillRun,
    request: testSkillRunRequestSchema,
    response: testSkillRunResultSchema,
  },
});
const skillInvokeMethods: InvokeMethodsByChannel<typeof skillInvokeContracts> = {
  [IpcChannel.ListSkills]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.ListSkills], input),
  [IpcChannel.GetSkill]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.GetSkill], input),
  [IpcChannel.ImportSkill]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.ImportSkill], input),
  [IpcChannel.ImportSkillFromUrl]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.ImportSkillFromUrl], input),
  [IpcChannel.SaveSkillRuntimeProfile]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.SaveSkillRuntimeProfile], input),
  [IpcChannel.SetSkillTrust]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.SetSkillTrust], input),
  [IpcChannel.RevokeSkillTrust]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.RevokeSkillTrust], input),
  [IpcChannel.SetSkillEnabled]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.SetSkillEnabled], input),
  [IpcChannel.CopySkill]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.CopySkill], input),
  [IpcChannel.ExportSkill]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.ExportSkill], input),
  [IpcChannel.DeleteSkill]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.DeleteSkill], input),
  [IpcChannel.RefreshSkillDependencyGrant]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.RefreshSkillDependencyGrant], input),
  [IpcChannel.TestSkillRun]: (input) =>
    invokeContract(skillInvokeContracts[IpcChannel.TestSkillRun], input),
};

const expertInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListExperts]: {
    channel: IpcChannel.ListExperts,
    request: listExpertsRequestSchema,
    response: expertSummarySchema.array(),
  },
  [IpcChannel.GetExpert]: {
    channel: IpcChannel.GetExpert,
    request: getExpertRequestSchema,
    response: expertDetailSchema.nullable(),
  },
  [IpcChannel.CreateExpert]: {
    channel: IpcChannel.CreateExpert,
    request: expertRevisionDraftSchema,
    response: expertMutationResultSchema,
  },
  [IpcChannel.SaveExpertRevision]: {
    channel: IpcChannel.SaveExpertRevision,
    request: saveExpertRevisionRequestSchema,
    response: expertMutationResultSchema,
  },
  [IpcChannel.CopyExpert]: {
    channel: IpcChannel.CopyExpert,
    request: copyExpertRequestSchema,
    response: expertMutationResultSchema,
  },
  [IpcChannel.SetExpertLifecycle]: {
    channel: IpcChannel.SetExpertLifecycle,
    request: setExpertLifecycleRequestSchema,
    response: expertMutationResultSchema,
  },
  [IpcChannel.DeleteExpert]: {
    channel: IpcChannel.DeleteExpert,
    request: deleteExpertRequestSchema,
    response: deletedResultSchema,
  },
});
const expertInvokeMethods: InvokeMethodsByChannel<typeof expertInvokeContracts> = {
  [IpcChannel.ListExperts]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.ListExperts], input),
  [IpcChannel.GetExpert]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.GetExpert], input),
  [IpcChannel.CreateExpert]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.CreateExpert], input),
  [IpcChannel.SaveExpertRevision]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.SaveExpertRevision], input),
  [IpcChannel.CopyExpert]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.CopyExpert], input),
  [IpcChannel.SetExpertLifecycle]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.SetExpertLifecycle], input),
  [IpcChannel.DeleteExpert]: (input) =>
    invokeContract(expertInvokeContracts[IpcChannel.DeleteExpert], input),
};

const taskSupportInvokeContracts = defineInvokeContracts({
  [IpcChannel.GetTaskContext]: {
    channel: IpcChannel.GetTaskContext,
    request: getTaskContextRequestSchema,
    response: taskContextRevisionSchema.nullable(),
  },
  [IpcChannel.SaveTaskContext]: {
    channel: IpcChannel.SaveTaskContext,
    request: saveTaskContextRequestSchema,
    response: taskContextMutationResultSchema,
  },
  [IpcChannel.GetTaskContinuityBrief]: {
    channel: IpcChannel.GetTaskContinuityBrief,
    request: getTaskContinuityBriefRequestSchema,
    response: taskContinuityRevisionSchema.nullable(),
  },
  [IpcChannel.SaveTaskContinuityBrief]: {
    channel: IpcChannel.SaveTaskContinuityBrief,
    request: saveTaskContinuityBriefRequestSchema,
    response: taskContinuityBriefMutationResultSchema,
  },
  [IpcChannel.ListDiscussionCheckpoints]: {
    channel: IpcChannel.ListDiscussionCheckpoints,
    request: listDiscussionCheckpointsRequestSchema,
    response: discussionCheckpointSchema.array(),
  },
  [IpcChannel.CreateDiscussionCheckpoint]: {
    channel: IpcChannel.CreateDiscussionCheckpoint,
    request: createDiscussionCheckpointRequestSchema,
    response: discussionCheckpointMutationResultSchema,
  },
  [IpcChannel.ListTaskMaterialCandidates]: {
    channel: IpcChannel.ListTaskMaterialCandidates,
    request: listTaskMaterialCandidatesRequestSchema,
    response: materialCandidateSchema.array(),
  },
  [IpcChannel.PrepareWorkspaceInputSnapshot]: {
    channel: IpcChannel.PrepareWorkspaceInputSnapshot,
    request: prepareWorkspaceInputSnapshotRequestSchema,
    response: inputSnapshotSchema.nullable(),
  },
});
const taskSupportInvokeMethods: InvokeMethodsByChannel<typeof taskSupportInvokeContracts> = {
  [IpcChannel.GetTaskContext]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.GetTaskContext], input),
  [IpcChannel.SaveTaskContext]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.SaveTaskContext], input),
  [IpcChannel.GetTaskContinuityBrief]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.GetTaskContinuityBrief], input),
  [IpcChannel.SaveTaskContinuityBrief]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.SaveTaskContinuityBrief], input),
  [IpcChannel.ListDiscussionCheckpoints]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.ListDiscussionCheckpoints], input),
  [IpcChannel.CreateDiscussionCheckpoint]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.CreateDiscussionCheckpoint], input),
  [IpcChannel.ListTaskMaterialCandidates]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.ListTaskMaterialCandidates], input),
  [IpcChannel.PrepareWorkspaceInputSnapshot]: (input) =>
    invokeContract(taskSupportInvokeContracts[IpcChannel.PrepareWorkspaceInputSnapshot], input),
};

const memoryInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListMemories]: {
    channel: IpcChannel.ListMemories,
    request: listMemoriesRequestSchema,
    response: resultSchema(memoryListPageDataSchema),
  },
  [IpcChannel.GetMemory]: {
    channel: IpcChannel.GetMemory,
    request: getMemoryRequestSchema,
    response: resultSchema(memoryViewItemSchema),
  },
  [IpcChannel.CreateMemory]: {
    channel: IpcChannel.CreateMemory,
    request: createMemoryRequestSchema,
    response: resultSchema(memoryWriteReceiptSchema),
  },
  [IpcChannel.UpdateMemory]: {
    channel: IpcChannel.UpdateMemory,
    request: updateMemoryRequestSchema,
    response: resultSchema(memoryWriteReceiptSchema),
  },
  [IpcChannel.SetMemoryStatus]: {
    channel: IpcChannel.SetMemoryStatus,
    request: setMemoryStatusRequestSchema,
    response: resultSchema(memoryWriteReceiptSchema),
  },
  [IpcChannel.ResolveMemoryConflict]: {
    channel: IpcChannel.ResolveMemoryConflict,
    request: resolveMemoryConflictRequestSchema,
    response: resultSchema(memoryConflictResolutionDataSchema),
  },
  [IpcChannel.PreviewMemory]: {
    channel: IpcChannel.PreviewMemory,
    request: previewMemoryRequestSchema,
    response: resultSchema(memoryPreviewDataSchema),
  },
  [IpcChannel.TaskMemoryExclusions]: {
    channel: IpcChannel.TaskMemoryExclusions,
    request: taskMemoryExclusionsRequestSchema,
    response: resultSchema(taskMemoryExclusionsDataSchema),
  },
  [IpcChannel.GetRunMemoryContext]: {
    channel: IpcChannel.GetRunMemoryContext,
    request: getRunMemoryContextRequestSchema,
    response: resultSchema(memoryRunContextDataSchema),
  },
  [IpcChannel.GetMemorySettings]: {
    channel: IpcChannel.GetMemorySettings,
    request: getMemorySettingsRequestSchema,
    response: resultSchema(workspaceMemorySettingsSchema),
  },
  [IpcChannel.SetMemorySettings]: {
    channel: IpcChannel.SetMemorySettings,
    request: setMemorySettingsRequestSchema,
    response: resultSchema(memorySettingsDataSchema),
  },
  [IpcChannel.ListMemoryJobs]: {
    channel: IpcChannel.ListMemoryJobs,
    request: listMemoryJobsRequestSchema,
    response: resultSchema(memoryJobListDataSchema),
  },
  [IpcChannel.RetryMemoryJob]: {
    channel: IpcChannel.RetryMemoryJob,
    request: retryMemoryJobRequestSchema,
    response: resultSchema(memoryJobSummarySchema),
  },
  [IpcChannel.CancelMemoryJob]: {
    channel: IpcChannel.CancelMemoryJob,
    request: cancelMemoryJobRequestSchema,
    response: resultSchema(memoryJobSummarySchema),
  },
  [IpcChannel.RebuildMemoryProjection]: {
    channel: IpcChannel.RebuildMemoryProjection,
    request: rebuildMemoryProjectionRequestSchema,
    response: resultSchema(memoryProjectionStateDataSchema),
  },
});
const memoryInvokeMethods: InvokeMethodsByChannel<typeof memoryInvokeContracts> = {
  [IpcChannel.ListMemories]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.ListMemories], input),
  [IpcChannel.GetMemory]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.GetMemory], input),
  [IpcChannel.CreateMemory]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.CreateMemory], input),
  [IpcChannel.UpdateMemory]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.UpdateMemory], input),
  [IpcChannel.SetMemoryStatus]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.SetMemoryStatus], input),
  [IpcChannel.ResolveMemoryConflict]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.ResolveMemoryConflict], input),
  [IpcChannel.PreviewMemory]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.PreviewMemory], input),
  [IpcChannel.TaskMemoryExclusions]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.TaskMemoryExclusions], input),
  [IpcChannel.GetRunMemoryContext]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.GetRunMemoryContext], input),
  [IpcChannel.GetMemorySettings]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.GetMemorySettings], input),
  [IpcChannel.SetMemorySettings]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.SetMemorySettings], input),
  [IpcChannel.ListMemoryJobs]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.ListMemoryJobs], input),
  [IpcChannel.RetryMemoryJob]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.RetryMemoryJob], input),
  [IpcChannel.CancelMemoryJob]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.CancelMemoryJob], input),
  [IpcChannel.RebuildMemoryProjection]: (input) =>
    invokeContract(memoryInvokeContracts[IpcChannel.RebuildMemoryProjection], input),
};

const mcpInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListMcpConnections]: {
    channel: IpcChannel.ListMcpConnections,
    request: emptyInvokeRequestSchema,
    response: mcpConnectionSummarySchema.array(),
  },
  [IpcChannel.GetMcpConnection]: {
    channel: IpcChannel.GetMcpConnection,
    request: getMcpConnectionRequestSchema,
    response: mcpConnectionSummarySchema.nullable(),
  },
  [IpcChannel.SaveMcpConnection]: {
    channel: IpcChannel.SaveMcpConnection,
    request: saveMcpConnectionRequestSchema,
    response: mcpMutationResultSchema,
  },
  [IpcChannel.DeleteMcpConnection]: {
    channel: IpcChannel.DeleteMcpConnection,
    request: deleteMcpConnectionRequestSchema,
    response: deletedResultSchema,
  },
  [IpcChannel.TestMcpConnection]: {
    channel: IpcChannel.TestMcpConnection,
    request: mcpOperationRequestSchema,
    response: mcpTestResultSchema,
  },
  [IpcChannel.SetMcpLifecycle]: {
    channel: IpcChannel.SetMcpLifecycle,
    request: mcpLifecycleRequestSchema,
    response: mcpMutationResultSchema,
  },
  [IpcChannel.ReviewMcpTool]: {
    channel: IpcChannel.ReviewMcpTool,
    request: mcpReviewRequestSchema,
    response: mcpMutationResultSchema,
  },
  [IpcChannel.CancelMcpOperation]: {
    channel: IpcChannel.CancelMcpOperation,
    request: mcpOperationRequestSchema,
    response: z.object({ cancelled: z.boolean() }),
  },
  [IpcChannel.PrepareMcpLogin]: {
    channel: IpcChannel.PrepareMcpLogin,
    request: mcpOperationRequestSchema,
    response: mcpOAuthPreparationSchema,
  },
  [IpcChannel.ContinueMcpLogin]: {
    channel: IpcChannel.ContinueMcpLogin,
    request: mcpLoginContinueRequestSchema,
    response: mcpTestResultSchema,
  },
  [IpcChannel.LogoutMcpConnection]: {
    channel: IpcChannel.LogoutMcpConnection,
    request: mcpOperationRequestSchema,
    response: mcpMutationResultSchema,
  },
});
const mcpInvokeMethods: InvokeMethodsByChannel<typeof mcpInvokeContracts> = {
  [IpcChannel.ListMcpConnections]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.ListMcpConnections], input),
  [IpcChannel.GetMcpConnection]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.GetMcpConnection], input),
  [IpcChannel.SaveMcpConnection]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.SaveMcpConnection], input),
  [IpcChannel.DeleteMcpConnection]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.DeleteMcpConnection], input),
  [IpcChannel.TestMcpConnection]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.TestMcpConnection], input),
  [IpcChannel.SetMcpLifecycle]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.SetMcpLifecycle], input),
  [IpcChannel.ReviewMcpTool]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.ReviewMcpTool], input),
  [IpcChannel.CancelMcpOperation]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.CancelMcpOperation], input),
  [IpcChannel.PrepareMcpLogin]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.PrepareMcpLogin], input),
  [IpcChannel.ContinueMcpLogin]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.ContinueMcpLogin], input),
  [IpcChannel.LogoutMcpConnection]: (input) =>
    invokeContract(mcpInvokeContracts[IpcChannel.LogoutMcpConnection], input),
};

const dependencyInvokeContracts = defineInvokeContracts({
  [IpcChannel.ListDependencyOptions]: {
    channel: IpcChannel.ListDependencyOptions,
    request: listDependencyOptionsRequestSchema,
    response: dependencyOptionsSchema,
  },
  [IpcChannel.InspectDependencyPlan]: {
    channel: IpcChannel.InspectDependencyPlan,
    request: dependencyPlanRequestSchema,
    response: dependencyPlanSchema,
  },
  [IpcChannel.VerifyDependencyEnvironment]: {
    channel: IpcChannel.VerifyDependencyEnvironment,
    request: verifyDependencyEnvironmentRequestSchema,
    response: runtimeEnvironmentSchema,
  },
  [IpcChannel.PrepareDependencyEnvironment]: {
    channel: IpcChannel.PrepareDependencyEnvironment,
    request: prepareDependencyRequestSchema,
    response: prepareDependencyResultSchema,
  },
  [IpcChannel.CancelDependencyPreparation]: {
    channel: IpcChannel.CancelDependencyPreparation,
    request: cancelDependencyRequestSchema,
    response: cancelDependencyResultSchema,
  },
  [IpcChannel.GetDependencyOperation]: {
    channel: IpcChannel.GetDependencyOperation,
    request: getDependencyOperationRequestSchema,
    response: dependencyOperationSchema.nullable(),
  },
  [IpcChannel.ChoosePythonInterpreter]: {
    channel: IpcChannel.ChoosePythonInterpreter,
    request: emptyInvokeRequestSchema,
    response: chooseInterpreterResultSchema,
  },
  [IpcChannel.RegisterToolchainSnapshot]: {
    channel: IpcChannel.RegisterToolchainSnapshot,
    request: registerToolchainRequestSchema,
    response: registerToolchainResultSchema,
  },
  [IpcChannel.DeleteToolchainSnapshot]: {
    channel: IpcChannel.DeleteToolchainSnapshot,
    request: deleteToolchainSnapshotRequestSchema,
    response: deleteToolchainSnapshotResultSchema,
  },
});
const dependencyInvokeMethods: InvokeMethodsByChannel<typeof dependencyInvokeContracts> = {
  [IpcChannel.ListDependencyOptions]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.ListDependencyOptions], input),
  [IpcChannel.InspectDependencyPlan]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.InspectDependencyPlan], input),
  [IpcChannel.VerifyDependencyEnvironment]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.VerifyDependencyEnvironment], input),
  [IpcChannel.PrepareDependencyEnvironment]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.PrepareDependencyEnvironment], input),
  [IpcChannel.CancelDependencyPreparation]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.CancelDependencyPreparation], input),
  [IpcChannel.GetDependencyOperation]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.GetDependencyOperation], input),
  [IpcChannel.ChoosePythonInterpreter]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.ChoosePythonInterpreter], input),
  [IpcChannel.RegisterToolchainSnapshot]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.RegisterToolchainSnapshot], input),
  [IpcChannel.DeleteToolchainSnapshot]: (input) =>
    invokeContract(dependencyInvokeContracts[IpcChannel.DeleteToolchainSnapshot], input),
};

const chromeInvokeContracts = defineInvokeContracts({
  [IpcChannel.UpdateWindowTheme]: {
    channel: IpcChannel.UpdateWindowTheme,
    request: updateWindowThemeRequestSchema,
    response: voidResultSchema,
  },
  [IpcChannel.WindowToggleMaximize]: {
    channel: IpcChannel.WindowToggleMaximize,
    request: windowToggleMaximizeRequestSchema,
    response: maximizedResultSchema,
  },
});
const chromeInvokeMethods: InvokeMethodsByChannel<typeof chromeInvokeContracts> = {
  [IpcChannel.UpdateWindowTheme]: (input) =>
    invokeContract(chromeInvokeContracts[IpcChannel.UpdateWindowTheme], input),
  [IpcChannel.WindowToggleMaximize]: (input) =>
    invokeContract(chromeInvokeContracts[IpcChannel.WindowToggleMaximize], input),
};

const api: BetterWorkDesktopApi = {
  runs: {
    start: (input) => runInvokeMethods[IpcChannel.StartRun](input),
    cancel: (input) => runInvokeMethods[IpcChannel.CancelRun](input),
    list: (input) => runInvokeMethods[IpcChannel.ListRuns](input),
    listEvents: (input) => runInvokeMethods[IpcChannel.ListRunEvents](input),
    getDiagnosticsSummary: (input) => runInvokeMethods[IpcChannel.GetRunDiagnosticsSummary](input),
    getDiagnosticsSources: (input) => runInvokeMethods[IpcChannel.GetRunDiagnosticsSources](input),
    listDiagnosticsPage: (input) => runInvokeMethods[IpcChannel.ListRunDiagnosticsPage](input),
    listDiagnosticsHistory: (input) =>
      runInvokeMethods[IpcChannel.ListRunDiagnosticsHistory](input),
    getDiagnosticNodeDetail: (input) =>
      runInvokeMethods[IpcChannel.GetRunDiagnosticNodeDetail](input),
    onEvent: (listener) => runEventMethods[IpcChannel.RunEvent](listener),
    onDiagnosticsChanged: (listener: (event: RunDiagnosticsChangedEvent) => void) =>
      runDiagnosticsChangedMethods[IpcChannel.RunDiagnosticsChanged](listener),
  },
  runSettings: {
    get: () => runInvokeMethods[IpcChannel.GetRunSettings]({}),
    save: (input) => runInvokeMethods[IpcChannel.SaveRunSettings](input),
  },
  workspace: {
    getDefault: () => workspaceTaskInvokeMethods[IpcChannel.GetDefaultWorkspace]({}),
    pickDirectory: () => workspaceTaskInvokeMethods[IpcChannel.PickWorkspaceDirectory]({}),
    listAll: () => workspaceTaskInvokeMethods[IpcChannel.ListWorkspaces]({}),
    create: (input) => workspaceTaskInvokeMethods[IpcChannel.CreateWorkspace](input),
    updateIdentity: (input) =>
      workspaceTaskInvokeMethods[IpcChannel.UpdateWorkspaceIdentity](input),
    setHidden: (input) => workspaceTaskInvokeMethods[IpcChannel.SetWorkspaceHidden](input),
    listTaskGroups: () => workspaceTaskInvokeMethods[IpcChannel.ListWorkspaceTaskGroups]({}),
    memoryBrief: (input) => workspaceTaskInvokeMethods[IpcChannel.GetWorkspaceMemoryBrief](input),
    listReferenceVersions: (input) =>
      workspaceTaskInvokeMethods[IpcChannel.ListWorkspaceReferenceVersions](input),
    setReferenceVersion: (input) =>
      workspaceTaskInvokeMethods[IpcChannel.SetWorkspaceReferenceVersion](input),
    removeReferenceVersion: (input) =>
      workspaceTaskInvokeMethods[IpcChannel.RemoveWorkspaceReferenceVersion](input),
  },
  tasks: {
    create: (input) => workspaceTaskInvokeMethods[IpcChannel.CreateTask](input),
    list: (input) => workspaceTaskInvokeMethods[IpcChannel.ListTasks](input),
    get: (input) => workspaceTaskInvokeMethods[IpcChannel.GetTask](input),
  },
  evidence: {
    list: (input) => artifactEvidenceInvokeMethods[IpcChannel.ListEvidence](input),
  },
  artifacts: {
    list: (input) => artifactEvidenceInvokeMethods[IpcChannel.ListArtifacts](input),
    get: (input) => artifactEvidenceInvokeMethods[IpcChannel.GetArtifact](input),
    listVersions: (input) => artifactEvidenceInvokeMethods[IpcChannel.ListArtifactVersions](input),
    getVersionExecutor: (input) =>
      artifactEvidenceInvokeMethods[IpcChannel.GetArtifactVersionExecutor](input),
    getVersion: (input) => artifactEvidenceInvokeMethods[IpcChannel.GetArtifactVersion](input),
    saveMarkdown: (input) => artifactEvidenceInvokeMethods[IpcChannel.SaveMarkdownArtifact](input),
    exportMarkdown: (input) =>
      artifactEvidenceInvokeMethods[IpcChannel.ExportMarkdownArtifact](input),
    registerFile: (input) => artifactEvidenceInvokeMethods[IpcChannel.RegisterFileArtifact](input),
    getFileDetail: (input) => artifactEvidenceInvokeMethods[IpcChannel.GetFileArtifact](input),
    exportFile: (input) => artifactEvidenceInvokeMethods[IpcChannel.ExportFileArtifact](input),
    openFile: (input) => artifactEvidenceInvokeMethods[IpcChannel.OpenFileArtifact](input),
    revealFile: (input) => artifactEvidenceInvokeMethods[IpcChannel.RevealFileArtifact](input),
    getThumbnails: (input) =>
      artifactEvidenceInvokeMethods[IpcChannel.GetArtifactThumbnails](input),
  },
  models: {
    list: () => modelSearchNotificationInvokeMethods[IpcChannel.ListModels]({}),
    save: (input) => modelSearchNotificationInvokeMethods[IpcChannel.SaveModel](input),
    delete: (input) => modelSearchNotificationInvokeMethods[IpcChannel.DeleteModel](input),
    setDefault: (input) => modelSearchNotificationInvokeMethods[IpcChannel.SetDefaultModel](input),
    setEnabled: (input) => modelSearchNotificationInvokeMethods[IpcChannel.SetModelEnabled](input),
    test: (input) => modelSearchNotificationInvokeMethods[IpcChannel.TestModel](input),
  },
  searchEngines: {
    list: () => modelSearchNotificationInvokeMethods[IpcChannel.ListSearchEngines]({}),
    save: (input) => modelSearchNotificationInvokeMethods[IpcChannel.SaveSearchEngine](input),
    test: (input) => modelSearchNotificationInvokeMethods[IpcChannel.TestSearchEngine](input),
  },
  notifications: {
    list: () => modelSearchNotificationInvokeMethods[IpcChannel.ListNotifications]({}),
    get: (input) => modelSearchNotificationInvokeMethods[IpcChannel.GetNotification](input),
    rendererReady: () =>
      modelSearchNotificationInvokeMethods[IpcChannel.NotificationRendererReady]({}),
    markRead: (input) =>
      modelSearchNotificationInvokeMethods[IpcChannel.MarkNotificationRead](input),
    markAllRead: () =>
      modelSearchNotificationInvokeMethods[IpcChannel.MarkAllNotificationsRead]({}),
    delete: (input) => modelSearchNotificationInvokeMethods[IpcChannel.DeleteNotification](input),
    clear: () => modelSearchNotificationInvokeMethods[IpcChannel.ClearNotifications]({}),
    onChange: (listener) => notificationEventMethods[IpcChannel.NotificationChangeEvent](listener),
    onActivate: (listener) => notificationEventMethods[IpcChannel.NotificationActivated](listener),
  },
  schedules: {
    list: (input) => scheduleInvokeMethods[IpcChannel.ListSchedules](input ?? {}),
    get: (input) => scheduleInvokeMethods[IpcChannel.GetSchedule](input),
    save: (input) => scheduleInvokeMethods[IpcChannel.SaveSchedule](input),
    setLifecycle: (input) => scheduleInvokeMethods[IpcChannel.SetScheduleLifecycle](input),
    preview: (input) => scheduleInvokeMethods[IpcChannel.PreviewSchedule](input),
    preflight: (input) => scheduleInvokeMethods[IpcChannel.PreflightSchedule](input),
    applyExpertRevision: (input) =>
      scheduleInvokeMethods[IpcChannel.ApplyScheduleExpertRevision](input),
    listOccurrences: (input) => scheduleInvokeMethods[IpcChannel.ListScheduleOccurrences](input),
    getOccurrence: (input) => scheduleInvokeMethods[IpcChannel.GetScheduleOccurrence](input),
    listSourceItems: (input) => scheduleInvokeMethods[IpcChannel.ListScheduleSourceItems](input),
    executeNow: (input) => scheduleInvokeMethods[IpcChannel.ExecuteScheduleNow](input),
    executeMissed: (input) => scheduleInvokeMethods[IpcChannel.ExecuteMissedSchedule](input),
    cancelOccurrence: (input) => scheduleInvokeMethods[IpcChannel.CancelScheduleOccurrence](input),
    retryOutput: (input) => scheduleInvokeMethods[IpcChannel.RetryScheduleOutput](input),
    onChange: (listener) => scheduleEventMethods[IpcChannel.ScheduleChanged](listener),
  },
  chrome: {
    updateTheme: (input) => chromeInvokeMethods[IpcChannel.UpdateWindowTheme](input),
    toggleMaximize: () => chromeInvokeMethods[IpcChannel.WindowToggleMaximize]({}),
  },
  knowledge: {
    list: (input) => knowledgeInvokeMethods[IpcChannel.ListKnowledge](input ?? {}),
    listCollections: () => knowledgeInvokeMethods[IpcChannel.ListKnowledgeCollections]({}),
    saveCollection: (input) => knowledgeInvokeMethods[IpcChannel.SaveKnowledgeCollection](input),
    deleteCollection: (input) =>
      knowledgeInvokeMethods[IpcChannel.DeleteKnowledgeCollection](input),
    setCollectionMembers: (input) =>
      knowledgeInvokeMethods[IpcChannel.SetKnowledgeCollectionMembers](input),
    importFromDialog: () => knowledgeInvokeMethods[IpcChannel.ImportKnowledge]({}),
    jobs: (input) => knowledgeInvokeMethods[IpcChannel.ListKnowledgeJobs](input ?? {}),
    job: (input) => knowledgeInvokeMethods[IpcChannel.GetKnowledgeJob](input),
    cancelJob: (input) => knowledgeInvokeMethods[IpcChannel.CancelKnowledgeJob](input),
    clearJobs: () => knowledgeInvokeMethods[IpcChannel.ClearKnowledgeJobs]({}),
    retryJob: (input) => knowledgeInvokeMethods[IpcChannel.RetryKnowledgeJob](input),
    onJobEvent: (listener) => knowledgeEventMethods[IpcChannel.KnowledgeJobEvent](listener),
    settings: () => knowledgeInvokeMethods[IpcChannel.GetKnowledgeSettings]({}),
    saveSettings: (input) => knowledgeInvokeMethods[IpcChannel.SaveKnowledgeSettings](input),
    rebuildIndex: (input) => knowledgeInvokeMethods[IpcChannel.RebuildKnowledgeIndex](input),
    checkSources: (input) => knowledgeInvokeMethods[IpcChannel.CheckKnowledgeSources](input),
    search: (input) => knowledgeInvokeMethods[IpcChannel.SearchKnowledge](input),
    openSource: (input) => knowledgeInvokeMethods[IpcChannel.OpenKnowledgeSource](input),
    remove: (input) => knowledgeInvokeMethods[IpcChannel.RemoveKnowledgeDocument](input),
    refresh: (input) => knowledgeInvokeMethods[IpcChannel.RefreshKnowledgeDocument](input),
    listRevisions: (input) => knowledgeInvokeMethods[IpcChannel.ListKnowledgeRevisions](input),
    preview: (input) => knowledgeInvokeMethods[IpcChannel.PreviewKnowledge](input),
    createResearchDraft: (input) => knowledgeInvokeMethods[IpcChannel.CreateResearchDraft](input),
    previewRunSource: (input) => knowledgeInvokeMethods[IpcChannel.PreviewRunSource](input),
    declareArtifactSources: (input) =>
      knowledgeInvokeMethods[IpcChannel.DeclareArtifactSources](input),
    getRunArtifactDeclarations: (input) =>
      knowledgeInvokeMethods[IpcChannel.GetRunArtifactDeclarations](input),
  },
  skills: {
    list: () => skillInvokeMethods[IpcChannel.ListSkills]({}),
    get: (input) => skillInvokeMethods[IpcChannel.GetSkill](input),
    importFromDialog: () => skillInvokeMethods[IpcChannel.ImportSkill]({}),
    importFromUrl: (input) => skillInvokeMethods[IpcChannel.ImportSkillFromUrl](input),
    saveRuntimeProfile: (input) => skillInvokeMethods[IpcChannel.SaveSkillRuntimeProfile](input),
    setTrust: (input) => skillInvokeMethods[IpcChannel.SetSkillTrust](input),
    revokeTrust: (input) => skillInvokeMethods[IpcChannel.RevokeSkillTrust](input),
    setEnabled: (input) => skillInvokeMethods[IpcChannel.SetSkillEnabled](input),
    copy: (input) => skillInvokeMethods[IpcChannel.CopySkill](input),
    export: (input) => skillInvokeMethods[IpcChannel.ExportSkill](input),
    delete: (input) => skillInvokeMethods[IpcChannel.DeleteSkill](input),
    refreshDependencyGrant: (input) =>
      skillInvokeMethods[IpcChannel.RefreshSkillDependencyGrant](input),
    testRun: (input) => skillInvokeMethods[IpcChannel.TestSkillRun](input),
  },
  experts: {
    list: (input) => expertInvokeMethods[IpcChannel.ListExperts](input ?? {}),
    get: (input) => expertInvokeMethods[IpcChannel.GetExpert](input),
    create: (input) => expertInvokeMethods[IpcChannel.CreateExpert](input),
    saveRevision: (input) => expertInvokeMethods[IpcChannel.SaveExpertRevision](input),
    copy: (input) => expertInvokeMethods[IpcChannel.CopyExpert](input),
    setLifecycle: (input) => expertInvokeMethods[IpcChannel.SetExpertLifecycle](input),
    delete: (input) => expertInvokeMethods[IpcChannel.DeleteExpert](input),
  },
  taskContexts: {
    get: (input) => taskSupportInvokeMethods[IpcChannel.GetTaskContext](input),
    save: (input) => taskSupportInvokeMethods[IpcChannel.SaveTaskContext](input),
  },
  taskContinuity: {
    getBrief: (input) => taskSupportInvokeMethods[IpcChannel.GetTaskContinuityBrief](input),
    saveBrief: (input) => taskSupportInvokeMethods[IpcChannel.SaveTaskContinuityBrief](input),
  },
  discussionCheckpoints: {
    list: (input) => taskSupportInvokeMethods[IpcChannel.ListDiscussionCheckpoints](input),
    create: (input) => taskSupportInvokeMethods[IpcChannel.CreateDiscussionCheckpoint](input),
  },
  materials: {
    listCandidates: (input) =>
      taskSupportInvokeMethods[IpcChannel.ListTaskMaterialCandidates](input),
    prepareInputSnapshot: (input) =>
      taskSupportInvokeMethods[IpcChannel.PrepareWorkspaceInputSnapshot](input),
  },
  memories: {
    list: (input) => memoryInvokeMethods[IpcChannel.ListMemories](input ?? {}),
    get: (input) => memoryInvokeMethods[IpcChannel.GetMemory](input),
    create: (input) => memoryInvokeMethods[IpcChannel.CreateMemory](input),
    update: (input) => memoryInvokeMethods[IpcChannel.UpdateMemory](input),
    setStatus: (input) => memoryInvokeMethods[IpcChannel.SetMemoryStatus](input),
    resolveConflict: (input) => memoryInvokeMethods[IpcChannel.ResolveMemoryConflict](input),
    preview: (input) => memoryInvokeMethods[IpcChannel.PreviewMemory](input),
    taskExclusions: (input) => memoryInvokeMethods[IpcChannel.TaskMemoryExclusions](input),
    runContext: (input) => memoryInvokeMethods[IpcChannel.GetRunMemoryContext](input),
    getSettings: (input) => memoryInvokeMethods[IpcChannel.GetMemorySettings](input),
    setSettings: (input) => memoryInvokeMethods[IpcChannel.SetMemorySettings](input),
    listJobs: (input) => memoryInvokeMethods[IpcChannel.ListMemoryJobs](input ?? {}),
    retryJob: (input) => memoryInvokeMethods[IpcChannel.RetryMemoryJob](input),
    cancelJob: (input) => memoryInvokeMethods[IpcChannel.CancelMemoryJob](input),
    rebuildProjection: (input) => memoryInvokeMethods[IpcChannel.RebuildMemoryProjection](input),
  },
  mcp: {
    listConnections: () => mcpInvokeMethods[IpcChannel.ListMcpConnections]({}),
    getConnection: (input) => mcpInvokeMethods[IpcChannel.GetMcpConnection](input),
    saveConnection: (input) => mcpInvokeMethods[IpcChannel.SaveMcpConnection](input),
    deleteConnection: (input) => mcpInvokeMethods[IpcChannel.DeleteMcpConnection](input),
    testConnection: (input) => mcpInvokeMethods[IpcChannel.TestMcpConnection](input),
    setLifecycle: (input) => mcpInvokeMethods[IpcChannel.SetMcpLifecycle](input),
    reviewTool: (input) => mcpInvokeMethods[IpcChannel.ReviewMcpTool](input),
    cancelOperation: (input) => mcpInvokeMethods[IpcChannel.CancelMcpOperation](input),
    prepareLogin: (input) => mcpInvokeMethods[IpcChannel.PrepareMcpLogin](input),
    continueLogin: (input) => mcpInvokeMethods[IpcChannel.ContinueMcpLogin](input),
    logout: (input) => mcpInvokeMethods[IpcChannel.LogoutMcpConnection](input),
  },
  dependencies: {
    listOptions: (input) => dependencyInvokeMethods[IpcChannel.ListDependencyOptions](input ?? {}),
    inspectPlan: (input) => dependencyInvokeMethods[IpcChannel.InspectDependencyPlan](input),
    verifyEnvironment: (input) =>
      dependencyInvokeMethods[IpcChannel.VerifyDependencyEnvironment](input),
    prepare: (input) => dependencyInvokeMethods[IpcChannel.PrepareDependencyEnvironment](input),
    cancel: (input) => dependencyInvokeMethods[IpcChannel.CancelDependencyPreparation](input),
    getOperation: (input) => dependencyInvokeMethods[IpcChannel.GetDependencyOperation](input),
    chooseInterpreter: () => dependencyInvokeMethods[IpcChannel.ChoosePythonInterpreter]({}),
    registerToolchain: (input) =>
      dependencyInvokeMethods[IpcChannel.RegisterToolchainSnapshot](input),
    deleteToolchainSnapshot: (input) =>
      dependencyInvokeMethods[IpcChannel.DeleteToolchainSnapshot](input),
  },
};

contextBridge.exposeInMainWorld('betterwork', api);
