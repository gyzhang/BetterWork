// @vitest-environment jsdom

import type {
  MemoryErrorCode,
  MemoryReferenceWriteReceipt,
  RemoveWorkspaceReferenceVersionRequest,
  Result,
  SetWorkspaceReferenceVersionRequest,
  WorkspaceArtifactReference,
  WorkspaceReferenceListData,
  WorkspaceReferenceListItem,
  WorkspaceReferenceSetData,
} from '@betterwork/agent-protocol';
import { renderHook, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceReferences } from './use-workspace-references';

/**
 * 参考成果版本的写入纪律（WM14，实施契约 §10）。
 *
 * 界面只关心三件事，因此这里也只断言三件事：
 * 1. **CAS**——首次标记 expectedRevision 为 0，改标记必须带标记行当前修订；
 * 2. **不串空间**——写入期间切了空间，就不把成功回报给界面，也不显示别的空间的清单；
 * 3. **失败可见**——冲突与传输异常都落成错误态，而不是当成没发生。
 */

const HASH = 'b'.repeat(64);

const receipt = (
  overrides?: Partial<MemoryReferenceWriteReceipt>,
): MemoryReferenceWriteReceipt => ({
  operationId: '22222222-2222-4222-8222-222222222222',
  commit: 'committed',
  effect: 'created',
  committedRevisionIds: [],
  projectionState: 'synced',
  currentReference: reference(),
  ...overrides,
});

const reference = (
  overrides?: Partial<WorkspaceArtifactReference>,
): WorkspaceArtifactReference => ({
  id: 'ref-1',
  workspaceId: 'workspace-1',
  artifactVersionId: 'version-9',
  contentHash: HASH,
  status: 'active',
  revision: 1,
  selectedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const listItem = (overrides?: Partial<WorkspaceReferenceListItem>): WorkspaceReferenceListItem => ({
  reference: reference(),
  artifactId: 'report-1',
  status: 'ready',
  ...overrides,
});

const ok = <TData>(data: TData): Result<TData> => ({ ok: true, data, warnings: [] });

const failure = (code: MemoryErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message, retryable: false },
});

const setData = (materialHash: string): WorkspaceReferenceSetData => ({
  receipt: receipt(),
  material: {
    kind: 'artifact-version',
    artifactId: 'report-1',
    artifactVersionId: 'version-9',
    contentHash: materialHash,
    originWorkspaceId: 'workspace-1',
  },
});

interface WorkspaceApi {
  list: Mock<(input: { workspaceId: string }) => Promise<Result<WorkspaceReferenceListData>>>;
  set: Mock<
    (input: SetWorkspaceReferenceVersionRequest) => Promise<Result<WorkspaceReferenceSetData>>
  >;
  remove: Mock<
    (input: RemoveWorkspaceReferenceVersionRequest) => Promise<Result<MemoryReferenceWriteReceipt>>
  >;
}

const installApi = (
  listItems: WorkspaceReferenceListItem[] = [],
  setResponse: Result<WorkspaceReferenceSetData> = ok(setData(HASH)),
  removeResponse: Result<MemoryReferenceWriteReceipt> = ok(receipt({ effect: 'unchanged' })),
): WorkspaceApi => {
  const api = {
    list: vi.fn(async (input: { workspaceId: string }) =>
      ok({
        items: listItems.filter((item) => item.reference.workspaceId === input.workspaceId),
      }),
    ),
    set: vi.fn(async () => setResponse),
    remove: vi.fn(async () => removeResponse),
  };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      workspace: {
        listReferenceVersions: api.list,
        setReferenceVersion: api.set,
        removeReferenceVersion: api.remove,
      },
    },
  });
  return api;
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useWorkspaceReferences', () => {
  it('没有工作空间时不读取参考清单', async () => {
    const api = installApi();
    const { result } = renderHook(() => useWorkspaceReferences(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.list).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('切换工作空间时只呈现该空间的参考版本', async () => {
    installApi([
      listItem(),
      listItem({
        reference: reference({ id: 'ref-2', workspaceId: 'workspace-2' }),
        artifactId: 'other',
      }),
    ]);
    const { result } = renderHook(() => useWorkspaceReferences('workspace-2'));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.artifactId).toBe('other');
  });

  it('首次标记用 expectedRevision 0，改标记带标记行的当前修订', async () => {
    const api = installApi([listItem()]);
    const { result } = renderHook(() => useWorkspaceReferences('workspace-1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const first = await result.current.markReference('version-new', '新参考');
    expect(first.ok).toBe(true);
    expect(api.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        artifactVersionId: 'version-new',
        expectedRevision: 0,
        label: '新参考',
      }),
    );

    await result.current.markReference('version-9');
    expect(api.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ artifactVersionId: 'version-9', expectedRevision: 1 }),
    );
  });

  it('已标记且可用的版本不再重复写入，直接回带固定到精确哈希的引用', async () => {
    const api = installApi([listItem()]);
    const { result } = renderHook(() => useWorkspaceReferences('workspace-1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const outcome = await result.current.ensureReference('version-9');
    expect(outcome).toEqual({
      ok: true,
      material: {
        kind: 'artifact-version',
        artifactId: 'report-1',
        artifactVersionId: 'version-9',
        contentHash: HASH,
        originWorkspaceId: 'workspace-1',
      },
      message: '',
      revisionConflict: false,
    });
    expect(api.set).not.toHaveBeenCalled();
  });

  it('写入冲突落成错误态并标明是修订冲突', async () => {
    installApi([], failure('REVISION_CONFLICT', '参考标记刚被别处更新，请重新查看后再试。'));
    const { result } = renderHook(() => useWorkspaceReferences('workspace-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.markReference('version-9');
    expect(outcome.ok).toBe(false);
    expect(outcome.revisionConflict).toBe(true);
    expect(outcome.message).toBe('参考标记刚被别处更新，请重新查看后再试。');
    // 冲突必须留在错误态：界面靠它显示内联错误，而不是让按钮退回「未标记」的假象
    await waitFor(() =>
      expect(result.current.error).toBe('参考标记刚被别处更新，请重新查看后再试。'),
    );
  });

  it('IPC 抛错时返回可读错误而不是让界面卡住', async () => {
    const api = installApi();
    api.set.mockRejectedValue(new Error('主进程连接中断'));
    const { result } = renderHook(() => useWorkspaceReferences('workspace-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const outcome = await result.current.markReference('version-9');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe('主进程连接中断');
  });

  it('写入期间切换工作空间时不把成功报给界面', async () => {
    let resolveSet: ((value: Result<WorkspaceReferenceSetData>) => void) | undefined;
    const pending = new Promise<Result<WorkspaceReferenceSetData>>((fulfill) => {
      resolveSet = fulfill;
    });
    const api = installApi();
    api.set.mockReturnValue(pending);
    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) => useWorkspaceReferences(workspaceId),
      { initialProps: { workspaceId: 'workspace-1' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const call = result.current.markReference('version-9');
    rerender({ workspaceId: 'workspace-2' });
    resolveSet?.(ok(setData(HASH)));

    const outcome = await call;
    expect(outcome.ok).toBe(false);
    expect(outcome.material).toBeUndefined();
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ workspaceId: 'workspace-2' }));
  });

  it('取消参考按标记行自身的 id 与修订提交', async () => {
    const api = installApi([listItem({ reference: reference({ revision: 4 }) })]);
    const { result } = renderHook(() => useWorkspaceReferences('workspace-1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const target = result.current.referenceOf('version-9');
    expect(target?.revision).toBe(4);
    await result.current.removeReference(target ?? reference({ revision: 4 }));
    expect(api.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ref-1', expectedRevision: 4 }),
    );
  });
});
