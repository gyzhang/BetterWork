import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionExecutorSummary,
  CreateMemoryRequest,
  DiscussionCheckpoint,
  ExpertDetail,
  ExpertSummary,
  InputSnapshot,
  MaterialCandidate,
  MaterialReference,
  MemoryReferenceWriteReceipt,
  MemoryViewItem,
  MemoryWriteReceipt,
  ModelProfileSummary,
  NotificationChangeEvent,
  NotificationSummary,
  RecentTaskSummary,
  Result,
  RunSummary,
  ScheduleChangedEvent,
  ScheduleDetail,
  ScheduleOccurrenceDetail,
  SkillDetail,
  TaskContextRevision,
  WorkspaceBrief,
  WorkspaceReferenceListData,
  WorkspaceReferenceSetData,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { vi } from 'vitest';

export const skill: SkillDetail = {
  id: 'skill-ppt',
  name: '演示生成专家',
  description: '生成演示文稿',
  sourceKind: 'user',
  enabled: true,
  currentRevisionId: 'revision-ppt',
  trustStatus: 'trusted',
  environmentStatus: 'ready',
  blockedReasons: [],
  revision: {
    id: 'revision-ppt',
    skillId: 'skill-ppt',
    contentHash: 'hash-ppt',
    resourceKey: 'user/skill-ppt/revisions/hash-ppt',
    frontmatter: {},
    createdAt: 1,
  },
};
export const goal = '使用「中电金信」模板，生成两页演示文稿——封面 + 一页内容页。';
export const workspaceFixture: WorkspaceSummary = {
  id: 'workspace-1',
  name: '我的工作空间',
  rootPath: '/workspace',
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 1,
};
export const previousRun: RunSummary = {
  id: 'previous-run',
  taskId: 'previous-task',
  sessionId: 'previous-session',
  prompt: '旧任务的要求',
  status: 'completed',
  createdAt: 1,
};
export const previousTask: RecentTaskSummary = {
  id: 'previous-task',
  workspaceId: 'workspace-1',
  sessionId: 'previous-session',
  title: '旧任务',
  goal: '旧任务的要求',
  createdAt: 1,
  updatedAt: 1,
};

export const expertSummary: ExpertSummary = {
  id: 'expert-finance',
  sourceKind: 'user',
  lifecycle: 'active',
  name: '经营分析专家',
  summary: '按月度规则分析经营数字。',
  author: '财务组',
  tags: ['经营分析', '月度复盘'],
  currentRevision: 1,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 1,
};
export const expertDetail: ExpertDetail = {
  ...expertSummary,
  revision: {
    id: 'expert-revision-1',
    expertId: expertSummary.id,
    revision: 1,
    name: expertSummary.name,
    summary: expertSummary.summary,
    author: expertSummary.author,
    tags: expertSummary.tags,
    identity: '负责经营分析。',
    principles: [],
    inputRequirements: [],
    deliveryRequirements: [],
    skillPreset: [],
    builtinToolPolicy: { mode: 'application-defaults' },
    modelReference: { mode: 'application-default' },
    createdAt: 1,
  },
};
export const scheduleContinuationFixture = (): {
  detail: ScheduleDetail;
  occurrence: ScheduleOccurrenceDetail;
} => {
  const period = {
    rule: 'previous-month' as const,
    timeZone: 'Asia/Shanghai' as const,
    anchorAt: 10,
    startAt: 1,
    endAt: 9,
    label: '2026 年 8 月',
  };
  const occurrence = {
    id: 'occurrence-1',
    scheduleId: 'schedule-1',
    configVersion: 3,
    trigger: 'scheduled' as const,
    period,
    phase: 'closed' as const,
    preparationOutcome: 'needs-material' as const,
    taskId: previousTask.id,
    sessionId: previousTask.sessionId,
    sourceSnapshotId: 'snapshot-1',
    createdAt: 1,
    requestedAt: 1,
    preparedAt: 2,
    finishedAt: 3,
  };
  const config = {
    scheduleId: 'schedule-1',
    version: 3,
    name: '月度经营分析',
    expertId: expertSummary.id,
    expertRevisionId: expertDetail.revision.id,
    requirements: '分析经营表现',
    expectedArtifactTypes: ['markdown' as const],
    timing: {
      frequency: 'monthly' as const,
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai' as const,
    },
    periodRule: 'previous-month' as const,
    knowledgeSources: [],
    outputSubdirectory: '定时成果' as const,
    createdAt: 1,
  };
  const historyItem = {
    occurrence,
    result: { occurrence, status: 'needs-material' as const, outputReceipts: [] },
  };
  const detail: ScheduleDetail = {
    aggregate: {
      schedule: {
        id: 'schedule-1',
        workspaceId: workspaceFixture.id,
        revision: 2,
        currentConfigVersion: 3,
        lifecycle: 'paused',
        createdAt: 1,
        updatedAt: 2,
      },
      config,
    },
    expertUpdate: {
      boundRevision: expertDetail.revision,
      currentRevision: expertDetail.revision,
      available: false,
    },
    history: { items: [historyItem] },
  };
  return {
    detail,
    occurrence: {
      occurrence,
      result: historyItem.result,
      config,
      task: previousTask,
      sourceSnapshot: {
        id: 'snapshot-1',
        occurrenceId: 'occurrence-1',
        workspaceId: workspaceFixture.id,
        status: 'ready',
        configVersion: 3,
        evaluatedAt: 1,
        manifestHash: 'a'.repeat(64),
        itemCount: 2,
        totalFileBytes: 512,
        createdAt: 1,
        completedAt: 2,
      },
      outputReceipts: [],
      readMaterialCount: 0,
      adoptedMaterialCount: 0,
    },
  };
};
export const languageModel: ModelProfileSummary = {
  id: 'model-language-1',
  name: '本地语言模型',
  provider: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:30808/v1',
  model: 'local-model',
  role: 'language',
  apiKeyConfigured: false,
  enabled: true,
  priority: 0,
  connectionStatus: 'connected',
  maxContextTokens: 8192,
  maxOutputTokens: 4096,
  temperature: 0.7,
  createdAt: 1,
  updatedAt: 1,
};

const emptySection = { items: [], total: 0, truncated: false };

export const briefFixture: WorkspaceBrief = {
  workspaceId: 'workspace-1',
  generatedAt: 1,
  goals: emptySection,
  constraints: emptySection,
  decisions: emptySection,
  methods: emptySection,
  openIssues: emptySection,
  referenceVersions: emptySection,
};

const memoryOperationUuid = '11111111-1111-4111-8111-111111111111';
export let emitNotificationChange: ((event: NotificationChangeEvent) => void) | undefined;
export let emitScheduleChange: ((event: ScheduleChangedEvent) => void) | undefined;
export let activateSystemNotification: ((input: { id: string }) => void) | undefined;

const writeReceipt: MemoryWriteReceipt = {
  operationId: memoryOperationUuid,
  commit: 'committed',
  effect: 'unchanged',
  committedRevisionIds: ['memory-1-r1'],
  projectionState: 'synced',
};

export const okResult = <TData>(data: TData): { ok: true; data: TData; warnings: never[] } => ({
  ok: true as const,
  data,
  warnings: [] as never[],
});

export const artifactVersionReference: MaterialReference = {
  kind: 'artifact-version',
  artifactId: 'artifact-1',
  artifactVersionId: 'version-1',
  contentHash: 'a'.repeat(64),
  originWorkspaceId: 'workspace-1',
};

const referenceWriteReceipt: MemoryReferenceWriteReceipt = {
  ...writeReceipt,
  currentReference: {
    id: 'ref-1',
    workspaceId: 'workspace-1',
    artifactVersionId: 'version-1',
    contentHash: 'a'.repeat(64),
    status: 'active',
    revision: 1,
    selectedAt: 1,
    updatedAt: 1,
  },
};

export const memoryViewItem = (overrides?: Partial<MemoryViewItem>): MemoryViewItem => ({
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 1,
  recallPolicy: overrides?.recallPolicy ?? 'relevant',
  scope: { kind: 'user' },
  kind: 'procedural',
  content: '先核对财务规则。',
  sourceType: 'conversation',
  confidence: 1,
  status: 'confirmed',
  contentHash: 'memory-hash',
  createdAt: 1,
  updatedAt: 1,
  facet: 'method',
  normalizedHash: 'normalized-hash',
  provenance: { schemaVersion: 1, verification: 'legacy-unverified', sourceType: 'conversation' },
  effectiveStatus: 'confirmed',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
  ...overrides,
});

interface AppTestApiOptions {
  expert?: boolean;
  skills?: SkillDetail[];
  context?: TaskContextRevision;
  memories?: MemoryViewItem[];
  models?: ModelProfileSummary[];
}

function createMemoryApiFixture(options?: Pick<AppTestApiOptions, 'memories'>) {
  return {
    list: vi.fn(async () => okResult({ items: options?.memories ?? [] })),
    get: vi.fn(async () => okResult(memoryViewItem())),
    create: vi.fn(async (input: CreateMemoryRequest): Promise<Result<MemoryWriteReceipt>> =>
      okResult({ ...writeReceipt, operationId: input.operationId }),
    ),
    update: vi.fn(async () => okResult(writeReceipt)),
    setStatus: vi.fn(async () => okResult(writeReceipt)),
    resolveConflict: vi.fn(async () =>
      okResult({
        receipt: writeReceipt,
        decision: {
          id: 'conflict-decision-1',
          operationId: memoryOperationUuid,
          leftRevisionId: 'memory-1-r1',
          rightRevisionId: 'memory-2-r1',
          decision: 'keep-both' as const,
          applicabilityNote: '按适用范围分别保留。',
          createdAt: 1,
        },
      }),
    ),
    preview: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'NOT_FOUND' as const, message: '测试未提供范围预览。', retryable: false },
    })),
    // 排除清单是独立只读投影：默认空表，个别用例再覆写。
    taskExclusions: vi.fn(async (input: { taskId: string; taskContextRevisionId: string }) =>
      okResult({
        taskId: input?.taskId ?? 'task-1',
        taskContextRevisionId: input?.taskContextRevisionId ?? 'context-1',
        taskContextRevision: 1,
        items: [],
      }),
    ),
    runContext: vi.fn(async (input: { runId: string }) =>
      okResult({
        runId: input?.runId ?? 'run-1',
        phase: 'legacy_unknown' as const,
        memories: [],
        reads: [],
      }),
    ),
    getSettings: vi.fn(async () =>
      okResult({
        workspaceId: 'workspace-1',
        revision: 0,
        autoSuggestEnabled: false,
        updatedAt: 1,
      }),
    ),
    setSettings: vi.fn(async () =>
      okResult({
        receipt: {
          ...writeReceipt,
          currentSettings: {
            workspaceId: 'workspace-1',
            revision: 1,
            autoSuggestEnabled: false,
            updatedAt: 1,
          },
        },
        cancelledJobCount: 0,
      }),
    ),
    listJobs: vi.fn(async () => okResult({ items: [] })),
    retryJob: vi.fn(async () => okResult({})),
    cancelJob: vi.fn(async () => okResult({})),
    rebuildProjection: vi.fn(async () => okResult({ projectionState: 'synced' as const })),
  };
}

function createKnowledgeApiFixture() {
  return {
    list: vi.fn(async () => []),
    job: vi.fn(async () => null),
    jobs: vi.fn(async () => ({ jobs: [] })),
    settings: vi.fn(async () => ({
      semanticEnabled: false,
      revision: 1,
      embeddingAvailable: false,
    })),
    onJobEvent: vi.fn(() => () => undefined),
    listCollections: vi.fn(async () => []),
    saveCollection: vi.fn(async () => []),
    deleteCollection: vi.fn(async () => []),
    setCollectionMembers: vi.fn(async () => ({ membershipRevision: 2, collectionIds: [] })),
  };
}

function createArtifactApiFixture() {
  return {
    list: vi.fn(async (): Promise<ArtifactSummary[]> => []),
    saveMarkdown: vi.fn<Window['betterwork']['artifacts']['saveMarkdown']>(async () => {
      throw new Error('App 测试没有配置成果保存结果');
    }),
    get: vi.fn(async (): Promise<ArtifactDetail | null> => null),
    listVersions: vi.fn(async () => []),
    getVersion: vi.fn(async () => null),
    getVersionExecutor: vi.fn(async (): Promise<ArtifactVersionExecutorSummary | null> => null),
  };
}

function createTaskContextApiFixture(
  options: Pick<AppTestApiOptions, 'context'> | undefined,
  removedScheduleScopeTaskIds: Set<string>,
) {
  return {
    get: vi.fn(async (): Promise<TaskContextRevision | null> => options?.context ?? null),
    save: vi.fn<Window['betterwork']['taskContexts']['save']>(async (input) => {
      const removesScheduleScope = input.scheduleSourceSnapshotId === null;
      if (removesScheduleScope) removedScheduleScopeTaskIds.add(input.taskId);
      const revision = removesScheduleScope ? (input.expectedRevision ?? 0) + 1 : 1;
      const scheduleSourceSnapshotId =
        removesScheduleScope || removedScheduleScopeTaskIds.has(input.taskId)
          ? undefined
          : (input.scheduleSourceSnapshotId ?? options?.context?.scheduleSourceSnapshotId);
      const materials = input.materials ?? options?.context?.materials;
      return {
        context: {
          id: removesScheduleScope ? `context-${String(revision)}` : 'context-1',
          taskId: input.taskId,
          revision,
          executor: input.executor,
          skillBindings: input.skillBindings,
          ...(materials !== undefined ? { materials } : {}),
          ...(scheduleSourceSnapshotId ? { scheduleSourceSnapshotId } : {}),
          ...(input.excludedMemoryIds !== undefined
            ? { excludedMemoryIds: input.excludedMemoryIds }
            : options?.context?.excludedMemoryIds !== undefined
              ? { excludedMemoryIds: options.context.excludedMemoryIds }
              : {}),
          ...(input.mcpToolBindings !== undefined
            ? { mcpToolBindings: input.mcpToolBindings }
            : options?.context?.mcpToolBindings !== undefined
              ? { mcpToolBindings: options.context.mcpToolBindings }
              : {}),
          ...(input.modelReference !== undefined
            ? { modelReference: input.modelReference }
            : options?.context?.modelReference !== undefined
              ? { modelReference: options.context.modelReference }
              : {}),
          ...(input.builtinToolPolicy !== undefined
            ? { builtinToolPolicy: input.builtinToolPolicy }
            : options?.context?.builtinToolPolicy !== undefined
              ? { builtinToolPolicy: options.context.builtinToolPolicy }
              : {}),
          createdAt: 1,
          updatedAt: removesScheduleScope ? revision : 1,
        },
      };
    }),
  };
}

function createWorkspaceApiFixture() {
  return {
    getDefault: vi.fn(async () => workspaceFixture),
    listAll: vi.fn(async () => [workspaceFixture]),
    pickDirectory: vi.fn(async () => null),
    create: vi.fn(),
    updateIdentity: vi.fn(),
    setHidden: vi.fn(async () => null),
    // 侧栏分组与 tasks.list 报同一批任务，测试才能继续点得到「旧任务」那一行。
    listTaskGroups: vi.fn(async () => [
      { workspace: workspaceFixture, tasks: [previousTask], totalTasks: 1 },
    ]),
    memoryBrief: vi.fn(async (): Promise<Result<WorkspaceBrief>> => okResult(briefFixture)),
    listReferenceVersions: vi.fn(async (): Promise<Result<WorkspaceReferenceListData>> =>
      okResult({ items: [] }),
    ),
    setReferenceVersion: vi.fn(async (): Promise<Result<WorkspaceReferenceSetData>> =>
      okResult({ receipt: referenceWriteReceipt, material: artifactVersionReference }),
    ),
    removeReferenceVersion: vi.fn(async (): Promise<Result<MemoryReferenceWriteReceipt>> =>
      okResult(referenceWriteReceipt),
    ),
  };
}

function createNotificationsApiFixture() {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async (): Promise<NotificationSummary | null> => null),
    rendererReady: vi.fn(async () => ({ ready: true as const })),
    markRead: vi.fn(async () => ({ unreadCount: 0 })),
    onChange: vi.fn((listener: (event: NotificationChangeEvent) => void) => {
      emitNotificationChange = listener;
      return () => undefined;
    }),
    onActivate: vi.fn((listener: (input: { id: string }) => void) => {
      activateSystemNotification = listener;
      return () => undefined;
    }),
  };
}

function createSchedulesApiFixture() {
  return {
    list: vi.fn<Window['betterwork']['schedules']['list']>(async () => ({
      status: 'success',
      data: { items: [] },
    })),
    onChange: vi.fn((listener: (event: ScheduleChangedEvent) => void) => {
      emitScheduleChange = listener;
      return () => {
        emitScheduleChange = undefined;
      };
    }),
    get: vi.fn<Window['betterwork']['schedules']['get']>(async () => ({
      status: 'rejected' as const,
      error: { code: 'schedule_not_found', message: '没有该规则。' },
    })),
    save: vi.fn<Window['betterwork']['schedules']['save']>(async () => ({
      status: 'rejected',
      error: { code: 'schedule_not_found', message: '没有该规则。' },
    })),
    setLifecycle: vi.fn<Window['betterwork']['schedules']['setLifecycle']>(async () => ({
      status: 'rejected',
      error: { code: 'schedule_not_found', message: '没有该规则。' },
    })),
    getOccurrence: vi.fn<Window['betterwork']['schedules']['getOccurrence']>(async () => ({
      status: 'rejected' as const,
      error: { code: 'schedule_not_found', message: '没有该实例。' },
    })),
  };
}

function createExpertsApiFixture(options?: Pick<AppTestApiOptions, 'expert'>) {
  return {
    list: vi.fn(async () => (options?.expert ? [expertSummary] : [])),
    get: vi.fn(async () => (options?.expert ? expertDetail : null)),
    create: vi.fn(async () => ({ expert: expertDetail })),
    saveRevision: vi.fn(async () => ({ expert: expertDetail })),
    copy: vi.fn(async () => ({ expert: expertDetail })),
    setLifecycle: vi.fn(async () => ({ expert: expertDetail })),
    delete: vi.fn(async () => ({ deleted: true })),
  };
}

function createRunsApiFixture() {
  return {
    list: vi.fn(async (input?: { taskId?: string }): Promise<RunSummary[]> =>
      input?.taskId === previousTask.id ? [previousRun] : [],
    ),
    listEvents: vi.fn<Window['betterwork']['runs']['listEvents']>(async () => []),
    start: vi.fn(async () => ({ runId: 'new-run' })),
    onEvent: vi.fn<Window['betterwork']['runs']['onEvent']>(() => () => undefined),
  };
}

function createSkillsApiFixture(options?: Pick<AppTestApiOptions, 'skills'>) {
  return {
    list: vi.fn(async () => options?.skills ?? []),
    get: vi.fn<Window['betterwork']['skills']['get']>(
      async ({ id }) => options?.skills?.find((candidate) => candidate.id === id) ?? null,
    ),
    testRun: vi.fn<Window['betterwork']['skills']['testRun']>(async () => {
      throw new Error('App 测试没有配置 Skill 试运行结果');
    }),
    refreshDependencyGrant: vi.fn<Window['betterwork']['skills']['refreshDependencyGrant']>(
      async () => {
        throw new Error('App 测试没有配置 Skill 依赖授权结果');
      },
    ),
  };
}

function createMcpApiFixture() {
  return {
    listConnections: vi.fn(async () => []),
    getConnection: vi.fn(async () => null),
    saveConnection: vi.fn(async () => ({ connection: undefined })),
    deleteConnection: vi.fn(async () => ({ deleted: true })),
    testConnection: vi.fn(async () => ({ connection: undefined, tools: [] })),
  };
}

function createAppTestApi(options?: AppTestApiOptions) {
  emitNotificationChange = undefined;
  emitScheduleChange = undefined;
  activateSystemNotification = undefined;
  const removedScheduleScopeTaskIds = new Set<string>();
  const api = {
    chrome: { updateTheme: vi.fn(async () => undefined) },
    workspace: createWorkspaceApiFixture(),
    models: {
      list: vi.fn(async (): Promise<ModelProfileSummary[]> => options?.models ?? []),
    },
    knowledge: createKnowledgeApiFixture(),
    artifacts: createArtifactApiFixture(),
    evidence: { list: vi.fn(async () => []) },
    notifications: createNotificationsApiFixture(),
    tasks: {
      list: vi.fn(async (): Promise<RecentTaskSummary[]> => [previousTask]),
      get: vi.fn(async (): Promise<RecentTaskSummary | null> => previousTask),
      create: vi.fn(async () => ({
        task: { id: 'new-task', title: goal },
        sessionId: 'new-session',
      })),
    },
    taskContinuity: {
      getBrief: vi.fn<Window['betterwork']['taskContinuity']['getBrief']>(async () => null),
      saveBrief: vi.fn<Window['betterwork']['taskContinuity']['saveBrief']>(async () => {
        throw new Error('App 测试没有配置 Task Continuity 保存结果');
      }),
    },
    schedules: createSchedulesApiFixture(),
    taskContexts: createTaskContextApiFixture(options, removedScheduleScopeTaskIds),
    discussionCheckpoints: {
      list: vi.fn(async (): Promise<DiscussionCheckpoint[]> => []),
      create: vi.fn(async () => ({ checkpoint: undefined })),
    },
    materials: {
      listCandidates: vi.fn(async (): Promise<MaterialCandidate[]> => []),
      prepareInputSnapshot: vi.fn(async (): Promise<InputSnapshot | null> => null),
    },
    memories: createMemoryApiFixture(options),
    mcp: createMcpApiFixture(),
    experts: createExpertsApiFixture(options),
    runs: createRunsApiFixture(),
    skills: createSkillsApiFixture(options),
    dependencies: {
      listOptions: vi.fn(async () => ({
        distributions: [],
        lockIds: [],
        snapshots: [],
        environments: [],
      })),
    },
  };
  return api;
}

export type AppTestApi = ReturnType<typeof createAppTestApi>;

export function installApi(options?: AppTestApiOptions): AppTestApi {
  const api = createAppTestApi(options);
  Object.defineProperty(window, 'betterwork', { configurable: true, value: api });
  return api;
}
