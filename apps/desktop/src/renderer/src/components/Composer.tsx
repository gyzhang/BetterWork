import type {
  MaterialCandidate,
  SkillSummary,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import type { FormEvent, KeyboardEvent, Ref } from 'react';

import { useComposerPrompt } from '../hooks/use-composer-prompt';
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
  promptResetRevision: number;
  readPromptDraft: () => string;
  onPromptChange: (value: string) => void;
  onPromptSettled: (value: string) => void;
  /** 表单提交与 ⌘／Ctrl＋↵ 走同一个入口，页面只给一个回调。 */
  onStartRun: (prompt: string) => void;
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
  onManageMaterials?: (() => void) | undefined;
  onRequestSkillDetail: () => void;
  onRequestExpert: () => void;
}

/**
 * 任务输入区与下方工具栏：正文和提交独立成卡；工作区、能力与材料摘要常驻下方预留区域。
 *
 * §10.2 把它列为业务组件却长期内联在 `App.tsx`（137 行）。外提的收益不只是行数：
 * 工作区那两颗按钮（打开本地文件夹／新建工作区）原本是**逐字相同**的两段
 * `reportAction(selectDirectory()…)`，只差一句失败文案；提交与 ⌘＋↵ 也各自复制了一次
 * `reportAction(startRun()…)`。复制的每一次都可能只改一处。
 */
export function Composer({
  promptResetRevision,
  readPromptDraft,
  onPromptChange,
  onPromptSettled,
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
  onManageMaterials,
  onRequestSkillDetail,
  onRequestExpert,
}: ComposerProps): React.JSX.Element {
  return (
    <div className="composer-dock">
      <ComposerPromptCard
        key={promptResetRevision}
        readPromptDraft={readPromptDraft}
        textareaRef={textareaRef}
        modelLabel={modelLabel}
        submit={submit}
        workspaceAvailable={workspacePicker.currentWorkspace !== undefined}
        onPromptChange={onPromptChange}
        onPromptSettled={onPromptSettled}
        onStartRun={onStartRun}
      />
      <div className="composer-utility-row">
        <div className="workspace-row">
          <WorkspaceSelector {...workspacePicker} />
        </div>
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
          {...(locked ? { disabledReason: '工作即将开始或运行中不可修改' } : {})}
          onAdd={onAddBinding}
          onRemove={onRemoveBinding}
          onRequestSkillDetail={onRequestSkillDetail}
          onRequestExpert={onRequestExpert}
          onRequestMaterials={onRequestMaterials}
          onDismissMaterialPicker={onDismissMaterialPicker}
          onCommitMaterials={onCommitMaterials}
          afterAddButton={
            expert ? (
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
            ) : undefined
          }
          {...(onManageMaterials ? { onManageMaterials } : {})}
        />
      </div>
    </div>
  );
}

function ComposerPromptCard({
  readPromptDraft,
  textareaRef,
  modelLabel,
  submit,
  workspaceAvailable,
  onPromptChange,
  onPromptSettled,
  onStartRun,
}: {
  readPromptDraft: () => string;
  textareaRef: Ref<HTMLTextAreaElement> | undefined;
  modelLabel: string;
  submit: ComposerSubmitState;
  workspaceAvailable: boolean;
  onPromptChange: (value: string) => void;
  onPromptSettled: (value: string) => void;
  onStartRun: (prompt: string) => void;
}): React.JSX.Element {
  const { prompt, changePrompt } = useComposerPrompt({
    readPromptDraft,
    onPromptChange,
    onPromptSettled,
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    onStartRun(prompt);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== 'Enter' ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    onStartRun(prompt);
  };
  return (
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        ref={textareaRef}
        aria-label="任务输入，按 Command 或 Control 加 Enter 开始工作"
        value={prompt}
        onChange={(event) => {
          changePrompt(event.target.value);
        }}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder="描述你想完成的工作…"
      />
      <div className="composer-footer">
        <span>
          {modelLabel} <kbd>⌘↵</kbd>
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
            disabled={!prompt.trim() || !workspaceAvailable}
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
