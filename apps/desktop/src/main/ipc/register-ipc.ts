import { chmod, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  agentRuntimeEventSchema,
  artifactDetailSchema,
  artifactSummarySchema,
  artifactVersionDetailSchema,
  artifactVersionSummarySchema,
  cancelDependencyRequestSchema,
  cancelDependencyResultSchema,
  cancelledResultSchema,
  cancelMemoryJobRequestSchema,
  cancelRunRequestSchema,
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
  declareArtifactSourcesRequestSchema,
  deletedResultSchema,
  deleteKnowledgeCollectionRequestSchema,
  deleteMcpConnectionRequestSchema,
  deleteSkillRequestSchema,
  dependencyOperationSchema,
  dependencyOptionsSchema,
  dependencyPlanRequestSchema,
  dependencyPlanSchema,
  discussionCheckpointMutationResultSchema,
  discussionCheckpointSchema,
  evidenceSummarySchema,
  expertDetailSchema,
  expertMutationResultSchema,
  expertRevisionDraftSchema,
  expertSummarySchema,
  exportFileArtifactRequestSchema,
  type ExportFileArtifactResult,
  exportFileArtifactResultSchema,
  exportMarkdownArtifactRequestSchema,
  exportMarkdownArtifactResultSchema,
  exportSkillRequestSchema,
  fileArtifactDetailSchema,
  getArtifactRequestSchema,
  getArtifactThumbnailsRequestSchema,
  getArtifactThumbnailsResultSchema,
  getArtifactVersionRequestSchema,
  getDependencyOperationRequestSchema,
  getExpertRequestSchema,
  getFileArtifactRequestSchema,
  getMcpConnectionRequestSchema,
  getMemoryRequestSchema,
  getMemorySettingsRequestSchema,
  getRunArtifactDeclarationsRequestSchema,
  getRunMemoryContextRequestSchema,
  getSkillRequestSchema,
  getTaskContextRequestSchema,
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
  listSkillsRequestSchema,
  listTaskMaterialCandidatesRequestSchema,
  listTasksRequestSchema,
  listWorkspaceReferenceVersionsRequestSchema,
  markAllNotificationsReadRequestSchema,
  markNotificationReadRequestSchema,
  materialCandidateSchema,
  maximizedResultSchema,
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
  modelProfileIdSchema,
  modelProfileSummarySchema,
  modelSaveResultSchema,
  notificationSummarySchema,
  openFileArtifactRequestSchema,
  openFileArtifactResultSchema,
  openKnowledgeSourceRequestSchema,
  openKnowledgeSourceResultSchema,
  prepareDependencyRequestSchema,
  prepareDependencyResultSchema,
  prepareWorkspaceInputSnapshotRequestSchema,
  previewKnowledgeRequestSchema,
  previewMemoryRequestSchema,
  previewRunSourceRequestSchema,
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
  revokeSkillTrustRequestSchema,
  runArtifactSourceDeclarationSchema,
  runSourcePreviewSchema,
  runSummarySchema,
  saveExpertRevisionRequestSchema,
  saveKnowledgeCollectionRequestSchema,
  saveKnowledgeSettingsRequestSchema,
  saveMarkdownArtifactRequestSchema,
  saveMcpConnectionRequestSchema,
  saveModelProfileRequestSchema,
  saveSearchEngineRequestSchema,
  saveSkillRuntimeProfileRequestSchema,
  saveTaskContextRequestSchema,
  searchEngineSaveResultSchema,
  searchEngineSummarySchema,
  searchKnowledgeRequestSchema,
  setDefaultModelRequestSchema,
  setExpertLifecycleRequestSchema,
  setKnowledgeCollectionMembersRequestSchema,
  setMemorySettingsRequestSchema,
  setMemoryStatusRequestSchema,
  setModelEnabledRequestSchema,
  setSkillEnabledRequestSchema,
  setSkillTrustRequestSchema,
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
  testModelRequestSchema,
  testSearchEngineRequestSchema,
  testSkillRunRequestSchema,
  testSkillRunResultSchema,
  unreadCountResultSchema,
  updatedResultSchema,
  updateMemoryRequestSchema,
  updateWindowThemeRequestSchema,
  voidResultSchema,
  windowToggleMaximizeRequestSchema,
  workspaceBriefSchema,
  workspaceMemoryBriefRequestSchema,
  workspaceMemorySettingsSchema,
  workspaceReferenceListDataSchema,
  workspaceReferenceSetDataSchema,
  workspaceSummarySchema,
} from '@betterwork/agent-protocol';
import { type BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import { z, type ZodTypeAny } from 'zod';

import { createNodeFileSystem } from '../infrastructure/dependency-adapters';
import { listDependencyLocks, loadDependencyLock } from '../infrastructure/dependency-lock-catalog';
import type { AppStore } from '../persistence';
import { API_KEY_SLOT } from '../persistence/credential-repository';
import { ArtifactDeclarationService } from '../services/artifact-declaration-service';
import { type CredentialProvisioner, type CredentialResolver } from '../services/credential-access';
import type { DiscussionCheckpointService } from '../services/discussion-checkpoint-service';
import type { ExpertService } from '../services/expert-service';
import type { FileArtifactService } from '../services/file-artifact-service';
import { KnowledgeAudit } from '../services/knowledge-audit';
import type { KnowledgeIndexService } from '../services/knowledge-index-service';
import type { KnowledgeSearchService } from '../services/knowledge-search';
import type { KnowledgeVault } from '../services/knowledge-vault';
import type { McpClientService } from '../services/mcp-client-service';
import type { MemoryExtractionService } from '../services/memory-extraction-service';
import type { MemoryRecallService } from '../services/memory-recall-service';
import type { MemoryService } from '../services/memory-service';
import { probeModelConnection } from '../services/model-connectivity';
import type { NotificationService } from '../services/notification-service';
import { ResearchDraftService } from '../services/research-draft-service';
import type { RunService } from '../services/run-service';
import { createQianfanSearchClient } from '../services/search-engine-service';
import {
  computeDependencyLockHash,
  type SkillDependencyService,
} from '../services/skill-dependency-service';
import type { SkillService } from '../services/skill-service';
import type { TaskMaterialService } from '../services/task-material-service';
import type { ToolchainSnapshotService } from '../services/toolchain-snapshot-service';
import type { WorkspaceBriefService } from '../services/workspace-memory-brief-service';
import type { WorkspaceReferenceService } from '../services/workspace-reference-service';

export interface IpcDependencies {
  readonly store: AppStore;
  readonly knowledgeVault: KnowledgeVault;
  readonly knowledgeIndex: KnowledgeIndexService;
  readonly knowledgeSearch: KnowledgeSearchService;
  readonly taskMaterials: TaskMaterialService;
  readonly notifications: NotificationService;
  readonly runs: RunService;
  /** 凭据入口（Main 侧）：供保存双写与连接测试的新读优先；缺省时保持旧行为。 */
  readonly credentialAccess?: CredentialResolver & CredentialProvisioner;
  readonly skillService: SkillService;
  readonly expertService: ExpertService;
  readonly discussionCheckpoints: DiscussionCheckpointService;
  readonly memories: MemoryService;
  /** 召回与运行上下文都是纯读：预览绝不写 run_memory_reads（契约 §9.2）。 */
  readonly memoryRecall: MemoryRecallService;
  /** 提炼设置与作业只影响候选生成，不阻塞任何 Run 终态。 */
  readonly memoryExtractions: MemoryExtractionService;
  readonly workspaceBrief: WorkspaceBriefService;
  readonly workspaceReferences: WorkspaceReferenceService;
  readonly mcpClientService: McpClientService;
  readonly dependencies: SkillDependencyService;
  readonly snapshots: ToolchainSnapshotService;
  readonly fileArtifactService?: FileArtifactService;
  /** 随包依赖锁目录：开发态在仓库 resources 下，打包后在安装资源里。 */
  readonly dependencyLocksRoot: string;
  readonly getWindow: () => BrowserWindow | null;
  /** 默认工作区根目录；开发态指向仓库根，打包后指向用户文档目录。 */
  readonly getDefaultWorkspaceRoot: () => string;
}

/** 导出文件名里不能出现的字符，统一替换为连字符。 */
const sanitizeFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|]/gu, '-').trim() || '算台成果';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 协议层没有为「无入参」通道单独定义 Schema 时用它，语义与 clearNotifications 等一致。 */
const emptyRequestSchema = z.object({}).strict();

/**
 * 注册一个带边界校验的 invoke channel。
 * 所有 IPC 入参都必须走这三个 helper 之一——协议层的 Zod Schema 是唯一真相源，
 * 不允许任何 handler 自行解析 raw 参数。
 */
function handleInput<Schema extends ZodTypeAny, Result>(
  channel: string,
  schema: Schema,
  responseSchema: ZodTypeAny,
  handler: (input: z.output<Schema>) => Result | Promise<Result>,
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) =>
    responseSchema.parse(await handler(schema.parse(raw))),
  );
}

/** 入参可整体省略的 channel（例如「列出全部或按某个 id 过滤」）。 */
function handleOptionalInput<Schema extends ZodTypeAny, Result>(
  channel: string,
  schema: Schema,
  responseSchema: ZodTypeAny,
  handler: (input: z.output<Schema>) => Result | Promise<Result>,
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) =>
    responseSchema.parse(await handler(schema.parse(raw ?? {}))),
  );
}

/** 入参必须为空的 channel，防止 Renderer 悄悄夹带字段。 */
function handleNoInput<Result>(
  channel: string,
  schema: ZodTypeAny,
  responseSchema: ZodTypeAny,
  handler: () => Result | Promise<Result>,
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    schema.parse(raw ?? {});
    return responseSchema.parse(await handler());
  });
}

/** 对话框的父窗口；窗口还没就绪或已销毁时返回 undefined，对话框依然可用。 */
function dialogParent(deps: IpcDependencies): BrowserWindow | undefined {
  const window = deps.getWindow();
  return window && !window.isDestroyed() ? window : undefined;
}

// Electron 的对话框重载不接受 undefined 父窗口，只能按有无父窗口分支调用。
function showOpenDialog(
  deps: IpcDependencies,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  const parent = dialogParent(deps);
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

function showSaveDialog(
  deps: IpcDependencies,
  options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  const parent = dialogParent(deps);
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
}

export function registerIpc(deps: IpcDependencies): void {
  registerRunChannels(deps);
  registerWorkspaceAndTaskChannels(deps);
  registerArtifactChannels(deps);
  registerModelChannels(deps);
  registerKnowledgeChannels(deps);
  registerSearchEngineChannels(deps);
  registerSkillChannels(deps);
  registerExpertChannels(deps);
  registerDiscussionCheckpointChannels(deps);
  registerMemoryChannels(deps);
  registerWorkspaceMemoryChannels(deps);
  registerMcpChannels(deps);
  registerDependencyChannels(deps);
  registerNotificationChannels(deps);
  registerWindowChannels(deps);
}

function registerRunChannels({ store, runs }: IpcDependencies): void {
  handleInput(IpcChannel.StartRun, startRunRequestSchema, startRunResultSchema, (input) => ({
    runId: runs.start(input),
  }));
  handleInput(IpcChannel.CancelRun, cancelRunRequestSchema, cancelledResultSchema, (input) => ({
    cancelled: runs.cancel(input.runId),
  }));
  handleInput(
    IpcChannel.ListRunEvents,
    listRunEventsRequestSchema,
    z.array(agentRuntimeEventSchema),
    (input) => store.runs.listEvents(input.runId),
  );
  handleOptionalInput(
    IpcChannel.ListRuns,
    listRunsRequestSchema,
    z.array(runSummarySchema),
    (input) => {
      const runs = store.runs.list(input.taskId);
      return runs.map((run) => {
        const bindings = store.executions.listBindingSummariesForRun(run.id);
        return bindings.length > 0 ? { ...run, bindings } : run;
      });
    },
  );
}

function registerWorkspaceAndTaskChannels(deps: IpcDependencies): void {
  const { store, getDefaultWorkspaceRoot, taskMaterials } = deps;

  handleNoInput(IpcChannel.GetDefaultWorkspace, emptyRequestSchema, workspaceSummarySchema, () =>
    store.workspaces.getOrCreate(getDefaultWorkspaceRoot(), '我的工作区'),
  );

  handleNoInput(
    IpcChannel.SelectWorkspace,
    emptyRequestSchema,
    workspaceSummarySchema.nullable(),
    async () => {
      const result = await showOpenDialog(deps, {
        title: '选择工作区',
        properties: ['openDirectory', 'createDirectory'],
      });
      const rootPath = result.filePaths[0];
      if (result.canceled || !rootPath) return null;
      return store.workspaces.getOrCreate(rootPath, path.basename(rootPath));
    },
  );

  handleNoInput(
    IpcChannel.ListWorkspaces,
    emptyRequestSchema,
    z.array(workspaceSummarySchema),
    () => store.workspaces.listAll(),
  );

  handleInput(IpcChannel.CreateTask, createTaskRequestSchema, createdTaskSchema, (input) =>
    store.tasks.create(input.workspaceId, input.title, input.goal),
  );
  handleOptionalInput(
    IpcChannel.ListTasks,
    listTasksRequestSchema,
    z.array(recentTaskSummarySchema),
    (input) => store.tasks.listRecent(input.workspaceId),
  );
  handleInput(
    IpcChannel.ListEvidence,
    listEvidenceRequestSchema,
    z.array(evidenceSummarySchema),
    (input) => store.evidence.listByTask(input.taskId),
  );
  handleInput(
    IpcChannel.GetTaskContext,
    getTaskContextRequestSchema,
    taskContextRevisionSchema.nullable(),
    (input) => store.taskContexts.getLatest(input.taskId) ?? null,
  );
  handleInput(
    IpcChannel.SaveTaskContext,
    saveTaskContextRequestSchema,
    taskContextMutationResultSchema,
    async (input) => {
      await taskMaterials.validateSelections(input.taskId, input.materials ?? []);
      return {
        context: store.taskContexts.save(
          input.taskId,
          {
            executor: input.executor,
            skillBindings: input.skillBindings,
            ...(input.modelReference ? { modelReference: input.modelReference } : {}),
            ...(input.builtinToolPolicy ? { builtinToolPolicy: input.builtinToolPolicy } : {}),
            ...(input.materials ? { materials: input.materials } : {}),
            ...(input.excludedMemoryIds ? { excludedMemoryIds: input.excludedMemoryIds } : {}),
            ...(input.mcpToolBindings ? { mcpToolBindings: input.mcpToolBindings } : {}),
          },
          input.expectedRevision,
        ),
      };
    },
  );
  handleInput(
    IpcChannel.ListTaskMaterialCandidates,
    listTaskMaterialCandidatesRequestSchema,
    z.array(materialCandidateSchema),
    (input) => {
      if (input.taskId) return taskMaterials.listCandidates(input.taskId);
      if (!input.workspaceId) throw new Error('缺少工作空间标识。');
      return taskMaterials.listCandidatesForWorkspace(input.workspaceId);
    },
  );
  handleInput(
    IpcChannel.PrepareWorkspaceInputSnapshot,
    prepareWorkspaceInputSnapshotRequestSchema,
    inputSnapshotSchema.nullable(),
    async (input) => {
      const workspaceId = input.taskId
        ? store.tasks.getWorkspaceId(input.taskId)
        : input.workspaceId;
      const workspaceRoot = workspaceId ? store.workspaces.get(workspaceId)?.rootPath : undefined;
      const result = await showOpenDialog(deps, {
        title: '选择本次工作需要的文件',
        properties: ['openFile'],
        ...(workspaceRoot ? { defaultPath: workspaceRoot } : {}),
      });
      const sourcePath = result.filePaths[0];
      if (result.canceled || !sourcePath) return null;
      if (input.taskId) return taskMaterials.prepareInputSnapshot(input.taskId, sourcePath);
      if (!input.workspaceId) throw new Error('缺少工作空间标识。');
      return taskMaterials.prepareInputSnapshotForWorkspace(input.workspaceId, sourcePath);
    },
  );
}

function registerDiscussionCheckpointChannels({ discussionCheckpoints }: IpcDependencies): void {
  handleInput(
    IpcChannel.ListDiscussionCheckpoints,
    listDiscussionCheckpointsRequestSchema,
    discussionCheckpointSchema.array(),
    (input) => discussionCheckpoints.list(input.taskId),
  );
  handleInput(
    IpcChannel.CreateDiscussionCheckpoint,
    createDiscussionCheckpointRequestSchema,
    discussionCheckpointMutationResultSchema,
    (input) => ({ checkpoint: discussionCheckpoints.create(input.taskId, input) }),
  );
}

function registerArtifactChannels(deps: IpcDependencies): void {
  const { store } = deps;

  handleOptionalInput(
    IpcChannel.ListArtifacts,
    listArtifactsRequestSchema,
    z.array(artifactSummarySchema),
    (input) => store.artifacts.list(input.taskId),
  );
  handleInput(
    IpcChannel.GetArtifact,
    getArtifactRequestSchema,
    artifactDetailSchema.nullable(),
    (input) => {
      const detail = store.artifacts.getDetail(input.id);
      if (!detail) return null;
      const inputRelations = store.artifactInputRelations.listByVersion(detail.currentVersionId);
      return inputRelations.length > 0 ? { ...detail, inputRelations } : detail;
    },
  );
  handleInput(
    IpcChannel.ListArtifactVersions,
    listArtifactVersionsRequestSchema,
    z.array(artifactVersionSummarySchema),
    (input) => store.artifacts.listVersions(input.artifactId),
  );
  handleInput(
    IpcChannel.GetArtifactVersion,
    getArtifactVersionRequestSchema,
    artifactVersionDetailSchema.nullable(),
    (input) => {
      const detail = store.artifacts.getVersionDetail(input.id);
      if (!detail) return null;
      const inputRelations = store.artifactInputRelations.listByVersion(detail.id);
      return inputRelations.length > 0 ? { ...detail, inputRelations } : detail;
    },
  );
  const declarations = new ArtifactDeclarationService(store);
  handleInput(
    IpcChannel.SaveMarkdownArtifact,
    saveMarkdownArtifactRequestSchema,
    artifactSummarySchema,
    (input) => {
      // 声明种类由宿主判定；校验先于事务，失败时不留半版本（知识契约 §6.1）。
      const previousVersionId = input.artifactId
        ? store.artifacts.getDetail(input.artifactId)?.currentVersionId
        : undefined;
      const plan = declarations.planForWrite(
        input.origin,
        input.runId,
        previousVersionId,
        input.inputRelations ?? null,
      );
      return store.transaction(() => {
        const saved = store.artifacts.saveMarkdown(input, plan.kind);
        if (plan.copyRelationsFromVersionId) {
          store.artifactInputRelations.inheritFromVersion(
            saved.currentVersionId,
            plan.copyRelationsFromVersionId,
            plan.kind,
          );
          return saved;
        }
        if (!plan.inputs || plan.inputs.length === 0) return saved;
        store.artifactInputRelations.saveForRun(
          saved.currentVersionId,
          plan.runId,
          plan.inputs,
          declarations.wasReadDuring,
          plan.kind === 'user' ? 'user' : 'model',
        );
        return saved;
      });
    },
  );
  handleInput(
    IpcChannel.ExportMarkdownArtifact,
    exportMarkdownArtifactRequestSchema,
    exportMarkdownArtifactResultSchema,
    async (input) => exportMarkdown(deps, input.artifactId, input.versionId),
  );
  handleInput(
    IpcChannel.GetFileArtifact,
    getFileArtifactRequestSchema,
    fileArtifactDetailSchema.nullable(),
    (input) => {
      const detail = store.artifacts.getDetail(input.artifactId);
      if (!detail || detail.type !== 'presentation') return null;
      if (!input.versionId) return detail;
      if (!store.artifacts.versionBelongsToArtifact(input.versionId, input.artifactId)) return null;
      const version = store.artifacts.getVersionDetail(input.versionId);
      if (!version || version.type !== 'presentation') return null;
      const inputRelations = store.artifactInputRelations.listByVersion(version.id);
      return {
        ...detail,
        fileHash: version.fileHash,
        fileKey: version.fileKey,
        validation: version.validation,
        ...(version.description ? { description: version.description } : {}),
        evidence: version.evidence,
        ...(inputRelations.length > 0 ? { inputRelations } : {}),
      };
    },
  );
  handleInput(
    IpcChannel.RegisterFileArtifact,
    registerFileArtifactRequestSchema,
    registerFileArtifactResultSchema,
    async (input) => {
      const { fileArtifactService } = deps;
      if (!fileArtifactService) throw new Error('File artifact service is not available');
      const relations = input.inputRelations ?? [];
      if (relations.length > 0) declarations.validate(relations, input.runId);
      const result = await fileArtifactService.register({
        runId: input.runId,
        executionId: input.executionId,
        outputId: input.outputId,
        ...(input.artifactId ? { artifactId: input.artifactId } : {}),
        title: input.title,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.validation ? { validation: input.validation } : {}),
        inputRelations: relations,
      });
      return result;
    },
  );
  handleInput(
    IpcChannel.ExportFileArtifact,
    exportFileArtifactRequestSchema,
    exportFileArtifactResultSchema,
    async (input) => exportFileArtifact(deps, input.artifactId, input.versionId),
  );
  handleInput(
    IpcChannel.OpenFileArtifact,
    openFileArtifactRequestSchema,
    openFileArtifactResultSchema,
    async (input) => {
      const { store, fileArtifactService } = deps;
      if (!fileArtifactService) throw new Error('File artifact service is not available');
      const artifact = store.artifacts.getDetail(input.artifactId);
      if (!artifact || artifact.type !== 'presentation')
        return { opened: false, error: '该成果不存在或不是文件类型。' };
      const resolvedVersionId = input.versionId ?? artifact.currentVersionId;
      if (
        input.versionId &&
        !store.artifacts.versionBelongsToArtifact(input.versionId, input.artifactId)
      ) {
        return { opened: false, error: '该版本不属于此成果。' };
      }
      const storedPath = fileArtifactService.resolveStoredPath(resolvedVersionId);
      const error = await shell.openPath(storedPath);
      return error ? { opened: false, error } : { opened: true };
    },
  );
  handleInput(
    IpcChannel.GetArtifactThumbnails,
    getArtifactThumbnailsRequestSchema,
    getArtifactThumbnailsResultSchema,
    async (input) => {
      const { store, fileArtifactService } = deps;
      if (!fileArtifactService) throw new Error('File artifact service is not available');
      const artifact = store.artifacts.getDetail(input.artifactId);
      if (!artifact || artifact.type !== 'presentation')
        return { thumbnails: [], error: '该成果不存在或不是文件类型。' };
      const resolvedVersionId = input.versionId ?? artifact.currentVersionId;
      if (
        input.versionId &&
        !store.artifacts.versionBelongsToArtifact(input.versionId, input.artifactId)
      ) {
        return { thumbnails: [], error: '该版本不属于此成果。' };
      }
      return fileArtifactService.generateThumbnails(resolvedVersionId);
    },
  );
}

/**
 * 导出当前版本或指定历史版本为 Markdown 文件。
 * 版本必须先校验归属，否则可以借导出通道读到其他成果的内容。
 * 用户取消不算失败，不发通知；写盘失败与成功都落消息中心。
 */
async function exportMarkdown(
  deps: IpcDependencies,
  artifactId: string,
  versionId: string | undefined,
): Promise<{ cancelled: boolean; filePath?: string }> {
  const { store, notifications } = deps;
  const artifact = store.artifacts.getDetail(artifactId);
  if (!artifact) throw new Error('Artifact does not exist');
  if (artifact.type !== 'markdown') throw new Error('Artifact is not a markdown artifact');

  const version = versionId ? store.artifacts.getVersionDetail(versionId) : undefined;
  if (versionId && (!version || version.artifactId !== artifactId)) {
    throw new Error('Artifact version does not belong to artifact');
  }
  if (version && !('content' in version))
    throw new Error('Artifact version is not a markdown version');
  const content = version && 'content' in version ? version.content : artifact.content;

  const result = await showSaveDialog(deps, {
    title: '导出 Markdown 成果',
    defaultPath: `${sanitizeFileName(artifact.title)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return { cancelled: true };

  try {
    await writeFile(result.filePath, content, 'utf8');
  } catch (error) {
    notifications.create({
      level: 'error',
      kind: 'artifact',
      title: `导出「${artifact.title}」失败`,
      detail: describeError(error),
      target: { kind: 'artifact', artifactId: artifact.id },
    });
    throw error;
  }

  notifications.create({
    level: 'success',
    kind: 'artifact',
    title: `已导出「${artifact.title}」`,
    detail: result.filePath,
    target: { kind: 'artifact', artifactId: artifact.id },
  });
  return { cancelled: false, filePath: result.filePath };
}

/**
 * 导出文件成果到用户选择的路径。
 * 版本归属校验与 Markdown 导出一致；文件来源由 FileArtifactService 的不可变存储提供。
 */
async function exportFileArtifact(
  deps: IpcDependencies,
  artifactId: string,
  versionId: string | undefined,
): Promise<ExportFileArtifactResult> {
  const { store, notifications, fileArtifactService } = deps;
  if (!fileArtifactService) throw new Error('File artifact service is not available');

  const artifact = store.artifacts.getDetail(artifactId);
  if (!artifact || artifact.type !== 'presentation')
    throw new Error('File artifact does not exist');

  const resolvedVersionId = versionId ?? artifact.currentVersionId;
  if (versionId) {
    const version = store.artifacts.getVersionDetail(versionId);
    if (!version || version.artifactId !== artifactId) {
      throw new Error('Artifact version does not belong to artifact');
    }
  }

  const extension = mimeToExtension(artifact.mimeType);
  const result = await showSaveDialog(deps, {
    title: '导出文件成果',
    defaultPath: `${sanitizeFileName(artifact.title)}.${extension}`,
    filters: [
      { name: extension.toUpperCase(), extensions: [extension] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { cancelled: true };

  const sourcePath = fileArtifactService.resolveStoredPath(resolvedVersionId);
  try {
    // 保存面板在某些 macOS 版本会先创建一个 0400 目标文件；先提升权限，
    // 否则 copyFile 无法覆盖这个已存在的只读占位文件。
    try {
      await chmod(result.filePath, 0o600);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await copyFile(sourcePath, result.filePath);
    // 成果源文件为不可变存储（0400）；导出是用户自己的工作副本，必须可继续编辑。
    // 保存面板可能已提前创建目标文件，单靠 copyFile 不会提升它的权限。
    await chmod(result.filePath, 0o600);
  } catch (error) {
    notifications.create({
      level: 'error',
      kind: 'artifact',
      title: `导出「${artifact.title}」失败`,
      detail: describeError(error),
      target: { kind: 'artifact', artifactId: artifact.id },
    });
    throw error;
  }

  notifications.create({
    level: 'success',
    kind: 'artifact',
    title: `已导出「${artifact.title}」`,
    detail: result.filePath,
    target: { kind: 'artifact', artifactId: artifact.id },
  });
  return { cancelled: false, filePath: result.filePath };
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

function mimeToExtension(mimeType: string): string {
  return MIME_EXTENSION_MAP[mimeType] ?? 'bin';
}

function registerModelChannels({ store, credentialAccess }: IpcDependencies): void {
  handleNoInput(IpcChannel.ListModels, emptyRequestSchema, z.array(modelProfileSummarySchema), () =>
    store.models.list(),
  );
  handleInput(
    IpcChannel.SaveModel,
    saveModelProfileRequestSchema,
    modelSaveResultSchema,
    async (input) => {
      const id = store.models.save(input);
      if (credentialAccess && input.apiKey) {
        const ref = { ownerKind: 'model-profile', ownerId: id, slot: API_KEY_SLOT } as const;
        await credentialAccess.provision(ref, input.apiKey);
        // 密文已落库就不再留明文副本；没有受保护存储时保留明文作为唯一可用路径。
        if (credentialAccess.hasSecret(ref)) store.models.clearPlaintextApiKey(id);
      }
      return { id };
    },
  );
  handleInput(IpcChannel.DeleteModel, modelProfileIdSchema, deletedResultSchema, (input) => ({
    deleted: store.models.delete(input.id),
  }));
  handleInput(
    IpcChannel.SetDefaultModel,
    setDefaultModelRequestSchema,
    updatedResultSchema,
    (input) => ({
      updated: store.models.setDefault(input.id),
    }),
  );
  handleInput(
    IpcChannel.SetModelEnabled,
    setModelEnabledRequestSchema,
    updatedResultSchema,
    (input) => ({
      updated: store.models.setEnabled(input.id, input.enabled),
    }),
  );

  handleInput(
    IpcChannel.TestModel,
    testModelRequestSchema,
    connectionTestResultSchema,
    async (input) => {
      // 编辑既有配置时允许留空 Key，表示沿用已保存的凭据；已迁移的凭据从 credentials 新读优先。
      const stored = input.id ? store.models.getWithSecret(input.id) : undefined;
      let storedKey = stored?.apiKey ?? '';
      if (input.id && credentialAccess && !storedKey) {
        const ref = { ownerKind: 'model-profile', ownerId: input.id, slot: API_KEY_SLOT } as const;
        if (credentialAccess.migrationStatus(ref) === 'done') {
          storedKey = await credentialAccess.resolveSecret(ref);
        }
      }
      const result = await probeModelConnection({
        baseUrl: input.baseUrl,
        model: input.model,
        role: input.role,
        apiKey: input.apiKey || storedKey,
      });
      if (input.id) store.models.recordConnection(input.id, result.ok ? 'connected' : 'failed');
      return result;
    },
  );
}

function registerKnowledgeChannels(deps: IpcDependencies): void {
  const { knowledgeIndex, knowledgeSearch, knowledgeVault, store } = deps;

  handleInput(
    IpcChannel.ListKnowledge,
    listKnowledgeRequestSchema,
    z.array(knowledgeDocumentSummarySchema),
    (input) => knowledgeVault.listDocuments(input.filter),
  );

  handleNoInput(
    IpcChannel.ListKnowledgeCollections,
    emptyRequestSchema,
    z.array(knowledgeCollectionSchema),
    () => knowledgeVault.listCollections(),
  );

  handleInput(
    IpcChannel.SaveKnowledgeCollection,
    saveKnowledgeCollectionRequestSchema,
    z.array(knowledgeCollectionSchema),
    (input) => knowledgeVault.saveCollection(input),
  );

  handleInput(
    IpcChannel.DeleteKnowledgeCollection,
    deleteKnowledgeCollectionRequestSchema,
    z.array(knowledgeCollectionSchema),
    (input) => knowledgeVault.deleteCollection(input),
  );

  handleInput(
    IpcChannel.SetKnowledgeCollectionMembers,
    setKnowledgeCollectionMembersRequestSchema,
    knowledgeCollectionMembersResultSchema,
    (input) => knowledgeVault.setCollectionMembers(input),
  );

  handleNoInput(
    IpcChannel.ImportKnowledge,
    emptyRequestSchema,
    knowledgeImportAckSchema,
    async () => {
      const result = await showOpenDialog(deps, {
        title: '导入本地资料',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '资料文件', extensions: ['md', 'markdown', 'txt', 'text', 'pdf', 'docx'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      // 取消文件对话框不创建作业，也不留下任何半成品索引。
      if (result.canceled) return { cancelled: true };
      return { cancelled: false, jobId: knowledgeIndex.startImport(result.filePaths).jobId };
    },
  );

  handleInput(
    IpcChannel.SearchKnowledge,
    searchKnowledgeRequestSchema,
    knowledgeSearchResponseSchema,
    (input) =>
      knowledgeSearch.search({
        scope: {
          kind: 'library',
          ...(input.filter?.kind === 'collection'
            ? { collectionId: input.filter.collectionId }
            : input.filter?.kind === 'uncategorized'
              ? { uncategorized: true }
              : {}),
        },
        query: input.query,
        ...(input.mode ? { mode: input.mode } : {}),
      }),
  );

  handleInput(
    IpcChannel.OpenKnowledgeSource,
    openKnowledgeSourceRequestSchema,
    openKnowledgeSourceResultSchema,
    async (input) => {
      // 只打开已登记的来源：白名单校验在主进程，Renderer 无法让它打开任意路径
      const sourcePath = knowledgeVault.getRegisteredSourcePath(input.sourcePath);
      if (!sourcePath) return { opened: false, error: '该文件不在当前知识库中，无法打开。' };
      const error = await shell.openPath(sourcePath);
      return error ? { opened: false, error } : { opened: true };
    },
  );

  handleInput(
    IpcChannel.RemoveKnowledgeDocument,
    removeKnowledgeDocumentRequestSchema,
    removedResultSchema,
    (input) => ({
      removed: knowledgeVault.removeDocument(input.id),
    }),
  );
  handleInput(
    IpcChannel.RefreshKnowledgeDocument,
    refreshKnowledgeDocumentRequestSchema,
    knowledgeJobAckSchema,
    (input) => knowledgeIndex.startRefresh(input.id),
  );
  handleOptionalInput(
    IpcChannel.ListKnowledgeJobs,
    listKnowledgeJobsRequestSchema,
    knowledgeJobPageSchema,
    (input) => knowledgeIndex.listJobs(input),
  );
  handleInput(
    IpcChannel.GetKnowledgeJob,
    knowledgeJobIdRequestSchema,
    knowledgeJobDetailSchema.nullable(),
    (input) => knowledgeIndex.jobDetail(input.jobId) ?? null,
  );
  handleInput(
    IpcChannel.CancelKnowledgeJob,
    knowledgeJobIdRequestSchema,
    knowledgeJobCancelResultSchema,
    (input) => ({ cancelled: knowledgeIndex.cancelJob(input.jobId) !== undefined }),
  );
  handleInput(
    IpcChannel.RetryKnowledgeJob,
    retryKnowledgeJobRequestSchema,
    knowledgeJobAckSchema,
    (input) => knowledgeIndex.retryJob(input.jobId, input.itemIds),
  );
  handleNoInput(
    IpcChannel.GetKnowledgeSettings,
    emptyRequestSchema,
    knowledgeSearchSettingsSchema,
    () => knowledgeIndex.getSettings(),
  );
  handleInput(
    IpcChannel.SaveKnowledgeSettings,
    saveKnowledgeSettingsRequestSchema,
    knowledgeSearchSettingsSchema,
    (input) => knowledgeIndex.saveSettings(input),
  );
  handleInput(
    IpcChannel.RebuildKnowledgeIndex,
    rebuildKnowledgeIndexRequestSchema,
    knowledgeJobAckSchema,
    (input) =>
      input.kind === 'keyword'
        ? knowledgeIndex.startRebuildKeyword(input)
        : knowledgeIndex.startRebuildSemantic(input),
  );
  handleInput(
    IpcChannel.CheckKnowledgeSources,
    checkKnowledgeSourcesRequestSchema,
    knowledgeJobAckSchema,
    (input) => knowledgeIndex.startCheckSources(input),
  );
  handleInput(
    IpcChannel.ListKnowledgeRevisions,
    listKnowledgeRevisionsRequestSchema,
    z.array(knowledgeRevisionSummarySchema),
    (input) => knowledgeVault.listRevisions(input.documentId),
  );
  handleInput(
    IpcChannel.PreviewKnowledge,
    previewKnowledgeRequestSchema,
    knowledgeTextPageSchema,
    (input) =>
      knowledgeVault.previewRevision(
        input.documentId,
        input.revisionId,
        input.cursor,
        input.maxCodePoints,
      ),
  );
  handleInput(
    IpcChannel.PreviewRunSource,
    previewRunSourceRequestSchema,
    runSourcePreviewSchema,
    (input) =>
      new KnowledgeAudit(store, knowledgeVault, (searchInput) =>
        knowledgeSearch.search(searchInput),
      ).previewRunSource(input.runId, input.evidenceId),
  );
  handleInput(
    IpcChannel.CreateResearchDraft,
    knowledgeCreateResearchDraftRequestSchema,
    knowledgeResearchDraftResultSchema,
    (input) => new ResearchDraftService(store, knowledgeVault).create(input),
  );
  handleInput(
    IpcChannel.DeclareArtifactSources,
    declareArtifactSourcesRequestSchema,
    runArtifactSourceDeclarationSchema,
    (input) => new ArtifactDeclarationService(store).declare(input.runId, input.inputRelations),
  );
  handleInput(
    IpcChannel.GetRunArtifactDeclarations,
    getRunArtifactDeclarationsRequestSchema,
    runArtifactSourceDeclarationSchema.nullable(),
    (input) => store.runArtifactDeclarations.get(input.runId) ?? null,
  );
}

function registerSearchEngineChannels({ store, credentialAccess }: IpcDependencies): void {
  handleNoInput(
    IpcChannel.ListSearchEngines,
    emptyRequestSchema,
    z.array(searchEngineSummarySchema),
    () => store.searchEngines.list(),
  );
  handleInput(
    IpcChannel.SaveSearchEngine,
    saveSearchEngineRequestSchema,
    searchEngineSaveResultSchema,
    async (input) => {
      const provider = store.searchEngines.save(input);
      if (credentialAccess && input.apiKey) {
        const ref = {
          ownerKind: 'api-service-profile',
          ownerId: provider,
          slot: API_KEY_SLOT,
        } as const;
        await credentialAccess.provision(ref, input.apiKey);
        // 与模型侧同一规则：凭据已加密入库后，明文列不得继续留副本。
        if (credentialAccess.hasSecret(ref)) store.searchEngines.clearPlaintextApiKey(provider);
      }
      return { provider };
    },
  );

  handleInput(
    IpcChannel.TestSearchEngine,
    testSearchEngineRequestSchema,
    connectionTestResultSchema,
    async (input) => {
      const stored = store.searchEngines.get(input.provider);
      let apiKey = input.apiKey || (stored?.apiKey ?? '');
      // 已迁移的搜索凭据从 credentials 新读优先（明文列已清空）。
      if (!apiKey && credentialAccess) {
        const ref = {
          ownerKind: 'api-service-profile',
          ownerId: input.provider,
          slot: API_KEY_SLOT,
        } as const;
        if (credentialAccess.migrationStatus(ref) === 'done') {
          apiKey = await credentialAccess.resolveSecret(ref);
        }
      }
      if (!apiKey) return { ok: false, message: '请先填写 API Key。' };
      const result = await createQianfanSearchClient({ apiKey, webTopK: input.webTopK }).test();
      // 只把用户本次输入的 Key 交给落库（用于「先测试、后保存」时建行）；
      // 从 credentials 解出的密钥绝不能回到明文列（CF11 发现一）。
      store.searchEngines.recordConnection(
        input.provider,
        result.ok ? 'connected' : 'failed',
        input.apiKey,
      );
      return result;
    },
  );
}

function skillSummary(skill: ReturnType<SkillService['setTrustPreference']>) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourceKind: skill.sourceKind,
    enabled: skill.enabled,
    currentRevisionId: skill.currentRevisionId,
    trustStatus: skill.trustStatus,
    environmentStatus: skill.environmentStatus,
    blockedReasons: skill.blockedReasons,
  };
}

function registerSkillChannels(deps: IpcDependencies): void {
  const { skillService, store, runs } = deps;
  handleNoInput(IpcChannel.ListSkills, listSkillsRequestSchema, z.array(skillSummarySchema), () =>
    store.skills.list(),
  );
  handleInput(
    IpcChannel.GetSkill,
    getSkillRequestSchema,
    skillDetailSchema.nullable(),
    (input) => store.skills.get(input.id) ?? null,
  );
  handleNoInput(
    IpcChannel.ImportSkill,
    importSkillRequestSchema,
    skillImportResultSchema,
    async () => {
      const result = await showOpenDialog(deps, {
        title: '导入 Skill',
        properties: ['openDirectory'],
      });
      const sourceRoot = result.filePaths[0];
      if (result.canceled || !sourceRoot) return { cancelled: true };
      const imported = await skillService.importDirectory(sourceRoot);
      return { cancelled: false, skill: skillSummary(imported.skill) };
    },
  );
  handleInput(
    IpcChannel.SaveSkillRuntimeProfile,
    saveSkillRuntimeProfileRequestSchema,
    skillMutationResultSchema,
    (input) => ({
      skill: skillSummary(skillService.saveRuntimeProfile(input.skillId, input.profile)),
    }),
  );
  handleInput(
    IpcChannel.SetSkillTrust,
    setSkillTrustRequestSchema,
    skillMutationResultSchema,
    async (input) => {
      const updated = skillService.setTrustPreference(input.skillId, input.trusted);
      if (!input.trusted) await runs.cancelRunsForSkill(input.skillId);
      return { skill: skillSummary(updated) };
    },
  );
  handleInput(
    IpcChannel.RevokeSkillTrust,
    revokeSkillTrustRequestSchema,
    skillMutationResultSchema,
    async (input) => {
      await skillService.revokeTrust(input.skillId, {
        cancelForSkill: (skillId) => runs.cancelRunsForSkill(skillId),
      });
      const skill = store.skills.get(input.skillId);
      if (!skill) throw new Error('Skill does not exist');
      return { skill: skillSummary(skill) };
    },
  );
  handleInput(
    IpcChannel.SetSkillEnabled,
    setSkillEnabledRequestSchema,
    skillMutationResultSchema,
    async (input) => {
      if (!store.skills.setEnabled(input.skillId, input.enabled))
        throw new Error('Skill does not exist');
      if (!input.enabled) await runs.cancelRunsForSkill(input.skillId);
      const skill = store.skills.get(input.skillId);
      if (!skill) throw new Error('Skill does not exist');
      return { skill: skillSummary(skill) };
    },
  );
  handleInput(
    IpcChannel.CopySkill,
    copySkillRequestSchema,
    skillMutationResultSchema,
    async (input) => {
      const copied = await skillService.copyAsUser(input.skillId);
      return { skill: skillSummary(copied.skill) };
    },
  );
  handleInput(
    IpcChannel.ExportSkill,
    exportSkillRequestSchema,
    skillExportResultSchema,
    async (input) => {
      const skill = store.skills.get(input.skillId);
      if (!skill) throw new Error('Skill does not exist');
      const result = await showSaveDialog(deps, {
        title: '导出 Skill',
        defaultPath: skill.name,
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      const filePath = await skillService.exportDirectory(input.skillId, result.filePath);
      return { cancelled: false, filePath };
    },
  );
  handleInput(
    IpcChannel.DeleteSkill,
    deleteSkillRequestSchema,
    deletedResultSchema,
    async (input) => ({ deleted: await skillService.deleteUserSkill(input.skillId) }),
  );
  handleInput(
    IpcChannel.TestSkillRun,
    testSkillRunRequestSchema,
    testSkillRunResultSchema,
    (input) => {
      const skill = store.skills.get(input.skillId);
      if (!skill) throw new Error('Skill does not exist');
      if (!skill.enabled) throw new Error(`Skill「${skill.name}」已停用`);
      if (skill.trustStatus !== 'trusted')
        throw new Error(`Skill「${skill.name}」尚未信任，无法试运行`);
      const workspace = store.workspaces.getOrCreate(deps.getDefaultWorkspaceRoot(), '我的工作区');
      const created = store.tasks.create(
        workspace.id,
        `Skill 试运行：${skill.name}`,
        'Skill 试运行任务',
      );
      const runId = runs.start({
        taskId: created.task.id,
        sessionId: created.sessionId,
        prompt: input.prompt ?? `请运行 Skill「${skill.name}」的完整流程`,
        skillBindings: [
          {
            skillId: skill.id,
            ...(skill.currentRevisionId ? { revisionId: skill.currentRevisionId } : {}),
          },
        ],
      });
      return { runId, taskId: created.task.id, sessionId: created.sessionId };
    },
  );
}

function registerExpertChannels({ expertService }: IpcDependencies): void {
  handleOptionalInput(
    IpcChannel.ListExperts,
    listExpertsRequestSchema,
    z.array(expertSummarySchema),
    (input) => expertService.list(input.includeArchived),
  );
  handleInput(
    IpcChannel.GetExpert,
    getExpertRequestSchema,
    expertDetailSchema.nullable(),
    (input) => expertService.get(input.id) ?? null,
  );
  handleInput(
    IpcChannel.CreateExpert,
    expertRevisionDraftSchema,
    expertMutationResultSchema,
    (input) => ({ expert: expertService.create(input) }),
  );
  handleInput(
    IpcChannel.SaveExpertRevision,
    saveExpertRevisionRequestSchema,
    expertMutationResultSchema,
    (input) => ({
      expert: expertService.saveRevision(input.expertId, input.revision, input.expectedRevision),
    }),
  );
  handleInput(
    IpcChannel.CopyExpert,
    copyExpertRequestSchema,
    expertMutationResultSchema,
    (input) => ({ expert: expertService.copy(input.expertId, input.name) }),
  );
  handleInput(
    IpcChannel.SetExpertLifecycle,
    setExpertLifecycleRequestSchema,
    expertMutationResultSchema,
    (input) => ({
      expert: expertService.setLifecycle(input.expertId, input.lifecycle, input.expectedRevision),
    }),
  );
}

function registerMemoryChannels({
  memories,
  memoryExtractions,
  memoryRecall,
}: IpcDependencies): void {
  handleOptionalInput(
    IpcChannel.ListMemories,
    listMemoriesRequestSchema,
    resultSchema(memoryListPageDataSchema),
    (input) => memories.list(input),
  );
  handleInput(
    IpcChannel.GetMemory,
    getMemoryRequestSchema,
    resultSchema(memoryViewItemSchema),
    (input) => memories.get(input),
  );
  // 记忆写在提交数据库之后还要重建投影：必须 await 内层结果，
  // 只 await 外层对象会让未解析的 Promise 进入响应校验。
  handleInput(
    IpcChannel.CreateMemory,
    createMemoryRequestSchema,
    resultSchema(memoryWriteReceiptSchema),
    async (input) => await memories.create(input),
  );
  handleInput(
    IpcChannel.UpdateMemory,
    updateMemoryRequestSchema,
    resultSchema(memoryWriteReceiptSchema),
    async (input) => await memories.update(input),
  );
  handleInput(
    IpcChannel.SetMemoryStatus,
    setMemoryStatusRequestSchema,
    resultSchema(memoryWriteReceiptSchema),
    async (input) => await memories.setStatus(input),
  );
  handleInput(
    IpcChannel.ResolveMemoryConflict,
    resolveMemoryConflictRequestSchema,
    resultSchema(memoryConflictResolutionDataSchema),
    async (input) => await memories.resolveConflict(input),
  );
  // 召回查询是纯读：preview 不写 run_memory_reads，也不留下任何运行痕迹（契约 §9.2）。
  handleInput(
    IpcChannel.PreviewMemory,
    previewMemoryRequestSchema,
    resultSchema(memoryPreviewDataSchema),
    (input) => memoryRecall.preview(input),
  );
  handleInput(
    IpcChannel.GetRunMemoryContext,
    getRunMemoryContextRequestSchema,
    resultSchema(memoryRunContextDataSchema),
    (input) => memoryRecall.runContext(input),
  );
  handleInput(
    IpcChannel.GetMemorySettings,
    getMemorySettingsRequestSchema,
    resultSchema(workspaceMemorySettingsSchema),
    async (input) => await memoryExtractions.getSettings(input),
  );
  handleInput(
    IpcChannel.SetMemorySettings,
    setMemorySettingsRequestSchema,
    resultSchema(memorySettingsDataSchema),
    async (input) => await memoryExtractions.setSettings(input),
  );
  handleInput(
    IpcChannel.ListMemoryJobs,
    listMemoryJobsRequestSchema,
    resultSchema(memoryJobListDataSchema),
    (input) => memoryExtractions.listJobs(input),
  );
  handleInput(
    IpcChannel.RetryMemoryJob,
    retryMemoryJobRequestSchema,
    resultSchema(memoryJobSummarySchema),
    async (input) => await memoryExtractions.retryJob(input),
  );
  handleInput(
    IpcChannel.CancelMemoryJob,
    cancelMemoryJobRequestSchema,
    resultSchema(memoryJobSummarySchema),
    async (input) => await memoryExtractions.cancelJob(input),
  );
  handleInput(
    IpcChannel.RebuildMemoryProjection,
    rebuildMemoryProjectionRequestSchema,
    resultSchema(memoryProjectionStateDataSchema),
    async (input) => await memories.rebuildProjection(input),
  );
}

/** 工作空间级的记忆派生视图：简报是当场重算的只读投影，参考版本是治理动作。 */
function registerWorkspaceMemoryChannels({
  workspaceBrief,
  workspaceReferences,
}: IpcDependencies): void {
  handleInput(
    IpcChannel.GetWorkspaceMemoryBrief,
    workspaceMemoryBriefRequestSchema,
    resultSchema(workspaceBriefSchema),
    async (input) => await workspaceBrief.get(input),
  );
  handleInput(
    IpcChannel.ListWorkspaceReferenceVersions,
    listWorkspaceReferenceVersionsRequestSchema,
    resultSchema(workspaceReferenceListDataSchema),
    (input) => workspaceReferences.listReferenceVersions(input),
  );
  handleInput(
    IpcChannel.SetWorkspaceReferenceVersion,
    setWorkspaceReferenceVersionRequestSchema,
    resultSchema(workspaceReferenceSetDataSchema),
    (input) => workspaceReferences.setReferenceVersion(input),
  );
  handleInput(
    IpcChannel.RemoveWorkspaceReferenceVersion,
    removeWorkspaceReferenceVersionRequestSchema,
    resultSchema(memoryReferenceWriteReceiptSchema),
    (input) => workspaceReferences.removeReferenceVersion(input),
  );
}

function registerMcpChannels({ mcpClientService }: IpcDependencies): void {
  handleNoInput(
    IpcChannel.ListMcpConnections,
    emptyRequestSchema,
    z.array(mcpConnectionSummarySchema),
    () => mcpClientService.listConnections(),
  );
  handleInput(
    IpcChannel.GetMcpConnection,
    getMcpConnectionRequestSchema,
    mcpConnectionSummarySchema.nullable(),
    (input) => mcpClientService.getConnection(input.id),
  );
  handleInput(
    IpcChannel.SaveMcpConnection,
    saveMcpConnectionRequestSchema,
    mcpMutationResultSchema,
    async (input) => ({ connection: await mcpClientService.saveConnection(input) }),
  );
  handleInput(
    IpcChannel.DeleteMcpConnection,
    deleteMcpConnectionRequestSchema,
    deletedResultSchema,
    async (input) => ({ deleted: await mcpClientService.deleteConnection(input.id) }),
  );
  handleInput(
    IpcChannel.TestMcpConnection,
    getMcpConnectionRequestSchema,
    mcpTestResultSchema,
    (input) => mcpClientService.testConnection(input.id),
  );
}

function registerDependencyChannels(deps: IpcDependencies): void {
  const { dependencies, snapshots, dependencyLocksRoot, store } = deps;
  const filesystem = createNodeFileSystem();

  handleNoInput(
    IpcChannel.ListDependencyOptions,
    listDependencyOptionsRequestSchema,
    dependencyOptionsSchema,
    async () => ({
      distributions: await dependencies.listManagedDistributions(),
      lockIds: await listDependencyLocks(dependencyLocksRoot, filesystem),
      snapshots: snapshots.listSnapshots(),
      environments: dependencies.listEnvironments(),
    }),
  );

  handleInput(
    IpcChannel.InspectDependencyPlan,
    dependencyPlanRequestSchema,
    dependencyPlanSchema,
    async (input) => {
      const lock = await loadDependencyLock(dependencyLocksRoot, input.lockId, filesystem);
      const plan = await dependencies.inspectPlan(input.base, lock);
      return {
        environmentKey: plan.environmentKey,
        base: plan.base,
        platform: plan.platform,
        lockHash: plan.lockHash,
        lock,
        missingWheels: plan.missingWheels,
        requiresDownload: plan.requiresDownload,
        environment: plan.environment ?? null,
        ...(plan.openOperationId ? { openOperationId: plan.openOperationId } : {}),
      };
    },
  );

  handleInput(
    IpcChannel.PrepareDependencyEnvironment,
    prepareDependencyRequestSchema,
    prepareDependencyResultSchema,
    async (input) => {
      const lock = await loadDependencyLock(dependencyLocksRoot, input.lockId, filesystem);
      return dependencies.prepareEnvironment(input.base, lock, input.kind);
    },
  );

  handleInput(
    IpcChannel.CancelDependencyPreparation,
    cancelDependencyRequestSchema,
    cancelDependencyResultSchema,
    (input) => dependencies.cancelPreparation(input.operationId),
  );

  handleInput(
    IpcChannel.GetDependencyOperation,
    getDependencyOperationRequestSchema,
    dependencyOperationSchema.nullable(),
    (input) => dependencies.getOperation(input.operationId) ?? null,
  );

  handleNoInput(
    IpcChannel.ChoosePythonInterpreter,
    emptyRequestSchema,
    chooseInterpreterResultSchema,
    async () => {
      const result = await showOpenDialog(deps, {
        title: '选择本机 Python 解释器',
        buttonLabel: '选择解释器',
        properties: ['openFile'],
      });
      const chosen = result.filePaths[0];
      if (result.canceled || !chosen) return { cancelled: true };
      return { cancelled: false, path: chosen };
    },
  );

  handleOptionalInput(
    IpcChannel.RegisterToolchainSnapshot,
    registerToolchainRequestSchema,
    registerToolchainResultSchema,
    async (input) => {
      const result = await showOpenDialog(deps, {
        title: '选择外部工具链目录',
        buttonLabel: '登记为受管快照',
        properties: ['openDirectory'],
      });
      const origin = result.filePaths[0];
      if (result.canceled || !origin) return { cancelled: true, snapshot: null, reused: false };
      const receipt = await snapshots.createSnapshot({
        origin,
        ...(input.include ? { include: input.include } : {}),
      });
      return { cancelled: false, snapshot: receipt.snapshot, reused: receipt.reused };
    },
  );

  handleInput(
    IpcChannel.RefreshSkillDependencyGrant,
    refreshSkillDependencyGrantRequestSchema,
    refreshSkillDependencyGrantResultSchema,
    async (input) => {
      const lock = await loadDependencyLock(dependencyLocksRoot, input.lockId, filesystem);
      const manifestHashes: string[] = [];
      for (const snapshotId of input.snapshotIds) {
        const snapshot = snapshots.getSnapshot(snapshotId);
        if (!snapshot) throw new Error(`工具链快照 ${snapshotId} 不存在`);
        manifestHashes.push(snapshot.manifestHash);
      }
      const outcome = dependencies.confirmDependencyGrant(input.skillId, {
        lockHash: computeDependencyLockHash(lock),
        snapshotManifestHashes: manifestHashes,
        ...(input.confirm === true ? { confirm: true } : {}),
      });
      const skill = store.skills.get(input.skillId);
      if (!skill) throw new Error('Skill does not exist');
      return {
        skill: skillSummary(skill),
        ...(outcome.fingerprint ? { fingerprint: outcome.fingerprint } : {}),
        grantActive: outcome.grantActive,
        grantCreated: outcome.grantCreated,
        ...(outcome.blockedReason ? { blockedReason: outcome.blockedReason } : {}),
      };
    },
  );
}

function registerNotificationChannels({ notifications }: IpcDependencies): void {
  handleNoInput(
    IpcChannel.ListNotifications,
    emptyRequestSchema,
    z.array(notificationSummarySchema),
    () => notifications.list(),
  );
  handleInput(
    IpcChannel.MarkNotificationRead,
    markNotificationReadRequestSchema,
    unreadCountResultSchema,
    (input) => ({
      unreadCount: notifications.markRead(input.id),
    }),
  );
  handleNoInput(
    IpcChannel.MarkAllNotificationsRead,
    markAllNotificationsReadRequestSchema,
    unreadCountResultSchema,
    () => ({
      unreadCount: notifications.markAllRead(),
    }),
  );
  handleNoInput(
    IpcChannel.ClearNotifications,
    clearNotificationsRequestSchema,
    clearedResultSchema,
    () => {
      notifications.clear();
      return { cleared: true };
    },
  );
}

function registerWindowChannels({ getWindow }: IpcDependencies): void {
  handleInput(
    IpcChannel.UpdateWindowTheme,
    updateWindowThemeRequestSchema,
    voidResultSchema,
    (theme) => {
      const window = getWindow();
      if (!window || window.isDestroyed()) return;
      window.setBackgroundColor(theme.backgroundColor);
      if (process.platform === 'win32') {
        window.setTitleBarOverlay({
          color: theme.backgroundColor,
          symbolColor: theme.symbolColor,
        });
      }
    },
  );

  handleNoInput(
    IpcChannel.WindowToggleMaximize,
    windowToggleMaximizeRequestSchema,
    maximizedResultSchema,
    () => {
      const window = getWindow();
      if (!window || window.isDestroyed()) return { maximized: false };
      if (process.platform === 'darwin') {
        // 双击标题栏的行为跟随系统偏好，不自创交互
        const preference = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
        if (preference === 'Minimize') {
          window.minimize();
          return { maximized: false };
        }
        if (preference === 'None') return { maximized: window.isMaximized() };
      }
      if (window.isMaximized()) {
        window.unmaximize();
        return { maximized: false };
      }
      window.maximize();
      return { maximized: true };
    },
  );
}

/** 导入结果按「全部成功 / 部分跳过 / 全部失败」给出不同级别的通知。 */
