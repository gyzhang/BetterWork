import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  agentRuntimeEventSchema,
  artifactDetailSchema,
  artifactSummarySchema,
  artifactVersionDetailSchema,
  artifactVersionSummarySchema,
  cancelledResultSchema,
  cancelRunRequestSchema,
  clearedResultSchema,
  clearNotificationsRequestSchema,
  connectionTestResultSchema,
  copySkillRequestSchema,
  createdTaskSchema,
  createTaskRequestSchema,
  deletedResultSchema,
  evidenceSummarySchema,
  exportMarkdownArtifactRequestSchema,
  exportMarkdownArtifactResultSchema,
  exportSkillRequestSchema,
  getArtifactRequestSchema,
  getArtifactVersionRequestSchema,
  getSkillRequestSchema,
  importSkillRequestSchema,
  IpcChannel,
  knowledgeDocumentSummarySchema,
  type KnowledgeImportResult,
  knowledgeImportResultSchema,
  knowledgeRefreshResultSchema,
  knowledgeSearchResultSchema,
  listArtifactsRequestSchema,
  listArtifactVersionsRequestSchema,
  listEvidenceRequestSchema,
  listRunEventsRequestSchema,
  listRunsRequestSchema,
  listSkillsRequestSchema,
  listTasksRequestSchema,
  markAllNotificationsReadRequestSchema,
  markNotificationReadRequestSchema,
  maximizedResultSchema,
  modelProfileIdSchema,
  modelProfileSummarySchema,
  modelSaveResultSchema,
  notificationSummarySchema,
  openKnowledgeSourceRequestSchema,
  openKnowledgeSourceResultSchema,
  recentTaskSummarySchema,
  refreshKnowledgeDocumentRequestSchema,
  removedResultSchema,
  removeKnowledgeDocumentRequestSchema,
  revokeSkillTrustRequestSchema,
  runSummarySchema,
  saveMarkdownArtifactRequestSchema,
  saveModelProfileRequestSchema,
  saveSearchEngineRequestSchema,
  saveSkillRuntimeProfileRequestSchema,
  searchEngineSaveResultSchema,
  searchEngineSummarySchema,
  searchKnowledgeRequestSchema,
  setDefaultModelRequestSchema,
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
  testModelRequestSchema,
  testSearchEngineRequestSchema,
  unreadCountResultSchema,
  updatedResultSchema,
  updateWindowThemeRequestSchema,
  voidResultSchema,
  windowToggleMaximizeRequestSchema,
  workspaceSummarySchema,
} from '@betterwork/agent-protocol';
import { type BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import { z, type ZodTypeAny } from 'zod';

import type { AppStore } from '../persistence';
import type { KnowledgeVault } from '../services/knowledge-vault';
import { probeModelConnection } from '../services/model-connectivity';
import type { NotificationService } from '../services/notification-service';
import type { RunService } from '../services/run-service';
import { createQianfanSearchClient } from '../services/search-engine-service';
import type { SkillService } from '../services/skill-service';

export interface IpcDependencies {
  readonly store: AppStore;
  readonly knowledgeVault: KnowledgeVault;
  readonly notifications: NotificationService;
  readonly runs: RunService;
  readonly skillService: SkillService;
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
    (input) => store.runs.list(input.taskId),
  );
}

function registerWorkspaceAndTaskChannels(deps: IpcDependencies): void {
  const { store, getDefaultWorkspaceRoot } = deps;

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
    (input) => store.artifacts.getDetail(input.id) ?? null,
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
    (input) => store.artifacts.getVersionDetail(input.id) ?? null,
  );
  handleInput(
    IpcChannel.SaveMarkdownArtifact,
    saveMarkdownArtifactRequestSchema,
    artifactSummarySchema,
    (input) => store.artifacts.saveMarkdown(input),
  );
  handleInput(
    IpcChannel.ExportMarkdownArtifact,
    exportMarkdownArtifactRequestSchema,
    exportMarkdownArtifactResultSchema,
    async (input) => exportMarkdown(deps, input.artifactId, input.versionId),
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

  const version = versionId ? store.artifacts.getVersionDetail(versionId) : undefined;
  if (versionId && (!version || version.artifactId !== artifactId)) {
    throw new Error('Artifact version does not belong to artifact');
  }
  const content = version ? version.content : artifact.content;

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

function registerModelChannels({ store }: IpcDependencies): void {
  handleNoInput(IpcChannel.ListModels, emptyRequestSchema, z.array(modelProfileSummarySchema), () =>
    store.models.list(),
  );
  handleInput(
    IpcChannel.SaveModel,
    saveModelProfileRequestSchema,
    modelSaveResultSchema,
    (input) => ({
      id: store.models.save(input),
    }),
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
      // 编辑既有配置时允许留空 Key，表示沿用已保存的凭据
      const stored = input.id ? store.models.getWithSecret(input.id) : undefined;
      const result = await probeModelConnection({
        baseUrl: input.baseUrl,
        model: input.model,
        role: input.role,
        apiKey: input.apiKey || (stored?.apiKey ?? ''),
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

function registerSearchEngineChannels({ store }: IpcDependencies): void {
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
    (input) => ({
      provider: store.searchEngines.save(input),
    }),
  );

  handleInput(
    IpcChannel.TestSearchEngine,
    testSearchEngineRequestSchema,
    connectionTestResultSchema,
    async (input) => {
      const stored = store.searchEngines.get(input.provider);
      const apiKey = input.apiKey || (stored?.apiKey ?? '');
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
  const { skillService, store } = deps;
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
    (input) => ({
      skill: skillSummary(skillService.setTrustPreference(input.skillId, input.trusted)),
    }),
  );
  handleInput(
    IpcChannel.RevokeSkillTrust,
    revokeSkillTrustRequestSchema,
    skillMutationResultSchema,
    async (input) => {
      await skillService.revokeTrust(input.skillId);
      const skill = store.skills.get(input.skillId);
      if (!skill) throw new Error('Skill does not exist');
      return { skill: skillSummary(skill) };
    },
  );
  handleInput(
    IpcChannel.SetSkillEnabled,
    setSkillEnabledRequestSchema,
    skillMutationResultSchema,
    (input) => {
      if (!store.skills.setEnabled(input.skillId, input.enabled))
        throw new Error('Skill does not exist');
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
