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
  McpToolBinding,
  MemoryViewItem,
  NotificationSummary,
  NotificationTarget,
  RecentTaskSummary,
  RunSummary,
  ScheduleOccurrenceDetail,
  TaskContextRevision,
  TaskMaterialSelection,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deriveActivityGroups } from './activity';
import { BrandLogo } from './brand-logo';
import { InlineLoading } from './components/AsyncButton';
import { Button } from './components/Button';
import { Composer } from './components/Composer';
import type { CapabilityChip } from './components/ComposerCapabilityPicker';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { ContextPanel } from './components/ContextPanel';
import { DiscussionCheckpointPanel } from './components/DiscussionCheckpointPanel';
import { IconButton } from './components/IconButton';
import { InlineError } from './components/InlineError';
import { PageHeader } from './components/layout/PageHeader';
import { type MemoryCaptureDraft, MemoryCapturePanel } from './components/MemoryCapturePanel';
import type { MemoryEditorSubmission } from './components/MemoryEditor';
import { MessageBlock } from './components/MessageBlock';
import { ModelEditor } from './components/ModelEditorSheet';
import { type NavEntry, NavItem, NavList } from './components/NavList';
import { StatusNote } from './components/StatusNote';
import { ToolActivity } from './components/ToolActivity';
import { TransientToast } from './components/TransientToast';
import { Welcome } from './components/Welcome';
import { type WorkspaceGroupAction, WorkspaceGroupList } from './components/WorkspaceGroupList';
import { WorkspaceIdentityDialog } from './components/WorkspaceIdentityDialog';
import { useAppearance } from './hooks/use-appearance';
import { useConversationAddresses } from './hooks/use-conversation-addresses';
import { useExperts } from './hooks/use-experts';
import { useKnowledgeLibrary } from './hooks/use-knowledge-library';
import { useMcpConnections } from './hooks/use-mcp-connections';
import { newMemoryOperationId, useMemories } from './hooks/use-memories';
import { useMemorySuggestions } from './hooks/use-memory-suggestions';
import { useModelSettings } from './hooks/use-model-settings';
import { useRunMemories, useTaskMemoryExclusion } from './hooks/use-run-memories';
import { useScheduleTaskContinuation } from './hooks/use-schedule-task-continuation';
import { useSchedules } from './hooks/use-schedules';
import { useSkills } from './hooks/use-skills';
import { useTaskContinuity } from './hooks/use-task-continuity';
import { useTaskMemoryExclusions } from './hooks/use-task-memory-exclusions';
import { useTaskScroll } from './hooks/use-task-scroll';
import { useWorkspaceBrief } from './hooks/use-workspace-brief';
import { useWorkspaceGroups } from './hooks/use-workspace-groups';
import { useWorkspaceIdentity } from './hooks/use-workspace-identity';
import { useWorkspaceReferences } from './hooks/use-workspace-references';
import {
  ArtifactIcon,
  CapabilityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpertIcon,
  HelpIcon,
  KnowledgeIcon,
  PlusIcon,
  ScheduleIcon,
  SettingsIcon,
  WorkIcon,
} from './icons';
import { describeActionError, reportAction, trackAction } from './lib/async-action';
import { fileNameOf, formatTime } from './lib/format';
import { materialReferenceAppliesToWorkspace, materialReferenceKey } from './lib/materials';
import { excerptOf, finalAssistantAnswer, planCaptureFromSelection } from './lib/memory-capture';
import { settleMemoryCall } from './lib/memory-result';
import { candidatesOfTask } from './lib/memory-suggestions';
import { buildResearchPrompt } from './lib/research-prompt';
import { extractAssistantText, finalRunContent, mergeRunEvents } from './lib/run-events';
import { handleTitlebarDoubleClick } from './lib/titlebar';
import type { AppView, ContextTab, SettingsTab } from './lib/view-types';
import { NotificationCenter, ToastHost, useNotifications } from './notifications';
import { ArtifactPage } from './views/ArtifactView';
import { ExpertsPage } from './views/ExpertsView';
import { HelpPage } from './views/HelpView';
import { KnowledgePage } from './views/KnowledgeView';
import { type MemoryManagementTarget, scopeOptionsFor } from './views/MemoryView';
import { SchedulesPage } from './views/SchedulesView';
import { SettingsPage } from './views/SettingsView';
import { SkillsPage } from './views/SkillsView';

/**
 * 侧栏一级导航。选中态由 `NavList` 同时给 `aria-current` 与底色，
 * 页面这里只声明「有哪些项、各自的图标」。
 */
const PRIMARY_NAV_ITEMS: readonly NavEntry<AppView>[] = [
  { id: 'work', label: '工作', icon: WorkIcon },
  { id: 'artifacts', label: '成果', icon: ArtifactIcon },
  { id: 'knowledge', label: '知识', icon: KnowledgeIcon },
  { id: 'skills', label: '技能', icon: CapabilityIcon },
  { id: 'experts', label: '专家', icon: ExpertIcon },
  { id: 'schedules', label: '定时', icon: ScheduleIcon },
];

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
  sourceLabel: `工作空间文件 · ${snapshot.sourcePath}`,
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
  const conversationAddressesState = useConversationAddresses();
  const conversationAddresses = conversationAddressesState.addresses;
  const setConversationAddress = conversationAddressesState.update;

  const knowledge = useKnowledgeLibrary();
  const refreshKnowledge = knowledge.refresh;

  const modelSettings = useModelSettings();
  const activeLanguageModel = modelSettings.activeLanguageModel;
  const refreshModels = modelSettings.refresh;
  const experts = useExperts();
  const memoriesState = useMemories();
  const mcpState = useMcpConnections();

  const [prompt, setPrompt] = useState('');
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
  const startFromVersionRequest = useRef(0);
  const [excludedMemoryIds, setExcludedMemoryIds] = useState<string[]>([]);
  const [mcpToolBindings, setMcpToolBindings] = useState<McpToolBinding[]>([]);
  const [discussionCheckpoints, setDiscussionCheckpoints] = useState<DiscussionCheckpoint[]>([]);
  /** 人工保存表单（产品设计 §3.1）：只带用户当场选中的片段，不预填整段回答。 */
  const [memoryCapture, setMemoryCapture] = useState<MemoryCaptureDraft>();
  const memoryCaptureTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const [expertReferencesLoading, setExpertReferencesLoading] = useState(false);
  const [expertReferencesError, setExpertReferencesError] = useState('');
  const [expertReferencesAttempt, setExpertReferencesAttempt] = useState(0);
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
  const scheduleTaskContinuation = useScheduleTaskContinuation({
    taskContext,
    onContextSaved: (context) => {
      if (activeTaskIdRef.current === context.taskId) setTaskContext(context);
    },
  });
  const clearScheduleTaskContinuation = scheduleTaskContinuation.clear;
  const [pendingScheduleScopeRemoval, setPendingScheduleScopeRemoval] = useState(false);
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
  const [selectedArtifactInitialVersion, setSelectedArtifactInitialVersion] =
    useState<ArtifactVersionDetail>();
  const [artifactNote, setArtifactNote] = useState<{ tone: 'ok' | 'error'; text: string }>();
  /** §3.6：来源专家不可用时不猜专家，改用通用助手并把这件事当场说出来。 */
  const [expertFallbackNotice, setExpertFallbackNotice] = useState<string>();
  // 全局短时提醒：只收「当前对象承载不了」的失败（导航失败、全局前置条件不满足），
  // 由 `TransientToast` 6s 自消。此前它是一块常驻顶部横幅——本仓第三个落点之外的第四个
  // 表面，25 个调用点共用一个槽互相覆盖，且要等到切换工作空间才清空（docs/10 §11.5.1）。
  // 已经有内联承载点的失败不要再上传到这里，那会让同一句话出现在两个地方。
  const [actionError, setActionError] = useState('');
  const [view, setView] = useState<AppView>('work');
  const schedules = useSchedules(view === 'schedules');
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
  const taskContinuity = useTaskContinuity(activeTask?.id);
  const references = useWorkspaceReferences(workspace?.id);
  const workspaceGroups = useWorkspaceGroups(workspace?.id);
  // 只把稳定的方法取出来当依赖：容器对象每次渲染都是新的，整对象进依赖会让
  // refreshTasks 每次都换身份，进而让依赖它的 effect 每帧重跑。
  const { refreshGroups } = workspaceGroups;
  const memoryExclusion = useTaskMemoryExclusion();
  // 契约 §11.2：排除清单独立读取，与预览互不阻塞；调整成功后立即刷新。
  const taskExclusions = useTaskMemoryExclusions({
    taskId: activeTask?.id,
    taskContextRevisionId: taskContext?.id,
    expectedTaskContextRevision: taskContext?.revision,
  });
  const taskCandidates = activeTask
    ? candidatesOfTask(suggestions.candidates, suggestions.jobs, activeTask.id)
    : [];
  // §3.1：有专家默认「专家与工作空间」，无专家默认「工作空间」；顺序即表单默认值。
  // 契约 §11.1：回答捕获保留的是资料派生来源，因此不提供用户/专家全局范围。
  // §3.1：有专家默认「专家与工作空间」，无专家默认「工作空间」；顺序即表单默认值。
  // 契约 §11.1：回答捕获保留的是资料派生来源，因此不提供用户/专家全局范围。
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
      ).filter((scope) => scope.kind !== 'user' && scope.kind !== 'expert'),
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
    // 设置内新增/修订经验后返回工作，范围预览已经采用新记录，正文清单也必须重新读取。
    if (view === 'work') trackAction(reloadTaskMemories(), '加载当前任务记忆');
  }, [reloadTaskMemories, view]);

  const closeMemoryCapture = (): void => {
    setMemoryCapture(undefined);
    setMemoryCaptureError('');
    memoryCaptureTriggerRef.current?.focus();
    memoryCaptureTriggerRef.current = null;
  };

  /** 人工保存：`create` 的失败已由 hook 收口，这里只把它呈现在表单旁边。 */
  const submitMemoryCapture = async (submission: MemoryEditorSubmission): Promise<boolean> => {
    if (submission.kind !== 'create') return false;
    const outcome = await memoriesState.create(submission.request);
    if (outcome.ok) {
      closeMemoryCapture();
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
        setSelectedArtifactInitialVersion(undefined);
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
    // 失败只走内联：`ensureReference` 已把同一句话写进 `references.error`，由「本空间参考
    // 版本」小节就地呈现。再上传到全局提醒就是同一句播报两遍——用户关掉一处后，
    // 读到的是「这个提示关不掉」（docs/10 §11.5.1「一次结果只有一个落点」）。
    reportAction(
      references.ensureReference(artifactVersionId).then((result) => {
        if (!result.ok || result.material === undefined) return;
        const reference = result.material;
        setTaskMaterials((current) =>
          current.some(
            (existing) =>
              materialReferenceKey(existing.reference) === materialReferenceKey(reference),
          )
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

  /**
   * 成果列表是跨空间全量的，参考版本却按空间隔离（仓储 `requireOwnedVersion` 会拒）。
   * 因此归属必须在打开的那一刻就说清楚，而不是让人点了才知道。
   */
  const artifactReferenceScope = selectedArtifact
    ? {
        inScope: selectedArtifact.workspaceId === workspace?.id,
        ownerWorkspaceName:
          allWorkspaces.find((item) => item.id === selectedArtifact.workspaceId)?.name ??
          '所属工作空间',
      }
    : undefined;

  useEffect(() => {
    const requestId = expertMaterialCandidatesRequestRef.current + 1;
    expertMaterialCandidatesRequestRef.current = requestId;
    setExpertMaterialCandidates([]);
    setExpertReferencesError('');
    if (view !== 'experts' || !workspace) {
      setExpertReferencesLoading(false);
      return;
    }
    setExpertReferencesLoading(true);
    reportAction(
      window.betterwork.materials
        .listCandidates({ workspaceId: workspace.id })
        .then((candidates) => {
          if (expertMaterialCandidatesRequestRef.current === requestId)
            setExpertMaterialCandidates(candidates);
        })
        .finally(() => {
          if (expertMaterialCandidatesRequestRef.current === requestId)
            setExpertReferencesLoading(false);
        }),
      (message) => {
        if (expertMaterialCandidatesRequestRef.current === requestId)
          setExpertReferencesError(message);
      },
      '无法加载专家常用参考，请重试。',
    );
  }, [view, workspace, expertReferencesAttempt]);

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
  const refreshTasks = useCallback(
    (workspaceId = workspaceIdRef.current): void => {
      trackAction(
        window.betterwork.tasks
          .list(workspaceId ? { workspaceId } : undefined)
          .then(setRecentTasks),
        '刷新最近任务',
      );
      // 侧栏分组与最近任务是同一批事实的两种切法，一起刷新才不会一处新一处旧。
      refreshGroups();
    },
    [refreshGroups],
  );
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
      '加载默认工作空间',
    );
    trackAction(window.betterwork.workspace.listAll().then(setAllWorkspaces), '加载工作空间列表');
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

  const startNewTask = useCallback((): void => {
    clearScheduleTaskContinuation();
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
  }, [clearScheduleTaskContinuation]);
  /** 刷新已登记空间清单：新建与改名之后侧栏与选择器都要看到同一份。 */
  const refreshWorkspaces = (): void => {
    trackAction(window.betterwork.workspace.listAll().then(setAllWorkspaces), '刷新工作空间列表');
  };

  /**
   * 换到某个空间开新任务。清的是上一条会话的上下文，不是她当场正在写的草稿——
   * 输入框里的话与已选的技能片都留下，切目录不等于清草稿。
   */
  const enterWorkspace = (selected: WorkspaceSummary): void => {
    const draftPrompt = prompt;
    const draftBindings = taskBindings;
    startNewTask();
    setPrompt(draftPrompt);
    setTaskBindings(draftBindings);
    workspaceIdRef.current = selected.id;
    setWorkspace(selected);
    refreshTasks(selected.id);
  };

  const workspaceIdentity = useWorkspaceIdentity({
    workspaces: allWorkspaces,
    onSaved: (saved, created) => {
      refreshWorkspaces();
      // 新建完就切过去：默认展开规则认的是「当前空间」，切过去后这一组自然摊开。
      if (created) enterWorkspace(saved);
    },
  });

  /** 隐藏只影响侧栏可见性；恢复走输入区那个工作空间选择器（它列全部空间）。 */
  const applyWorkspaceGroupAction = (action: WorkspaceGroupAction): void => {
    const target = allWorkspaces.find((item) => item.id === action.workspaceId);
    if (!target) return;
    if (action.kind === 'new-task') {
      enterWorkspace(target);
      return;
    }
    if (action.kind === 'edit-identity') {
      workspaceIdentity.openEdit(target);
      return;
    }
    reportAction(
      window.betterwork.workspace
        .setHidden({ workspaceId: target.id, hidden: action.hidden })
        .then(() => {
          refreshWorkspaces();
          refreshGroups();
        }),
      setActionError,
      '更新工作空间显示状态失败，请重试。',
    );
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
            materialReferenceAppliesToWorkspace(material.reference, workspace?.id),
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
    [expertMaterialCandidates, skillChipForBinding, startNewTask, workspace?.id],
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
          '无法添加工作空间文件，请重试。',
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
  const selectTask = async (task: RecentTaskSummary): Promise<TaskContextRevision | undefined> => {
    if (activeTaskIdRef.current !== task.id) scheduleTaskContinuation.clear();
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
    if (selectionId !== runSelectionRequestRef.current) return undefined;
    loadAllTaskRuns(task.id);
    refreshEvidence(task.id);
    refreshDiscussionCheckpoints(task.id);
    refreshTaskRuns(task.id);
    setView('work');
    const loadedRuns = await window.betterwork.runs.list({ taskId: task.id });
    if (selectionId !== runSelectionRequestRef.current) return;
    const latest = [...loadedRuns].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return loadedContext;
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
    if (selectionId !== runSelectionRequestRef.current) return undefined;
    setEvents((current) => mergeRunEvents(snapshot, current));
    return loadedContext;
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
    setSelectedArtifactInitialVersion(undefined);
    setSelectedArtifact(detail);
  };
  const openArtifactVersion = async (versionId: string): Promise<void> => {
    const version = await window.betterwork.artifacts.getVersion({ id: versionId });
    if (!version) throw new Error('该成果版本已不存在，无法打开。');
    const detail = await window.betterwork.artifacts.get({ id: version.artifactId });
    if (!detail) throw new Error('该版本所属成果已不存在，无法打开。');
    setSelectedArtifact(detail);
    setSelectedArtifactInitialVersion(version);
    setView('artifacts');
  };
  const startFromArtifactVersion = async (
    artifact: ArtifactDetail,
    version: ArtifactVersionDetail,
  ): Promise<void> => {
    if (artifact.type !== 'markdown' || version.type !== 'markdown') {
      throw new Error('当前仅支持以 Markdown 成果版本开始新任务。');
    }
    // MI08 AC4：读取期间用户可能已切走或正在写别的草稿——迟到响应不得改动当前任务，
    // 读取失败也要保留原任务与草稿而不是先清空再报错。
    const requestId = (startFromVersionRequest.current += 1);
    const taskAtRequest = activeTask?.id;
    let executor: Awaited<ReturnType<typeof window.betterwork.artifacts.getVersionExecutor>>;
    try {
      executor = await window.betterwork.artifacts.getVersionExecutor({
        artifactId: artifact.id,
        artifactVersionId: version.id,
      });
    } catch (error: unknown) {
      // 读取失败：原任务与草稿保持不动，失败由调用方的 reportAction 呈现。
      if (requestId !== startFromVersionRequest.current) return;
      throw new Error('无法确认该版本的来源执行身份，原任务保持不变。', { cause: error });
    }
    if (requestId !== startFromVersionRequest.current || activeTask?.id !== taskAtRequest) return;
    // MI08：默认身份取自这个精确版本的来源 Run 快照，不读旧 Task 的当前草稿，
    // 也不复制来源任务的技能/模型/MCP 绑定；配置已更新时先按当前版本使用并说明。
    let sourceExpert: { id: string; revisionId: string; name: string } | undefined;
    let notice: string | undefined;
    if (executor === null) {
      notice = '无法确认这个版本当时的执行身份，新任务先用通用助手，可自行选择专家。';
    } else if (executor.kind === 'expert') {
      sourceExpert = {
        id: executor.expertId,
        revisionId: executor.currentExpertRevisionId,
        name: executor.name,
      };
      notice =
        executor.currentExpertRevisionId === executor.sourceExpertRevisionId
          ? undefined
          : `来源使用的是「${executor.name}」的旧版本配置；新任务使用其当前版本，权限与预设以当前配置为准。`;
    } else if (executor.kind === 'unavailable') {
      notice =
        executor.reason === 'expert-unavailable'
          ? '来源任务的专家已不可用，新任务先用通用助手，可自行选择其他专家。'
          : '来源运行的执行记录不完整，无法确认当时的专家，新任务先用通用助手。';
    }
    startNewTask();
    setSelectedArtifactInitialVersion(undefined);
    setSelectedArtifact(undefined);
    setExpertFallbackNotice(notice);
    if (sourceExpert) setActiveExpert(sourceExpert);
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
    inputRelations?: ArtifactInputRelationInput[],
  ): Promise<void> => {
    const saved = await window.betterwork.artifacts.saveMarkdown({
      artifactId: artifact.id,
      taskId: artifact.taskId,
      origin: 'user-edit',
      title,
      content,
      ...(inputRelations ? { inputRelations } : {}),
    });
    refreshArtifacts();
    const detail = await window.betterwork.artifacts.get({ id: saved.id });
    if (detail) {
      setSelectedArtifactInitialVersion(undefined);
      setSelectedArtifact(detail);
    }
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
  const openTaskTarget = async (
    taskId: string,
    continuation?: ScheduleOccurrenceDetail,
  ): Promise<void> => {
    const task = await window.betterwork.tasks.get({ id: taskId });
    if (!task) throw new Error('这项通知对应的任务已不存在，无法打开。');
    let workspaces = allWorkspaces;
    let targetWorkspace = workspaces.find((item) => item.id === task.workspaceId);
    if (!targetWorkspace) {
      workspaces = await window.betterwork.workspace.listAll();
      setAllWorkspaces(workspaces);
      targetWorkspace = workspaces.find((item) => item.id === task.workspaceId);
    }
    if (!targetWorkspace) throw new Error('这项任务所属的工作空间已不存在，无法打开。');
    workspaceIdRef.current = targetWorkspace.id;
    setWorkspace(targetWorkspace);
    refreshTasks(targetWorkspace.id);
    const validContinuation =
      continuation?.task?.id === taskId && continuation.occurrence.taskId === taskId
        ? continuation
        : undefined;
    if (activeTaskIdRef.current === taskId) {
      if (validContinuation) {
        scheduleTaskContinuation.attach(validContinuation);
        setContextTab('sources');
        setContextOpen(true);
      }
      setView('work');
      return;
    }
    const loadedContext = await selectTask(task);
    if (validContinuation && activeTaskIdRef.current === taskId) {
      scheduleTaskContinuation.attach(validContinuation);
      setTaskContext(loadedContext);
      setContextTab('sources');
      setContextOpen(true);
    }
  };
  const startResearchFromKnowledge = (): void => {
    if (isRunning) {
      setActionError('当前任务仍在执行，请等待完成后再开始新的研究。');
      return;
    }
    if (!workspace) {
      setActionError('请先选择或创建工作空间，再开始研究。');
      return;
    }
    const prompt = buildResearchPrompt(knowledge.query.trim(), knowledge.selectedMaterials.length);
    // KM03：失败绝不清空当前任务或选择；成功且请求仍是最新意图时才导航。
    reportAction(
      (async (): Promise<void> => {
        const outcome = await knowledge.research(prompt, workspace.id);
        if (!outcome) {
          setActionError('没有可用的勾选资料，请先勾选要用于研究的资料。');
          return;
        }
        if (outcome.stale) {
          knowledge.showToast('success', '研究草稿已创建；可从最近任务打开。');
          refreshTasks();
          return;
        }
        const tasks = await window.betterwork.tasks.list({ workspaceId: workspace.id });
        const created = tasks.find((task) => task.id === outcome.result.task.id);
        if (created) {
          await selectTask(created);
          setPrompt(outcome.result.prompt);
        }
        knowledge.clearSelection();
      })(),
      setActionError,
      '创建研究草稿失败；当前任务与已勾选资料保持不变。',
    );
  };
  const navigateToTarget = (target: NotificationTarget): void => {
    setNotificationCenterOpen(false);
    if (target.kind === 'task') {
      reportAction(openTaskTarget(target.taskId), setActionError, '无法打开这项任务。');
      return;
    }
    if (target.kind === 'artifact') {
      reportAction(
        window.betterwork.artifacts.get({ id: target.artifactId }).then((detail) => {
          if (!detail) throw new Error('这项通知对应的成果已不存在，无法打开。');
          setSelectedArtifactInitialVersion(undefined);
          setSelectedArtifact(detail);
          setView('artifacts');
        }),
        setActionError,
        '无法打开这项成果。',
      );
      return;
    }
    if (target.kind === 'schedule') {
      if (!target.occurrenceId) {
        reportAction(
          window.betterwork.schedules.get({ scheduleId: target.scheduleId }).then((result) => {
            if (result.status === 'rejected') throw new Error(result.error.message);
            throw new Error('定时任务已找到；请从定时任务页打开相关期间。');
          }),
          setActionError,
          '无法打开这项定时任务。',
        );
        return;
      }
      reportAction(
        window.betterwork.schedules
          .getOccurrence({ occurrenceId: target.occurrenceId })
          .then((result) => {
            if (result.status === 'rejected') throw new Error(result.error.message);
            if (result.data.task) return openTaskTarget(result.data.task.id);
            throw new Error('这期错过的实例没有创建任务，也不会自动补跑。');
          }),
        setActionError,
        '无法打开这期定时任务。',
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
    if (target.kind === 'schedule') return false;
    return view === 'knowledge';
  };
  const {
    notifications,
    unreadCount,
    toasts,
    activate: activateNotificationFromCenter,
    markAllRead,
    deleteNotification,
    clear: clearAllNotifications,
    dismissToast,
    pauseToast,
    resumeToast,
  } = useNotifications({
    navigate: navigateToTarget,
    isTargetVisible: isNotificationTargetVisible,
    onActivationError: () => setActionError('这条通知对应的对象已不存在，或暂时无法打开。'),
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
          <IconButton
            size="md"
            className="sidebar-collapse-button"
            label={sidebarCollapsed ? '展开导航' : '收起导航'}
            icon={sidebarCollapsed ? ChevronRightIcon : ChevronLeftIcon}
            expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
        </div>
        <NavItem label="新建任务" icon={PlusIcon} rail={sidebarCollapsed} onClick={startNewTask} />
        <NavList
          className="primary-nav"
          label="主要导航"
          rail={sidebarCollapsed}
          value={view}
          onSelect={(next) => {
            setView(next);
            if (next === 'artifacts') {
              setSelectedArtifactInitialVersion(undefined);
              setSelectedArtifact(undefined);
              refreshArtifacts();
            }
            if (next === 'knowledge') refreshKnowledge();
            if (next === 'skills') skills.refresh();
            if (next === 'experts') experts.refresh();
          }}
          items={PRIMARY_NAV_ITEMS}
        />
        <div className="sidebar-divider" />
        <p className="section-label">工作空间</p>
        <WorkspaceGroupList
          groups={workspaceGroups.groups}
          currentWorkspaceId={workspace?.id}
          activeTaskId={activeTask?.id}
          isOpen={workspaceGroups.isOpen}
          showsAll={workspaceGroups.showsAll}
          onToggleGroup={workspaceGroups.toggleGroup}
          onToggleShowAll={workspaceGroups.toggleShowAll}
          onSelectTask={(workspaceId, task) => {
            // 打开别的空间里的任务，输入区的目录绑定要跟着过去——
            // 这是「打开任务」的必然结果，不是第二处切换入口。
            if (workspaceId !== workspaceIdRef.current) {
              const target = allWorkspaces.find((item) => item.id === workspaceId);
              if (target) {
                workspaceIdRef.current = target.id;
                setWorkspace(target);
              }
            }
            reportAction(selectTask(task), setActionError, '无法打开这项任务。');
          }}
          onAction={applyWorkspaceGroupAction}
          rail={sidebarCollapsed}
          onRevealFromRail={(workspaceId) => {
            setSidebarCollapsed(false);
            workspaceGroups.openGroup(workspaceId);
          }}
        />
        <div className="sidebar-bottom">
          <NavItem
            label="设置"
            icon={SettingsIcon}
            rail={sidebarCollapsed}
            selected={view === 'settings'}
            onClick={() => {
              setView('settings');
              setSettingsTab('models');
              setMemoryManagementTarget(undefined);
              refreshModels();
            }}
          />
          <NavItem
            label="帮助"
            icon={HelpIcon}
            rail
            className="sidebar-help"
            selected={view === 'help'}
            onClick={() => setView('help')}
          />
          <NotificationCenter
            notifications={notifications}
            unreadCount={unreadCount}
            open={notificationCenterOpen}
            onOpenChange={setNotificationCenterOpen}
            onActivate={activateNotification}
            onMarkAllRead={markAllRead}
            onDelete={deleteNotification}
            onClear={clearAllNotifications}
          />
        </div>
      </aside>
      <section className="main-stage">
        {actionError && (
          <TransientToast tone="error" message={actionError} onDismiss={() => setActionError('')} />
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
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setContextOpen((open) => !open)}
                >
                  {contextOpen ? '收起上下文' : '查看上下文'}
                </Button>
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
                <div className="page-body message-flow">
                  {taskAllRuns.length === 0 && !activeRunId ? (
                    <Welcome userName={conversationAddresses.user.trim()} />
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
                            <MessageBlock
                              author="user"
                              authorName={conversationAddresses.user.trim() || '你'}
                              content={run.prompt}
                            />
                            <ToolActivity key={run.id} events={runEvents} />
                            {runAssistantText && (
                              <MessageBlock
                                author="assistant"
                                authorName={conversationAddresses.assistant.trim() || 'AI'}
                                content={runAssistantText}
                                anchorRef={
                                  idx === taskAllRuns.length - 1 ? latestReplyRef : undefined
                                }
                                actions={
                                  isLatestCompleted ? (
                                    <>
                                      <Button
                                        variant="text"
                                        size="sm"
                                        onClick={(event) => {
                                          const answer = finalAssistantAnswer(runEvents);
                                          if (!answer) {
                                            setMemoryCaptureError(
                                              '这条回答还没有可定位的最终事件，请等运行完成后再记住经验。',
                                            );
                                            return;
                                          }
                                          // §3.1 与契约 §11.1：只有页面选区在原文里唯一命中才预填，
                                          // 否则正文留空，让用户在下方只读原文重选，不猜渲染坐标。
                                          const selected =
                                            window.getSelection()?.toString().trim() ?? '';
                                          const plan = planCaptureFromSelection(
                                            answer.content,
                                            selected,
                                          );
                                          memoryCaptureTriggerRef.current = event.currentTarget;
                                          setMemoryCapture({
                                            runId: run.id,
                                            eventId: answer.eventId,
                                            raw: answer.content,
                                            initialContent: plan.range
                                              ? excerptOf(answer.content, plan.range)
                                              : '',
                                            range: plan.range,
                                          });
                                          setMemoryCaptureError(plan.error);
                                        }}
                                      >
                                        记住这段经验
                                      </Button>
                                      <Button
                                        variant="text"
                                        size="sm"
                                        onClick={() =>
                                          trackAction(saveCurrentArtifact(), '保存成果')
                                        }
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
                                      </Button>
                                    </>
                                  ) : undefined
                                }
                              />
                            )}
                            {runFailure?.type === 'run.failed' && (
                              <InlineError
                                message={`本次运行未完成，回复内容未登记为正式成果。${runFailure.error ?? ''}`}
                              />
                            )}
                            {runEvents.some((event) => event.type === 'run.cancelled') && (
                              <StatusNote message="本次运行已停止。可以调整要求后重新开始。" />
                            )}
                            {/* 「保存为成果」的失败需要停留并让人据此重试，属 §11.5.1 第二落点；
                                成功那句改走自消浮层（同一处只留一个落点）。原先两档都写在按钮旁
                                那句 `.action-note` 里，等于一条常驻的内联成功通道。 */}
                            {artifactNote?.tone === 'error' && (
                              <InlineError
                                message={artifactNote.text}
                                onDismiss={() => setArtifactNote(undefined)}
                              />
                            )}
                            {artifactNote?.tone === 'ok' && (
                              <TransientToast
                                tone="success"
                                message={artifactNote.text}
                                onDismiss={() => setArtifactNote(undefined)}
                              />
                            )}
                            {memoryCapture?.runId === run.id && (
                              <MemoryCapturePanel
                                capture={memoryCapture}
                                scopes={memoryCaptureScopes}
                                error={memoryCaptureError}
                                onRangeChange={(range) => {
                                  setMemoryCapture({ ...memoryCapture, range });
                                  setMemoryCaptureError('');
                                }}
                                onSubmit={submitMemoryCapture}
                                onClose={closeMemoryCapture}
                              />
                            )}
                            {isRunActive &&
                              runEvents.length > 0 &&
                              !runEvents.some((event) =>
                                ['run.completed', 'run.failed', 'run.cancelled'].includes(
                                  event.type,
                                ),
                              ) && <InlineLoading label="正在执行…" />}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
              {detached && (
                <div className="latest-message-control">
                  <Button variant="secondary" size="md" type="button" onClick={jumpToLatest}>
                    回到最新
                  </Button>
                </div>
              )}
              <Composer
                prompt={prompt}
                onPromptChange={setPrompt}
                onStartRun={() =>
                  reportAction(startRun(), setActionError, '无法开始这项工作，请重试。')
                }
                submit={
                  isRunning && activeRunId
                    ? {
                        state: 'running',
                        onStop: () =>
                          reportAction(
                            window.betterwork.runs.cancel({ runId: activeRunId }),
                            setActionError,
                            '无法停止这次执行，请重试。',
                          ),
                      }
                    : isStarting
                      ? { state: 'starting' }
                      : { state: 'idle' }
                }
                locked={isStarting || isRunning}
                modelLabel={composerModelLabel}
                textareaRef={composerRef}
                workspacePicker={{
                  currentWorkspace: workspace,
                  workspaces: allWorkspaces,
                  disabled: activeTask !== undefined || isStarting || isRunning,
                  onSelectWorkspace: (selected) => {
                    if (activeTask || isStarting || isRunning) return;
                    // 从选择器回到一个曾隐藏的空间＝她又要在这里工作，隐藏随之解除。
                    if (selected.hiddenAt !== undefined) {
                      reportAction(
                        window.betterwork.workspace
                          .setHidden({ workspaceId: selected.id, hidden: false })
                          .then(refreshGroups),
                        setActionError,
                        '更新工作空间显示状态失败，请重试。',
                      );
                    }
                    enterWorkspace(selected);
                  },
                  onNewWorkspace: workspaceIdentity.openCreate,
                }}
                expert={activeExpert}
                onRemoveExpert={() => {
                  setActiveExpert(undefined);
                  setTaskContext(undefined);
                  setTaskBindings((current) =>
                    current.filter((chip) => chip.source !== 'expert-preset'),
                  );
                }}
                skills={skills.skills}
                bindings={taskBindings}
                onAddBinding={(chip) => setTaskBindings((prev) => [...prev, chip])}
                onRemoveBinding={(id) =>
                  setTaskBindings((prev) => prev.filter((chip) => chip.id !== id))
                }
                materials={taskMaterials}
                materialCandidates={materialCandidates}
                materialsLoading={materialsLoading}
                {...(materialPickerKind ? { materialPickerKind } : {})}
                {...(materialPickerError ? { materialPickerError } : {})}
                onRequestMaterials={requestMaterials}
                onDismissMaterialPicker={() => setMaterialPickerKind(undefined)}
                onCommitMaterials={commitTaskMaterials}
                onManageMaterials={() => {
                  setContextTab('sources');
                  setContextOpen(true);
                }}
                onRequestSkillDetail={() => setView('skills')}
                onRequestExpert={() => {
                  setView('experts');
                  experts.refresh();
                }}
              />
            </div>
          </>
        )}
        {view === 'artifacts' && (
          <ArtifactPage
            artifacts={artifacts}
            selected={selectedArtifact}
            {...(selectedArtifactInitialVersion
              ? { initialVersion: selectedArtifactInitialVersion }
              : {})}
            onSelect={(artifact) =>
              reportAction(openArtifact(artifact), setActionError, '无法打开这项成果。')
            }
            onSave={reviseArtifact}
            onExport={exportArtifact}
            onOpenFile={openFileArtifact}
            onOpenSource={knowledge.onOpenSource}
            onStartFromVersion={startFromArtifactVersion}
            references={references}
            referenceScope={artifactReferenceScope}
            onReferenceToTask={referenceVersionToTask}
            onBack={() => {
              setSelectedArtifact(undefined);
              setSelectedArtifactInitialVersion(undefined);
            }}
          />
        )}
        {view === 'knowledge' && (
          <KnowledgePage library={knowledge} onResearch={startResearchFromKnowledge} />
        )}
        {view === 'skills' && <SkillsPage state={skills} />}
        {view === 'help' && <HelpPage />}
        {view === 'experts' && (
          <ExpertsPage
            state={experts}
            skills={skills.skills}
            skillsLoading={skills.loading}
            mcpConnections={mcpState.connections}
            memories={memoriesState.memories}
            models={modelSettings.models}
            materialCandidates={expertMaterialCandidates}
            referencesLoading={expertReferencesLoading}
            referencesError={expertReferencesError}
            onRetryReferences={() => setExpertReferencesAttempt((attempt) => attempt + 1)}
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
        {view === 'schedules' && (
          <SchedulesPage
            state={schedules}
            workspaces={allWorkspaces}
            experts={experts.experts}
            expertsLoading={experts.loading}
            expertsError={experts.error}
            getExpert={experts.get}
            onOpenTask={openTaskTarget}
            onOpenArtifactVersion={openArtifactVersion}
            onOpenSource={knowledge.onOpenSource}
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
            conversationAddresses={conversationAddresses}
            onAssistantAddressChange={(assistant) =>
              setConversationAddress({ ...conversationAddresses, assistant })
            }
            onUserAddressChange={(user) =>
              setConversationAddress({ ...conversationAddresses, user })
            }
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
          taskId={activeTask?.id}
          taskContinuity={taskContinuity}
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
          onCommitMaterials={commitTaskMaterials}
          materialsDisabled={isStarting || isRunning}
          {...(scheduleTaskContinuation.view
            ? {
                scheduleContinuation: {
                  ...scheduleTaskContinuation.view,
                  removingScope: scheduleTaskContinuation.removingScope,
                  scopeError: scheduleTaskContinuation.scopeError,
                  onRemoveScope: () => setPendingScheduleScopeRemoval(true),
                },
              }
            : {})}
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
                taskExclusions.reload();
              }),
              '调整本任务的记忆范围',
            );
          }}
          exclusion={memoryExclusion}
          exclusions={taskExclusions}
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
          onOpenArtifactVersion={openArtifactVersion}
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
      {pendingScheduleScopeRemoval && scheduleTaskContinuation.view && (
        <ConfirmationDialog
          title="移除本 Task 的定时来源范围？"
          detail="这会为原 Task 保存新的上下文修订：后续 Run 不再使用本期自动来源，并按既有规则缩小安全历史范围。已经开始的 Run、已有历史与本期来源快照不变；Schedule 配置和之后的新期间也不变。已显式补充到原 Task 的材料会保留。"
          confirmLabel="移除本期范围"
          onConfirm={() => {
            setPendingScheduleScopeRemoval(false);
            scheduleTaskContinuation.removeScope({
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
          }}
          onCancel={() => setPendingScheduleScopeRemoval(false)}
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
      {workspaceIdentity.open && (
        <WorkspaceIdentityDialog
          editing={workspaceIdentity.editing}
          draft={workspaceIdentity.draft}
          error={workspaceIdentity.error}
          takenByName={workspaceIdentity.takenBy?.name}
          busy={workspaceIdentity.busy}
          picking={workspaceIdentity.picking}
          canSubmit={workspaceIdentity.canSubmit}
          onChangeDraft={workspaceIdentity.changeDraft}
          onChooseDirectory={workspaceIdentity.chooseDirectory}
          onSubmit={workspaceIdentity.submit}
          onClose={workspaceIdentity.close}
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
