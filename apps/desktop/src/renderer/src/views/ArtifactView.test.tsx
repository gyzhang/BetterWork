// @vitest-environment jsdom

import type {
  ArtifactDetail,
  ArtifactInputRelationInput,
  WorkspaceArtifactReference,
} from '@betterwork/agent-protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ReferenceVersionResult,
  WorkspaceReferencesState,
} from '../hooks/use-workspace-references';
import { ArtifactPage } from './ArtifactView';

const selectedArtifact: ArtifactDetail = {
  id: 'artifact-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  type: 'markdown',
  title: '季度复盘',
  currentVersionId: 'version-1',
  versionNumber: 1,
  origin: 'assistant-run',
  sourceRunId: 'run-1',
  createdAt: 1,
  updatedAt: 1,
  content: '# 当前版本',
  contentHash: 'hash-1',
  evidence: [],
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('ArtifactPage', () => {
  it('shows MCP evidence as a read-only source without an original-file action', async () => {
    const mcpArtifact: ArtifactDetail = {
      ...selectedArtifact,
      evidence: [
        {
          id: 'evidence-mcp',
          taskId: selectedArtifact.taskId,
          runId: selectedArtifact.sourceRunId ?? 'run-1',
          sourceType: 'mcp-tool',
          sourceUri: 'mcp:finance_monthly_summary',
          title: 'mcp_finance_monthly_summary',
          locator: 'MCP 工具结果',
          excerpt: '{"month":"2026-08","revenue":120}',
          contentHash: 'hash-mcp',
          capturedAt: 1,
        },
      ],
    };
    const onOpenSource = vi.fn(async () => undefined);
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: {
          listVersions: vi.fn(async () => []),
          getVersion: vi.fn(async () => null),
        },
      },
    });

    render(
      <ArtifactPage
        artifacts={[mcpArtifact]}
        selected={mcpArtifact}
        onSelect={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={onOpenSource}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText((content) => content.includes('MCP 工具'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: '原文' })).toBeNull();
    expect(onOpenSource).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows a version-list loading failure while previewing the Artifact', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: {
          listVersions: vi.fn(async () => {
            throw new Error('版本历史暂不可用');
          }),
          getVersion: vi.fn(async () => null),
        },
      },
    });

    render(
      <ArtifactPage
        artifacts={[selectedArtifact]}
        selected={selectedArtifact}
        onSelect={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={vi.fn(async () => undefined)}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('版本历史暂不可用'),
    );
  });
});

/**
 * 参考成果版本的界面约束（WM14，产品设计 §3.6、实施契约 §10）。
 *
 * 这里只验呈现纪律：标记固定到正在查看的那个版本 id、成功措辞不冒称审批或「本期已读取」、
 * 写入失败就地报错、写入中禁止重复提交。真正的 CAS 与跨空间守卫在 use-workspace-references。
 */
describe('ArtifactPage 本空间参考版本', () => {
  const reference: WorkspaceArtifactReference = {
    id: 'ref-1',
    workspaceId: 'workspace-1',
    artifactVersionId: 'version-1',
    contentHash: 'b'.repeat(64),
    status: 'active',
    revision: 2,
    selectedAt: 1,
    updatedAt: 1,
  };

  const okWrite: ReferenceVersionResult = {
    ok: true,
    material: undefined,
    message: '',
    revisionConflict: false,
  };

  const referencesState = (
    overrides?: Partial<WorkspaceReferencesState>,
  ): WorkspaceReferencesState => ({
    items: [],
    loading: false,
    error: '',
    pendingVersionId: '',
    referenceOf: () => undefined,
    refresh: vi.fn(),
    markReference: vi.fn(async () => okWrite),
    removeReference: vi.fn(async () => okWrite),
    ensureReference: vi.fn(async () => okWrite),
    ...overrides,
  });

  const renderWithReferences = (
    references: WorkspaceReferencesState,
    onReferenceToTask?: (artifactVersionId: string) => void,
  ): HTMLElement => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: {
          listVersions: vi.fn(async () => []),
          getVersion: vi.fn(async () => null),
        },
      },
    });
    const { container } = render(
      <ArtifactPage
        artifacts={[selectedArtifact]}
        selected={selectedArtifact}
        onSelect={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={vi.fn(async () => undefined)}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        references={references}
        {...(onReferenceToTask ? { onReferenceToTask } : {})}
        onBack={vi.fn()}
      />,
    );
    return container;
  };

  const section = (container: HTMLElement): Element | null =>
    container.querySelector('.artifact-reference-section');

  it('标记写入正在查看的精确版本，成功提示不冒称审批或通过', async () => {
    const references = referencesState();
    const container = renderWithReferences(references);

    fireEvent.click(screen.getByRole('button', { name: '指定为本空间参考版本' }));
    expect(references.markReference).toHaveBeenCalledWith('version-1', 'v1 · 季度复盘');
    await act(async () => undefined);

    expect(section(container)?.textContent).toContain(
      '已把 v1 指定为本空间参考版本：标记只表示参考选择，不表示内容正确或审批通过。',
    );
    expect(section(container)?.textContent).toContain(
      '标记与引用都固定到这一版的内容哈希，成果新增版本后参考仍指旧版本',
    );
    expect(section(container)?.textContent).toContain('不会自动发送');
    expect(section(container)?.textContent).not.toContain('本期已读取');
  });

  it('写入失败时只显示内联错误，不给出成功措辞', async () => {
    const container = renderWithReferences(
      referencesState({
        error: '参考标记刚被别处更新，请重新查看后再试。',
        markReference: vi.fn(async () => ({
          ok: false,
          material: undefined,
          message: '参考标记刚被别处更新，请重新查看后再试。',
          revisionConflict: true,
        })),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '指定为本空间参考版本' }));
    await act(async () => undefined);

    const alert = section(container)?.querySelector('.inline-message.error');
    expect(alert?.textContent).toBe('参考标记刚被别处更新，请重新查看后再试。');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(section(container)?.textContent).not.toContain('已把 v1 指定为本空间参考版本');
  });

  it('已标记的版本给出取消入口，并按标记行本身回传', () => {
    const references = referencesState({ referenceOf: () => reference });
    const container = renderWithReferences(references);

    expect(section(container)?.textContent).toContain('当前查看的 v1 已标记为参考');
    fireEvent.click(screen.getByRole('button', { name: '取消参考' }));
    expect(references.removeReference).toHaveBeenCalledWith(reference);
  });

  it('写入过程中按钮显示进行状态并禁用，避免重复提交', () => {
    renderWithReferences(referencesState({ pendingVersionId: 'version-1' }));

    const button = screen.getByRole('button', { name: '正在提交…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: '指定为本空间参考版本' })).toBeNull();
  });

  it('「引用到当前任务」只把版本 id 交给宿主，页面自身不写标记', () => {
    const references = referencesState();
    const onReferenceToTask = vi.fn();
    renderWithReferences(references, onReferenceToTask);

    fireEvent.click(screen.getByRole('button', { name: '引用到当前任务' }));
    expect(onReferenceToTask).toHaveBeenCalledWith('version-1');
    expect(references.markReference).not.toHaveBeenCalled();
    expect(references.ensureReference).not.toHaveBeenCalled();
  });

  it('宿主未接线参考能力时不显示该区', () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: { listVersions: vi.fn(async () => []), getVersion: vi.fn(async () => null) },
      },
    });
    const { container } = render(
      <ArtifactPage
        artifacts={[selectedArtifact]}
        selected={selectedArtifact}
        onSelect={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={vi.fn(async () => undefined)}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        onBack={vi.fn()}
      />,
    );
    expect(container.querySelector('.artifact-reference-section')).toBeNull();
  });
});

/** KM05（知识契约 §6.1/§6.2）：人工修订时由用户重新选择采用来源，未改动则沿用前版声明。 */
describe('ArtifactPage 采用来源选择', () => {
  type SaveHandler = (
    artifact: ArtifactDetail,
    title: string,
    content: string,
    inputRelations?: ArtifactInputRelationInput[],
  ) => Promise<void>;

  const createSaver = (): Mock<SaveHandler> => vi.fn<SaveHandler>(async () => undefined);

  const preciseEvidence = {
    id: 'evidence-precise',
    taskId: 'task-1',
    runId: 'run-1',
    sourceType: 'local-file' as const,
    sourceUri: '/notes/经营口径.md',
    title: '经营口径',
    locator: '修订 rev-1',
    excerpt: '收入按回款口径统计。',
    contentHash: 'hash-precise',
    capturedAt: 1,
    knowledgeSource: {
      reference: {
        kind: 'knowledge-revision' as const,
        knowledgeDocumentId: 'doc-1',
        knowledgeRevisionId: 'rev-1',
        contentHash: 'content-1',
        sourcePath: '/notes/经营口径.md',
      },
      textHash: 'text-precise',
      span: { sectionOrdinal: 1, start: 0, end: 120 },
      operation: 'read' as const,
    },
  };
  const legacyEvidence = {
    id: 'evidence-legacy',
    taskId: 'task-1',
    runId: 'run-1',
    sourceType: 'local-file' as const,
    sourceUri: '/notes/历史资料.md',
    title: '历史资料',
    locator: '本地资料 · 历史范围未记录',
    excerpt: '旧数据没有区间定位。',
    contentHash: 'hash-legacy',
    capturedAt: 1,
  };
  const artifactWithSources = (
    inputRelations?: ArtifactDetail['inputRelations'],
  ): ArtifactDetail => ({
    ...selectedArtifact,
    evidence: [preciseEvidence, legacyEvidence],
    ...(inputRelations ? { inputRelations } : {}),
  });

  const renderEditable = (artifact: ArtifactDetail, onSave: Mock<SaveHandler>) => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: { listVersions: vi.fn(async () => []), getVersion: vi.fn(async () => null) },
      },
    });
    render(
      <ArtifactPage
        artifacts={[artifact]}
        selected={artifact}
        onSelect={vi.fn()}
        onSave={onSave}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={vi.fn(async () => undefined)}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑此版本' }));
  };

  it('只列出带精确定位的来源作为可采用候选', () => {
    renderEditable(artifactWithSources(), createSaver());

    expect(screen.getByRole('checkbox', { name: /经营口径/ })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /历史资料/ })).toBeNull();
  });

  it('勾选来源后保存，把用户级声明交给宿主判定', async () => {
    const onSave = createSaver();
    renderEditable(artifactWithSources(), onSave);

    fireEvent.click(screen.getByRole('checkbox', { name: /经营口径/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'artifact-1' }),
        '季度复盘',
        '# 当前版本',
        [{ input: { kind: 'evidence', evidenceId: 'evidence-precise' }, relation: 'data' }],
      ),
    );
  });

  it('未改动选择时保存不提交该字段，沿用前版声明', async () => {
    const onSave = createSaver();
    renderEditable(
      artifactWithSources([
        {
          outputVersionId: 'version-1',
          input: { kind: 'evidence', evidenceId: 'evidence-precise' },
          relation: 'data',
          createdAt: 1,
        },
      ]),
      onSave,
    );

    // 前版已声明的证据默认勾选，表示这次不改选。
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /经营口径/ }).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[3]).toBeUndefined();
  });
});
