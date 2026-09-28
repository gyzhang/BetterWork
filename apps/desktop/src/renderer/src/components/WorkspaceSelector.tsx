import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ChevronLeftIcon, FolderIcon, PlusIcon, workspaceIcons } from '../icons';
import { workspaceAccentVar } from '../lib/workspace-identity';
import { PopoverMenu } from './PopoverMenu';

export interface WorkspaceSelectorProps {
  currentWorkspace: WorkspaceSummary | undefined;
  workspaces: WorkspaceSummary[];
  onSelectWorkspace: (workspace: WorkspaceSummary) => void;
  /** 唯一的入口：打开新建对话框。旧的「打开本地文件夹」与它是同一条路径，已合并。 */
  onNewWorkspace: () => void;
}

/** 触发器与列表项左侧的身份图标：与侧栏分组同一份颜色，认空间靠形状和色相，不靠路径。 */
const identityIcon = (workspace: WorkspaceSummary): React.JSX.Element => {
  const Icon = workspaceIcons[workspace.iconId];
  return (
    <span style={{ color: workspaceAccentVar(workspace.accentId) }}>
      <Icon size={14} />
    </span>
  );
};

export function WorkspaceSelector({
  currentWorkspace,
  workspaces,
  onSelectWorkspace,
  onNewWorkspace,
}: WorkspaceSelectorProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

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
    setOpen((prev) => !prev);
  }, []);

  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-selector-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleTriggerClick}
      >
        {currentWorkspace ? identityIcon(currentWorkspace) : <FolderIcon size={14} />}
        <span className="workspace-selector-name">{currentWorkspace?.name ?? '选择工作空间'}</span>
        <ChevronLeftIcon size={12} className={`workspace-selector-chevron${open ? ' open' : ''}`} />
      </button>
      <PopoverMenu
        open={open}
        anchorRef={triggerRef}
        items={menuItems}
        label="选择工作空间"
        placement="bottom"
        onDismiss={handleDismiss}
        onSelect={handleSelect}
        header={
          <div className="workspace-selector-search">
            <input
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
              <PlusIcon size={14} />
              <span>新建工作空间</span>
            </button>
          </div>
        }
      />
    </>
  );
}
