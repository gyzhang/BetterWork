import type { WorkspaceTaskGroup } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { trackAction } from '../lib/async-action';

/**
 * 哪个空间是展开的属于界面状态，不是产品事实：与侧栏折叠、外观偏好同一档，
 * 存放在 Renderer 的 `localStorage`（docs/03 §与建议清单的差异）。
 */
const STORAGE_KEY = 'betterwork-workspace-groups';

type GroupPreference = 'open' | 'closed';

const readOverrides = (): Record<string, GroupPreference> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, GroupPreference] => entry[1] === 'open' || entry[1] === 'closed',
    );
    return Object.fromEntries(entries);
  } catch {
    // storage 不可用或被改坏——全部退回默认档，不影响任何数据。
    return {};
  }
};

const writeOverrides = (overrides: Record<string, GroupPreference>): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // storage 不可用时偏好只在本次会话生效，不为此打扰用户。
  }
};

/**
 * 侧栏工作空间分组：数据、展开偏好与「展示更多」的本地状态。
 *
 * 展开态按「默认值＋例外」存：默认只有当前空间展开，用户手动改过的那几档才落盘。
 * 反过来存（记展开的那几个）会让新建的空间默认是折叠的——用户刚建完就找不到它。
 */
export function useWorkspaceGroups(currentWorkspaceId: string | undefined): {
  groups: WorkspaceTaskGroup[];
  refreshGroups: () => void;
  isOpen: (workspaceId: string) => boolean;
  toggleGroup: (workspaceId: string) => void;
  /** 只展开、不切换：窄栏点图标要先把她带回宽栏里的那一组。 */
  openGroup: (workspaceId: string) => void;
  showsAll: (workspaceId: string) => boolean;
  toggleShowAll: (workspaceId: string) => void;
} {
  const [groups, setGroups] = useState<WorkspaceTaskGroup[]>([]);
  const [overrides, setOverrides] = useState<Record<string, GroupPreference>>(readOverrides);
  const [allShownIds, setAllShownIds] = useState<string[]>([]);

  useEffect(() => {
    writeOverrides(overrides);
  }, [overrides]);

  const refreshGroups = useCallback((): void => {
    trackAction(window.betterwork.workspace.listTaskGroups().then(setGroups), '刷新工作空间分组');
  }, []);

  const isOpen = useCallback(
    (workspaceId: string): boolean => {
      const override = overrides[workspaceId];
      // 没被手动改过的组走默认档：只有当前空间展开。
      return override === undefined ? workspaceId === currentWorkspaceId : override === 'open';
    },
    [currentWorkspaceId, overrides],
  );

  const toggleGroup = useCallback(
    (workspaceId: string): void => {
      setOverrides((current) => {
        const override = current[workspaceId];
        const openNow =
          override === undefined ? workspaceId === currentWorkspaceId : override === 'open';
        return { ...current, [workspaceId]: openNow ? 'closed' : 'open' };
      });
    },
    [currentWorkspaceId],
  );

  const openGroup = useCallback((workspaceId: string): void => {
    setOverrides((current) =>
      current[workspaceId] === 'open' ? current : { ...current, [workspaceId]: 'open' },
    );
  }, []);

  const showsAll = useCallback(
    (workspaceId: string): boolean => allShownIds.includes(workspaceId),
    [allShownIds],
  );

  /** 「展示更多」是就地展开一页已加载的任务，不另发请求，也不跨会话记住。 */
  const toggleShowAll = useCallback((workspaceId: string): void => {
    setAllShownIds((current) =>
      current.includes(workspaceId)
        ? current.filter((id) => id !== workspaceId)
        : [...current, workspaceId],
    );
  }, []);

  return { groups, refreshGroups, isOpen, toggleGroup, openGroup, showsAll, toggleShowAll };
}
