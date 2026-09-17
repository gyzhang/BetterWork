import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ChevronLeftIcon, FolderIcon, PlusIcon } from '../icons';
import { PopoverMenu } from './PopoverMenu';

export interface WorkspaceSelectorProps {
  currentWorkspace: WorkspaceSummary | undefined;
  workspaces: WorkspaceSummary[];
  onSelectWorkspace: (workspace: WorkspaceSummary) => void;
  onOpenLocalFolder: () => void;
  onNewWorkspace: () => void;
}

export function WorkspaceSelector({
  currentWorkspace,
  workspaces,
  onSelectWorkspace,
  onOpenLocalFolder,
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
        <FolderIcon size={14} />
        <span className="workspace-selector-name">{currentWorkspace?.name ?? '选择工作区'}</span>
        <ChevronLeftIcon size={12} className={`workspace-selector-chevron${open ? ' open' : ''}`} />
      </button>
      <PopoverMenu
        open={open}
        anchorRef={triggerRef}
        items={menuItems}
        label="选择工作区"
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
            <button
              type="button"
              className="workspace-selector-action"
              onClick={() => {
                onOpenLocalFolder();
                handleDismiss();
              }}
            >
              <FolderIcon size={14} />
              <span>打开本地文件夹</span>
            </button>
          </div>
        }
      />
    </>
  );
}
