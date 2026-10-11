// @vitest-environment jsdom

import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceIdentity } from './use-workspace-identity';

const workspaceOf = (overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id: 'ws-1',
  name: '测试空间',
  rootPath: '/tmp/test-workspace',
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const pickDirectory = vi.fn<() => Promise<string | null>>();
const createWorkspace = vi.fn<(input: never) => Promise<WorkspaceSummary>>();
const updateIdentity = vi.fn<(input: never) => Promise<WorkspaceSummary>>();

const install = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      workspace: {
        pickDirectory,
        create: createWorkspace,
        updateIdentity,
      },
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  pickDirectory.mockReset();
  createWorkspace.mockReset();
  updateIdentity.mockReset();
  vi.restoreAllMocks();
});

describe('useWorkspaceIdentity', () => {
  it('初始状态：对话框关闭，草稿为空', () => {
    install();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));

    expect(result.current.open).toBe(false);
    expect(result.current.draft.rootPath).toBe('');
    expect(result.current.draft.name).toBe('');
    expect(result.current.canSubmit).toBe(false);
  });

  it('openCreate 打开新建对话框', () => {
    install();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));

    act(() => result.current.openCreate());

    expect(result.current.open).toBe(true);
    expect(result.current.editing).toBeUndefined();
  });

  it('openEdit 打开编辑对话框并填入现有值', () => {
    install();
    const workspace = workspaceOf();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));

    act(() => result.current.openEdit(workspace));

    expect(result.current.open).toBe(true);
    expect(result.current.editing?.id).toBe('ws-1');
    expect(result.current.draft.rootPath).toBe('/tmp/test-workspace');
    expect(result.current.draft.name).toBe('测试空间');
  });

  it('close 关闭对话框并清空状态', () => {
    install();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));

    act(() => result.current.openCreate());
    expect(result.current.open).toBe(true);

    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.editing).toBeUndefined();
  });

  it('changeDraft 更新草稿字段', () => {
    install();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));

    act(() => result.current.openCreate());
    act(() => result.current.changeDraft({ name: '新名称' }));

    expect(result.current.draft.name).toBe('新名称');
  });

  it('新建时 canSubmit 要求路径非空且未被占用', () => {
    install();
    const existing = workspaceOf({ id: 'ws-existing', rootPath: '/tmp/existing' });
    const { result } = renderHook(() =>
      useWorkspaceIdentity({ workspaces: [existing], onSaved: vi.fn() }),
    );

    act(() => result.current.openCreate());
    expect(result.current.canSubmit).toBe(false);

    act(() => result.current.changeDraft({ rootPath: '/tmp/new' }));
    expect(result.current.canSubmit).toBe(true);

    act(() => result.current.changeDraft({ rootPath: '/tmp/existing' }));
    expect(result.current.canSubmit, '路径已被占用').toBe(false);
    expect(result.current.takenBy?.id).toBe('ws-existing');
  });

  it('编辑时 canSubmit 要求至少改了一项', () => {
    install();
    const workspace = workspaceOf();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));

    act(() => result.current.openEdit(workspace));
    expect(result.current.canSubmit, '什么都没改不能提交').toBe(false);

    act(() => result.current.changeDraft({ name: '新名称' }));
    expect(result.current.canSubmit).toBe(true);
  });

  it('chooseDirectory 选完目录自动填入文件夹名', async () => {
    pickDirectory.mockResolvedValue('/Users/test/my-project');
    install();

    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));
    act(() => result.current.openCreate());

    await act(async () => {
      result.current.chooseDirectory();
      await Promise.resolve();
    });

    expect(result.current.draft.rootPath).toBe('/Users/test/my-project');
    expect(result.current.draft.name).toBe('my-project');
  });

  it('chooseDirectory 用户取消时不改变草稿', async () => {
    pickDirectory.mockResolvedValue(null);
    install();

    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));
    act(() => result.current.openCreate());
    act(() => result.current.changeDraft({ rootPath: '/tmp/already-set' }));

    await act(async () => {
      result.current.chooseDirectory();
      await Promise.resolve();
    });

    expect(result.current.draft.rootPath).toBe('/tmp/already-set');
  });

  it('submit 新建成功后调用 onSaved', async () => {
    const onSaved = vi.fn();
    const saved = workspaceOf({ id: 'ws-new' });
    createWorkspace.mockResolvedValue(saved);
    install();

    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved }));
    act(() => result.current.openCreate());
    act(() => result.current.changeDraft({ rootPath: '/tmp/new' }));

    await act(async () => {
      result.current.submit();
      await Promise.resolve();
    });

    expect(createWorkspace).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(saved, true);
    expect(result.current.open).toBe(false);
  });

  it('submit 编辑成功后调用 onSaved 并标记非新建', async () => {
    const onSaved = vi.fn();
    const saved = workspaceOf({ name: '更新后' });
    updateIdentity.mockResolvedValue(saved);
    install();

    const workspace = workspaceOf();
    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved }));
    act(() => result.current.openEdit(workspace));
    act(() => result.current.changeDraft({ name: '更新后' }));

    await act(async () => {
      result.current.submit();
      await Promise.resolve();
    });

    expect(updateIdentity).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(saved, false);
  });

  it('submit 失败时错误留在对话框', async () => {
    createWorkspace.mockRejectedValue(new Error('权限不足'));
    install();

    const { result } = renderHook(() => useWorkspaceIdentity({ workspaces: [], onSaved: vi.fn() }));
    act(() => result.current.openCreate());
    act(() => result.current.changeDraft({ rootPath: '/tmp/new' }));

    await act(async () => {
      result.current.submit();
      await Promise.resolve();
    });

    expect(result.current.error).toBe('权限不足');
    expect(result.current.open, '失败不关对话框').toBe(true);
  });
});
