import type { RecentTaskSummary, WorkspaceTaskGroup } from '@betterwork/agent-protocol';
import { useRef, useState } from 'react';

import { ChevronRightIcon, MoreHorizontalIcon, workspaceIcons } from '../icons';
import { workspaceAccentVar } from '../lib/workspace-identity';
import { Button } from './Button';
import { EmptyNotice } from './EmptyState';
import { IconButton } from './IconButton';
import { NavItem } from './NavList';
import { PopoverMenu } from './PopoverMenu';
import { RunSummaryRow } from './RunSummaryRow';

/** 折叠时先给三条：再多一屏就只剩一个空间的任务看得见。 */
const PREVIEW_TASKS = 3;

export type WorkspaceGroupAction =
  | { kind: 'new-task'; workspaceId: string }
  | { kind: 'edit-identity'; workspaceId: string }
  | { kind: 'set-hidden'; workspaceId: string; hidden: boolean };

export interface WorkspaceGroupListProps {
  groups: readonly WorkspaceTaskGroup[];
  currentWorkspaceId: string | undefined;
  activeTaskId: string | undefined;
  isOpen: (workspaceId: string) => boolean;
  showsAll: (workspaceId: string) => boolean;
  onToggleGroup: (workspaceId: string) => void;
  onToggleShowAll: (workspaceId: string) => void;
  onSelectTask: (workspaceId: string, task: RecentTaskSummary) => void;
  onAction: (action: WorkspaceGroupAction) => void;
  /** 窄栏：只剩身份图标。 */
  rail: boolean;
  /** 窄栏里点图标：先展开侧栏，再展开那一组——图标本身不是导航目的地。 */
  onRevealFromRail: (workspaceId: string) => void;
}

/**
 * 侧栏的工作空间分组（ADR-0029）。
 *
 * 「回到哪段持续工作」在这里回答，而不是在一条不分组的最近任务列表里。三条规则：
 * 点空间行**只展开收起**，不切换当前空间、不打断运行中的任务；任务行才负责打开任务；
 * 隐藏只影响这一列的可见性，删除会经 `ON DELETE CASCADE` 带走整棵子树，因此不做成按钮。
 */
export function WorkspaceGroupList({
  groups,
  currentWorkspaceId,
  activeTaskId,
  isOpen,
  showsAll,
  onToggleGroup,
  onToggleShowAll,
  onSelectTask,
  onAction,
  rail,
  onRevealFromRail,
}: WorkspaceGroupListProps): React.JSX.Element {
  const anchorRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [menuWorkspaceId, setMenuWorkspaceId] = useState<string>();
  const menuGroup = groups.find((group) => group.workspace.id === menuWorkspaceId);

  const openMenu = (workspaceId: string): void => {
    anchorRef.current = rowRefs.current.get(workspaceId) ?? null;
    setMenuWorkspaceId(workspaceId);
  };

  if (rail) {
    return (
      <div className="workspace-rail" role="group" aria-label="工作空间">
        {groups.slice(0, 6).map((group) => {
          const Icon = workspaceIcons[group.workspace.iconId];
          return (
            <span
              key={group.workspace.id}
              style={{ color: workspaceAccentVar(group.workspace.accentId) }}
            >
              <IconButton
                size="sm"
                label={group.workspace.name}
                icon={Icon}
                onClick={() => onRevealFromRail(group.workspace.id)}
              />
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="workspace-groups">
      {groups.length === 0 && <EmptyNotice title="还没有工作空间，新建一个开始。" />}
      {groups.map((group) => {
        const { workspace } = group;
        const Icon = workspaceIcons[workspace.iconId];
        const open = isOpen(workspace.id);
        const expanded = showsAll(workspace.id);
        const shown = expanded ? group.tasks : group.tasks.slice(0, PREVIEW_TASKS);
        const remaining = group.totalTasks - shown.length;
        return (
          <div className="workspace-group" key={workspace.id}>
            <div className="workspace-group-row">
              <NavItem
                className="workspace-group-name"
                icon={Icon}
                iconColor={workspaceAccentVar(workspace.accentId)}
                label={workspace.name}
                selected={workspace.id === currentWorkspaceId}
                onClick={() => onToggleGroup(workspace.id)}
                trailing={
                  <span
                    className="workspace-group-chevron"
                    data-open={open ? 'true' : 'false'}
                    aria-hidden="true"
                  >
                    <ChevronRightIcon size={12} />
                  </span>
                }
              />
              <IconButton
                size="sm"
                className="workspace-group-menu"
                label={`「${workspace.name}」工作空间的操作`}
                icon={MoreHorizontalIcon}
                hasPopup="menu"
                expanded={menuWorkspaceId === workspace.id}
                buttonRef={(element) => {
                  if (element) rowRefs.current.set(workspace.id, element);
                  else rowRefs.current.delete(workspace.id);
                }}
                onClick={() => openMenu(workspace.id)}
              />
            </div>
            {open && (
              <div className="workspace-group-tasks">
                {group.tasks.length === 0 && <EmptyNotice title="这个空间还没有任务。" />}
                {shown.map((task) => (
                  <RunSummaryRow
                    key={task.id}
                    run={task.latestRun}
                    title={task.title}
                    action="打开任务"
                    compact
                    selected={task.id === activeTaskId}
                    onSelect={() => onSelectTask(workspace.id, task)}
                  />
                ))}
                {!expanded && remaining > 0 && (
                  <Button
                    variant="quiet"
                    size="sm"
                    type="button"
                    onClick={() => onToggleShowAll(workspace.id)}
                  >
                    {`展示更多（${remaining}）`}
                  </Button>
                )}
                {expanded && remaining > 0 && (
                  <p className="workspace-group-more">{`另有 ${remaining} 项未列出`}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <PopoverMenu
        open={menuGroup !== undefined}
        anchorRef={anchorRef}
        label={menuGroup ? `「${menuGroup.workspace.name}」的操作` : '工作空间的操作'}
        placement="bottom"
        onDismiss={() => setMenuWorkspaceId(undefined)}
        onSelect={(id) => {
          if (!menuGroup) return;
          if (id === 'new-task')
            onAction({ kind: 'new-task', workspaceId: menuGroup.workspace.id });
          if (id === 'edit')
            onAction({ kind: 'edit-identity', workspaceId: menuGroup.workspace.id });
          if (id === 'hide')
            onAction({
              kind: 'set-hidden',
              workspaceId: menuGroup.workspace.id,
              hidden: true,
            });
          setMenuWorkspaceId(undefined);
        }}
        items={[
          { id: 'new-task', label: '在此空间新建任务' },
          { id: 'edit', label: '重命名与更改外观' },
          { id: 'hide', label: '从侧栏隐藏', tone: 'danger' },
        ]}
      />
    </div>
  );
}
