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
  cancelRunRequestSchema,
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
  deletedResultSchema,
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
  getSkillRequestSchema,
  getTaskContextRequestSchema,
  importSkillRequestSchema,
  inputSnapshotSchema,
  IpcChannel,
  knowledgeDocumentSummarySchema,
  type KnowledgeImportResult,
  knowledgeImportResultSchema,
  knowledgeRefreshResultSchema,
  knowledgeSearchResultSchema,
  listArtifactsRequestSchema,
  listArtifactVersionsRequestSchema,
  listDependencyOptionsRequestSchema,
  listDiscussionCheckpointsRequestSchema,
  listEvidenceRequestSchema,
  listExpertsRequestSchema,
  listMemoriesRequestSchema,
  listRunEventsRequestSchema,
  listRunsRequestSchema,
  listSkillsRequestSchema,
  listTaskMaterialCandidatesRequestSchema,
  listTasksRequestSchema,
  markAllNotificationsReadRequestSchema,
  markNotificationReadRequestSchema,
  materialCandidateSchema,
  maximizedResultSchema,
  mcpConnectionSummarySchema,
  mcpMutationResultSchema,
  mcpTestResultSchema,
  memoryMutationResultSchema,
  memoryRecordSchema,
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
  revokeSkillTrustRequestSchema,
  runSummarySchema,
  saveExpertRevisionRequestSchema,
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
  setMemoryStatusRequestSchema,
  setModelEnabledRequestSchema,
  setSkillEnabledRequestSchema,
  setSkillTrustRequestSchema,
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
  workspaceSummarySchema,
} from '@betterwork/agent-protocol';
import { type BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import { z, type ZodTypeAny } from 'zod';

import { createNodeFileSystem } from '../infrastructure/dependency-adapters';
import { listDependencyLocks, loadDependencyLock } from '../infrastructure/dependency-lock-catalog';
import type { AppStore } from '../persistence';
import { API_KEY_SLOT } from '../persistence/credential-repository';
import { type CredentialProvisioner, type CredentialResolver } from '../services/credential-access';
import type { DiscussionCheckpointService } from '../services/discussion-checkpoint-service';
import type { ExpertService } from '../services/expert-service';
import type { FileArtifactService } from '../services/file-artifact-service';
import type { KnowledgeVault } from '../services/knowledge-vault';
import type { McpClientService } from '../services/mcp-client-service';
import type { MemoryService } from '../services/memory-service';
import { probeModelConnection } from '../services/model-connectivity';
import type { NotificationService } from '../services/notification-service';
import type { RunService } from '../services/run-service';
import { createQianfanSearchClient } from '../services/search-engine-service';
import {
  computeDependencyLockHash,
  type SkillDependencyService,
} from '../services/skill-dependency-service';
import type { SkillService } from '../services/skill-service';
import type { TaskMaterialService } from '../services/task-material-service';
import type { ToolchainSnapshotService } from '../services/toolchain-snapshot-service';

export interface IpcDependencies {
  readonly store: AppStore;
  readonly knowledgeVault: KnowledgeVault;
  readonly taskMaterials: TaskMaterialService;
  readonly notifications: NotificationService;
  readonly runs: RunService;
  /** 凭据入口（Main 侧）：供保存双写与连接测试的新读优先；缺省时保持旧行为。 */
  readonly credentialAccess?: CredentialResolver & CredentialProvisioner;
  readonly skillService: SkillService;
  readonly expertService: ExpertService;
  readonly discussionCheckpoints: DiscussionCheckpointService;
  readonly memories: MemoryService;
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
  handleInput(
    IpcChannel.SaveMarkdownArtifact,
    saveMarkdownArtifactRequestSchema,
    artifactSummarySchema,
    (input) => {
      return store.transaction(() => {
        const saved = store.artifacts.saveMarkdown(input);
        if (!input.inputRelations || input.inputRelations.length === 0) return saved;
        const runId = input.runId;
        if (input.origin !== 'assistant-run' || !runId) {
          throw new Error('只有 Assistant Run 产生的成果才能声明本次输入来源');
        }
        const version = store.artifacts.getVersionDetail(saved.currentVersionId);
        if (!version || version.sourceRunId !== runId) {
          throw new Error('成果版本不属于声明来源的 Run');
        }
        store.artifactInputRelations.saveForRun(
          saved.currentVersionId,
          runId,
          input.inputRelations,
          (relationInput) => {
            if (relationInput.kind === 'evidence') {
              return store.evidence.get(relationInput.evidenceId)?.runId === runId;
            }
            return store.materialReads.hasMaterialRead(
              runId,
              JSON.stringify(relationInput),
              relationInput.contentHash,
            );
          },
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
      const { fileArtifactService, store } = deps;
      if (!fileArtifactService) throw new Error('File artifact service is not available');
      const relations = input.inputRelations ?? [];
      if (
        relations.some((relation) =>
          relation.input.kind === 'evidence'
            ? store.evidence.get(relation.input.evidenceId)?.runId !== input.runId
            : !store.materialReads.hasMaterialRead(
                input.runId,
                JSON.stringify(relation.input),
                relation.input.contentHash,
              ),
        )
      ) {
        throw new Error('文件成果输入必须先由同一 Run 实际读取');
      }
      const result = await fileArtifactService.register({
        runId: input.runId,
        executionId: input.executionId,
        outputId: input.outputId,
        ...(input.artifactId ? { artifactId: input.artifactId } : {}),
        title: input.title,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.validation ? { validation: input.validation } : {}),
      });
      if (relations.length > 0) {
        store.artifactInputRelations.saveForRun(
          result.versionId,
          input.runId,
          relations,
          (relationInput) =>
            relationInput.kind === 'evidence'
              ? store.evidence.get(relationInput.evidenceId)?.runId === input.runId
              : store.materialReads.hasMaterialRead(
                  input.runId,
                  JSON.stringify(relationInput),
                  relationInput.contentHash,
                ),
        );
      }
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
        await credentialAccess.provision(
          { ownerKind: 'model-profile', ownerId: id, slot: API_KEY_SLOT },
          input.apiKey,
        );
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
  const { knowledgeVault, notifications } = deps;

  handleNoInput(
    IpcChannel.ListKnowledge,
    emptyRequestSchema,
    z.array(knowledgeDocumentSummarySchema),
    () => knowledgeVault.listDocuments(),
  );

  handleNoInput(
    IpcChannel.ImportKnowledge,
    emptyRequestSchema,
    knowledgeImportResultSchema,
    async () => {
      const result = await showOpenDialog(deps, {
        title: '导入本地资料',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '资料文件', extensions: ['md', 'markdown', 'txt', 'text', 'pdf', 'docx'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled) return { imported: [], skipped: [] };

      try {
        const outcome = await knowledgeVault.importPaths(result.filePaths);
        notifyImportOutcome(notifications, outcome);
        return outcome;
      } catch (error) {
        notifications.create({
          level: 'error',
          kind: 'knowledge-import',
          title: '导入资料失败',
          detail: describeError(error),
          target: { kind: 'knowledge' },
        });
        throw error;
      }
    },
  );

  handleInput(
    IpcChannel.SearchKnowledge,
    searchKnowledgeRequestSchema,
    z.array(knowledgeSearchResultSchema),
    (input) => knowledgeVault.search(input.query),
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
    knowledgeRefreshResultSchema,
    (input) => knowledgeVault.refreshDocument(input.id),
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
        await credentialAccess.provision(
          { ownerKind: 'api-service-profile', ownerId: provider, slot: API_KEY_SLOT },
          input.apiKey,
        );
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
      store.searchEngines.recordConnection(
        input.provider,
        result.ok ? 'connected' : 'failed',
        apiKey,
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

function registerMemoryChannels({ memories }: IpcDependencies): void {
  handleOptionalInput(
    IpcChannel.ListMemories,
    listMemoriesRequestSchema,
    z.array(memoryRecordSchema),
    (input) => memories.list(input),
  );
  handleInput(
    IpcChannel.CreateMemory,
    createMemoryRequestSchema,
    memoryMutationResultSchema,
    (input) => ({ memory: memories.create(input) }),
  );
  handleInput(
    IpcChannel.UpdateMemory,
    updateMemoryRequestSchema,
    memoryMutationResultSchema,
    (input) => ({ memory: memories.update(input) }),
  );
  handleInput(
    IpcChannel.SetMemoryStatus,
    setMemoryStatusRequestSchema,
    memoryMutationResultSchema,
    (input) => ({ memory: memories.setStatus(input) }),
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
function notifyImportOutcome(
  notifications: NotificationService,
  outcome: KnowledgeImportResult,
): void {
  const { imported, skipped } = outcome;
  if (imported.length > 0) {
    notifications.create({
      level: skipped.length > 0 ? 'warning' : 'success',
      kind: 'knowledge-import',
      title:
        skipped.length > 0
          ? `已整理 ${imported.length} 份资料，${skipped.length} 份未导入`
          : `已整理 ${imported.length} 份资料`,
      target: { kind: 'knowledge' },
    });
    return;
  }
  if (skipped.length === 0) return;
  notifications.create({
    level: 'warning',
    kind: 'knowledge-import',
    title: `资料未导入（${skipped.length} 份）`,
    detail: skipped
      .slice(0, 5)
      .map((item) => `${path.basename(item.sourcePath)}：${item.reason}`)
      .join('；'),
    target: { kind: 'knowledge' },
  });
}
