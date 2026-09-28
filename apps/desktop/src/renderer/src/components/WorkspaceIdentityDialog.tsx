import {
  type WorkspaceAccentId,
  type WorkspaceIconId,
  workspaceNameMaxLength,
  type WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { useRef } from 'react';

import { workspaceAccents } from '../appearance';
import type { WorkspaceIdentityDraft } from '../hooks/use-workspace-identity';
import { FolderIcon, workspaceIcons } from '../icons';
import { workspaceIconName } from '../lib/labels';
import { folderNameOf, workspaceAccentVar } from '../lib/workspace-identity';
import { ActionBar } from './ActionBar';
import { AsyncButton } from './AsyncButton';
import { Field } from './Field';
import { Modal } from './Modal';
import { type PickerOption, SingleSelectPicker } from './SingleSelectPicker';

export interface WorkspaceIdentityDialogProps {
  /** 有目标＝编辑身份；没有＝新建。 */
  editing: WorkspaceSummary | undefined;
  draft: WorkspaceIdentityDraft;
  error: string;
  /** 该路径已被哪个空间登记：新建时当场报出来，不让人点了提交才知道。 */
  takenByName: string | undefined;
  busy: boolean;
  /** 原生目录选择器正开着：它不该让主按钮说「正在创建…」。 */
  picking: boolean;
  canSubmit: boolean;
  onChangeDraft: (patch: Partial<WorkspaceIdentityDraft>) => void;
  onChooseDirectory: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

const iconIds = Object.keys(workspaceIcons) as WorkspaceIconId[];
const accentOptions: PickerOption<WorkspaceAccentId>[] = workspaceAccents.map((accent) => ({
  id: accent.id,
  name: accent.name,
  visual: (
    <span
      className="workspace-accent-swatch"
      style={{ background: workspaceAccentVar(accent.id) }}
    />
  ),
}));

/**
 * 新建与编辑工作空间身份的对话框（ADR-0029）。
 *
 * 只有四项：文件夹、名称、图标、颜色。没有「工作空间索引」开关——算台的知识库不按
 * 空间分区（协议里写明集合不代表空间授权），放一个开关就是让用户对一个不存在的能力
 * 做承诺。名称留空时主进程沿用文件夹名，所以这里不把它做成必填。
 */
export function WorkspaceIdentityDialog({
  editing,
  draft,
  error,
  takenByName,
  busy,
  picking,
  canSubmit,
  onChangeDraft,
  onChooseDirectory,
  onSubmit,
  onClose,
}: WorkspaceIdentityDialogProps): React.JSX.Element {
  const nameRef = useRef<HTMLInputElement>(null);
  const title = editing ? '编辑工作空间' : '新建工作空间';
  // 图标一律用当前所选身份色画：选中的那一档形状与最终侧栏里看到的完全一致。
  const accent = workspaceAccentVar(draft.accentId);
  const iconOptions: PickerOption<WorkspaceIconId>[] = iconIds.map((id) => {
    const Icon = workspaceIcons[id];
    return {
      id,
      name: workspaceIconName[id],
      visual: (
        <span style={{ color: accent }}>
          <Icon size={17} />
        </span>
      ),
    };
  });

  return (
    <Modal
      variant="dialog"
      className="workspace-identity-dialog"
      label={title}
      onClose={onClose}
      {...(editing ? { initialFocusRef: nameRef } : {})}
    >
      <h2>{title}</h2>
      <Field
        label="本地文件夹"
        hint="文件夹是真相源：材料读写边界与成果导出都以它为根，算台不会移动或改名它。"
      >
        <button
          type="button"
          className="workspace-folder-drop"
          data-filled={draft.rootPath ? 'true' : undefined}
          disabled={Boolean(editing) || picking}
          onClick={onChooseDirectory}
        >
          <FolderIcon size={16} />
          <span className="workspace-folder-drop-text">
            {draft.rootPath ? (
              <>
                <strong>{folderNameOf(draft.rootPath)}</strong>
                <small>{draft.rootPath}</small>
              </>
            ) : (
              '点击选择要长期工作的文件夹'
            )}
          </span>
        </button>
      </Field>
      <Field
        label="名称"
        controlId="workspace-name-input"
        hint="显示在侧栏与输入区；留空则取文件夹名。"
      >
        <input
          id="workspace-name-input"
          ref={nameRef}
          type="text"
          maxLength={workspaceNameMaxLength}
          value={draft.name}
          placeholder="例如：GienWork 售前"
          onChange={(event) => onChangeDraft({ name: event.target.value })}
        />
      </Field>
      <Field label="图标">
        <SingleSelectPicker
          label="工作空间图标"
          value={draft.iconId}
          options={iconOptions}
          onSelect={(iconId) => onChangeDraft({ iconId })}
        />
      </Field>
      <Field label="颜色" hint="八档固定色板，浅色与深色下各有一套值。">
        <SingleSelectPicker
          label="工作空间颜色"
          value={draft.accentId}
          options={accentOptions}
          onSelect={(accentId) => onChangeDraft({ accentId })}
        />
      </Field>
      {takenByName && (
        <p className="inline-message error" role="alert">
          {`这个文件夹已经登记为「${takenByName}」，请直接打开它，或换一个目录。`}
        </p>
      )}
      {error && (
        <p className="inline-message error" role="alert">
          {error}
        </p>
      )}
      <ActionBar label={title}>
        <button type="button" className="secondary-button" onClick={onClose}>
          取消
        </button>
        <AsyncButton
          variant="primary"
          label={editing ? '保存修改' : '创建'}
          busyLabel={editing ? '正在保存…' : '正在创建…'}
          busy={busy}
          disabled={!canSubmit}
          onClick={onSubmit}
        />
      </ActionBar>
    </Modal>
  );
}
