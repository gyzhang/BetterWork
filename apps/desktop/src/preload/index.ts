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
  [IpcChannel.GetRunSettings]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.GetRunSettings], input),
  [IpcChannel.SaveRunSettings]: (input) =>
    invokeContract(runInvokeContracts[IpcChannel.SaveRunSettings], input),
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

const api: BetterWorkDesktopApi = {
  runs: {
    start: (input) => runInvokeMethods[IpcChannel.StartRun](input),
    cancel: (input) => runInvokeMethods[IpcChannel.CancelRun](input),
    list: (input) => runInvokeMethods[IpcChannel.ListRuns](input),
    listEvents: (input) => runInvokeMethods[IpcChannel.ListRunEvents](input),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
        listener(agentRuntimeEventSchema.parse(raw));
      };
      ipcRenderer.on(IpcChannel.RunEvent, handler);
      return () => ipcRenderer.off(IpcChannel.RunEvent, handler);
    },
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
