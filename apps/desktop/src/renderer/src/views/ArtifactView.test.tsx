// @vitest-environment jsdom

import type { ArtifactDetail, WorkspaceArtifactReference } from '@betterwork/agent-protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
