import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronLeftIcon, FolderIcon, PlusIcon, workspaceIcons } from '../icons';
import { workspaceAccentVar } from '../lib/workspace-identity';
import { PopoverMenu } from './PopoverMenu';
import { TextField } from './TextField';

export interface WorkspaceSelectorProps {
  currentWorkspace: WorkspaceSummary | undefined;
  workspaces: WorkspaceSummary[];
  /** 已进入 Task 后工作空间固定；新建任务后才能选择其他空间。 */
  disabled?: boolean | undefined;
  onSelectWorkspace: (workspace: WorkspaceSummary) => void;
  /** 唯一的入口：打开新建对话框。旧的「打开本地文件夹」与它是同一条路径，已合并。 */
  onNewWorkspace: () => void;
}

/** 触发器与列表项左侧的身份图标：与侧栏分组同一份颜色，认空间靠形状和色相，不靠路径。 */
const identityIcon = (workspace: WorkspaceSummary): React.JSX.Element => {
  const Icon = workspaceIcons[workspace.iconId];
  return (
    <span style={{ color: workspaceAccentVar(workspace.accentId) }}>
      <Icon size={13} />
    </span>
  );
};

export function WorkspaceSelector({
  currentWorkspace,
  workspaces,
  disabled = false,
  onSelectWorkspace,
  onNewWorkspace,
}: WorkspaceSelectorProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const menuOpen = open && !disabled;

  const filteredWorkspaces = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return workspaces;
    return workspaces.filter(
      (ws) =>
        ws.name.toLowerCase().includes(keyword) || ws.rootPath.toLowerCase().includes(keyword),
    );
  }, [workspaces, search]);

  const menuItems = useMemo(
    () =>
      filteredWorkspaces.map((ws) => ({
        id: ws.id,
        label: ws.name,
        hint: ws.rootPath,
        leading: identityIcon(ws),
      })),
    [filteredWorkspaces],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const selected = workspaces.find((ws) => ws.id === id);
      if (selected) {
        onSelectWorkspace(selected);
        setOpen(false);
        setSearch('');
      }
    },
    [workspaces, onSelectWorkspace],
  );

  const handleDismiss = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  const handleTriggerClick = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
  }, [disabled]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setSearch('');
  }, [disabled]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-selector-trigger"
        disabled={disabled}
        title={disabled ? '当前任务已固定工作空间；新建任务后可切换' : undefined}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={handleTriggerClick}
      >
        {currentWorkspace ? identityIcon(currentWorkspace) : <FolderIcon size={13} />}
        <span className="workspace-selector-name">{currentWorkspace?.name ?? '选择工作空间'}</span>
        <ChevronLeftIcon
          size={12}
          className={`workspace-selector-chevron${menuOpen ? ' open' : ''}`}
        />
      </button>
      <PopoverMenu
        open={menuOpen}
        anchorRef={triggerRef}
        items={menuItems}
        label="选择工作空间"
        className="workspace-selector-menu"
        onDismiss={handleDismiss}
        onSelect={handleSelect}
        header={
          <div className="workspace-selector-search">
            <TextField
              size="md"
              ref={searchInputRef}
              type="text"
              className="workspace-selector-search-input"
              placeholder="搜索工作空间"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                // 阻止 PopoverMenu 的方向键导航在搜索框中生效
                if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.stopPropagation();
                }
              }}
              aria-label="搜索工作空间"
            />
          </div>
        }
        footer={
          <div className="workspace-selector-actions">
            <button
              type="button"
              className="workspace-selector-action"
              onClick={() => {
                onNewWorkspace();
                handleDismiss();
              }}
            >
              <PlusIcon size={13} />
              <span>新建工作空间</span>
            </button>
          </div>
        }
      />
    </>
  );
}
