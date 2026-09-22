// @vitest-environment jsdom

import type {
  WorkspaceBrief,
  WorkspaceBriefMemoryItem,
  WorkspaceBriefOpenIssue,
  WorkspaceReferenceListItem,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceBrief as WorkspaceBriefPanel } from './WorkspaceBrief';

/**
 * 工作空间简报（WM14，产品设计 §3.6、契约 §10）。
 *
 * 简报是只读、可重建、不注入的视图，所以断言集中在「三态是否诚实」：
 * 空态不自动补内容、错误态不拿旧简报冒充现状、未决节点不写成已确认结论、
 * 资料派生条目必须带上「使用时仍需本期选入资料」。
 */

const HASH = 'a'.repeat(64);

const section = (items: WorkspaceBriefMemoryItem[]) => ({
  items,
  total: items.length,
  truncated: false,
});

const memoryItem = (overrides?: Partial<WorkspaceBriefMemoryItem>): WorkspaceBriefMemoryItem => ({
  memoryId: 'memory-1',
  revisionId: 'memory-1-r1',
  contentHash: HASH,
  content: '季度分析先对齐签约金额口径。',
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  ...overrides,
});

const issue = (overrides?: Partial<WorkspaceBriefOpenIssue>): WorkspaceBriefOpenIssue => ({
  checkpointId: 'cp-1',
  taskId: 'task-1',
  summary: '回款口径仍待与财务确认。',
  nextAction: '找财务要本月签约台账',
  createdAt: 1,
  ...overrides,
});

const referenceItem = (
  overrides?: Partial<WorkspaceReferenceListItem>,
): WorkspaceReferenceListItem => ({
  reference: {
    id: 'ref-1',
    workspaceId: 'workspace-1',
    artifactVersionId: 'version-1',
    contentHash: HASH,
    label: '经营分析月报 v3',
    status: 'active',
    revision: 1,
    selectedAt: 1,
    updatedAt: 1,
  },
  artifactId: 'artifact-1',
  status: 'ready',
  ...overrides,
});

const briefOf = (overrides?: Partial<WorkspaceBrief>): WorkspaceBrief => ({
  workspaceId: 'workspace-1',
  generatedAt: 1,
  goals: section([memoryItem()]),
  constraints: section([]),
  decisions: section([]),
  methods: section([]),
  openIssues: { items: [], total: 0, truncated: false },
  referenceVersions: { items: [], total: 0, truncated: false },
  ...overrides,
});

const renderPanel = (props: Partial<Parameters<typeof WorkspaceBriefPanel>[0]> = {}) => {
  const onOpenMemory = vi.fn();
  const onOpenIssue = vi.fn();
  const onOpenReference = vi.fn();
  const onRetry = vi.fn();
  const { container } = render(
    <WorkspaceBriefPanel
      brief={briefOf()}
      loading={false}
      error=""
      workspaceName="我的空间"
      expertName="经营分析师"
      onRetry={onRetry}
      onOpenMemory={onOpenMemory}
      onOpenIssue={onOpenIssue}
      onOpenReference={onOpenReference}
      {...props}
    />,
  );
  return { container, onOpenMemory, onOpenIssue, onOpenReference, onRetry };
};

afterEach(() => {
  cleanup();
});

describe('WorkspaceBrief', () => {
  it('说明简报只读不注入，按已确认分组列出', () => {
    const { container } = renderPanel();
    expect(container.textContent).toContain('简报每次现取、只读不注入');
    screen.getByRole('button', { name: /季度分析先对齐签约金额口径/ });
    expect(container.textContent).toContain('目标');
  });

  it('资料派生与来源待复核的条目都带上当场可懂的限定', () => {
    const { container } = renderPanel({
      brief: briefOf({
        decisions: section([
          memoryItem({
            memoryId: 'memory-2',
            revisionId: 'memory-2-r1',
            requiresMaterialSelection: true,
            sourceAvailability: 'review-required',
          }),
        ]),
      }),
    });
    expect(container.textContent).toContain('使用时仍需本期选入资料');
    expect(container.textContent).toContain('来源待复核');
  });

  it('未决事项标成未决并保留下一步，点击回到对应讨论节点', () => {
    const { container, onOpenIssue } = renderPanel({
      brief: briefOf({
        goals: section([]),
        openIssues: { items: [issue()], total: 1, truncated: false },
      }),
    });
    expect(container.textContent).toContain('未决事项');
    expect(container.textContent).toContain('下一步：找财务要本月签约台账');

    fireEvent.click(screen.getByRole('button', { name: /回款口径仍待与财务确认/ }));
    expect(onOpenIssue).toHaveBeenCalledTimes(1);
    expect(onOpenIssue).toHaveBeenCalledWith(expect.objectContaining({ checkpointId: 'cp-1' }));
  });

  it('参考版本说明标记只是参考选择，点击交给调用方打开版本', () => {
    const { container, onOpenReference } = renderPanel({
      brief: briefOf({
        goals: section([]),
        referenceVersions: { items: [referenceItem()], total: 1, truncated: false },
      }),
    });
    expect(container.textContent).toContain('不表示内容正确、审批通过或本期已读取');

    fireEvent.click(screen.getByRole('button', { name: /经营分析月报 v3/ }));
    expect(onOpenReference).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'artifact-1' }),
    );
  });

  it('超出列表上限时用局部提示说明完整入口在成果页', () => {
    const { container } = renderPanel({
      brief: briefOf({
        goals: section([]),
        referenceVersions: { items: [referenceItem()], total: 9, truncated: true },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: '共 9 个参考版本' }));
    expect(container.querySelector('.page-toast-host')?.textContent).toContain('完整列表在成果页');
  });

  it('读取失败时给重试入口，并且不显示上一次的简报内容', () => {
    const { container, onRetry } = renderPanel({
      brief: briefOf(),
      error: '工作空间简报读取失败，请重试。',
    });
    expect(container.querySelector('.inline-message.error')?.textContent).toContain(
      '工作空间简报读取失败，请重试。',
    );
    expect(container.textContent).not.toContain('季度分析先对齐签约金额口径');
    expect(container.textContent).toContain('不会用旧内容代替现状');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('首次读取与确实没有积累分别给出可解释的空态', () => {
    const loading = render(
      <WorkspaceBriefPanel
        brief={undefined}
        loading
        error=""
        workspaceName="我的空间"
        expertName={undefined}
        onRetry={vi.fn()}
        onOpenMemory={vi.fn()}
        onOpenIssue={vi.fn()}
        onOpenReference={vi.fn()}
      />,
    );
    expect(loading.container.textContent).toContain('正在读取工作空间简报…');
    cleanup();

    const empty = renderPanel({ brief: briefOf({ goals: section([]) }) });
    expect(empty.container.textContent).toContain('这个空间还没有可汇总的工作积累');
    expect(empty.container.textContent).toContain('候选与未确认内容不会进入简报');
  });

  it('条目点击回到对应记忆修订，供就地复核', () => {
    const { onOpenMemory } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /季度分析先对齐签约金额口径/ }));
    expect(onOpenMemory).toHaveBeenCalledWith(
      expect.objectContaining({ revisionId: 'memory-1-r1' }),
    );
  });
});
