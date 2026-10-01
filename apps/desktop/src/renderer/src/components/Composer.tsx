import type {
  MaterialCandidate,
  SkillSummary,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import type { FormEvent, KeyboardEvent, Ref } from 'react';

import { ArrowUpIcon, ExpertIcon } from '../icons';
import { AsyncButton } from './AsyncButton';
import { BindingChip, BindingChipBar } from './BindingChip';
import { Button } from './Button';
import { type CapabilityChip, ComposerCapabilityPicker } from './ComposerCapabilityPicker';
import { WorkspaceSelector, type WorkspaceSelectorProps } from './WorkspaceSelector';

/**
 * 提交区的三档状态。它只回答「这颗主按钮现在是什么」，
 * 与 `locked`（输入区是否因运行而锁定）是两件事：停止按钮要求确实有一次可停的运行。
 */
export type ComposerSubmitState =
  { state: 'idle' } | { state: 'starting' } | { state: 'running'; onStop: () => void };

export interface ComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  /** 表单提交与 ⌘／Ctrl＋↵ 走同一个入口，页面只给一个回调。 */
  onStartRun: () => void;
  submit: ComposerSubmitState;
  /** 运行中不许改绑定区（技能／材料／专家）。 */
  locked: boolean;
  /** 底部那一行报的是「这次会用哪个模型」，措辞由页面给。 */
  modelLabel: string;
  textareaRef?: Ref<HTMLTextAreaElement> | undefined;

  workspacePicker: WorkspaceSelectorProps;

  expert: { name: string } | undefined;
  onRemoveExpert: () => void;

  skills: SkillSummary[];
  bindings: CapabilityChip[];
  onAddBinding: (chip: CapabilityChip) => void;
  onRemoveBinding: (id: string) => void;
  materials: TaskMaterialSelection[];
  materialCandidates: MaterialCandidate[];
  materialsLoading: boolean;
  materialPickerKind?: 'knowledge' | 'artifact' | undefined;
  materialPickerError?: string | undefined;
  onRequestMaterials: (kind: 'file' | 'knowledge' | 'artifact') => void;
  onDismissMaterialPicker: () => void;
  onCommitMaterials: (materials: TaskMaterialSelection[]) => void;
  onRequestSkillDetail: () => void;
  onRequestExpert: () => void;
}

/**
 * 任务输入区：工作区、绑定区、正文与提交。
 *
 * §10.2 把它列为业务组件却长期内联在 `App.tsx`（137 行）。外提的收益不只是行数：
 * 工作区那两颗按钮（打开本地文件夹／新建工作区）原本是**逐字相同**的两段
 * `reportAction(selectDirectory()…)`，只差一句失败文案；提交与 ⌘＋↵ 也各自复制了一次
 * `reportAction(startRun()…)`。复制的每一次都可能只改一处。
 */
export function Composer({
  prompt,
  onPromptChange,
  onStartRun,
  submit,
  locked,
  modelLabel,
  textareaRef,
  workspacePicker,
  expert,
  onRemoveExpert,
  skills,
  bindings,
  onAddBinding,
  onRemoveBinding,
  materials,
  materialCandidates,
  materialsLoading,
  materialPickerKind,
  materialPickerError,
  onRequestMaterials,
  onDismissMaterialPicker,
  onCommitMaterials,
  onRequestSkillDetail,
  onRequestExpert,
}: ComposerProps): React.JSX.Element {
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    onStartRun();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== 'Enter' ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    onStartRun();
  };
  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="workspace-row">
        <WorkspaceSelector {...workspacePicker} />
      </div>
      <div className="composer-capability-row">
        {expert && (
          <BindingChipBar label="当前专家">
            <BindingChip
              name={expert.name}
              removeLabel={`移除专家 ${expert.name}`}
              leading={<ExpertIcon size={12} />}
              tone="brand"
              disabled={locked}
              onRemove={onRemoveExpert}
            />
          </BindingChipBar>
        )}
        <ComposerCapabilityPicker
          skills={skills}
          selected={bindings}
          materials={materials}
          materialCandidates={materialCandidates}
          {...(workspacePicker.currentWorkspace
            ? { workspaceId: workspacePicker.currentWorkspace.id }
            : {})}
          {...(materialPickerKind ? { materialPickerKind } : {})}
          materialsLoading={materialsLoading}
          {...(materialPickerError ? { materialPickerError } : {})}
          disabled={locked}
          {...(locked ? { disabledReason: '运行中不可修改' } : {})}
          onAdd={onAddBinding}
          onRemove={onRemoveBinding}
          onRequestSkillDetail={onRequestSkillDetail}
          onRequestExpert={onRequestExpert}
          onRequestMaterials={onRequestMaterials}
          onDismissMaterialPicker={onDismissMaterialPicker}
          onCommitMaterials={onCommitMaterials}
        />
      </div>
      <textarea
        ref={textareaRef}
        aria-label="任务输入，按 Command 或 Control 加 Enter 开始工作"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder="告诉算台你想完成什么工作…"
      />
      <div className="composer-footer">
        <span>
          {modelLabel} <kbd>⌘/Ctrl ↵</kbd>
        </span>
        {submit.state === 'running' ? (
          <Button variant="danger" size="md" type="button" onClick={submit.onStop}>
            停止
          </Button>
        ) : (
          <AsyncButton
            size="md"
            type="submit"
            busy={submit.state === 'starting'}
            disabled={!prompt.trim() || workspacePicker.currentWorkspace === undefined}
            label={
              <>
                开始工作 <ArrowUpIcon size={13} />
              </>
            }
            busyLabel="正在启动…"
          />
        )}
      </div>
    </form>
  );
}
