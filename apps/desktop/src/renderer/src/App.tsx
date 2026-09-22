import type {
  AgentRuntimeEvent,
  ArtifactDetail,
  ArtifactInputRelationInput,
  ArtifactSummary,
  ArtifactVersionDetail,
  CreateDiscussionCheckpointRequest,
  DiscussionCheckpoint,
  EvidenceSummary,
  ExpertModelReference,
  ExpertSummary,
  InputSnapshot,
  MaterialCandidate,
  MaterialReference,
  McpToolBinding,
  MemoryViewItem,
  NotificationSummary,
  NotificationTarget,
  RecentTaskSummary,
  RunSummary,
  TaskContextRevision,
  TaskMaterialSelection,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { MEMORY_CONTENT_MAX_CODE_POINTS } from '@betterwork/agent-protocol';
import type { FormEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deriveActivityGroups } from './activity';
import { BrandLogo } from './brand-logo';
import {
  type CapabilityChip,
  ComposerCapabilityPicker,
} from './components/ComposerCapabilityPicker';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { ContextPanel } from './components/ContextPanel';
import { DiscussionCheckpointPanel } from './components/DiscussionCheckpointPanel';
import { PageHeader } from './components/layout/PageHeader';
import { MemoryEditor, type MemoryEditorSubmission } from './components/MemoryEditor';
import { ModelEditor } from './components/ModelEditorSheet';
import { ToolActivity } from './components/ToolActivity';
import { TransientToast } from './components/TransientToast';
import { Welcome } from './components/Welcome';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { useAppearance } from './hooks/use-appearance';
import { useExperts } from './hooks/use-experts';
import { useKnowledgeLibrary } from './hooks/use-knowledge-library';
import { useMcpConnections } from './hooks/use-mcp-connections';
import { newMemoryOperationId, useMemories } from './hooks/use-memories';
import { useMemorySuggestions } from './hooks/use-memory-suggestions';
import { useModelSettings } from './hooks/use-model-settings';
import { useRunMemories, useTaskMemoryExclusion } from './hooks/use-run-memories';
import { useSkills } from './hooks/use-skills';
import { useTaskScroll } from './hooks/use-task-scroll';
import { useWorkspaceBrief } from './hooks/use-workspace-brief';
import { useWorkspaceReferences } from './hooks/use-workspace-references';
import {
  AlertIcon,
  ArrowUpIcon,
  ArtifactIcon,
  CapabilityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExpertIcon,
  KnowledgeIcon,
  PlusIcon,
  SettingsIcon,
  WorkIcon,
} from './icons';
import { describeActionError, reportAction, trackAction } from './lib/async-action';
import { fileNameOf, formatTime } from './lib/format';
import { runStatusName } from './lib/labels';
import { settleMemoryCall } from './lib/memory-result';
import { candidatesOfTask } from './lib/memory-suggestions';
import { buildResearchPrompt } from './lib/research-prompt';
import { extractAssistantText, finalRunContent, mergeRunEvents } from './lib/run-events';
import { handleTitlebarDoubleClick } from './lib/titlebar';
import type { AppView, ContextTab, SettingsTab } from './lib/view-types';
import { MarkdownPreview } from './markdown-preview';
import { NotificationCenter, ToastHost, useNotifications } from './notifications';
import { ArtifactPage } from './views/ArtifactView';
import { ExpertsPage } from './views/ExpertsView';
import { KnowledgePage } from './views/KnowledgeView';
import { type MemoryManagementTarget, scopeOptionsFor } from './views/MemoryView';
import { SettingsPage } from './views/SettingsView';
import { SkillsPage } from './views/SkillsView';

const expertReferenceApplicableToWorkspace = (
  reference: MaterialReference,
  workspaceId?: string,
): boolean => {
  if (reference.kind !== 'artifact-version') return true;
  return Boolean(workspaceId && reference.originWorkspaceId === workspaceId);
};

/** 材料引用的身份键：同一精确版本重复引用只留一条（§3.6）。 */
const referenceKey = (reference: MaterialReference): string => {
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

const inputSnapshotCandidate = (snapshot: InputSnapshot): MaterialCandidate => ({
  reference: {
    kind: 'workspace-input-snapshot',
    snapshotId: snapshot.id,
    workspaceId: snapshot.workspaceId,
    contentHash: snapshot.contentHash,
    format: snapshot.format,
    fileKey: snapshot.fileKey,
  },
  title: fileNameOf(snapshot.sourcePath),
  sourceLabel: `工作区文件 · ${snapshot.sourcePath}`,
  status: snapshot.status === 'ready' ? 'ready' : 'unavailable',
  ...(snapshot.status === 'ready'
    ? {}
    : { detail: snapshot.failureMessage ?? '输入快照尚未准备完成' }),
});

export function App(): React.JSX.Element {
  // 三个自包含的状态簇各自成 hook；App 只保留跨簇的编排与布局。
  const appearanceState = useAppearance();
  const appearance = appearanceState.preference;
  const resolvedAppearance = appearanceState.resolved;
  const setAppearanceValue = appearanceState.update;

  const knowledge = useKnowledgeLibrary();
  const refreshKnowledge = knowledge.refresh;

  const modelSettings = useModelSettings();
  const activeLanguageModel = modelSettings.activeLanguageModel;
  const refreshModels = modelSettings.refresh;
  const experts = useExperts();
  const memoriesState = useMemories();
  const mcpState = useMcpConnections();

  const [prompt, setPrompt] = useState('计算: (12 + 8) * 3');
  const [taskBindings, setTaskBindings] = useState<CapabilityChip[]>([]);
  const [activeExpert, setActiveExpert] = useState<{
    id: string;
    revisionId: string;
    name: string;
    modelReference?: ExpertModelReference;
  }>();
  const [taskContext, setTaskContext] = useState<TaskContextRevision>();
  const [taskMaterials, setTaskMaterials] = useState<TaskMaterialSelection[]>([]);
  const [taskMemories, setTaskMemories] = useState<MemoryViewItem[]>([]);
  const [taskMemoriesError, setTaskMemoriesError] = useState('');
  const [taskMemoriesWarning, setTaskMemoriesWarning] = useState('');
  const taskMemoriesRequestRef = useRef(0);
  const [excludedMemoryIds, setExcludedMemoryIds] = useState<string[]>([]);
  const [mcpToolBindings, setMcpToolBindings] = useState<McpToolBinding[]>([]);
  const [discussionCheckpoints, setDiscussionCheckpoints] = useState<DiscussionCheckpoint[]>([]);
  /** 人工保存表单（产品设计 §3.1）：只带用户当场选中的片段，不预填整段回答。 */
  const [memoryCapture, setMemoryCapture] = useState<{
    runId: string;
    initialContent: string;
  }>();
  const [memoryCaptureError, setMemoryCaptureError] = useState('');
  const [pendingCandidateDelete, setPendingCandidateDelete] = useState<MemoryViewItem>();
  const expertModelReference = activeExpert?.modelReference;
  const expertModel =
    expertModelReference?.mode === 'profile'
      ? modelSettings.models.find((model) => model.id === expertModelReference.modelProfileId)
      : undefined;
  const composerModelLabel =
    activeExpert && !expertModelReference
      ? '专家修订模型（历史版本）'
      : activeExpert && expertModelReference?.mode === 'profile'
        ? expertModel && expertModel.enabled
          ? `${expertModel.provider} · ${expertModel.model}`
          : '专家指定模型不可用'
        : activeLanguageModel
          ? `${activeLanguageModel.provider} · ${activeLanguageModel.model}`
          : '未配置模型时使用教学 Provider';
  const [materialCandidates, setMaterialCandidates] = useState<MaterialCandidate[]>([]);
  const [expertMaterialCandidates, setExpertMaterialCandidates] = useState<MaterialCandidate[]>([]);
  const [materialPickerKind, setMaterialPickerKind] = useState<'knowledge' | 'artifact'>();
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialPickerError, setMaterialPickerError] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startingRef = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [allWorkspaces, setAllWorkspaces] = useState<WorkspaceSummary[]>([]);
  const workspaceIdRef = useRef<string | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<{ id: string; sessionId: string; title: string }>();
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const materialCandidatesRequestRef = useRef(0);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [taskRuns, setTaskRuns] = useState<RunSummary[]>([]);
  const [recentTasks, setRecentTasks] = useState<RecentTaskSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const runSelectionRequestRef = useRef(0);
  const taskRunsRequestRef = useRef(0);
  const evidenceRequestRef = useRef(0);
  const expertMaterialCandidatesRequestRef = useRef(0);
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [taskAllRuns, setTaskAllRuns] = useState<RunSummary[]>([]);
  const [taskAllEvents, setTaskAllEvents] = useState<Map<string, AgentRuntimeEvent[]>>(new Map());
  const { containerRef, latestReplyRef, detached, onScroll, jumpToLatest } = useTaskScroll(
    activeTask?.id,
    taskAllEvents,
    taskAllRuns.length,
  );
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail>();
  const [artifactNote, setArtifactNote] = useState<{ tone: 'ok' | 'error'; text: string }>();
  /** §3.6：来源专家不可用时不猜专家，改用通用助手并把这件事当场说出来。 */
  const [expertFallbackNotice, setExpertFallbackNotice] = useState<string>();
  // 跨视图的动作错误出口：开始任务、切换任务、停止执行、选择工作区等失败都在这里呈现，
  // 而不是像此前那样被 `void` 静默吞掉。
  const [actionError, setActionError] = useState('');
  const [view, setView] = useState<AppView>('work');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('betterwork-sidebar-collapsed') === 'true',
  );
  const [contextTab, setContextTab] = useState<ContextTab>('process');
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  const [memoryManagementTarget, setMemoryManagementTarget] = useState<MemoryManagementTarget>();
  const [memoryFocusId, setMemoryFocusId] = useState<string>();
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);

  // 记忆域的三个读取口各自只在可见时取数：面板与设置页不会同时打开，
  // 因此同一时刻最多一份建议轮询在跑（产品设计 §3.3）。
  const suggestionsVisible = view === 'work' && contextOpen && contextTab === 'memory';
  const suggestions = useMemorySuggestions({
    workspaceId: workspace?.id,
    visible: suggestionsVisible,
    taskId: activeTask?.id,
  });
  const settingsSuggestions = useMemorySuggestions({
    workspaceId: workspace?.id,
    visible: view === 'settings' && settingsTab === 'memory',
    taskId: undefined,
  });
  const runMemories = useRunMemories(
    {
      taskId: activeTask?.id,
      taskContextRevisionId: taskContext?.id,
      expectedTaskContextRevision: taskContext?.revision,
      prompt,
    },
    activeRunId,
  );
  const brief = useWorkspaceBrief({
    workspaceId: workspace?.id,
    expertId: activeExpert?.id,
  });
  const references = useWorkspaceReferences(workspace?.id);
  const memoryExclusion = useTaskMemoryExclusion();
  const taskCandidates = activeTask
    ? candidatesOfTask(suggestions.candidates, suggestions.jobs, activeTask.id)
    : [];
  // §3.1：有专家默认「专家与工作空间」，无专家默认「工作空间」；顺序即表单默认值。
  const memoryCaptureScopes = useMemo(
    () =>
      scopeOptionsFor(
        workspace?.id,
        activeExpert
          ? {
              expertId: activeExpert.id,
              expertName: activeExpert.name,
              ...(workspace ? { workspaceId: workspace.id } : {}),
            }
          : undefined,
      ),
    [activeExpert, workspace],
  );

  /**
   * 当前任务范围内的记忆清单（契约 §9.1 治理视图）。
   * 读取走 `Result` 收口：失败写进面板内联提示，迟到响应按序列号丢弃。
   */
  const reloadTaskMemories = useCallback((): Promise<void> => {
    const requestId = taskMemoriesRequestRef.current + 1;
    taskMemoriesRequestRef.current = requestId;
    if (!workspace) {
      setTaskMemories([]);
      setTaskMemoriesError('');
      setTaskMemoriesWarning('');
      return Promise.resolve();
    }
    return settleMemoryCall(
      window.betterwork.memories.list({
        workspaceId: workspace.id,
        ...(activeExpert ? { expertId: activeExpert.id } : {}),
      }),
      '加载当前任务记忆失败，请重试。',
    ).then((outcome) => {
      if (taskMemoriesRequestRef.current !== requestId) return;
      if (outcome.ok) {
        setTaskMemories(outcome.data.items);
        setTaskMemoriesError('');
        setTaskMemoriesWarning(outcome.warnings.map((warning) => warning.message).join('；'));
      } else {
        setTaskMemories([]);
        setTaskMemoriesWarning('');
        setTaskMemoriesError(outcome.message);
      }
    });
  }, [activeExpert, workspace]);

  useEffect(() => {
    trackAction(reloadTaskMemories(), '加载当前任务记忆');
  }, [reloadTaskMemories]);

  /** 人工保存：`create` 的失败已由 hook 收口，这里只把它呈现在表单旁边。 */
  const submitMemoryCapture = async (submission: MemoryEditorSubmission): Promise<boolean> => {
    if (submission.kind !== 'create') return false;
    const outcome = await memoriesState.create(submission.request);
    if (outcome.ok) {
      setMemoryCapture(undefined);
      setMemoryCaptureError('');
      await reloadTaskMemories();
      return true;
    }
    // 失败（含修订冲突）：表单不关闭、草稿与幂等键保留（契约 §5.6）。
    setMemoryCaptureError(outcome.message);
    return false;
  };

  const openMemoryPage = useCallback((): void => {
    setContextOpen(false);
    setView('settings');
    setSettingsTab('memory');
  }, []);

  const openMemoryPageAt = useCallback((memoryId: string): void => {
    setMemoryFocusId(memoryId);
    setContextOpen(false);
    setView('settings');
    setSettingsTab('memory');
  }, []);

  const actOnTaskCandidate = (candidate: MemoryViewItem, action: 'reject' | 'delete'): void => {
    trackAction(
      memoriesState
        .act({
          operationId: newMemoryOperationId(),
          id: candidate.id,
          expectedRevision: candidate.revision,
          action,
        })
        .then(() => reloadTaskMemories()),
      action === 'reject' ? '暂不采用建议' : '删除建议',
    );
  };

  const openBriefIssue = (issue: WorkspaceBriefOpenIssue): void => {
    const task = recentTasks.find((item) => item.id === issue.taskId);
    if (!task) {
      setActionError('这条未决事项所属的任务不在当前空间的任务列表里，请从任务列表打开。');
      return;
    }
    reportAction(selectTask(task), setActionError, '无法打开这条未决事项对应的任务。');
  };

  const openBriefReference = (item: WorkspaceReferenceListItem): void => {
    reportAction(
      window.betterwork.artifacts.get({ id: item.artifactId }).then((artifact) => {
        if (!artifact) {
          setActionError('该参考版本对应的成果已不存在，请在成果列表中确认。');
          return;
        }
        setSelectedArtifact(artifact);
        setContextOpen(false);
        setView('artifacts');
      }),
      setActionError,
      '无法打开该参考版本的成果。',
    );
  };

  /** §3.6「引用到当前任务」：固定精确版本，不改当前专家，不自动发送。 */
  const referenceVersionToTask = (artifactVersionId: string): void => {
    reportAction(
      references.ensureReference(artifactVersionId).then((result) => {
        if (!result.ok || result.material === undefined) {
          setActionError(result.message || '无法把该版本设为参考，请重试。');
          return;
        }
        const reference = result.material;
        setTaskMaterials((current) =>
          current.some((existing) => referenceKey(existing.reference) === referenceKey(reference))
            ? current
            : [...current, { reference, purpose: 'structure-reference', addedFrom: 'user-input' }],
        );
        if (activeTask?.id) refreshMaterialCandidates(activeTask.id);
        setContextOpen(false);
        setView('work');
      }),
      setActionError,
      '引用该版本到当前任务失败。',
    );
  };

  useEffect(() => {
    const requestId = expertMaterialCandidatesRequestRef.current + 1;
    expertMaterialCandidatesRequestRef.current = requestId;
    if (view !== 'experts' || !workspace) {
      setExpertMaterialCandidates([]);
      return;
    }
    trackAction(
      window.betterwork.materials
        .listCandidates({ workspaceId: workspace.id })
        .then((candidates) => {
          if (expertMaterialCandidatesRequestRef.current === requestId) {
            setExpertMaterialCandidates(candidates);
          }
        }),
      '加载专家常用参考候选',
    );
  }, [view, workspace]);

  useEffect(() => {
    if (view === 'work' && taskBindings.length > 0) composerRef.current?.focus();
  }, [view, taskBindings.length]);
  /**
   * 列表刷新属于后台同步：失败时用户无法据以行动，但也不能完全无痕。
   * 统一走 trackAction 记录到控制台，并对调用方保证「永不 reject」，
   * 因此这些函数返回 void，调用点不需要也不应该 await。
   */
  const refreshRuns = useCallback((): void => {
    trackAction(window.betterwork.runs.list().then(setRuns), '刷新运行列表');
  }, []);
  const refreshTaskRuns = useCallback((taskId = activeTaskIdRef.current): void => {
    const requestId = taskRunsRequestRef.current + 1;
    taskRunsRequestRef.current = requestId;
    if (!taskId) {
      setTaskRuns([]);
      return;
    }
    trackAction(
      window.betterwork.runs.list({ taskId }).then((loaded) => {
        if (taskRunsRequestRef.current === requestId && activeTaskIdRef.current === taskId) {
          setTaskRuns(loaded);
        }
      }),
      '刷新任务运行记录',
    );
  }, []);
  const refreshTasks = useCallback((workspaceId = workspaceIdRef.current): void => {
    trackAction(
      window.betterwork.tasks.list(workspaceId ? { workspaceId } : undefined).then(setRecentTasks),
      '刷新最近任务',
    );
  }, []);
  const refreshEvidence = useCallback((taskId = activeTaskIdRef.current): void => {
    const requestId = evidenceRequestRef.current + 1;
    evidenceRequestRef.current = requestId;
    if (!taskId) {
      setEvidence([]);
      return;
    }
    trackAction(
      window.betterwork.evidence.list({ taskId }).then((loaded) => {
        if (evidenceRequestRef.current === requestId && activeTaskIdRef.current === taskId) {
          setEvidence(loaded);
        }
      }),
      '刷新引用资料',
    );
  }, []);
  const refreshDiscussionCheckpoints = useCallback((taskId = activeTaskIdRef.current): void => {
    if (!taskId) {
      setDiscussionCheckpoints([]);
      return;
    }
    trackAction(
      window.betterwork.discussionCheckpoints.list({ taskId }).then(setDiscussionCheckpoints),
      '刷新讨论节点',
    );
  }, []);
  const refreshArtifacts = useCallback((): void => {
    trackAction(window.betterwork.artifacts.list().then(setArtifacts), '刷新成果列表');
  }, []);
  const loadAllTaskRuns = useCallback((taskId: string): void => {
    trackAction(
      (async () => {
        const allRuns = await window.betterwork.runs.list({ taskId });
        const ordered = [...allRuns].sort((a, b) => a.createdAt - b.createdAt);
        const eventsMap = new Map<string, AgentRuntimeEvent[]>();
        await Promise.all(
          ordered.map(async (run) => {
            const runEvents = await window.betterwork.runs.listEvents({ runId: run.id });
            eventsMap.set(run.id, runEvents);
          }),
        );
        if (activeTaskIdRef.current !== taskId) return;
        setTaskAllRuns(ordered);
        setTaskAllEvents(eventsMap);
      })(),
      '加载任务全部执行记录',
    );
  }, []);

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
    trackAction(window.betterwork.workspace.listAll().then(setAllWorkspaces), '加载工作区列表');
    return window.betterwork.runs.onEvent((event) => {
      setEvents((current) =>
        event.runId === activeRunIdRef.current ? [...current, event] : current,
      );
      setTaskAllEvents((prev) => {
        const existing = prev.get(event.runId);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(event.runId, [...existing, event]);
        return next;
      });
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        refreshRuns();
        refreshTaskRuns();
        refreshTasks();
        refreshEvidence();
        refreshDiscussionCheckpoints();
        refreshArtifacts();
        if (activeTaskIdRef.current) loadAllTaskRuns(activeTaskIdRef.current);
      }
    });
  }, [
    refreshRuns,
    refreshModels,
    refreshKnowledge,
    refreshArtifacts,
    refreshTasks,
    refreshTaskRuns,
    refreshEvidence,
    refreshDiscussionCheckpoints,
    loadAllTaskRuns,
  ]);

  useEffect(() => {
    window.localStorage.setItem('betterwork-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const activeRun = runs.find((run) => run.id === activeRunId);
  const latestCompletedRun = useMemo(() => {
    for (let i = taskAllRuns.length - 1; i >= 0; i--) {
      const run = taskAllRuns[i];
      if (!run) continue;
      const runEvents = taskAllEvents.get(run.id) ?? [];
      if (runEvents.some((event) => event.type === 'run.completed')) {
        const content = finalRunContent(runEvents);
        if (content) return { id: run.id, content };
      }
    }
    return undefined;
  }, [taskAllRuns, taskAllEvents]);
  const isRunning =
    activeRun?.status === 'running' ||
    events.at(-1)?.type === 'run.started' ||
    (!!activeRunId &&
      !events.some((event) =>
        ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
      ));
  const activityGroups = useMemo(() => deriveActivityGroups(events), [events]);
  const currentTaskArtifacts = artifacts.filter((artifact) => artifact.taskId === activeTask?.id);
  const artifactInputRelations = useMemo<ArtifactInputRelationInput[]>(
    () =>
      taskMaterials.map((selection) => ({
        input: selection.reference,
        relation:
          selection.purpose === 'rule'
            ? 'rule'
            : selection.purpose === 'current-input'
              ? 'data'
              : selection.purpose === 'historical-comparison'
                ? 'comparison'
                : selection.purpose === 'structure-reference'
                  ? 'structure'
                  : selection.purpose === 'template'
                    ? 'template'
                    : selection.purpose === 'background'
                      ? 'background'
                      : 'other',
      })),
    [taskMaterials],
  );

  const startNewTask = (): void => {
    runSelectionRequestRef.current += 1;
    activeRunIdRef.current = undefined;
    activeTaskIdRef.current = undefined;
    setActiveRunId(undefined);
    setActiveTask(undefined);
    setTaskRuns([]);
    setTaskAllRuns([]);
    setTaskAllEvents(new Map());
    setTaskBindings([]);
    setActiveExpert(undefined);
    setTaskContext(undefined);
    setTaskMaterials([]);
    setTaskMemories([]);
    setExcludedMemoryIds([]);
    setMcpToolBindings([]);
    setDiscussionCheckpoints([]);
    setMemoryCapture(undefined);
    setMemoryCaptureError('');
    setMaterialCandidates([]);
    setMaterialPickerKind(undefined);
    setMaterialPickerError('');
    setActionError('');
    setEvidence([]);
    setEvents([]);
    setPrompt('');
    setArtifactNote(undefined);
    setView('work');
  };
  const skills = useSkills({
    onTestRunRequested: (skill) => {
      startNewTask();
      setTaskBindings([{ kind: 'skill', id: skill.id, name: skill.name, status: 'ready' }]);
      setContextOpen(false);
    },
  });
  const skillChipForBinding = useCallback(
    (binding: {
      skillId: string;
      revisionId: string;
      source?: 'expert-preset' | 'task-selection';
    }): CapabilityChip => {
      const skill = skills.skills.find((item) => item.id === binding.skillId);
      const status: CapabilityChip['status'] =
        skill &&
        skill.enabled &&
        skill.trustStatus === 'trusted' &&
        skill.environmentStatus === 'ready'
          ? 'ready'
          : 'dependency-missing';
      return {
        kind: 'skill',
        id: binding.skillId,
        name: skill?.name ?? binding.skillId,
        revisionId: binding.revisionId,
        status,
        ...(binding.source ? { source: binding.source } : {}),
      };
    },
    [skills.skills],
  );
  const refreshMaterialCandidates = useCallback((taskId: string): void => {
    const requestId = materialCandidatesRequestRef.current + 1;
    materialCandidatesRequestRef.current = requestId;
    trackAction(
      window.betterwork.materials.listCandidates({ taskId }).then((candidates) => {
        if (
          materialCandidatesRequestRef.current === requestId &&
          activeTaskIdRef.current === taskId
        ) {
          setMaterialCandidates(candidates);
        }
      }),
      '加载任务材料候选',
    );
  }, []);
  const loadTaskContext = useCallback(
    async (taskId: string, selectionId: number): Promise<TaskContextRevision | undefined> => {
      const context = await window.betterwork.taskContexts.get({ taskId });
      if (selectionId !== runSelectionRequestRef.current) return undefined;
      setTaskContext(context ?? undefined);
      setTaskMaterials(context?.materials ?? []);
      refreshMaterialCandidates(taskId);
      setExcludedMemoryIds(context?.excludedMemoryIds ?? []);
      setMcpToolBindings(context?.mcpToolBindings ?? []);
      if (!context || context.executor.kind === 'general') {
        setActiveExpert(undefined);
      } else {
        const expert = await window.betterwork.experts.get({ id: context.executor.expertId });
        if (selectionId !== runSelectionRequestRef.current) return undefined;
        if (expert) {
          setActiveExpert({
            id: expert.id,
            revisionId: context.executor.expertRevisionId,
            name: expert.name,
            ...(expert.revision.id === context.executor.expertRevisionId
              ? { modelReference: expert.revision.modelReference }
              : {}),
          });
        } else {
          setActiveExpert(undefined);
        }
      }
      setTaskBindings(context?.skillBindings.map(skillChipForBinding) ?? []);
      return context ?? undefined;
    },
    [refreshMaterialCandidates, skillChipForBinding],
  );
  const summonExpert = useCallback(
    async (summary: ExpertSummary): Promise<void> => {
      if (summary.lifecycle !== 'active') throw new Error('该专家已停用或归档。');
      const detail = await window.betterwork.experts.get({ id: summary.id });
      if (!detail) throw new Error('专家已不存在，请刷新后重试。');
      startNewTask();
      setActiveExpert({
        id: detail.id,
        revisionId: detail.revision.id,
        name: detail.name,
        modelReference: detail.revision.modelReference,
      });
      setTaskMaterials(
        (detail.revision.referenceMaterials ?? [])
          .filter((material) =>
            expertReferenceApplicableToWorkspace(material.reference, workspace?.id),
          )
          .map((material) => ({ ...material, addedFrom: 'expert-reference' as const })),
      );
      setMaterialCandidates(expertMaterialCandidates);
      setMcpToolBindings(detail.revision.mcpToolBindings ?? []);
      setTaskBindings(
        detail.revision.skillPreset.map((binding) =>
          skillChipForBinding({ ...binding, source: 'expert-preset' }),
        ),
      );
      setView('work');
    },
    [expertMaterialCandidates, skillChipForBinding, workspace?.id],
  );
  const commitTaskMaterials = useCallback((materials: TaskMaterialSelection[]): void => {
    setTaskMaterials(materials);
    setMaterialPickerError('');
  }, []);
  const requestMaterials = useCallback(
    (kind: 'file' | 'knowledge' | 'artifact'): void => {
      if (!workspace) {
        setMaterialPickerError('工作空间尚未准备好，请稍后重试。');
        return;
      }
      if (kind === 'file') {
        setMaterialPickerKind(undefined);
        reportAction(
          window.betterwork.materials
            .prepareInputSnapshot({
              ...(activeTask?.id ? { taskId: activeTask.id } : { workspaceId: workspace.id }),
            })
            .then((snapshot) => {
              if (!snapshot) return;
              const candidate = inputSnapshotCandidate(snapshot);
              const selection: TaskMaterialSelection = {
                reference: {
                  kind: 'workspace-input-snapshot',
                  snapshotId: snapshot.id,
                  workspaceId: snapshot.workspaceId,
                  contentHash: snapshot.contentHash,
                  format: snapshot.format,
                  fileKey: snapshot.fileKey,
                },
                purpose: 'current-input',
                addedFrom: 'user-input',
              };
              setTaskMaterials((current) => {
                const exists = current.some(
                  (item) =>
                    item.reference.kind === 'workspace-input-snapshot' &&
                    item.reference.snapshotId === snapshot.id,
                );
                return exists ? current : [...current, selection];
              });
              materialCandidatesRequestRef.current += 1;
              setMaterialCandidates((current) => [
                ...current.filter(
                  (item) =>
                    item.reference.kind !== 'workspace-input-snapshot' ||
                    item.reference.snapshotId !== snapshot.id,
                ),
                candidate,
              ]);
              setMaterialPickerError('');
            }),
          setActionError,
          '无法添加工作区文件，请重试。',
        );
        return;
      }
      setMaterialPickerKind(kind);
      setMaterialsLoading(true);
      setMaterialPickerError('');
      reportAction(
        window.betterwork.materials
          .listCandidates({
            ...(activeTask?.id ? { taskId: activeTask.id } : { workspaceId: workspace.id }),
          })
          .then(setMaterialCandidates)
          .catch((error: unknown) => {
            setMaterialPickerError(error instanceof Error ? error.message : '候选材料加载失败。');
          })
          .finally(() => setMaterialsLoading(false)),
        setActionError,
        '无法加载候选材料，请重试。',
      );
    },
    [activeTask?.id, workspace],
  );
  const startRun = async (): Promise<void> => {
    if (startingRef.current || isRunning || !prompt.trim() || !workspace) return;
    startingRef.current = true;
    setIsStarting(true);
    setActionError('');
    try {
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
      const contextResult = await window.betterwork.taskContexts.save({
        taskId: task.id,
        ...(taskContext ? { expectedRevision: taskContext.revision } : {}),
        executor: activeExpert
          ? {
              kind: 'expert',
              expertId: activeExpert.id,
              expertRevisionId: activeExpert.revisionId,
            }
          : { kind: 'general' },
        skillBindings: taskBindings.map((chip) => ({
          skillId: chip.id,
          revisionId:
            chip.revisionId ??
            skills.skills.find((skill) => skill.id === chip.id)?.currentRevisionId ??
            '',
          source: chip.source ?? 'task-selection',
        })),
        materials: taskMaterials,
        excludedMemoryIds,
        mcpToolBindings,
      });
      setTaskContext(contextResult.context);
      const result = await window.betterwork.runs.start({
        taskId: task.id,
        sessionId: task.sessionId,
        prompt,
        taskContextRevisionId: contextResult.context.id,
        expectedTaskContextRevision: contextResult.context.revision,
      });
      runSelectionRequestRef.current += 1;
      activeRunIdRef.current = result.runId;
      setActiveRunId(result.runId);
      setEvents([]);
      setPrompt('');
      setArtifactNote(undefined);
      setContextTab('process');
      const newRun: RunSummary = {
        id: result.runId,
        taskId: task.id,
        sessionId: task.sessionId,
        prompt,
        status: 'running',
        createdAt: Date.now(),
      };
      setTaskAllRuns((prev) => [...prev, newRun]);
      setTaskAllEvents((prev) => {
        const next = new Map(prev);
        next.set(result.runId, []);
        return next;
      });
      refreshRuns();
      refreshTaskRuns(task.id);
      refreshTasks();
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    reportAction(startRun(), setActionError, '无法开始这项工作，请重试。');
  };
  const createDiscussionCheckpoint = async (
    input: CreateDiscussionCheckpointRequest,
  ): Promise<void> => {
    try {
      const result = await window.betterwork.discussionCheckpoints.create(input);
      setDiscussionCheckpoints((current) => [...current, result.checkpoint]);
    } catch (error: unknown) {
      setActionError(describeActionError(error, '无法保存讨论节点，请重试。'));
      throw error;
    }
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
    setTaskBindings([]);
    setActiveExpert(undefined);
    setTaskContext(undefined);
    const requestId = runSelectionRequestRef.current + 1;
    runSelectionRequestRef.current = requestId;
    activeRunIdRef.current = run.id;
    activeTaskIdRef.current = run.taskId;
    setActiveRunId(run.id);
    setActiveTask({ id: run.taskId, sessionId: run.sessionId, title: run.prompt.slice(0, 80) });
    setPrompt('');
    setArtifactNote(undefined);
    setEvents([]);
    await loadTaskContext(run.taskId, requestId);
    if (runSelectionRequestRef.current !== requestId) return;
    const snapshot = await window.betterwork.runs.listEvents({ runId: run.id });
    if (runSelectionRequestRef.current !== requestId) return;
    setEvents((current) => mergeRunEvents(snapshot, current));
    refreshTaskRuns(run.taskId);
    refreshEvidence(run.taskId);
    refreshDiscussionCheckpoints(run.taskId);
    loadAllTaskRuns(run.taskId);
    setView('work');
  };
  const selectTask = async (task: RecentTaskSummary): Promise<void> => {
    setTaskAllRuns([]);
    setTaskAllEvents(new Map());
    setTaskRuns([]);
    setTaskBindings([]);
    setActiveExpert(undefined);
    setTaskContext(undefined);
    runSelectionRequestRef.current += 1;
    activeRunIdRef.current = undefined;
    activeTaskIdRef.current = task.id;
    setActiveRunId(undefined);
    setActiveTask({ id: task.id, sessionId: task.sessionId, title: task.title });
    setPrompt('');
    setArtifactNote(undefined);
    setEvents([]);
    const selectionId = runSelectionRequestRef.current;
    const loadedContext = await loadTaskContext(task.id, selectionId);
    if (selectionId !== runSelectionRequestRef.current) return;
    loadAllTaskRuns(task.id);
    refreshEvidence(task.id);
    refreshDiscussionCheckpoints(task.id);
    refreshTaskRuns(task.id);
    setView('work');
    const loadedRuns = await window.betterwork.runs.list({ taskId: task.id });
    if (selectionId !== runSelectionRequestRef.current) return;
    const latest = [...loadedRuns].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return;
    // 旧任务没有 TaskContextRevision 时，才兼容恢复最近一次 Run 的 Skill chip；不补造 Expert 身份。
    if (!loadedContext && latest.bindings && latest.bindings.length > 0) {
      setTaskBindings(
        latest.bindings.map((binding) => ({
          kind: 'skill' as const,
          id: binding.skillId,
          name: binding.skillName,
          source: 'task-selection' as const,
          status: 'ready' as const,
        })),
      );
    }
    activeRunIdRef.current = latest.id;
    setActiveRunId(latest.id);
    const snapshot = await window.betterwork.runs.listEvents({ runId: latest.id });
    if (selectionId !== runSelectionRequestRef.current) return;
    setEvents((current) => mergeRunEvents(snapshot, current));
  };
  const saveCurrentArtifact = async (): Promise<void> => {
    if (!activeTask || !latestCompletedRun) return;
    try {
      const artifact = await window.betterwork.artifacts.saveMarkdown({
        ...(currentTaskArtifacts[0] ? { artifactId: currentTaskArtifacts[0].id } : {}),
        taskId: activeTask.id,
        origin: 'assistant-run',
        runId: latestCompletedRun.id,
        title: activeTask.title,
        content: latestCompletedRun.content,
        ...(artifactInputRelations.length > 0 ? { inputRelations: artifactInputRelations } : {}),
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
  const startFromArtifactVersion = async (
    artifact: ArtifactDetail,
    version: ArtifactVersionDetail,
  ): Promise<void> => {
    if (artifact.type !== 'markdown' || version.type !== 'markdown') {
      throw new Error('当前仅支持以 Markdown 成果版本开始新任务。');
    }
    const sourceContext = await window.betterwork.taskContexts.get({ taskId: artifact.taskId });
    let sourceExpert: { id: string; revisionId: string; name: string } | undefined;
    let unavailableExpertName: string | undefined;
    if (sourceContext?.executor.kind === 'expert') {
      const expert = await window.betterwork.experts.get({ id: sourceContext.executor.expertId });
      if (expert?.lifecycle === 'active') {
        sourceExpert = {
          id: expert.id,
          revisionId: expert.revision.id,
          name: expert.name,
        };
      } else {
        unavailableExpertName = expert?.name;
      }
    }
    startNewTask();
    setSelectedArtifact(undefined);
    setExpertFallbackNotice(
      sourceExpert || sourceContext?.executor.kind !== 'expert'
        ? undefined
        : unavailableExpertName === undefined
          ? '来源任务的专家已不可用，新任务先用通用助手。'
          : `专家「${unavailableExpertName}」已不可用，新任务先用通用助手。`,
    );
    if (sourceExpert) {
      setActiveExpert(sourceExpert);
      setTaskBindings(
        sourceContext?.skillBindings.map((binding) =>
          skillChipForBinding({ ...binding, source: 'expert-preset' }),
        ) ?? [],
      );
    }
    setTaskMaterials([
      {
        reference: {
          kind: 'artifact-version',
          artifactId: artifact.id,
          artifactVersionId: version.id,
          contentHash: version.contentHash,
          originWorkspaceId: artifact.workspaceId,
        },
        purpose: 'historical-comparison',
        addedFrom: artifact.workspaceId === workspace?.id ? 'user-input' : 'global-search',
      },
    ]);
    setMaterialCandidates([
      {
        reference: {
          kind: 'artifact-version',
          artifactId: artifact.id,
          artifactVersionId: version.id,
          contentHash: version.contentHash,
          originWorkspaceId: artifact.workspaceId,
        },
        title: artifact.title,
        sourceLabel: `成果 · ${artifact.title}`,
        status: 'ready',
        detail: `v${version.versionNumber}`,
      },
    ]);
    setView('work');
    setContextOpen(false);
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
  ): Promise<{ cancelled: boolean; filePath?: string }> => {
    if (artifact.type === 'presentation') {
      return window.betterwork.artifacts.exportFile({
        artifactId: artifact.id,
        ...(versionId ? { versionId } : {}),
      });
    }
    return window.betterwork.artifacts.exportMarkdown({
      artifactId: artifact.id,
      ...(versionId ? { versionId } : {}),
    });
  };
  const openFileArtifact = (
    artifactId: string,
    versionId?: string,
  ): Promise<{ opened: boolean; error?: string }> =>
    window.betterwork.artifacts.openFile({
      artifactId,
      ...(versionId ? { versionId } : {}),
    });
  const openKnowledge = (): void => {
    setView('knowledge');
    refreshKnowledge();
  };
  const startResearchFromKnowledge = (query: string, sourceCount: number): void => {
    if (isRunning) {
      setActionError('当前任务仍在执行，请等待完成后再开始新的研究。');
      return;
    }
    startNewTask();
    setPrompt(buildResearchPrompt(query, sourceCount));
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
          <button
            className={view === 'skills' ? 'active' : ''}
            onClick={() => {
              setView('skills');
              skills.refresh();
            }}
          >
            <span aria-hidden="true">
              <CapabilityIcon size={15} />
            </span>{' '}
            技能
          </button>
          <button
            className={view === 'experts' ? 'active' : ''}
            onClick={() => {
              setView('experts');
              experts.refresh();
            }}
          >
            <span aria-hidden="true">
              <ExpertIcon size={15} />
            </span>{' '}
            专家
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
              setMemoryManagementTarget(undefined);
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
            <PageHeader
              eyebrow="工作"
              title={taskAllRuns.length > 0 || activeRun ? '继续完成任务' : '开始一件工作'}
              actions={
                <button className="context-toggle" onClick={() => setContextOpen((open) => !open)}>
                  {contextOpen ? '收起上下文' : '查看上下文'}
                </button>
              }
            />
            <div className="workspace">
              {activeTask && (
                <DiscussionCheckpointPanel
                  taskId={activeTask.id}
                  {...(activeRunId ? { runId: activeRunId } : {})}
                  checkpoints={discussionCheckpoints}
                  artifacts={currentTaskArtifacts}
                  onCreate={createDiscussionCheckpoint}
                />
              )}
              <div className="messages" ref={containerRef} onScroll={onScroll}>
                <div className="page-body">
                  {taskAllRuns.length === 0 && !activeRunId ? (
                    taskBindings.length > 0 ? (
                      <div className="welcome">
                        <p className="eyebrow">Skill 试运行</p>
                        <h2>{taskBindings.map((chip) => chip.name).join('、')}</h2>
                        <p>输入这次任务的具体要求，点击「开始工作」后执行。</p>
                      </div>
                    ) : (
                      <Welcome setPrompt={setPrompt} />
                    )
                  ) : (
                    <>
                      {taskAllRuns.map((run, idx) => {
                        const runEvents = taskAllEvents.get(run.id) ?? [];
                        const runAssistantText =
                          finalRunContent(runEvents) ?? extractAssistantText(runEvents);
                        const runFailure = runEvents.find((event) => event.type === 'run.failed');
                        const isRunActive = run.id === activeRunId;
                        const runIsCompleted = runEvents.some(
                          (event) => event.type === 'run.completed',
                        );
                        const isLatestCompleted =
                          runIsCompleted &&
                          run.id ===
                            [...taskAllRuns].reverse().find((r) => {
                              const evts = taskAllEvents.get(r.id) ?? [];
                              return evts.some((event) => event.type === 'run.completed');
                            })?.id;

                        return (
                          <div key={run.id} className="run-group">
                            {idx > 0 && (
                              <div className="run-divider">
                                <span>{formatTime(run.createdAt)}</span>
                              </div>
                            )}
                            <div className="message user">
                              <span>你</span>
                              <p>{run.prompt}</p>
                            </div>
                            <ToolActivity key={run.id} events={runEvents} />
                            {runAssistantText && (
                              <div
                                className="message assistant"
                                ref={idx === taskAllRuns.length - 1 ? latestReplyRef : undefined}
                              >
                                <span>算台</span>
                                <MarkdownPreview content={runAssistantText} variant="message" />
                              </div>
                            )}
                            {runFailure?.type === 'run.failed' && (
                              <p className="action-note error run-failure-note" role="alert">
                                本次运行未完成，回复内容未登记为正式成果。{runFailure.error}
                              </p>
                            )}
                            {isLatestCompleted && runAssistantText && (
                              <div className="message-actions">
                                <button
                                  className="message-action"
                                  onClick={() => {
                                    // §3.1：只预填用户当场选中的片段，不把整段回答当作经验。
                                    const selected = window
                                      .getSelection()
                                      ?.toString()
                                      .trim()
                                      .slice(0, MEMORY_CONTENT_MAX_CODE_POINTS);
                                    setMemoryCapture({
                                      runId: run.id,
                                      initialContent: selected ?? '',
                                    });
                                    setMemoryCaptureError('');
                                  }}
                                >
                                  记住这段经验
                                </button>
                                <button
                                  className="message-action"
                                  onClick={() => trackAction(saveCurrentArtifact(), '保存成果')}
                                  disabled={currentTaskArtifacts.some(
                                    (artifact) => artifact.sourceRunId === run.id,
                                  )}
                                >
                                  <ArtifactIcon size={13} />
                                  {currentTaskArtifacts.some(
                                    (artifact) => artifact.sourceRunId === run.id,
                                  )
                                    ? '已保存为成果'
                                    : '保存为成果'}
                                </button>
                                {artifactNote && (
                                  <span
                                    className={
                                      artifactNote.tone === 'ok'
                                        ? 'action-note ok'
                                        : 'action-note error'
                                    }
                                  >
                                    {artifactNote.text}
                                  </span>
                                )}
                              </div>
                            )}
                            {memoryCapture?.runId === run.id && (
                              <div className="memory-capture">
                                <p className="memory-capture-hint">
                                  先在上方回答中选中要沉淀的片段可自动带入；表单内容以你最终确认为准。
                                </p>
                                <MemoryEditor
                                  scopes={memoryCaptureScopes}
                                  initialContent={memoryCapture.initialContent}
                                  sourceNote="由你在任务里手工确认，正文即来源，不调用模型"
                                  submitLabel="确认并记住"
                                  onSubmit={submitMemoryCapture}
                                  onCancel={() => {
                                    setMemoryCapture(undefined);
                                    setMemoryCaptureError('');
                                  }}
                                />
                                {memoryCaptureError && (
                                  <p className="inline-message error" role="alert">
                                    {memoryCaptureError}
                                  </p>
                                )}
                              </div>
                            )}
                            {isRunActive &&
                              runEvents.length > 0 &&
                              !runEvents.some((event) =>
                                ['run.completed', 'run.failed', 'run.cancelled'].includes(
                                  event.type,
                                ),
                              ) && <div className="run-running-indicator">正在执行…</div>}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
              {detached && (
                <div className="latest-message-control">
                  <button type="button" className="secondary-button" onClick={jumpToLatest}>
                    回到最新
                  </button>
                </div>
              )}
              <form className="composer" onSubmit={submit}>
                <div className="workspace-row">
                  <WorkspaceSelector
                    currentWorkspace={workspace}
                    workspaces={allWorkspaces}
                    onSelectWorkspace={(selected) => {
                      startNewTask();
                      setTaskBindings(taskBindings);
                      workspaceIdRef.current = selected.id;
                      setWorkspace(selected);
                      refreshTasks(selected.id);
                    }}
                    onOpenLocalFolder={() =>
                      reportAction(
                        window.betterwork.workspace.selectDirectory().then((selected) => {
                          if (selected) {
                            startNewTask();
                            setTaskBindings(taskBindings);
                            workspaceIdRef.current = selected.id;
                            setWorkspace(selected);
                            refreshTasks(selected.id);
                            trackAction(
                              window.betterwork.workspace.listAll().then(setAllWorkspaces),
                              '刷新工作区列表',
                            );
                          }
                        }),
                        setActionError,
                        '选择工作区失败，请重试。',
                      )
                    }
                    onNewWorkspace={() =>
                      reportAction(
                        window.betterwork.workspace.selectDirectory().then((selected) => {
                          if (selected) {
                            startNewTask();
                            setTaskBindings(taskBindings);
                            workspaceIdRef.current = selected.id;
                            setWorkspace(selected);
                            refreshTasks(selected.id);
                            trackAction(
                              window.betterwork.workspace.listAll().then(setAllWorkspaces),
                              '刷新工作区列表',
                            );
                          }
                        }),
                        setActionError,
                        '新建工作区失败，请重试。',
                      )
                    }
                  />
                </div>
                <div className="composer-capability-row">
                  {activeExpert && (
                    <div className="expert-chip-bar" role="list" aria-label="当前专家">
                      <div className="expert-chip" role="listitem">
                        <ExpertIcon size={12} />
                        <span>{activeExpert.name}</span>
                        <button
                          type="button"
                          className="capability-chip-remove"
                          aria-label={`移除专家 ${activeExpert.name}`}
                          onClick={() => {
                            setActiveExpert(undefined);
                            setTaskContext(undefined);
                            setTaskBindings((current) =>
                              current.filter((chip) => chip.source !== 'expert-preset'),
                            );
                          }}
                          disabled={isRunning}
                        >
                          <CloseIcon size={10} />
                        </button>
                      </div>
                    </div>
                  )}
                  <ComposerCapabilityPicker
                    skills={skills.skills}
                    selected={taskBindings}
                    materials={taskMaterials}
                    materialCandidates={materialCandidates}
                    {...(workspace ? { workspaceId: workspace.id } : {})}
                    {...(materialPickerKind ? { materialPickerKind } : {})}
                    materialsLoading={materialsLoading}
                    {...(materialPickerError ? { materialPickerError } : {})}
                    disabled={isRunning}
                    {...(isRunning ? { disabledReason: '运行中不可修改' } : {})}
                    onAdd={(chip) => setTaskBindings((prev) => [...prev, chip])}
                    onRemove={(id) =>
                      setTaskBindings((prev) => prev.filter((chip) => chip.id !== id))
                    }
                    onRequestSkillDetail={() => {
                      setView('skills');
                    }}
                    onRequestExpert={() => {
                      setView('experts');
                      experts.refresh();
                    }}
                    onRequestMaterials={requestMaterials}
                    onDismissMaterialPicker={() => setMaterialPickerKind(undefined)}
                    onCommitMaterials={commitTaskMaterials}
                  />
                </div>
                <textarea
                  ref={composerRef}
                  aria-label="任务输入，按 Command 或 Control 加 Enter 开始工作"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  rows={3}
                  placeholder="告诉算台你想完成什么工作…"
                />
                <div className="composer-footer">
                  <span>
                    {composerModelLabel} <kbd>⌘/Ctrl ↵</kbd>
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
                    <button type="submit" disabled={isStarting || !prompt.trim() || !workspace}>
                      {isStarting ? '正在启动…' : '开始工作'} <ArrowUpIcon size={13} />
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
            onOpenFile={openFileArtifact}
            onOpenSource={knowledge.onOpenSource}
            onStartFromVersion={startFromArtifactVersion}
            references={references}
            onReferenceToTask={referenceVersionToTask}
            onBack={() => setSelectedArtifact(undefined)}
          />
        )}
        {view === 'knowledge' && (
          <KnowledgePage library={knowledge} onStartResearch={startResearchFromKnowledge} />
        )}
        {view === 'skills' && <SkillsPage state={skills} />}
        {view === 'experts' && (
          <ExpertsPage
            state={experts}
            skills={skills.skills}
            mcpConnections={mcpState.connections}
            memories={memoriesState.memories}
            models={modelSettings.models}
            materialCandidates={expertMaterialCandidates}
            {...(workspace ? { workspaceId: workspace.id } : {})}
            actions={experts}
            onSummon={summonExpert}
            onError={setActionError}
            onManageMemories={(expert) => {
              setMemoryManagementTarget({
                expertId: expert.id,
                expertName: expert.name,
                ...(workspace ? { workspaceId: workspace.id } : {}),
              });
              setView('settings');
              setSettingsTab('memory');
            }}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            tab={settingsTab}
            setTab={setSettingsTab}
            models={modelSettings.filteredModels}
            modelFilter={modelSettings.filter}
            setModelFilter={modelSettings.setFilter}
            activeLanguageModel={activeLanguageModel}
            defaultModelIds={modelSettings.defaultModelIds}
            onAdd={() => modelSettings.openEditor()}
            onEdit={modelSettings.openEditor}
            onToggle={modelSettings.onToggle}
            onSetDefault={modelSettings.onSetDefault}
            onDelete={modelSettings.onDelete}
            appearance={appearance}
            resolvedAppearance={resolvedAppearance}
            onMode={(mode) => setAppearanceValue({ ...appearance, mode })}
            onScheme={(scheme) => setAppearanceValue({ ...appearance, scheme })}
            memories={memoriesState}
            {...(memoryManagementTarget ? { memoryTarget: memoryManagementTarget } : {})}
            onClearMemoryTarget={() => setMemoryManagementTarget(undefined)}
            memorySuggestions={settingsSuggestions}
            {...(workspace ? { workspaceId: workspace.id, workspaceName: workspace.name } : {})}
            {...(activeExpert ? { expertName: activeExpert.name } : {})}
            {...(memoryFocusId ? { memoryFocusId } : {})}
            onClearMemoryFocus={() => setMemoryFocusId(undefined)}
            mcp={mcpState}
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
          materials={taskMaterials}
          memories={taskMemories}
          excludedMemoryIds={excludedMemoryIds}
          onToggleMemory={(memoryId) => {
            if (!taskContext) {
              setActionError('任务上下文还没有建立，暂不能调整本任务的记忆范围。');
              return;
            }
            trackAction(
              memoryExclusion.toggle(taskContext, memoryId).then((saved) => {
                if (!saved) return;
                setTaskContext(saved);
                setExcludedMemoryIds(saved.excludedMemoryIds ?? []);
              }),
              '调整本任务的记忆范围',
            );
          }}
          exclusion={memoryExclusion}
          materialCandidates={materialCandidates}
          onRequestMaterials={requestMaterials}
          mcpConnections={mcpState.connections}
          mcpToolBindings={mcpToolBindings}
          onMcpToolBindingsChange={setMcpToolBindings}
          runMemories={runMemories}
          brief={brief}
          workspaceName={workspace?.name}
          expertName={activeExpert?.name}
          onOpenBriefMemory={(item) => openMemoryPageAt(item.memoryId)}
          onOpenBriefIssue={openBriefIssue}
          onOpenBriefReference={openBriefReference}
          suggestions={suggestions}
          taskCandidates={taskCandidates}
          onEditCandidate={(candidate) => openMemoryPageAt(candidate.id)}
          onRejectCandidate={(candidate) => actOnTaskCandidate(candidate, 'reject')}
          onDeleteCandidate={(candidate) => setPendingCandidateDelete(candidate)}
          onOpenMemoryPage={openMemoryPage}
          memoriesError={taskMemoriesError}
          memoriesWarning={taskMemoriesWarning}
          onSelectRun={(run) =>
            reportAction(selectRun(run), setActionError, '无法打开这次执行记录。')
          }
          onOpenSource={knowledge.onOpenSource}
          onSelectArtifact={(artifact) =>
            reportAction(
              openArtifact(artifact).then(() => setView('artifacts')),
              setActionError,
              '无法打开这项成果。',
            )
          }
        />
      )}
      {pendingCandidateDelete && (
        <ConfirmationDialog
          title="不再使用这条建议？"
          detail="这是「以后不用」：历史记录与来源仍保留、可随时回溯；正在运行的任务不会热更新，需要立刻生效请取消该次运行后重跑。"
          confirmLabel="以后不用"
          onConfirm={() => {
            actOnTaskCandidate(pendingCandidateDelete, 'delete');
            setPendingCandidateDelete(undefined);
          }}
          onCancel={() => setPendingCandidateDelete(undefined)}
        />
      )}
      {modelSettings.editorOpen && (
        <ModelEditor
          form={modelSettings.editorForm}
          setForm={modelSettings.setEditorForm}
          editing={modelSettings.editorIsEditing}
          error={modelSettings.error}
          onClose={modelSettings.closeEditor}
          onSave={modelSettings.onSave}
          onTest={() => trackAction(modelSettings.onTest(), '测试模型连接')}
        />
      )}
      {modelSettings.toast && (
        <TransientToast {...modelSettings.toast} onDismiss={modelSettings.dismissToast} />
      )}
      {expertFallbackNotice && (
        <TransientToast
          tone="success"
          message={expertFallbackNotice}
          onDismiss={() => setExpertFallbackNotice(undefined)}
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
