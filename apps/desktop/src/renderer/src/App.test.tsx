// @vitest-environment jsdom

import type {
  AgentRuntimeEvent,
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionExecutorSummary,
  CreateMemoryRequest,
  ExpertDetail,
  ExpertSummary,
  InputSnapshot,
  MaterialCandidate,
  MaterialReference,
  MemoryReferenceWriteReceipt,
  MemoryViewItem,
  MemoryWriteReceipt,
  ModelProfileSummary,
  RecentTaskSummary,
  Result,
  RunSummary,
  SkillDetail,
  TaskContextRevision,
  WorkspaceBrief,
  WorkspaceReferenceListData,
  WorkspaceReferenceSetData,
} from '@betterwork/agent-protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const skill: SkillDetail = {
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
const goal = '使用「中电金信」模板，生成两页演示文稿——封面 + 一页内容页。';
const previousRun: RunSummary = {
  id: 'previous-run',
  taskId: 'previous-task',
  sessionId: 'previous-session',
  prompt: '旧任务的要求',
  status: 'completed',
  createdAt: 1,
};
const previousTask: RecentTaskSummary = {
  id: 'previous-task',
  workspaceId: 'workspace-1',
  sessionId: 'previous-session',
  title: '旧任务',
  goal: '旧任务的要求',
  createdAt: 1,
  updatedAt: 1,
};

const expertSummary: ExpertSummary = {
  id: 'expert-finance',
  sourceKind: 'user',
  lifecycle: 'active',
  name: '经营分析专家',
  summary: '按月度规则分析经营数字。',
  currentRevision: 1,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 1,
};
const expertDetail: ExpertDetail = {
  ...expertSummary,
  revision: {
    id: 'expert-revision-1',
    expertId: expertSummary.id,
    revision: 1,
    name: expertSummary.name,
    summary: expertSummary.summary,
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
const languageModel: ModelProfileSummary = {
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

const briefFixture: WorkspaceBrief = {
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

const writeReceipt: MemoryWriteReceipt = {
  operationId: memoryOperationUuid,
  commit: 'committed',
  effect: 'unchanged',
  committedRevisionIds: ['memory-1-r1'],
  projectionState: 'synced',
};

const okResult = <TData,>(data: TData) => ({ ok: true as const, data, warnings: [] as never[] });

const artifactVersionReference: MaterialReference = {
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

const memoryViewItem = (overrides?: Partial<MemoryViewItem>): MemoryViewItem => ({
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

function installApi(options?: {
  expert?: boolean;
  context?: TaskContextRevision;
  memories?: MemoryViewItem[];
  models?: ModelProfileSummary[];
}) {
  const api = {
    chrome: { updateTheme: vi.fn(async () => undefined) },
    workspace: {
      getDefault: vi.fn(async () => ({ id: 'workspace-1', rootPath: '/workspace' })),
      listAll: vi.fn(async () => []),
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
    },
    models: {
      list: vi.fn(async (): Promise<ModelProfileSummary[]> => options?.models ?? []),
    },
    knowledge: {
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
    },
    artifacts: {
      list: vi.fn(async (): Promise<ArtifactSummary[]> => []),
      get: vi.fn(async (): Promise<ArtifactDetail | null> => null),
      listVersions: vi.fn(async () => []),
      getVersion: vi.fn(async () => null),
      getVersionExecutor: vi.fn(async (): Promise<ArtifactVersionExecutorSummary | null> => null),
    },
    evidence: { list: vi.fn(async () => []) },
    notifications: {
      list: vi.fn(async () => []),
      onChange: vi.fn(() => () => undefined),
      onActivate: vi.fn(() => () => undefined),
    },
    tasks: {
      list: vi.fn(async (): Promise<RecentTaskSummary[]> => [previousTask]),
      create: vi.fn(async () => ({
        task: { id: 'new-task', title: goal },
        sessionId: 'new-session',
      })),
    },
    taskContexts: {
      get: vi.fn(async (): Promise<TaskContextRevision | null> => options?.context ?? null),
      save: vi.fn(
        async (input: {
          taskId: string;
          expectedRevision?: number;
          executor: TaskContextRevision['executor'];
          skillBindings: TaskContextRevision['skillBindings'];
        }) => ({
          context: {
            id: 'context-1',
            taskId: input.taskId,
            revision: 1,
            executor: input.executor,
            skillBindings: input.skillBindings,
            createdAt: 1,
            updatedAt: 1,
          },
        }),
      ),
    },
    discussionCheckpoints: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ checkpoint: undefined })),
    },
    materials: {
      listCandidates: vi.fn(async (): Promise<MaterialCandidate[]> => []),
      prepareInputSnapshot: vi.fn(async (): Promise<InputSnapshot | null> => null),
    },
    memories: {
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
            decision: 'keep-both',
            applicabilityNote: '按适用范围分别保留。',
            createdAt: 1,
          },
        }),
      ),
      preview: vi.fn(async () => ({
        ok: false,
        error: { code: 'NOT_FOUND', message: '测试未提供范围预览。', retryable: false },
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
          phase: 'legacy_unknown',
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
      rebuildProjection: vi.fn(async () => okResult({ projectionState: 'synced' })),
    },
    mcp: {
      listConnections: vi.fn(async () => []),
      getConnection: vi.fn(async () => null),
      saveConnection: vi.fn(async () => ({ connection: undefined })),
      deleteConnection: vi.fn(async () => ({ deleted: true })),
      testConnection: vi.fn(async () => ({ connection: undefined, tools: [] })),
    },
    experts: {
      list: vi.fn(async () => (options?.expert ? [expertSummary] : [])),
      get: vi.fn(async () => (options?.expert ? expertDetail : null)),
      create: vi.fn(async () => ({ expert: expertDetail })),
      saveRevision: vi.fn(async () => ({ expert: expertDetail })),
      copy: vi.fn(async () => ({ expert: expertDetail })),
      setLifecycle: vi.fn(async () => ({ expert: expertDetail })),
    },
    runs: {
      list: vi.fn(async (input?: { taskId?: string }): Promise<RunSummary[]> =>
        input?.taskId === previousTask.id ? [previousRun] : [],
      ),
      listEvents: vi.fn(async (): Promise<AgentRuntimeEvent[]> => []),
      start: vi.fn(async () => ({ runId: 'new-run' })),
      onEvent: vi.fn(() => () => undefined),
    },
    skills: {
      list: vi.fn(async () => [skill]),
      get: vi.fn(async () => skill),
      testRun: vi.fn(async () => ({ runId: 'unexpected-run' })),
      refreshDependencyGrant: vi.fn(async () => ({ skill, grantActive: true })),
    },
    dependencies: {
      listOptions: vi.fn(async () => ({
        distributions: [],
        lockIds: [],
        snapshots: [],
        environments: [],
      })),
    },
  };
  Object.defineProperty(window, 'betterwork', { configurable: true, value: api });
  return api;
}

async function openTestRun(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '技能' }));
  fireEvent.click(await screen.findByRole('button', { name: /演示生成专家/ }));
  fireEvent.click(await screen.findByRole('button', { name: '试运行' }));
  // 现在以 chip 条形式显示已选技能，查找 aria-label 为“已选能力”的列表。
  const chipBar = await screen.findByRole('list', { name: '已选能力' });
  expect(chipBar.textContent).toContain('演示生成专家');
}

function composer(): HTMLElement {
  return screen.getByRole('textbox', { name: /任务输入/ });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('Skill test run in the task composer', () => {
  it('opens an empty focused draft and starts only after explicit submission with the Skill binding', async () => {
    const api = installApi();
    render(<App />);
    await openTestRun();

    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(document.activeElement).toBe(composer());
    expect(screen.getByRole('button', { name: '开始工作' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(composer(), { key: 'Enter', metaKey: true });
    expect(api.tasks.create).not.toHaveBeenCalled();
    expect(api.runs.start).not.toHaveBeenCalled();
    expect(api.skills.testRun).not.toHaveBeenCalled();

    fireEvent.change(composer(), { target: { value: goal } });
    expect(api.runs.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() =>
      expect(api.runs.start).toHaveBeenCalledExactlyOnceWith({
        taskId: 'new-task',
        sessionId: 'new-session',
        prompt: goal,
        taskContextRevisionId: 'context-1',
        expectedTaskContextRevision: 1,
      }),
    );
    expect(api.tasks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'workspace-1',
      title: goal,
      goal,
    });
    expect(await screen.findByText(goal)).toBeTruthy();
    expect(api.skills.testRun).not.toHaveBeenCalled();
    // 首次挂载完整 App 含 Markdown 与所有页面；全量并行测试的冷启动需更长预算。
  }, 15_000);

  it('clears previous messages and ignores late history responses when opening the draft', async () => {
    const api = installApi();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText('旧任务的要求');
    let resolveEvents: ((events: []) => void) | undefined;
    api.runs.listEvents.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          resolveEvents = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: /旧任务/ }));
    await waitFor(() => expect(resolveEvents).toBeTypeOf('function'));
    await openTestRun();
    await act(async () => {
      resolveEvents?.([]);
    });
    expect(screen.queryByText('旧任务的要求')).toBeNull();
    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('retains the prompt and Skill on failure and prevents duplicate starts during submission', async () => {
    const api = installApi();
    api.runs.start.mockRejectedValueOnce(new Error('启动失败，请重试'));
    render(<App />);
    await openTestRun();
    fireEvent.change(composer(), { target: { value: goal } });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });
    await screen.findByRole('alert');
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
    expect(api.runs.start).toHaveBeenCalledTimes(1);
    expect(composer()).toHaveProperty('value', goal);
    // chip 条应该保留。
    expect(screen.getByRole('list', { name: '已选能力' }).textContent).toContain('演示生成专家');

    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(2));
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
    expect(api.runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: goal,
        taskContextRevisionId: 'context-1',
        expectedTaskContextRevision: 1,
      }),
    );
  });

  it.each(['新建任务', '旧任务'])('does not carry the draft Skill into %s', async (destination) => {
    const api = installApi();
    render(<App />);
    await openTestRun();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(destination) }));
    // chip 条应该被清空。
    expect(screen.queryByRole('list', { name: '已选能力' })).toBeNull();
    fireEvent.change(composer(), { target: { value: '普通要求' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.runs.start).toHaveBeenCalledWith({
      taskId: destination === '旧任务' ? 'previous-task' : 'new-task',
      sessionId: destination === '旧任务' ? 'previous-session' : 'new-session',
      prompt: '普通要求',
      taskContextRevisionId: 'context-1',
      expectedTaskContextRevision: 1,
    });
  });
});

describe('Expert summon in the task composer', () => {
  it('summons an Expert into a blank task and pins its revision on first send', async () => {
    const api = installApi({ expert: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));

    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(screen.getByRole('list', { name: '当前专家' }).textContent).toContain('经营分析专家');
    fireEvent.change(composer(), { target: { value: '分析本月经营数字' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
      }),
    );
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.runs.start).toHaveBeenCalledWith(
      expect.objectContaining({
        taskContextRevisionId: 'context-1',
        expectedTaskContextRevision: 1,
      }),
    );
  });

  it('shows the summoned Expert model in the task composer', async () => {
    const api = installApi({ expert: true, models: [languageModel] });
    api.experts.get.mockResolvedValue({
      ...expertDetail,
      revision: {
        ...expertDetail.revision,
        modelReference: { mode: 'profile', modelProfileId: languageModel.id },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));

    expect(await screen.findByText('openai-compatible · local-model')).toBeTruthy();
    expect(api.experts.get).toHaveBeenCalledWith({ id: expertSummary.id });
  });

  it('carries the Expert common references into the next TaskContext', async () => {
    const api = installApi({ expert: true });
    const reference = {
      reference: {
        kind: 'knowledge-revision' as const,
        knowledgeDocumentId: 'finance-rules',
        knowledgeRevisionId: 'finance-rules-v2',
        contentHash: 'rules-hash',
        sourcePath: '/rules/finance.md',
      },
      purpose: 'rule' as const,
    };
    api.experts.get.mockResolvedValue({
      ...expertDetail,
      revision: { ...expertDetail.revision, referenceMaterials: [reference] },
    });
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: reference.reference,
        title: '公司财务规则',
        sourceLabel: '知识 · finance.md',
        status: 'ready',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /任务输入/ }), {
      target: { value: '分析本月经营数字' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        materials: [{ ...reference, addedFrom: 'expert-reference' }],
      }),
    );
  });

  it('does not carry an Expert artifact reference from another workspace', async () => {
    const api = installApi({ expert: true });
    const reference = {
      reference: {
        kind: 'artifact-version' as const,
        artifactId: 'previous-report',
        artifactVersionId: 'previous-report-v3',
        contentHash: 'previous-report-hash',
        originWorkspaceId: 'other-workspace',
      },
      purpose: 'historical-comparison' as const,
    };
    api.experts.get.mockResolvedValue({
      ...expertDetail,
      revision: { ...expertDetail.revision, referenceMaterials: [reference] },
    });
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: reference.reference,
        title: '上月经营报告',
        sourceLabel: '成果 · 上月经营报告 · 其他工作空间',
        status: 'ready',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /任务输入/ }), {
      target: { value: '分析本月经营数字' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(expect.objectContaining({ materials: [] }));
  });
});

describe('Workspace input material display', () => {
  it('shows the filename immediately after adding a workspace file', async () => {
    const api = installApi();
    api.materials.prepareInputSnapshot.mockResolvedValue({
      id: 'snapshot-new',
      workspaceId: 'workspace-1',
      sourcePath: '/workspace/current-data-excel.xlsx',
      contentHash: 'hash-new',
      byteSize: 1,
      format: 'xlsx',
      fileKey: 'input-snapshots/hash-new/content',
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '添加能力' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /添加文件/ }));

    expect(api.materials.prepareInputSnapshot).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    });
    expect(await screen.findByText('current-data-excel.xlsx')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看上下文' }));
    fireEvent.click(screen.getByRole('tab', { name: '资料' }));
    const contextPanel = document.querySelector('.context-panel');
    expect(contextPanel?.textContent).toContain('current-data-excel.xlsx');
  });

  it('reloads the filename when reopening a task with a saved input snapshot', async () => {
    const api = installApi({
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: { kind: 'general' },
        skillBindings: [],
        materials: [
          {
            reference: {
              kind: 'workspace-input-snapshot',
              snapshotId: 'snapshot-saved',
              workspaceId: 'workspace-1',
              contentHash: 'hash-saved',
              format: 'xlsx',
              fileKey: 'input-snapshots/hash-saved/content',
            },
            purpose: 'current-input',
            addedFrom: 'user-input',
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: 'snapshot-saved',
          workspaceId: 'workspace-1',
          contentHash: 'hash-saved',
          format: 'xlsx',
          fileKey: 'input-snapshots/hash-saved/content',
        },
        title: 'current-data-excel.xlsx',
        sourceLabel: '工作区文件 · /workspace/current-data-excel.xlsx',
        status: 'ready',
      },
    ]);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));

    expect(await screen.findByText('current-data-excel.xlsx')).toBeTruthy();
    expect(api.materials.listCandidates).toHaveBeenCalledWith({ taskId: previousTask.id });
  });
});

describe('Task context restoration', () => {
  it('restores the saved Skill selection when reopening a task', async () => {
    const api = installApi({
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: { kind: 'general' },
        skillBindings: [
          { skillId: skill.id, revisionId: skill.currentRevisionId, source: 'task-selection' },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    expect((await screen.findByRole('list', { name: '已选能力' })).textContent).toContain(
      skill.name,
    );
    expect(api.taskContexts.get).toHaveBeenCalledWith({ taskId: previousTask.id });
  });

  it('does not claim the current default model for an historical Expert revision', async () => {
    installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: 'historical-expert-revision',
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));

    expect(await screen.findByText('专家修订模型（历史版本）')).toBeTruthy();
  });

  it('offers Expert-scoped memory capture for an Expert task', async () => {
    const api = installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'message-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'message.completed',
        messageId: 'message-1',
        content: '经营分析应先核对规则。',
      },
      {
        id: 'completed-event',
        runId: previousRun.id,
        sequence: 2,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '经营分析应先核对规则。',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '记住这段经验' }));
    // 专家任务的捕获表单默认落在「专家 + 工作空间」范围，并给出只读原文选择区（§3.1、MI02）。
    const scopeButton = await screen.findByRole('button', { name: '记忆适用范围' });
    expect(scopeButton.textContent ?? '').toContain('专家与工作空间');
    expect(screen.getByRole('textbox', { name: '回答原文' })).toBeDefined();
  });

  it('回答捕获保留原文选区来源，并且不提供全局范围', async () => {
    const api = installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'message-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'message.completed',
        messageId: 'message-1',
        content: '经营分析应先核对规则。',
      },
      {
        id: 'completed-event',
        runId: previousRun.id,
        sequence: 2,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '经营分析应先核对规则。',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '记住这段经验' }));
    // 未确认选区前不得提交（契约 §11.1）。
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '先核对规则再出结论。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));
    await Promise.resolve();
    expect(api.memories.create).not.toHaveBeenCalled();

    const original = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '回答原文' });
    original.setSelectionRange(0, 9);
    fireEvent.select(original);
    fireEvent.click(screen.getByRole('button', { name: '确认选区' }));
    // 派生来源不进入全局范围：菜单里不再出现「专家通用」「用户全局」。
    fireEvent.click(screen.getByRole('button', { name: '记忆适用范围' }));
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
    expect(labels.some((label) => label.includes('专家通用') || label.includes('全局'))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '记忆适用范围' }));
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));

    await waitFor(() => expect(api.memories.create).toHaveBeenCalledTimes(1));
    expect(api.memories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '先核对规则再出结论。',
        facet: 'method',
        asUserInstruction: false,
        sourceSelector: {
          kind: 'run-assistant',
          runId: previousRun.id,
          eventId: 'message-event',
          start: 0,
          end: 9,
        },
      }),
    );
  });
  /** MI02 AC3：保存失败要留下草稿与原因，未提交的取消不得写库。 */
  it('回答捕获保存失败时保留草稿与幂等键，取消不写库', async () => {
    const api = installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'message-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'message.completed',
        messageId: 'message-1',
        content: '经营分析应先核对规则。',
      },
      {
        id: 'completed-event',
        runId: previousRun.id,
        sequence: 2,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '经营分析应先核对规则。',
      },
    ]);
    api.memories.create.mockImplementation(async () => ({
      ok: false,
      error: {
        code: 'SOURCE_REVIEW_REQUIRED',
        message: '来源回答缺少可证明的审计记录，请重新确认选区。',
        retryable: false,
      },
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '记住这段经验' }));
    const original = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '回答原文' });
    original.setSelectionRange(0, 9);
    fireEvent.select(original);
    fireEvent.click(screen.getByRole('button', { name: '确认选区' }));
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '先核对规则再出结论。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));

    await waitFor(() => expect(api.memories.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('来源回答缺少可证明的审计记录，请重新确认选区。')).toBeTruthy();
    // 失败不关表单、不吞草稿：正文与来源区间都还在，可以原地重试。
    expect(screen.getByRole('textbox', { name: '记忆正文' })).toHaveProperty(
      'value',
      '先核对规则再出结论。',
    );
    expect(screen.getByRole('button', { name: '保留来源并记住' })).toBeTruthy();

    // 失败重试复用同一个幂等键：一次打开表单一个键（契约 §5.6）。
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));
    await waitFor(() => expect(api.memories.create).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.memories.create).mock.calls;
    const firstKey = calls[0]?.[0]?.operationId;
    expect(firstKey).toBeTruthy();
    expect(calls[1]?.[0]?.operationId).toBe(firstKey);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '保留来源并记住' })).toBeNull(),
    );
    expect(api.memories.create).toHaveBeenCalledTimes(2);
  });
});

describe('Expert configuration', () => {
  it('shows the Expert memory summary and opens memory management', async () => {
    const legacyProvenance = {
      schemaVersion: 1,
      verification: 'legacy-unverified',
      sourceType: 'user-explicit',
    } as const;
    const memory = memoryViewItem({
      id: 'expert-memory-1',
      revisionId: 'expert-memory-1-r1',
      scope: { kind: 'expert', expertId: expertSummary.id },
      content: '经营月报先核对财务规则。',
      sourceType: 'user-explicit',
      contentHash: 'expert-memory-hash',
      provenance: legacyProvenance,
    });
    const workspaceMemory = memoryViewItem({
      id: 'expert-workspace-memory-1',
      revisionId: 'expert-workspace-memory-1-r1',
      scope: { kind: 'expert-workspace', expertId: expertSummary.id, workspaceId: 'workspace-1' },
      content: '当前工作空间的月报需要附上预算偏差。',
      sourceType: 'user-explicit',
      status: 'candidate',
      candidateDisposition: 'pending',
      effectiveStatus: 'candidate',
      provenance: legacyProvenance,
    });
    const otherWorkspaceMemory = memoryViewItem({
      id: 'expert-workspace-memory-2',
      revisionId: 'expert-workspace-memory-2-r1',
      scope: { kind: 'expert-workspace', expertId: expertSummary.id, workspaceId: 'workspace-2' },
      content: '其他工作空间的内容不应出现在这里。',
      sourceType: 'user-explicit',
      provenance: legacyProvenance,
    });
    installApi({ expert: true, memories: [memory, workspaceMemory, otherWorkspaceMemory] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看配置' }));

    expect(await screen.findByText('1 条已确认 · 1 条待确认')).toBeTruthy();
    expect(screen.getByText(memory.content)).toBeTruthy();
    expect(screen.getByText(workspaceMemory.content)).toBeTruthy();
    expect(screen.queryByText(otherWorkspaceMemory.content)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '管理记忆' }));
    expect(await screen.findByText('当前范围：经营分析专家 · 当前工作空间')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: '让长期经验可查看、可确认、可撤回' }),
    ).toBeTruthy();
  });

  it('allows an Expert to pin a language model profile or inherit the application default', async () => {
    const api = installApi({
      expert: true,
      models: [languageModel],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑配置' }));

    const modelSelect = await screen.findByRole('combobox', { name: '专家模型偏好' });
    expect(modelSelect).toHaveProperty('value', 'application-default');
    fireEvent.change(modelSelect, { target: { value: 'model-language-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }));

    await waitFor(() => expect(api.experts.saveRevision).toHaveBeenCalledTimes(1));
    expect(api.experts.saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: expect.objectContaining({
          modelReference: { mode: 'profile', modelProfileId: 'model-language-1' },
        }),
      }),
    );
  });

  it('opens a separate editor and saves a new immutable revision', async () => {
    const api = installApi({ expert: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑配置' }));
    const identity = await screen.findByRole('textbox', { name: '人格与职责' });
    fireEvent.change(identity, { target: { value: '负责经营分析并检查交付。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }));
    await waitFor(() => expect(api.experts.saveRevision).toHaveBeenCalledTimes(1));
    expect(api.experts.saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expertId: expertSummary.id,
        expectedRevision: 1,
        revision: expect.objectContaining({ identity: '负责经营分析并检查交付。' }),
      }),
    );
  });
});

/**
 * 参考成果版本的端到端纪律（WM14，产品设计 §3.6、实施契约 §10）。
 *
 * 界面把「标记」和「引用到当前任务」分成两件事：引用只把**那一版**（精确版本 id +
 * 内容哈希）加进当前任务材料，既不自动发送也不换专家；来源消失时报错可见、视图不跳走。
 */
describe('参考成果版本接入当前任务', () => {
  const pinnedHash = 'b'.repeat(64);
  const reportSummary: ArtifactSummary = {
    id: 'report-1',
    workspaceId: 'workspace-1',
    taskId: 'previous-task',
    type: 'markdown',
    title: '季度复盘',
    currentVersionId: 'version-9',
    versionNumber: 3,
    origin: 'assistant-run',
    sourceRunId: 'previous-run',
    createdAt: 1,
    updatedAt: 1,
  };
  const reportDetail: ArtifactDetail = {
    ...reportSummary,
    content: '# 季度复盘',
    contentHash: pinnedHash,
    evidence: [],
  };
  const pinnedReference = {
    kind: 'artifact-version' as const,
    artifactId: reportSummary.id,
    artifactVersionId: 'version-9',
    contentHash: pinnedHash,
    originWorkspaceId: 'workspace-1',
  };

  const installReferenceApi = (
    options?: Parameters<typeof installApi>[0],
  ): ReturnType<typeof installApi> => {
    const api = installApi(options);
    api.artifacts.list.mockResolvedValue([reportSummary]);
    api.artifacts.get.mockResolvedValue(reportDetail);
    // MI08：默认身份来自来源 Run 快照，而不是旧 Task 的当前草稿。
    api.artifacts.getVersionExecutor.mockResolvedValue({
      kind: 'expert',
      sourceRunId: 'previous-run',
      expertId: expertSummary.id,
      sourceExpertRevisionId: expertDetail.revision.id,
      currentExpertRevisionId: expertDetail.revision.id,
      name: expertDetail.name,
    });
    api.workspace.listReferenceVersions.mockResolvedValue(
      okResult({
        items: [
          {
            reference: {
              id: 'ref-1',
              workspaceId: 'workspace-1',
              artifactVersionId: 'version-9',
              contentHash: pinnedHash,
              label: '季度复盘 · v3',
              status: 'active' as const,
              revision: 1,
              selectedAt: 1,
              updatedAt: 1,
            },
            artifactId: reportSummary.id,
            status: 'ready' as const,
          },
        ],
      }),
    );
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: pinnedReference,
        title: '季度复盘 · v3',
        sourceLabel: '成果 · 季度复盘',
        status: 'ready',
      },
    ]);
    return api;
  };

  it('引用只固定精确版本与哈希进材料，不自动启动运行', async () => {
    const api = installReferenceApi();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '成果' }));
    fireEvent.click(await screen.findByRole('button', { name: /季度复盘/ }));
    expect(await screen.findByText('本空间参考版本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '引用到当前任务' }));

    const chipBar = await screen.findByRole('list', { name: '本次材料' });
    expect(chipBar.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    // 材料标题要等候选清单加载才有名字，这里断言的是引用本身：固定到结构参考用途、不自动发送
    expect(chipBar.textContent).toContain('成果版本');
    expect(screen.getByRole('combobox', { name: '成果版本用途' })).toHaveProperty(
      'value',
      'structure-reference',
    );
    expect(api.runs.start).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: /任务输入/ }), {
      target: { value: '按这一版的结构重写摘要' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        materials: [
          {
            reference: pinnedReference,
            purpose: 'structure-reference',
            addedFrom: 'user-input',
          },
        ],
      }),
    );
    // 复用已标记的引用：不再重复写标记，也不跟随成果的最新版本
    expect(api.workspace.setReferenceVersion).not.toHaveBeenCalled();
  });

  it('简报里的参考版本对应成果已消失时，错误可见且不切换视图', async () => {
    const api = installApi();
    api.artifacts.get.mockResolvedValue(null);
    api.workspace.memoryBrief.mockResolvedValue(
      okResult({
        ...briefFixture,
        referenceVersions: {
          items: [
            {
              reference: {
                id: 'ref-1',
                workspaceId: 'workspace-1',
                artifactVersionId: 'version-9',
                contentHash: pinnedHash,
                label: '季度复盘 · v3',
                status: 'active' as const,
                revision: 1,
                selectedAt: 1,
                updatedAt: 1,
              },
              artifactId: reportSummary.id,
              status: 'ready' as const,
            },
          ],
          total: 1,
          truncated: false,
        },
      }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '查看上下文' }));
    fireEvent.click(screen.getByRole('tab', { name: '简报' }));
    fireEvent.click(await screen.findByRole('button', { name: /季度复盘/ }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      '该参考版本对应的成果已不存在，请在成果列表中确认。',
    );
    expect(api.artifacts.get).toHaveBeenCalledWith({ id: reportSummary.id });
    // 视图仍在工作页：失败不把用户扔到空白成果页
    expect(screen.getByRole('textbox', { name: /任务输入/ })).toBeTruthy();
  });

  /** 来源任务的专家绑定就记在它的 TaskContext 里，草稿衔接要按它继承。 */
  const expertContext = (): TaskContextRevision => ({
    id: 'context-previous',
    taskId: 'previous-task',
    revision: 2,
    executor: {
      kind: 'expert',
      expertId: expertSummary.id,
      expertRevisionId: expertDetail.revision.id,
    },
    skillBindings: [],
    createdAt: 1,
    updatedAt: 1,
  });

  const openVersionAction = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('button', { name: '成果' }));
    fireEvent.click(await screen.findByRole('button', { name: /季度复盘/ }));
    fireEvent.click(await screen.findByRole('button', { name: '基于此版本开始新任务' }));
  };

  it('沿用来源专家：草稿交给该专家当前可用修订，不自动发送也不提示', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    render(<App />);
    await openVersionAction();

    const expertChip = await screen.findByRole('list', { name: '当前专家' });
    expect(expertChip.textContent).toContain('经营分析专家');
    expect(screen.queryByText(/通用助手/)).toBeNull();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('来源执行身份读取失败时保留原任务与草稿，只报一次可重试错误', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    api.artifacts.getVersionExecutor.mockRejectedValueOnce(new Error('数据库暂时不可用'));
    render(<App />);
    await openVersionAction();

    expect(await screen.findByText(/无法确认该版本的来源执行身份，原任务保持不变/)).toBeTruthy();
    // 失败不新建任务、不切走成果视图，也不留下半途的专家切换。
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('重复点击时迟到响应不覆盖后一次结果', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    let resolveFirst: ((value: ArtifactVersionExecutorSummary | null) => void) | undefined;
    api.artifacts.getVersionExecutor
      .mockImplementationOnce(
        () =>
          new Promise<ArtifactVersionExecutorSummary | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        kind: 'unavailable',
        reason: 'expert-unavailable',
      });
    render(<App />);
    await openVersionAction();
    // 再点一次：第一次的响应此刻仍未回来，只有后一次的结果可以落到界面上。
    const again = screen.getAllByRole('button', { name: '基于此版本开始新任务' }).at(-1);
    if (again) fireEvent.click(again);

    resolveFirst?.({
      kind: 'expert',
      sourceRunId: 'previous-run',
      expertId: expertSummary.id,
      sourceExpertRevisionId: expertDetail.revision.id,
      currentExpertRevisionId: expertDetail.revision.id,
      name: expertDetail.name,
    });
    await Promise.resolve();
    await Promise.resolve();

    // 只有后一次（专家不可用）的结果生效：不出现幽灵专家，也不重复提示。
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();
    expect(
      await screen.findByText('来源任务的专家已不可用，新任务先用通用助手，可自行选择其他专家。'),
    ).toBeTruthy();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  /**
   * MI08 AC3：来源专家配置已更新时要说明「按当前配置使用」，并且不继承来源任务的技能选择；
   * 来源身份只用于决定默认专家，旧授权不自动跟随。
   */
  it('来源专家修订已更新时说明按当前配置使用，且不复制技能绑定', async () => {
    const api = installReferenceApi({
      expert: true,
      context: {
        ...expertContext(),
        // 来源任务带着技能选择；新草稿只继承默认专家，不复制这些授权。
        skillBindings: [{ skillId: 'skill-old', revisionId: 'rev-old', source: 'task-selection' }],
      },
    });
    api.artifacts.getVersionExecutor.mockResolvedValue({
      kind: 'expert',
      sourceRunId: 'previous-run',
      expertId: expertSummary.id,
      sourceExpertRevisionId: 'expert-revision-old',
      currentExpertRevisionId: expertDetail.revision.id,
      name: expertDetail.name,
    });
    render(<App />);
    await openVersionAction();

    expect(await screen.findByText(/旧版本配置；新任务使用其当前版本/)).toBeTruthy();
    expect(api.runs.start).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: /任务输入/ }), {
      target: { value: '按这一版的结构重写摘要' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
      }),
    );
  });

  it('来源专家已不可用时改用通用助手并当场说明，不猜专家', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    api.artifacts.getVersionExecutor.mockResolvedValue({
      kind: 'unavailable',
      reason: 'expert-unavailable',
    });
    render(<App />);
    await openVersionAction();

    expect(
      await screen.findByText('来源任务的专家已不可用，新任务先用通用助手，可自行选择其他专家。'),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();
    expect(api.runs.start).not.toHaveBeenCalled();
  });
});
