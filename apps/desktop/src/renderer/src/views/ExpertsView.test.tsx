// @vitest-environment jsdom

import type {
  ExpertDetail,
  ExpertSummary,
  MaterialCandidate,
  McpConnectionSummary,
  MemoryRecord,
  ModelProfileSummary,
  SkillSummary,
} from '@betterwork/agent-protocol';
import { mcpConnectionSummarySchema, skillSummarySchema } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { languageModel, memoryViewItem } from '../app-test-fixtures';
import type { ExpertsState } from '../hooks/use-experts';
import { ExpertsPage } from './ExpertsView';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const userExpert: ExpertSummary = {
  id: 'expert-user',
  sourceKind: 'user',
  lifecycle: 'active',
  name: '纪要整理',
  summary: '把会议记录整理成结论与待办',
  author: '财务组',
  tags: ['纪要'],
  currentRevision: 3,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 1,
};
const builtinExpert: ExpertSummary = {
  ...userExpert,
  id: 'expert-builtin',
  sourceKind: 'builtin',
  name: '研究顾问',
  author: '',
  currentRevision: 2,
};

/** 本测试只看列表档给出什么，不点开详情，所以这些动作一律钉成「谁碰谁红」。 */
function unused(): never {
  throw new Error('专家列表测试不该触发这条动作');
}

function stateStub(experts: ExpertSummary[]): ExpertsState {
  return {
    experts,
    loading: false,
    error: '',
    refresh: vi.fn(),
    get: vi.fn(async () => unused()),
    create: vi.fn(async () => unused()),
    saveRevision: vi.fn(async () => unused()),
    copy: vi.fn(async () => unused()),
    setLifecycle: vi.fn(async () => unused()),
    remove: vi.fn(async () => unused()),
  };
}

function renderCatalog(experts: ExpertSummary[]): HTMLElement {
  const state = stateStub(experts);
  const { container } = render(
    <ExpertsPage
      state={state}
      skills={[]}
      mcpConnections={[]}
      memories={[]}
      models={[]}
      materialCandidates={[]}
      actions={state}
      onSummon={vi.fn(async () => undefined)}
      onError={vi.fn()}
      onManageMemories={vi.fn()}
    />,
  );
  return container;
}

function detailOf(expert: ExpertSummary = userExpert): ExpertDetail {
  return {
    ...expert,
    revision: {
      id: `${expert.id}-revision-${expert.currentRevision}`,
      expertId: expert.id,
      revision: expert.currentRevision,
      createdAt: 1,
      name: expert.name,
      summary: expert.summary,
      author: expert.author,
      tags: expert.tags,
      identity: '负责整理工作材料。',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
      referenceMaterials: [],
    },
  };
}

function renderExpertsPage(options?: {
  experts?: ExpertSummary[];
  detail?: ExpertDetail;
  memories?: MemoryRecord[];
  models?: ModelProfileSummary[];
  skills?: SkillSummary[];
  mcpConnections?: McpConnectionSummary[];
  skillsLoading?: boolean;
  workspaceId?: string;
  actions?: Partial<ExpertsState>;
}) {
  const state = stateStub(options?.experts ?? [userExpert]);
  const actions = {
    ...state,
    get: vi.fn(async () => options?.detail ?? detailOf()),
    ...options?.actions,
  };
  const onSummon = vi.fn(async () => undefined);
  const onError = vi.fn();
  const onManageMemories = vi.fn();
  const { container } = render(
    <ExpertsPage
      state={state}
      skills={options?.skills ?? []}
      mcpConnections={options?.mcpConnections ?? []}
      skillsLoading={options?.skillsLoading ?? false}
      memories={options?.memories ?? []}
      models={options?.models ?? []}
      materialCandidates={[]}
      {...(options?.workspaceId === undefined ? {} : { workspaceId: options.workspaceId })}
      actions={actions}
      onSummon={onSummon}
      onError={onError}
      onManageMemories={onManageMemories}
    />,
  );
  return { actions, container, onError, onManageMemories, onSummon, state };
}

/** 一张条目上给出的动作集合；排序比较的是「有哪几颗」，不是「摆在哪一格」。
 * 卡片自己的整片可点区不算动作——它的可及名称是标题与说明的聚合。 */
function actionLabels(root: Element): string[] {
  return [...root.querySelectorAll('button:not(.card-main)')]
    .map((button) => (button.textContent ?? '').trim())
    .filter((label) => label !== '')
    .sort();
}

describe('ExpertsPage 的目录条目', () => {
  it.each(['list', 'detail'])('从%s 编辑后取消归还对应入口，不修改原专家', async (origin) => {
    const detail: ExpertDetail = {
      ...userExpert,
      revision: {
        id: 'expert-r3',
        expertId: userExpert.id,
        revision: 3,
        createdAt: 1,
        name: userExpert.name,
        summary: userExpert.summary,
        author: userExpert.author,
        tags: userExpert.tags,
        identity: '整理纪要',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
        referenceMaterials: [],
      },
    };
    const base = stateStub([userExpert]);
    const actions = {
      ...base,
      get: vi.fn(async () => detail),
      saveRevision: vi.fn<ExpertsState['saveRevision']>(),
    };
    render(
      <ExpertsPage
        state={base}
        actions={actions}
        skills={[]}
        mcpConnections={[]}
        memories={[]}
        models={[]}
        materialCandidates={[]}
        onSummon={vi.fn(async () => undefined)}
        onError={vi.fn()}
        onManageMemories={vi.fn()}
      />,
    );
    if (origin === 'detail') fireEvent.click(screen.getByRole('button', { name: '详情' }));
    const name = origin === 'detail' ? '编辑配置' : '编辑';
    const editButton = await screen.findByRole('button', { name });
    fireEvent.click(editButton);
    const field = await screen.findByLabelText('名称');
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: '未保存的名称' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name })));
    expect(actions.saveRevision).not.toHaveBeenCalled();
    expect(detail.revision.name).toBe(userExpert.name);
  });

  it('筛选保留已选精确版本，越范围或失效后仍可移除，取消不再提交', async () => {
    const state = stateStub([]);
    const create = vi.fn<ExpertsState['create']>(async () => {
      throw new Error('保留草稿');
    });
    const candidate = (version: number, workspaceId = 'ws-1'): MaterialCandidate => ({
      title: '经营报告',
      sourceLabel: '成果 · 经营报告',
      status: 'ready',
      detail: `经营报告 · v${version}`,
      reference: {
        kind: 'artifact-version',
        artifactId: 'artifact-1',
        artifactVersionId: `v${version}`,
        contentHash: `${version}`.repeat(64),
        originWorkspaceId: workspaceId,
      },
    });
    const knowledge: MaterialCandidate = {
      title: '核对口径',
      sourceLabel: '知识',
      status: 'ready',
      detail: '第 3 版',
      reference: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'doc-1',
        knowledgeRevisionId: 'r3',
        contentHash: 'a'.repeat(64),
        sourcePath: '/notes/rules.md',
      },
    };
    const page = (candidates: MaterialCandidate[]) => (
      <ExpertsPage
        state={state}
        actions={{ ...state, create }}
        skills={[]}
        mcpConnections={[]}
        memories={[]}
        models={[]}
        workspaceId="ws-1"
        materialCandidates={candidates}
        onSummon={vi.fn(async () => undefined)}
        onError={vi.fn()}
        onManageMemories={vi.fn()}
      />
    );
    const { rerender } = render(
      page([candidate(1), candidate(2), candidate(3, 'ws-other'), knowledge]),
    );
    fireEvent.click(screen.getByRole('button', { name: '新建专家' }));
    expect(document.activeElement).toBe(screen.getByLabelText('名称'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '经营专家' } });
    fireEvent.change(screen.getByLabelText('人格与职责'), { target: { value: '核对经营数据' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: '当前空间成果版本' })).getByRole('checkbox', {
        name: /v2/,
      }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: '筛选参考标题或版本' }), {
      target: { value: '口径' },
    });
    expect(
      within(screen.getByRole('group', { name: '已选参考' }))
        .getByRole('checkbox', { name: /v2/ })
        .getAttribute('disabled'),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole('group', { name: '知识修订' })).getByRole('checkbox', {
        name: /核对口径/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0].referenceMaterials).toEqual([
      { reference: candidate(2).reference, purpose: 'historical-comparison' },
      { reference: knowledge.reference, purpose: 'rule' },
    ]);
    rerender(
      page([
        candidate(1),
        { ...candidate(2, 'ws-other'), status: 'unavailable' },
        candidate(3, 'ws-other'),
        knowledge,
      ]),
    );
    const selected = within(screen.getByRole('group', { name: '已选参考' })).getByRole('checkbox', {
      name: /v2.*不适用于当前工作空间.*当前不可用/,
    });
    expect(selected.getAttribute('disabled')).toBeNull();
    fireEvent.click(selected);
    expect(
      within(screen.getByRole('group', { name: '已选参考' })).queryByRole('checkbox', {
        name: /v2/,
      }),
    ).toBeNull();
    rerender(page([]));
    const missing = screen.getByRole('checkbox', { name: /已选参考.*来源已不可用/ });
    expect(missing.getAttribute('disabled')).toBeNull();
    fireEvent.click(missing);
    expect(screen.queryByRole('checkbox', { name: /来源已不可用/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '新建专家' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '新建专家' })).toBeTruthy();
  });
  it('逐卡给出自己的动作：内置只有复制副本，没有编辑与删除', () => {
    const container = renderCatalog([userExpert, builtinExpert]);
    const cards = container.querySelectorAll('.card');
    expect(cards).toHaveLength(2);

    const editable = cards[0] as HTMLElement;
    const readonly = cards[1] as HTMLElement;
    expect(actionLabels(editable)).toEqual(['停用', '删除', '召唤', '编辑', '详情'].sort());
    expect(actionLabels(readonly)).toEqual(['停用', '复制副本', '召唤', '详情'].sort());
    expect(within(readonly).queryByRole('button', { name: '删除' })).toBeNull();
    expect(within(readonly).queryByRole('button', { name: '编辑' })).toBeNull();
    expect(within(editable).queryByRole('button', { name: '复制副本' })).toBeNull();
  });

  it('切到列表档后，同一条目的动作与署名一格不少——两种视图不许各自长出一套', async () => {
    const container = renderCatalog([userExpert, builtinExpert]);
    const cards = [...container.querySelectorAll('.card')];
    const bylineOnCards = cards.map((card) => card.querySelector('.card-byline')?.textContent);
    expect(bylineOnCards).toEqual(['用户 · 财务组 · v3', '内置 · v2']);

    fireEvent.click(screen.getByRole('button', { name: '列表' }));
    await waitFor(() => expect(container.querySelector('.list-row')).not.toBeNull());

    const rows = [...container.querySelectorAll('.list-row[data-variant="card"]')];
    expect(rows).toHaveLength(2);
    for (const [index, row] of rows.entries()) {
      const card = cards[index] as Element;
      expect(actionLabels(row)).toEqual(actionLabels(card));
      expect(row.querySelector('.list-row-meta')?.textContent).toBe(bylineOnCards[index]);
    }
  });
});

describe('ExpertsPage 的整页配置交互', () => {
  it('参考读取经历加载、失败和重试后才展示空态，并保留创建草稿', async () => {
    const state = stateStub([]);
    const actions = { ...state };
    const onRetryReferences = vi.fn();
    const onSummon = vi.fn(async () => undefined);
    const onError = vi.fn();
    const onManageMemories = vi.fn();
    const page = (referencesLoading: boolean, referencesError: string) => (
      <ExpertsPage
        state={state}
        actions={actions}
        skills={[]}
        mcpConnections={[]}
        memories={[]}
        models={[]}
        materialCandidates={[]}
        referencesLoading={referencesLoading}
        referencesError={referencesError}
        onRetryReferences={onRetryReferences}
        onSummon={onSummon}
        onError={onError}
        onManageMemories={onManageMemories}
      />
    );
    const { rerender } = render(page(true, ''));

    fireEvent.click(screen.getByRole('button', { name: '新建专家' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '保留名称草稿' } });
    expect(screen.getByText('正在加载常用参考…')).toBeTruthy();
    expect(screen.queryByText('没有匹配的知识修订。')).toBeNull();
    expect(screen.queryByText('没有匹配的成果版本。')).toBeNull();

    rerender(page(false, '参考暂不可读取'));
    expect(screen.getByRole('alert').textContent).toContain('参考暂不可读取');
    expect(screen.queryByText('没有匹配的知识修订。')).toBeNull();
    expect(screen.queryByText('没有匹配的成果版本。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetryReferences).toHaveBeenCalledOnce();

    rerender(page(true, ''));
    expect(screen.getByText('正在加载常用参考…')).toBeTruthy();
    expect(screen.getByLabelText('名称')).toHaveProperty('value', '保留名称草稿');
    rerender(page(false, ''));

    expect(await screen.findByText('没有匹配的知识修订。')).toBeTruthy();
    expect(screen.getByText('没有匹配的成果版本。')).toBeTruthy();
    expect(screen.getByLabelText('名称')).toHaveProperty('value', '保留名称草稿');
  });

  it('专家详情只汇总当前专家与工作空间的有效记忆', async () => {
    const detail = detailOf();
    const memories: MemoryRecord[] = [
      memoryViewItem({
        id: 'expert-memory',
        scope: { kind: 'expert', expertId: userExpert.id },
        content: '专家通用记忆',
        status: 'confirmed',
      }),
      memoryViewItem({
        id: 'expert-workspace-memory',
        scope: { kind: 'expert-workspace', expertId: userExpert.id, workspaceId: 'workspace-1' },
        content: '当前工作空间记忆',
        status: 'candidate',
        candidateDisposition: 'pending',
      }),
      memoryViewItem({
        id: 'other-workspace-memory',
        scope: { kind: 'expert-workspace', expertId: userExpert.id, workspaceId: 'workspace-2' },
        content: '其他工作空间记忆',
      }),
      memoryViewItem({
        id: 'other-expert-memory',
        scope: { kind: 'expert', expertId: 'expert-other' },
        content: '其他专家记忆',
      }),
      memoryViewItem({
        id: 'deleted-expert-memory',
        scope: { kind: 'expert', expertId: userExpert.id },
        content: '已删除记忆',
        status: 'deleted',
      }),
    ];
    const { onManageMemories } = renderExpertsPage({
      detail,
      memories,
      workspaceId: 'workspace-1',
    });

    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByText('1 条已确认 · 1 条待确认')).toBeTruthy();
    expect(screen.getByText('专家通用记忆')).toBeTruthy();
    expect(screen.getByText('当前工作空间记忆')).toBeTruthy();
    expect(screen.queryByText('其他工作空间记忆')).toBeNull();
    expect(screen.queryByText('其他专家记忆')).toBeNull();
    expect(screen.queryByText('已删除记忆')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '管理记忆' }));
    expect(onManageMemories).toHaveBeenCalledWith(detail);
  });

  it('保存模型偏好时保留修订版本与编辑内容', async () => {
    const detail = detailOf();
    const saveRevision = vi.fn<ExpertsState['saveRevision']>(async () => ({ expert: detail }));
    const { actions } = renderExpertsPage({
      detail,
      models: [languageModel],
      actions: { saveRevision },
    });

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑配置' }));
    const modelSelect = await screen.findByRole('button', { name: '专家模型偏好' });
    expect(modelSelect.textContent).toContain('应用默认模型');
    fireEvent.click(modelSelect);
    fireEvent.click(await screen.findByRole('menuitem', { name: '本地语言模型 · local-model' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '人格与职责' }), {
      target: { value: '负责经营分析并检查交付。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }));

    await waitFor(() =>
      expect(actions.saveRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          expertId: userExpert.id,
          expectedRevision: userExpert.currentRevision,
          revision: expect.objectContaining({
            identity: '负责经营分析并检查交付。',
            modelReference: { mode: 'profile', modelProfileId: languageModel.id },
          }),
        }),
      ),
    );
  });

  it('卡片交代图标、署名、版本与用途标签，召唤按钮带图标', () => {
    const cardExpert = { ...userExpert, tags: ['经营分析', '月度复盘'] };
    const { container } = renderExpertsPage({ experts: [cardExpert] });
    const card = container.querySelector('.expert-cards .card');

    expect(card?.querySelector('.card-mark svg')).not.toBeNull();
    expect(card?.textContent).toContain('用户 · 财务组 · v3');
    expect(card?.querySelectorAll('.expert-card-tags .badge[data-shape="pill"]')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '召唤' })).toBeTruthy();
    expect(card?.querySelector('.card-primary svg')).not.toBeNull();
  });

  it('内置专家详情显示复制入口，不显示编辑入口', async () => {
    const builtinDetail = detailOf(builtinExpert);
    renderExpertsPage({ experts: [builtinExpert], detail: builtinDetail });
    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByRole('button', { name: '复制为用户专家' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '编辑配置' })).toBeNull();
  });

  it('详情列出预设 Skill、内置工具和 MCP 工具名称', async () => {
    const detail = detailOf(builtinExpert);
    detail.revision.skillPreset = [{ skillId: 'skill-ppt', revisionId: 'skill-old' }];
    detail.revision.builtinToolPolicy = { mode: 'allow-list', toolNames: ['web_search'] };
    detail.revision.mcpToolBindings = [{ connectionId: 'mcp-1', toolId: 'fetch-page' }];
    const skill = skillSummarySchema.parse({
      id: 'skill-ppt',
      name: 'PPT 生成',
      description: '生成可编辑演示文稿',
      sourceKind: 'builtin',
      enabled: true,
      currentRevisionId: 'skill-current',
      trustStatus: 'trusted',
      environmentStatus: 'ready',
      blockedReasons: [],
    });
    const connection = mcpConnectionSummarySchema.parse({
      id: 'mcp-1',
      name: '研究服务',
      transport: { kind: 'stdio', command: 'mcp-server' },
      status: 'ready',
      tools: [
        {
          id: 'fetch-page',
          connectionId: 'mcp-1',
          name: 'fetch_page',
          description: '读取网页信息',
          inputSchema: { type: 'object' },
          schemaHash: 'schema-hash',
          discoveredAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    renderExpertsPage({ detail, skills: [skill], mcpConnections: [connection] });
    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByText('生成可编辑演示文稿')).toBeTruthy();
    expect(screen.getByText('绑定固定修订')).toBeTruthy();
    expect(screen.getByText('搜索网络资料')).toBeTruthy();
    expect(screen.getByText('研究服务 · fetch_page')).toBeTruthy();
    expect(screen.getByText('读取网页信息')).toBeTruthy();
  });

  it('内置专家卡片只提供复制动作，点击后刷新目录', async () => {
    const copy = vi.fn(async () => ({ expert: detailOf(builtinExpert) }));
    const { actions, container } = renderExpertsPage({
      experts: [builtinExpert],
      actions: { copy },
    });

    const card = container.querySelector('.expert-cards .card');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).queryByRole('button', { name: '编辑' })).toBeNull();
    expect(within(card as HTMLElement).queryByRole('button', { name: '删除' })).toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '复制副本' }));

    await waitFor(() => expect(actions.copy).toHaveBeenCalledWith(builtinExpert.id));
    await waitFor(() => expect(actions.refresh).toHaveBeenCalledTimes(1));
  });

  it('卡片停用直接提交当前修订并刷新目录', async () => {
    const setLifecycle = vi.fn<ExpertsState['setLifecycle']>(async () => ({ expert: detailOf() }));
    const { actions, container, state } = renderExpertsPage({ actions: { setLifecycle } });
    const card = container.querySelector('.expert-cards .card');
    expect(card).not.toBeNull();

    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '停用' }));

    await waitFor(() =>
      expect(actions.setLifecycle).toHaveBeenCalledWith({
        expertId: userExpert.id,
        lifecycle: 'disabled',
        expectedRevision: userExpert.currentRevision,
      }),
    );
    await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(1));
  });

  it('删除卡片先要求确认，确认后才删除并刷新目录', async () => {
    const remove = vi.fn<ExpertsState['remove']>(async () => ({ deleted: true }));
    const { actions, container, state } = renderExpertsPage({ actions: { remove } });
    const card = container.querySelector('.expert-cards .card');
    expect(card).not.toBeNull();

    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '删除' }));
    expect(actions.remove).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: '删除专家' }));

    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith(userExpert.id));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(1));
  });

  it('卡片编辑先读取当前修订，再显示作者与用途标签字段', async () => {
    const detail = detailOf();
    const get = vi.fn(async () => detail);
    renderExpertsPage({ actions: { get } });

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    await waitFor(() => expect(get).toHaveBeenCalledWith(userExpert.id));
    expect(await screen.findByRole('textbox', { name: '作者' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /用途标签/ })).toBeTruthy();
  });

  it('从详情进入编辑器后返回详情', async () => {
    renderExpertsPage();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '返回详情' }));

    expect(screen.queryByRole('textbox', { name: '作者' })).toBeNull();
    expect(screen.getByRole('button', { name: '编辑配置' })).toBeTruthy();
  });

  it('从卡片进入编辑器后返回目录', async () => {
    renderExpertsPage();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(await screen.findByRole('button', { name: '返回列表' }));

    expect(await screen.findByRole('button', { name: '详情' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '编辑配置' })).toBeNull();
  });
});
