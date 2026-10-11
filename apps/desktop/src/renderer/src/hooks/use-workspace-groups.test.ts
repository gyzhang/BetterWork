// @vitest-environment jsdom

import type { WorkspaceTaskGroup } from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceGroups } from './use-workspace-groups';

const STORAGE_KEY = 'betterwork-workspace-groups';

const groupOf = (workspaceId: string, name: string): WorkspaceTaskGroup => ({
  workspace: {
    id: workspaceId,
    name,
    rootPath: `/tmp/${workspaceId}`,
    iconId: 'folder',
    accentId: 'moss',
    hidden: false,
    createdAt: 1,
    updatedAt: 1,
  },
  tasks: [],
  totalTasks: 0,
});

const installStorage = (initial: Record<string, string> = {}): void => {
  const store = new Map(Object.entries(initial));
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
    },
  });
};

const listTaskGroups = vi.fn<() => Promise<WorkspaceTaskGroup[]>>();

const install = (groups: WorkspaceTaskGroup[] = []): void => {
  listTaskGroups.mockResolvedValue(groups);
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { workspace: { listTaskGroups } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  listTaskGroups.mockReset();
  vi.restoreAllMocks();
});

describe('useWorkspaceGroups', () => {
  it('当前空间默认展开，其他空间默认折叠', async () => {
    installStorage();
    install([groupOf('ws-1', '空间一'), groupOf('ws-2', '空间二')]);

    const { result } = renderHook(() => useWorkspaceGroups('ws-1'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isOpen('ws-1')).toBe(true);
    expect(result.current.isOpen('ws-2')).toBe(false);
  });

  it('toggleGroup 切换展开/折叠并写入 localStorage', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          store.set(key, value);
        },
      },
    });
    install([groupOf('ws-1', '空间一')]);

    const { result } = renderHook(() => useWorkspaceGroups('ws-1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isOpen('ws-1')).toBe(true);

    act(() => result.current.toggleGroup('ws-1'));
    expect(result.current.isOpen('ws-1')).toBe(false);
    expect(JSON.parse(store.get(STORAGE_KEY) ?? '')).toHaveProperty('ws-1', 'closed');
  });

  it('openGroup 只展开不切换：已展开的保持展开', async () => {
    installStorage();
    install([groupOf('ws-1', '空间一'), groupOf('ws-2', '空间二')]);

    const { result } = renderHook(() => useWorkspaceGroups('ws-1'));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.openGroup('ws-2'));
    expect(result.current.isOpen('ws-2')).toBe(true);

    act(() => result.current.openGroup('ws-2'));
    expect(result.current.isOpen('ws-2'), '已是 open 不翻成 closed').toBe(true);
  });

  it('toggleShowAll 只在本会话生效，不写入 localStorage', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          store.set(key, value);
        },
      },
    });
    install([groupOf('ws-1', '空间一')]);

    const { result } = renderHook(() => useWorkspaceGroups('ws-1'));
    // useEffect 在挂载时写一次初始 overrides
    const afterMount = store.get(STORAGE_KEY);

    expect(result.current.showsAll('ws-1')).toBe(false);
    act(() => result.current.toggleShowAll('ws-1'));
    expect(result.current.showsAll('ws-1')).toBe(true);
    act(() => result.current.toggleShowAll('ws-1'));
    expect(result.current.showsAll('ws-1')).toBe(false);
    expect(store.get(STORAGE_KEY), '展示更多不改变 overrides 落盘').toBe(afterMount);
  });

  it('refreshGroups 拉取分组并更新状态', async () => {
    installStorage();
    install([groupOf('ws-1', '空间一')]);

    const { result } = renderHook(() => useWorkspaceGroups('ws-1'));
    expect(result.current.groups).toHaveLength(0);

    act(() => result.current.refreshGroups());
    await act(async () => {
      await Promise.resolve();
    });
    expect(listTaskGroups).toHaveBeenCalledTimes(1);
    expect(result.current.groups).toHaveLength(1);

    act(() => result.current.refreshGroups());
    await act(async () => {
      await Promise.resolve();
    });
    expect(listTaskGroups).toHaveBeenCalledTimes(2);
  });

  it('localStorage 损坏时退回空偏好，不抛错', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (): string | null => {
          throw new Error('storage denied');
        },
        setItem: (): void => {
          throw new Error('storage denied');
        },
      },
    });
    install([groupOf('ws-1', '空间一')]);

    const { result } = renderHook(() => useWorkspaceGroups('ws-1'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isOpen('ws-1')).toBe(true);
  });
});
