import {
  type WorkspaceAccentId,
  type WorkspaceIconId,
  workspaceIdentityDefaults,
  type WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { useCallback, useState } from 'react';

import { reportAction } from '../lib/async-action';
import { folderNameOf } from '../lib/workspace-identity';

/** 对话框里的表单形状：新建与编辑共用一套字段，差别只在有没有目标空间。 */
export interface WorkspaceIdentityDraft {
  rootPath: string;
  name: string;
  iconId: WorkspaceIconId;
  accentId: WorkspaceAccentId;
}

const emptyDraft = (): WorkspaceIdentityDraft => ({
  rootPath: '',
  name: '',
  iconId: workspaceIdentityDefaults.iconId,
  accentId: workspaceIdentityDefaults.accentId,
});

const draftOf = (workspace: WorkspaceSummary): WorkspaceIdentityDraft => ({
  rootPath: workspace.rootPath,
  name: workspace.name,
  iconId: workspace.iconId,
  accentId: workspace.accentId,
});

export interface UseWorkspaceIdentityOptions {
  /** 已登记的空间：新建时用来就地认出「这个文件夹已经是某个空间」，不等到提交才发现。 */
  workspaces: readonly WorkspaceSummary[];
  /** 保存成功后的收尾：新建要切过去，编辑要刷新列表。由页面决定，钩子不猜。 */
  onSaved: (workspace: WorkspaceSummary, created: boolean) => void;
}

export interface WorkspaceIdentityDialogState {
  open: boolean;
  editing: WorkspaceSummary | undefined;
  draft: WorkspaceIdentityDraft;
  error: string;
  busy: boolean;
  picking: boolean;
  /** 该路径已被登记成的那个空间；新建时用来就地报冲突。 */
  takenBy: WorkspaceSummary | undefined;
  canSubmit: boolean;
  openCreate: () => void;
  openEdit: (workspace: WorkspaceSummary) => void;
  close: () => void;
  changeDraft: (patch: Partial<WorkspaceIdentityDraft>) => void;
  chooseDirectory: () => void;
  submit: () => void;
}

/**
 * 工作空间身份对话框的状态簇（docs/10 §9.12、ADR-0029）。
 *
 * 选目录与登记是两次调用：`workspace:pick-directory` 只回路径，用户看完对话框就取消
 * 时不会留下半个工作空间行。名称留空沿用文件夹名，与对话框里那句说明一致——
 * 这条口径由主进程兜底，界面不自己拼一份。
 */
export function useWorkspaceIdentity({
  workspaces,
  onSaved,
}: UseWorkspaceIdentityOptions): WorkspaceIdentityDialogState {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSummary>();
  const [draft, setDraft] = useState<WorkspaceIdentityDraft>(emptyDraft);
  /** 弹原生目录选择器与提交保存是两件事：前者不该让主按钮说「正在创建…」。 */
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = useCallback((target: WorkspaceSummary | undefined): void => {
    setEditing(target);
    setDraft(target ? draftOf(target) : emptyDraft());
    setError('');
    setOpen(true);
  }, []);

  const close = useCallback((): void => {
    setOpen(false);
    setEditing(undefined);
    setError('');
  }, []);

  const changeDraft = useCallback((patch: Partial<WorkspaceIdentityDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setError('');
  }, []);

  /** 选完目录顺手填上文件夹名，但只在她还没自己起名字的时候。 */
  const chooseDirectory = useCallback((): void => {
    setPicking(true);
    reportAction(
      window.betterwork.workspace.pickDirectory().then((picked) => {
        setPicking(false);
        if (!picked) return;
        setDraft((current) => {
          const untouched =
            current.name.trim() === '' || current.name === folderNameOf(current.rootPath);
          return {
            ...current,
            rootPath: picked,
            ...(untouched ? { name: folderNameOf(picked) } : {}),
          };
        });
        setError('');
      }),
      (message) => {
        setPicking(false);
        setError(message);
      },
      '选择文件夹失败，请重试。',
    );
  }, []);

  const submit = useCallback((): void => {
    if (busy) return;
    setBusy(true);
    const trimmed = draft.name.trim();
    const action = editing
      ? window.betterwork.workspace.updateIdentity({
          workspaceId: editing.id,
          ...(trimmed && trimmed !== editing.name ? { name: trimmed } : {}),
          ...(draft.iconId !== editing.iconId ? { iconId: draft.iconId } : {}),
          ...(draft.accentId !== editing.accentId ? { accentId: draft.accentId } : {}),
        })
      : window.betterwork.workspace.create({
          rootPath: draft.rootPath,
          ...(trimmed ? { name: trimmed } : {}),
          iconId: draft.iconId,
          accentId: draft.accentId,
        });
    reportAction(
      action.then((saved) => {
        setBusy(false);
        onSaved(saved, !editing);
        setOpen(false);
        setEditing(undefined);
      }),
      (message) => {
        setBusy(false);
        setError(message);
      },
      editing ? '保存工作空间失败，请重试。' : '新建工作空间失败，请重试。',
    );
  }, [busy, draft, editing, onSaved]);

  const takenBy = editing
    ? undefined
    : workspaces.find((workspace) => workspace.rootPath === draft.rootPath);
  /** 编辑时什么都没改就别提交：协议要求「至少改一项」，不该让人点了才知道。 */
  const identityChanged =
    draft.name.trim() !== editing?.name ||
    draft.iconId !== editing?.iconId ||
    draft.accentId !== editing?.accentId;
  const canSubmit = editing
    ? !busy && draft.name.trim().length > 0 && identityChanged
    : !busy && draft.rootPath !== '' && takenBy === undefined;

  return {
    open,
    editing,
    draft,
    error,
    busy,
    picking,
    takenBy,
    canSubmit,
    openCreate: () => start(undefined),
    openEdit: (workspace: WorkspaceSummary) => start(workspace),
    close,
    changeDraft,
    chooseDirectory,
    submit,
  };
}
