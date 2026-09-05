import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type {
  AgentRuntimeEvent,
  ArtifactDetail,
  ArtifactSummary,
  EvidenceSummary,
  KnowledgeDocumentSummary,
  KnowledgeSearchResult,
  ModelProfileInput,
  ModelProfileSummary,
  NotificationSummary,
  NotificationTarget,
  RecentTaskSummary,
  RunSummary,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import type { AppearancePreference, ResolvedAppearance } from './appearance';
import {
  applyAppearance,
  bootstrapAppearance,
  getWindowTheme,
  persistAppearance,
} from './appearance';
import { deriveActivityGroups } from './activity';
import { BrandLogo } from './brand-logo';
import { NotificationCenter, ToastHost, useNotifications } from './notifications';
import {
  AlertIcon,
  ArrowUpIcon,
  ArtifactIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  KnowledgeIcon,
  PlusIcon,
  SettingsIcon,
  WorkIcon,
} from './icons';
import type { AppView, ContextTab, SettingsTab } from './lib/view-types';
import { eventDetail, fileNameOf, formatTime } from './lib/format';
import { emptyModel, roleName, runStatusName } from './lib/labels';
import { handleTitlebarDoubleClick } from './lib/titlebar';
import { reportAction, trackAction } from './lib/async-action';
import { Welcome } from './components/Welcome';
import { ContextPanel } from './components/ContextPanel';
import { ModelEditor } from './components/ModelEditorSheet';
import { KnowledgePage } from './views/KnowledgeView';
import { ArtifactPage } from './views/ArtifactView';
import { SettingsPage } from './views/SettingsView';

export function App(): React.JSX.Element {
  const [prompt, setPrompt] = useState('计算: (12 + 8) * 3');
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const workspaceIdRef = useRef<string | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<{ id: string; sessionId: string; title: string }>();
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [taskRuns, setTaskRuns] = useState<RunSummary[]>([]);
  const [recentTasks, setRecentTasks] = useState<RecentTaskSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail>();
  const [sentPrompt, setSentPrompt] = useState('');
  const [artifactNote, setArtifactNote] = useState<{ tone: 'ok' | 'error'; text: string }>();
  // 跨视图的动作错误出口：开始任务、切换任务、停止执行、选择工作区等失败都在这里呈现，
  // 而不是像此前那样被 `void` 静默吞掉。
  const [actionError, setActionError] = useState('');
  const [models, setModels] = useState<ModelProfileSummary[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResult[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeMessage, setKnowledgeMessage] = useState('');
  const [knowledgeIssues, setKnowledgeIssues] = useState<string[]>([]);
  const [isImportingKnowledge, setIsImportingKnowledge] = useState(false);
  const [view, setView] = useState<AppView>('work');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('betterwork-sidebar-collapsed') === 'true',
  );
  const [contextTab, setContextTab] = useState<ContextTab>('process');
  const [contextOpen, setContextOpen] = useState(true);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [modelEditorOpen, setModelEditorOpen] = useState(false);
  const [modelForm, setModelForm] = useState<ModelProfileInput>(emptyModel);
  const [editingModelId, setEditingModelId] = useState<string>();
  const [modelFilter, setModelFilter] = useState<ModelProfileSummary['role'] | 'all'>('all');
  const [modelMessage, setModelMessage] = useState('');
  const [appearance, setAppearance] = useState<AppearancePreference>(() => bootstrapAppearance());
  const [resolvedAppearance, setResolvedAppearance] = useState<ResolvedAppearance>(() =>
    applyAppearance(bootstrapAppearance()),
  );

  /**
   * 列表刷新属于后台同步：失败时用户无法据以行动，但也不能完全无痕。
   * 统一走 trackAction 记录到控制台，并对调用方保证「永不 reject」，
   * 因此这些函数返回 void，调用点不需要也不应该 await。
   */
  const refreshRuns = (): void => {
    trackAction(window.betterwork.runs.list().then(setRuns), '刷新运行列表');
  };
  const refreshTaskRuns = (taskId = activeTaskIdRef.current): void => {
    if (!taskId) {
      setTaskRuns([]);
      return;
    }
    trackAction(window.betterwork.runs.list({ taskId }).then(setTaskRuns), '刷新任务运行记录');
  };
  const refreshTasks = (workspaceId = workspaceIdRef.current): void => {
    trackAction(
      window.betterwork.tasks.list(workspaceId ? { workspaceId } : undefined).then(setRecentTasks),
      '刷新最近任务',
    );
  };
  const refreshModels = (): void => {
    trackAction(window.betterwork.models.list().then(setModels), '刷新模型配置');
  };
  const refreshKnowledge = (): void => {
    trackAction(window.betterwork.knowledge.list().then(setKnowledgeDocuments), '刷新资料库');
  };
  const refreshEvidence = (taskId = activeTaskIdRef.current): void => {
    if (!taskId) {
      setEvidence([]);
      return;
    }
    trackAction(window.betterwork.evidence.list({ taskId }).then(setEvidence), '刷新引用资料');
  };
  const refreshArtifacts = (): void => {
    trackAction(window.betterwork.artifacts.list().then(setArtifacts), '刷新成果列表');
  };

  useEffect(() => {
    refreshRuns();
    refreshModels();
    refreshKnowledge();
    refreshArtifacts();
    trackAction(
      window.betterwork.workspace.getDefault().then((currentWorkspace) => {
        workspaceIdRef.current = currentWorkspace.id;
        setWorkspace(currentWorkspace);
        refreshTasks(currentWorkspace.id);
      }),
      '加载默认工作区',
    );
    return window.betterwork.runs.onEvent((event) => {
      setEvents((current) =>
        event.runId === activeRunIdRef.current ? [...current, event] : current,
      );
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        refreshRuns();
        refreshTaskRuns();
        refreshTasks();
        refreshEvidence();
        refreshArtifacts();
      }
    });
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      if (appearance.mode === 'system') setResolvedAppearance(applyAppearance(appearance));
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [appearance]);

  useEffect(() => {
    window.localStorage.setItem('betterwork-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    trackAction(window.betterwork.chrome.updateTheme(getWindowTheme()), '同步窗口主题');
  }, [appearance, resolvedAppearance]);

  const setAppearanceValue = (next: AppearancePreference): void => {
    setAppearance(next);
    persistAppearance(next);
    setResolvedAppearance(applyAppearance(next));
  };
  const assistantText = useMemo(
    () =>
      events
        .filter(
          (event): event is Extract<AgentRuntimeEvent, { type: 'message.delta' }> =>
            event.type === 'message.delta',
        )
        .map((event) => event.delta)
        .join(''),
    [events],
  );
  const assistantDisplayText = assistantText.trim();
  const activeRun = runs.find((run) => run.id === activeRunId);
  const activeLanguageModel = models.find((model) => model.role === 'language' && model.enabled);
  const defaultModelIds = useMemo(
    () =>
      new Map(
        (['language', 'vision', 'embedding'] as const).map((role) => [
          role,
          models.find((model) => model.role === role && model.enabled)?.id,
        ]),
      ),
    [models],
  );
  const isRunning =
    activeRun?.status === 'running' ||
    events.at(-1)?.type === 'run.started' ||
    (!!activeRunId &&
      !events.some((event) =>
        ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
      ));
  const completedTools = events.filter(
    (event) => event.type === 'tool.completed' || event.type === 'tool.failed',
  );
  const activityGroups = useMemo(() => deriveActivityGroups(events), [events]);
  const filteredModels = models.filter(
    (model) => modelFilter === 'all' || model.role === modelFilter,
  );
  const currentTaskArtifacts = artifacts.filter((artifact) => artifact.taskId === activeTask?.id);
  const isCompletedRun = events.some((event) => event.type === 'run.completed');

  const startNewTask = (): void => {
    activeRunIdRef.current = undefined;
    activeTaskIdRef.current = undefined;
    setActiveRunId(undefined);
    setActiveTask(undefined);
    setTaskRuns([]);
    setEvidence([]);
    setEvents([]);
    setSentPrompt('');
    setPrompt('');
    setArtifactNote(undefined);
    setView('work');
  };
  const startRun = async (): Promise<void> => {
    if (isRunning || !prompt.trim() || !workspace) return;
    const goal = prompt.trim();
    let task = activeTask;
    if (!task) {
      const created = await window.betterwork.tasks.create({
        workspaceId: workspace.id,
        title: goal.slice(0, 80),
        goal,
      });
      task = { id: created.task.id, sessionId: created.sessionId, title: created.task.title };
      activeTaskIdRef.current = task.id;
      setActiveTask(task);
    }
    const result = await window.betterwork.runs.start({
      taskId: task.id,
      sessionId: task.sessionId,
      prompt,
      workspacePath: workspace.rootPath,
    });
    activeRunIdRef.current = result.runId;
    setActiveRunId(result.runId);
    setEvents([]);
    setSentPrompt(goal);
    setPrompt('');
    setArtifactNote(undefined);
    setContextTab('process');
    setContextOpen(true);
    refreshRuns();
    refreshTaskRuns(task.id);
    refreshTasks();
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    reportAction(startRun(), setActionError, '无法开始这项工作，请重试。');
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== 'Enter' ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    reportAction(startRun(), setActionError, '无法开始这项工作，请重试。');
  };
  const selectRun = async (run: RunSummary): Promise<void> => {
    activeRunIdRef.current = run.id;
    activeTaskIdRef.current = run.taskId;
    setActiveRunId(run.id);
    setActiveTask({ id: run.taskId, sessionId: run.sessionId, title: run.prompt.slice(0, 80) });
    setSentPrompt(run.prompt.trim());
    setPrompt('');
    setArtifactNote(undefined);
    setEvents(await window.betterwork.runs.listEvents({ runId: run.id }));
    refreshTaskRuns(run.taskId);
    refreshEvidence(run.taskId);
    setView('work');
  };
  const selectTask = async (task: RecentTaskSummary): Promise<void> => {
    if (task.latestRun) {
      await selectRun(task.latestRun);
      return;
    }
    activeRunIdRef.current = undefined;
    activeTaskIdRef.current = task.id;
    setActiveRunId(undefined);
    setActiveTask({ id: task.id, sessionId: task.sessionId, title: task.title });
    setSentPrompt(task.goal);
    setPrompt('');
    setArtifactNote(undefined);
    setEvents([]);
    refreshTaskRuns(task.id);
    refreshEvidence(task.id);
    setView('work');
  };
  const openModelEditor = (model?: ModelProfileSummary): void => {
    setModelMessage('');
    if (model) {
      setEditingModelId(model.id);
      setModelForm({
        name: model.name,
        provider: model.provider,
        baseUrl: model.baseUrl,
        model: model.model,
        role: model.role,
        apiKey: '',
        maxContextTokens: model.maxContextTokens,
        maxOutputTokens: model.maxOutputTokens,
        temperature: model.temperature,
        enabled: model.enabled,
        priority: model.priority,
      });
    } else {
      setEditingModelId(undefined);
      setModelForm(emptyModel);
    }
    setModelEditorOpen(true);
  };
  const saveModel = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      await window.betterwork.models.save({
        ...modelForm,
        ...(editingModelId ? { id: editingModelId } : {}),
      });
      refreshModels();
      setModelEditorOpen(false);
      setModelMessage(editingModelId ? '模型配置已更新。' : '模型已添加，现在可以用于任务。');
    } catch (error) {
      setModelMessage(error instanceof Error ? error.message : '保存失败，请检查配置。');
    }
  };
  const testModel = async (): Promise<void> => {
    try {
      const result = await window.betterwork.models.test({
        ...modelForm,
        ...(editingModelId ? { id: editingModelId } : {}),
      });
      setModelMessage(result.message);
      refreshModels();
    } catch (error) {
      setModelMessage(error instanceof Error ? error.message : '连接测试失败。');
    }
  };
  const toggleModel = (model: ModelProfileSummary): void => {
    reportAction(
      window.betterwork.models
        .setEnabled({ id: model.id, enabled: !model.enabled })
        .then(() => refreshModels()),
      setModelMessage,
      '切换启用状态失败，请重试。',
    );
  };
  const setDefaultModel = (model: ModelProfileSummary): void => {
    reportAction(
      window.betterwork.models.setDefault({ id: model.id }).then((result) => {
        setModelMessage(
          result.updated
            ? `${model.name} 已设为${roleName[model.role]}默认模型。`
            : '仅已启用模型可以设为默认。',
        );
        refreshModels();
      }),
      setModelMessage,
      '设置默认模型失败，请重试。',
    );
  };
  const saveCurrentArtifact = async (): Promise<void> => {
    if (!activeTask || !activeRunId || !assistantDisplayText) return;
    try {
      const artifact = await window.betterwork.artifacts.saveMarkdown({
        ...(currentTaskArtifacts[0] ? { artifactId: currentTaskArtifacts[0].id } : {}),
        taskId: activeTask.id,
        origin: 'assistant-run',
        runId: activeRunId,
        title: activeTask.title,
        content: assistantDisplayText,
      });
      setArtifactNote({
        tone: 'ok',
        text: `已保存为 Markdown 成果（v${artifact.versionNumber}）。`,
      });
      refreshArtifacts();
      setContextTab('artifacts');
      setContextOpen(true);
    } catch (error) {
      setArtifactNote({
        tone: 'error',
        text: error instanceof Error ? error.message : '保存成果失败。',
      });
    }
  };
  const openArtifact = async (artifact: ArtifactSummary): Promise<void> => {
    const detail = await window.betterwork.artifacts.get({ id: artifact.id });
    if (!detail) throw new Error('成果已不存在，可能已被移除。');
    setSelectedArtifact(detail);
  };
  const reviseArtifact = async (
    artifact: ArtifactDetail,
    title: string,
    content: string,
  ): Promise<void> => {
    const saved = await window.betterwork.artifacts.saveMarkdown({
      artifactId: artifact.id,
      taskId: artifact.taskId,
      origin: 'user-edit',
      title,
      content,
    });
    refreshArtifacts();
    const detail = await window.betterwork.artifacts.get({ id: saved.id });
    if (detail) setSelectedArtifact(detail);
  };
  const exportArtifact = (
    artifact: ArtifactDetail,
    versionId?: string,
  ): Promise<{ cancelled: boolean; filePath?: string }> =>
    window.betterwork.artifacts.exportMarkdown({
      artifactId: artifact.id,
      ...(versionId ? { versionId } : {}),
    });
  const openKnowledge = (): void => {
    setView('knowledge');
    refreshKnowledge();
  };
  const navigateToTarget = (target: NotificationTarget): void => {
    if (target.kind === 'task') {
      const task = recentTasks.find((item) => item.id === target.taskId);
      if (task) reportAction(selectTask(task), setActionError, '无法打开这项任务。');
      else setView('work');
      return;
    }
    if (target.kind === 'artifact') {
      setView('artifacts');
      reportAction(
        window.betterwork.artifacts.get({ id: target.artifactId }).then((detail) => {
          setSelectedArtifact(detail ?? undefined);
        }),
        setActionError,
        '无法打开这项成果。',
      );
      return;
    }
    openKnowledge();
  };
  const isNotificationTargetVisible = (notification: NotificationSummary): boolean => {
    const target = notification.target;
    if (!target) return false;
    if (target.kind === 'task') return view === 'work' && activeTask?.id === target.taskId;
    if (target.kind === 'artifact')
      return view === 'artifacts' && selectedArtifact?.id === target.artifactId;
    return view === 'knowledge';
  };
  const {
    notifications,
    unreadCount,
    toasts,
    activate: activateNotificationFromCenter,
    markAllRead,
    clear: clearAllNotifications,
    dismissToast,
    pauseToast,
    resumeToast,
  } = useNotifications({
    navigate: navigateToTarget,
    isTargetVisible: isNotificationTargetVisible,
  });
  const activateNotification = (notification: NotificationSummary): void => {
    setNotificationCenterOpen(false);
    activateNotificationFromCenter(notification);
  };
  const openKnowledgeSource = async (sourcePath: string): Promise<void> => {
    const result = await window.betterwork.knowledge.openSource({ sourcePath });
    if (!result.opened) throw new Error(result.error ?? '无法打开原始资料。');
  };
  const importKnowledge = async (): Promise<void> => {
    setIsImportingKnowledge(true);
    setKnowledgeMessage('');
    setKnowledgeIssues([]);
    try {
      const result = await window.betterwork.knowledge.importFromDialog();
      if (result.imported.length || result.skipped.length) {
        setKnowledgeMessage(
          `已整理 ${result.imported.length} 份资料${result.skipped.length ? `；${result.skipped.length} 份未导入` : ''}。`,
        );
        setKnowledgeIssues(
          result.skipped.map((item) => `${fileNameOf(item.sourcePath)}：${item.reason}`),
        );
      } else {
        setKnowledgeMessage('已取消导入，未选择文件。');
      }
      refreshKnowledge();
    } catch (error) {
      setKnowledgeMessage(error instanceof Error ? error.message : '导入资料失败。');
    } finally {
      setIsImportingKnowledge(false);
    }
  };
  const removeKnowledgeDocument = async (document: KnowledgeDocumentSummary): Promise<void> => {
    if (
      !window.confirm(
        `从算台资料库移除「${document.title}」？\n\n这不会删除原始文件，只会删除本地检索索引。`,
      )
    )
      return;
    try {
      const result = await window.betterwork.knowledge.remove({ id: document.id });
      setKnowledgeMessage(
        result.removed
          ? `已从资料库移除「${document.title}」，原始文件未受影响。`
          : '资料已不在当前资料库中。',
      );
      setKnowledgeQuery('');
      refreshKnowledge();
    } catch (error) {
      setKnowledgeMessage(error instanceof Error ? error.message : '移出资料库失败，请重试。');
    }
  };
  const refreshKnowledgeDocument = async (document: KnowledgeDocumentSummary): Promise<void> => {
    setIsImportingKnowledge(true);
    try {
      const result = await window.betterwork.knowledge.refresh({ id: document.id });
      setKnowledgeMessage(
        result.refreshed
          ? `已刷新「${document.title}」的本地索引。`
          : (result.error ?? '刷新索引失败。'),
      );
      setKnowledgeQuery('');
      refreshKnowledge();
    } catch (error) {
      setKnowledgeMessage(
        error instanceof Error && error.message
          ? `刷新索引失败：${error.message}`
          : '刷新索引失败，请重试。',
      );
    } finally {
      setIsImportingKnowledge(false);
    }
  };
  const searchKnowledge = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const query = knowledgeQuery.trim();
    if (!query) {
      setKnowledgeResults([]);
      return;
    }
    try {
      setKnowledgeResults(await window.betterwork.knowledge.search({ query }));
    } catch (error) {
      setKnowledgeMessage(error instanceof Error ? error.message : '检索资料失败。');
    }
  };

  return (
    <main className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className="sidebar">
        <div className="sidebar-top-drag" onDoubleClick={handleTitlebarDoubleClick} />
        <div className="brand" onDoubleClick={handleTitlebarDoubleClick}>
          <span className="brand-mark" aria-hidden="true">
            <BrandLogo size={28} />
          </span>
          <div>
            <strong>算台</strong>
            <small>BetterWork</small>
          </div>
          <button
            className="sidebar-collapse-button"
            aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <ChevronRightIcon size={15} /> : <ChevronLeftIcon size={15} />}
          </button>
        </div>
        <button className="new-task" onClick={startNewTask}>
          <PlusIcon size={15} /> 新建任务
        </button>
        <nav className="primary-nav" aria-label="主要导航">
          <button className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}>
            <span aria-hidden="true">
              <WorkIcon size={15} />
            </span>{' '}
            工作
          </button>
          <button
            className={view === 'artifacts' ? 'active' : ''}
            onClick={() => {
              setView('artifacts');
              setSelectedArtifact(undefined);
              refreshArtifacts();
            }}
          >
            <span aria-hidden="true">
              <ArtifactIcon size={15} />
            </span>{' '}
            成果
          </button>
          <button className={view === 'knowledge' ? 'active' : ''} onClick={openKnowledge}>
            <span aria-hidden="true">
              <KnowledgeIcon size={15} />
            </span>{' '}
            知识
          </button>
        </nav>
        <div className="sidebar-divider" />
        <p className="section-label">最近任务</p>
        <div className="run-list">
          {recentTasks.length === 0 && <p className="empty-runs">你的任务会保存在这里。</p>}
          {recentTasks.map((task) => (
            <button
              key={task.id}
              className={task.id === activeTask?.id ? 'run-item active' : 'run-item'}
              onClick={() => reportAction(selectTask(task), setActionError, '无法打开这项任务。')}
            >
              <span>{task.title}</span>
              <small>
                {task.latestRun
                  ? `${runStatusName[task.latestRun.status]} · ${formatTime(task.latestRun.createdAt)}`
                  : '等待开始'}
              </small>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button
            className={view === 'settings' ? 'settings-nav active' : 'settings-nav'}
            onClick={() => {
              setView('settings');
              setSettingsTab('models');
              refreshModels();
            }}
          >
            <span aria-hidden="true">
              <SettingsIcon size={15} />
            </span>{' '}
            设置
          </button>
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadCount}
            open={notificationCenterOpen}
            onOpenChange={setNotificationCenterOpen}
            onActivate={activateNotification}
            onMarkAllRead={markAllRead}
            onClear={clearAllNotifications}
          />
        </div>
        <div className="sidebar-footer">算台 BetterWork · Phase 0</div>
      </aside>
      <section className="main-stage">
        {actionError && (
          <div className="action-error-banner" role="alert">
            <span aria-hidden="true">
              <AlertIcon size={13} />
            </span>
            <p>{actionError}</p>
            <button type="button" aria-label="关闭提示" onClick={() => setActionError('')}>
              <CloseIcon size={12} />
            </button>
          </div>
        )}
        {view === 'settings' && (
          <div className="window-drag-strip" onDoubleClick={handleTitlebarDoubleClick} />
        )}
        {view === 'work' && (
          <>
            <header className="page-header" onDoubleClick={handleTitlebarDoubleClick}>
              <div>
                <p className="eyebrow">工作</p>
                <h1>{activeRun ? '继续完成任务' : '开始一件工作'}</h1>
              </div>
              <div className="page-header-actions">
                <button className="context-toggle" onClick={() => setContextOpen((open) => !open)}>
                  {contextOpen ? '收起上下文' : '查看上下文'}
                </button>
              </div>
            </header>
            <div className="workspace">
              <div className="messages">
                <div className="page-body">
                  {events.length === 0 && !activeRunId ? (
                    <Welcome setPrompt={setPrompt} />
                  ) : (
                    <>
                      {
                        <div className="message user">
                          <span>你</span>
                          <p>{sentPrompt}</p>
                        </div>
                      }
                      {assistantDisplayText && (
                        <div className="message assistant">
                          <span>算台</span>
                          <p>{assistantDisplayText}</p>
                        </div>
                      )}
                      {isCompletedRun && assistantDisplayText && (
                        <div className="message-actions">
                          <button
                            className="message-action"
                            onClick={() => trackAction(saveCurrentArtifact(), '保存成果')}
                          >
                            <ArtifactIcon size={13} />
                            保存为成果
                          </button>
                          {artifactNote && (
                            <span
                              className={
                                artifactNote.tone === 'ok' ? 'action-note ok' : 'action-note error'
                              }
                            >
                              {artifactNote.text}
                            </span>
                          )}
                        </div>
                      )}
                      {completedTools.map((event) => (
                        <div
                          className={
                            event.type === 'tool.failed' ? 'tool-card failed' : 'tool-card'
                          }
                          key={event.id}
                        >
                          <div>
                            <span className="tool-icon" aria-hidden="true">
                              {event.type === 'tool.failed' ? (
                                <AlertIcon size={11} />
                              ) : (
                                <CheckIcon size={11} />
                              )}
                            </span>
                            <strong>
                              {event.type === 'tool.completed'
                                ? '已完成一个工作步骤'
                                : '工作步骤未完成'}
                            </strong>
                          </div>
                          <code>{eventDetail(event)}</code>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
              <form className="composer" onSubmit={submit}>
                <div className="workspace-row">
                  <span>工作区</span>
                  <input aria-label="工作区" value={workspace?.rootPath ?? ''} readOnly />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      reportAction(
                        window.betterwork.workspace.selectDirectory().then((selected) => {
                          if (selected) {
                            startNewTask();
                            workspaceIdRef.current = selected.id;
                            setWorkspace(selected);
                            refreshTasks(selected.id);
                          }
                        }),
                        setActionError,
                        '选择工作区失败，请重试。',
                      )
                    }
                  >
                    选择
                  </button>
                </div>
                <textarea
                  aria-label="任务输入，按 Command 或 Control 加 Enter 开始工作"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  rows={3}
                  placeholder="告诉算台你想完成什么工作…"
                />
                <div className="composer-footer">
                  <span>
                    {activeLanguageModel
                      ? `${activeLanguageModel.provider} · ${activeLanguageModel.model}`
                      : '未配置模型时使用教学 Provider'}{' '}
                    <kbd>⌘/Ctrl ↵</kbd>
                  </span>
                  {isRunning && activeRunId ? (
                    <button
                      type="button"
                      className="stop"
                      onClick={() =>
                        reportAction(
                          window.betterwork.runs.cancel({ runId: activeRunId }),
                          setActionError,
                          '无法停止这次执行，请重试。',
                        )
                      }
                    >
                      停止
                    </button>
                  ) : (
                    <button type="submit" disabled={!prompt.trim() || !workspace}>
                      开始工作 <ArrowUpIcon size={13} />
                    </button>
                  )}
                </div>
              </form>
            </div>
          </>
        )}
        {view === 'artifacts' && (
          <ArtifactPage
            artifacts={artifacts}
            selected={selectedArtifact}
            onSelect={(artifact) =>
              reportAction(openArtifact(artifact), setActionError, '无法打开这项成果。')
            }
            onSave={reviseArtifact}
            onExport={exportArtifact}
            onBack={() => setSelectedArtifact(undefined)}
          />
        )}
        {view === 'knowledge' && (
          <KnowledgePage
            documents={knowledgeDocuments}
            results={knowledgeResults}
            query={knowledgeQuery}
            setQuery={setKnowledgeQuery}
            message={knowledgeMessage}
            issues={knowledgeIssues}
            importing={isImportingKnowledge}
            onImport={() => trackAction(importKnowledge(), '导入资料')}
            onSearch={(event) => trackAction(searchKnowledge(event), '检索资料')}
            onOpenSource={openKnowledgeSource}
            onRefresh={refreshKnowledgeDocument}
            onRemove={removeKnowledgeDocument}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            tab={settingsTab}
            setTab={setSettingsTab}
            models={filteredModels}
            modelFilter={modelFilter}
            setModelFilter={setModelFilter}
            activeLanguageModel={activeLanguageModel}
            defaultModelIds={defaultModelIds}
            onAdd={() => openModelEditor()}
            onEdit={openModelEditor}
            onToggle={toggleModel}
            onSetDefault={setDefaultModel}
            onDelete={(model) =>
              reportAction(
                window.betterwork.models.delete({ id: model.id }).then(() => refreshModels()),
                setModelMessage,
                '删除模型失败，请重试。',
              )
            }
            appearance={appearance}
            resolvedAppearance={resolvedAppearance}
            onMode={(mode) => setAppearanceValue({ ...appearance, mode })}
            onScheme={(scheme) => setAppearanceValue({ ...appearance, scheme })}
            modelMessage={modelMessage}
          />
        )}
      </section>
      {view === 'work' && (
        <ContextPanel
          open={contextOpen}
          setOpen={setContextOpen}
          tab={contextTab}
          setTab={setContextTab}
          events={events}
          evidence={evidence}
          artifacts={currentTaskArtifacts}
          activeRun={activeRun}
          taskRuns={taskRuns}
          activityGroups={activityGroups}
          onSelectRun={(run) =>
            reportAction(selectRun(run), setActionError, '无法打开这次执行记录。')
          }
          onOpenSource={openKnowledgeSource}
        />
      )}
      {modelEditorOpen && (
        <ModelEditor
          form={modelForm}
          setForm={setModelForm}
          editing={Boolean(editingModelId)}
          message={modelMessage}
          onClose={() => setModelEditorOpen(false)}
          onSave={saveModel}
          onTest={() => trackAction(testModel(), '测试模型连接')}
        />
      )}
      <ToastHost
        toasts={toasts}
        onActivate={activateNotification}
        onDismiss={dismissToast}
        onPause={pauseToast}
        onResume={resumeToast}
      />
    </main>
  );
}
