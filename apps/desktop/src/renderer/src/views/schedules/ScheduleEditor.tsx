import type {
  ExpertDetail,
  ExpertSummary,
  ScheduleDetail,
  ScheduleLifecycle,
  ScheduleTiming,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { Field } from '../../components/Field';
import { FieldSelect } from '../../components/FieldSelect';
import { InlineError } from '../../components/InlineError';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScrollRegion } from '../../components/layout/ScrollRegion';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusNote } from '../../components/StatusNote';
import { TextArea, TextField } from '../../components/TextField';
import { useScheduleEditor } from '../../hooks/use-schedule-editor';
import { useScheduleSourceCandidates } from '../../hooks/use-schedule-source-candidates';
import type { ScheduleEditorValue } from '../../lib/schedule-editor';
import {
  monthlyDayNeedsSkipNotice,
  parseScheduleTime,
  scheduleEditorWorkspaceOptions,
  schedulePeriodOptions,
  scheduleTimingWithFrequency,
} from '../../lib/schedule-editor';
import { periodRuleLabel, scheduleTimestampLabel } from '../../lib/schedules';
import { ScheduleSourcePicker } from './ScheduleSourcePicker';

const frequencyOptions = [
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
] as const;

const weekdayOptions = [
  { id: '1', label: '周一' },
  { id: '2', label: '周二' },
  { id: '3', label: '周三' },
  { id: '4', label: '周四' },
  { id: '5', label: '周五' },
  { id: '6', label: '周六' },
  { id: '7', label: '周日' },
] as const;

const dayOptions = Array.from({ length: 31 }, (_, index) => ({
  id: String(index + 1),
  label: `${index + 1} 日`,
}));

const timeZoneOptions = [
  { id: 'Asia/Shanghai', label: '北京时间 · UTC+8' },
  { id: 'Asia/Tokyo', label: '东京时间 · UTC+9' },
  { id: 'UTC', label: '协调世界时 · UTC' },
] as const;

export function ScheduleEditor({
  detail,
  experts,
  expertsLoading,
  expertsError,
  workspaces,
  getExpert,
  onClose,
  onSaved,
}: {
  detail?: ScheduleDetail;
  experts: readonly ExpertSummary[];
  expertsLoading: boolean;
  expertsError: string;
  workspaces: readonly WorkspaceSummary[];
  getExpert: (id: string) => Promise<ExpertDetail | null>;
  onClose: () => void;
  onSaved: (lifecycle: Extract<ScheduleLifecycle, 'enabled' | 'paused'>) => void;
}): React.JSX.Element {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const editor = useScheduleEditor({
    ...(detail ? { detail } : {}),
    experts,
    getExpert,
    onSaved,
  });
  const sourceCandidates = useScheduleSourceCandidates(true);
  const workspace = workspaces.find((item) => item.id === editor.value.workspaceId);
  const timing = editor.value.config.timing;
  const selectedArtifacts = editor.value.config.expectedArtifactTypes;
  const timeInvalid = parseScheduleTime(editor.value.timeInput) === undefined;
  const title = detail ? '编辑定时任务' : '新建定时任务';
  const expertOptions = [
    { id: '', label: '请选择已有专家' },
    ...experts.map((expert) => ({
      id: expert.id,
      label: `${expert.name} · 修订 ${expert.currentRevision}${expert.lifecycle === 'active' ? '' : ' · 不可用'}`,
      ...(expert.lifecycle === 'active' ? {} : { disabled: true }),
    })),
  ];

  const requestClose = (): void => {
    if (editor.saving) return;
    if (editor.dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const updateTiming = (update: (current: ScheduleTiming) => ScheduleTiming): void => {
    editor.updateConfig((config) => ({
      ...config,
      timing: update(config.timing),
    }));
  };

  const toggleArtifact = (artifact: 'markdown' | 'presentation', checked: boolean): void => {
    editor.updateConfig((config) => {
      const current = config.expectedArtifactTypes;
      const next = checked
        ? current.length < 2 && !current.includes(artifact)
          ? [...current, artifact]
          : current
        : current.filter((candidate) => candidate !== artifact);
      return { ...config, expectedArtifactTypes: next };
    });
  };

  return (
    <>
      <section className="schedules-page schedule-editor">
        <PageHeader
          eyebrow="定时任务"
          title={title}
          leading={
            <Button variant="link" size="sm" type="button" onClick={requestClose}>
              返回列表
            </Button>
          }
        />
        <ScrollRegion ariaLabel="定时任务配置" busy={editor.saving}>
          <div className="page-body schedules-body">
            <div className="schedule-editor-sections">
              <section>
                <SectionHeader variant="block" title="谁来做，在哪里做" />
                <div className="schedule-editor-grid">
                  <Field
                    label={detail ? '固定的执行专家' : '已有专家'}
                    controlId="schedule-expert"
                    hint={
                      detail
                        ? '本规则继续调用创建时绑定的专家修订；此处不会改写专家定义。'
                        : '选择会固定当前修订；不会修改专家定义。'
                    }
                  >
                    {detail ? (
                      <TextField
                        id="schedule-expert"
                        size="md"
                        readOnly
                        value={editor.expertLabel}
                        aria-label="固定的执行专家"
                      />
                    ) : (
                      <FieldSelect
                        id="schedule-expert"
                        options={expertOptions}
                        value={editor.value.config.expertId}
                        onChange={editor.selectExpert}
                        size="md"
                        disabled={editor.saving || expertsLoading || editor.expertLoading}
                      />
                    )}
                    {editor.expertLoading && <StatusNote message="正在读取所选专家修订…" />}
                  </Field>
                  <Field
                    label="持续工作空间"
                    controlId="schedule-workspace"
                    hint={
                      detail
                        ? '工作空间在规则创建后固定；更换长期目录需新建规则。'
                        : '同一目录会供后续各期持续使用。'
                    }
                  >
                    {detail ? (
                      <TextField
                        id="schedule-workspace"
                        size="md"
                        readOnly
                        value={workspace?.name ?? '工作空间不可用'}
                        aria-label="持续工作空间"
                      />
                    ) : (
                      <FieldSelect
                        id="schedule-workspace"
                        options={scheduleEditorWorkspaceOptions(workspaces)}
                        value={editor.value.workspaceId}
                        onChange={editor.setWorkspaceId}
                        size="md"
                        disabled={editor.saving}
                      />
                    )}
                    <StatusNote
                      message={
                        workspace
                          ? `本地目录：${workspace.rootPath}`
                          : '请选择一个可持续访问的本地目录。'
                      }
                    />
                  </Field>
                  <Field
                    label="附加知识范围"
                    group
                    hint="后续成员与文档修订会用于下一期；本期准备时固定实际采用的材料版本。"
                  >
                    <ScheduleSourcePicker
                      sources={editor.value.config.knowledgeSources}
                      documents={sourceCandidates.documents}
                      collections={sourceCandidates.collections}
                      loading={sourceCandidates.loading}
                      error={sourceCandidates.error}
                      onRefresh={sourceCandidates.refresh}
                      disabled={editor.saving}
                      onChange={(knowledgeSources) =>
                        editor.updateConfig((config) => ({ ...config, knowledgeSources }))
                      }
                    />
                  </Field>
                  {detail?.expertUpdate.available && (
                    <StatusNote
                      tone="warning"
                      message="专家已有新修订；当前规则仍绑定原修订。应用差异将在规则详情中处理。"
                    />
                  )}
                  {expertsError && !detail && (
                    <InlineError message={expertsError} className="schedule-editor-wide" />
                  )}
                  {editor.expertError && (
                    <InlineError message={editor.expertError} className="schedule-editor-wide" />
                  )}
                </div>
              </section>

              <section>
                <SectionHeader
                  variant="block"
                  title="每期完成什么"
                  hint="工作要求会原样纳入每期的任务目标；历史对比写在要求里即可。"
                />
                <div className="schedule-editor-grid">
                  <Field
                    label="定时任务名称"
                    controlId="schedule-name"
                    className="schedule-editor-wide"
                    hint="在列表、通知和逐期工作中识别这项约定。"
                  >
                    <TextField
                      id="schedule-name"
                      size="md"
                      value={editor.value.config.name}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        editor.updateConfig((config) => ({
                          ...config,
                          name,
                        }));
                      }}
                      maxLength={100}
                      disabled={editor.saving}
                    />
                  </Field>
                  <Field
                    label="每期工作要求"
                    controlId="schedule-requirements"
                    className="schedule-editor-wide"
                    hint="可以要求与上月、季度或半年度资料对比；本期统计期间不会限制合法历史参考。"
                  >
                    <TextArea
                      id="schedule-requirements"
                      rows={5}
                      value={editor.value.config.requirements}
                      onChange={(event) => {
                        const requirements = event.currentTarget.value;
                        editor.updateConfig((config) => ({
                          ...config,
                          requirements,
                        }));
                      }}
                      maxLength={20_000}
                      disabled={editor.saving}
                    />
                  </Field>
                  <Field label="预期成果" group hint="最多选择两种成果类型。">
                    <div className="schedule-editor-artifact-options">
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedArtifacts.includes('presentation')}
                          onChange={(event) =>
                            toggleArtifact('presentation', event.currentTarget.checked)
                          }
                          disabled={
                            editor.saving ||
                            (!selectedArtifacts.includes('presentation') &&
                              selectedArtifacts.length >= 2)
                          }
                        />
                        演示文稿（PPTX）
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedArtifacts.includes('markdown')}
                          onChange={(event) =>
                            toggleArtifact('markdown', event.currentTarget.checked)
                          }
                          disabled={
                            editor.saving ||
                            (!selectedArtifacts.includes('markdown') &&
                              selectedArtifacts.length >= 2)
                          }
                        />
                        Markdown 报告
                      </label>
                    </div>
                  </Field>
                  <Field label="成果保存位置" controlId="schedule-output-directory">
                    <TextField
                      id="schedule-output-directory"
                      size="md"
                      readOnly
                      value={workspace ? `${workspace.name} / 定时成果` : '所选工作空间 / 定时成果'}
                    />
                    <StatusNote message="每期成果在此目录中单独保存；重名时不覆盖已有文件。" />
                  </Field>
                </div>
              </section>

              <section>
                <SectionHeader
                  variant="block"
                  title="何时开始，处理哪个期间"
                  hint="使用固定时区；修改电脑所在时区不会改变这项约定。"
                />
                <div className="schedule-editor-grid">
                  <Field
                    label="重复频率"
                    controlId="schedule-frequency"
                    hint="错过的时刻只提醒，不会在恢复后自动补跑。"
                  >
                    <FieldSelect
                      id="schedule-frequency"
                      options={frequencyOptions}
                      value={timing.frequency}
                      onChange={(frequency) =>
                        updateTiming((current) =>
                          scheduleTimingWithFrequency(
                            current,
                            frequency as ScheduleTiming['frequency'],
                          ),
                        )
                      }
                      size="md"
                      disabled={editor.saving}
                    />
                  </Field>
                  {timing.frequency === 'weekly' ? (
                    <Field label="每周几" controlId="schedule-weekday">
                      <FieldSelect
                        id="schedule-weekday"
                        options={weekdayOptions}
                        value={String(timing.weekday)}
                        onChange={(weekday) =>
                          updateTiming((current) => ({
                            ...current,
                            frequency: 'weekly',
                            weekday: Number(weekday),
                          }))
                        }
                        size="md"
                        disabled={editor.saving}
                      />
                    </Field>
                  ) : timing.frequency === 'monthly' ? (
                    <Field label="每月几日" controlId="schedule-month-day">
                      <FieldSelect
                        id="schedule-month-day"
                        options={dayOptions}
                        value={String(timing.day)}
                        onChange={(day) =>
                          updateTiming((current) => ({
                            ...current,
                            frequency: 'monthly',
                            day: Number(day),
                          }))
                        }
                        size="md"
                        disabled={editor.saving}
                      />
                      {monthlyDayNeedsSkipNotice(timing) && (
                        <StatusNote
                          tone="warning"
                          message="没有该日期的月份会跳过本次计划，不会改为月末。"
                        />
                      )}
                    </Field>
                  ) : (
                    <Field label="执行时刻" controlId="schedule-time">
                      <TextField
                        id="schedule-time"
                        type="time"
                        size="md"
                        value={editor.value.timeInput}
                        onChange={(event) => editor.setTimeInput(event.currentTarget.value)}
                        aria-label="执行时刻"
                        disabled={editor.saving}
                      />
                    </Field>
                  )}
                  {timing.frequency !== 'daily' && (
                    <Field label="执行时刻" controlId="schedule-time">
                      <TextField
                        id="schedule-time"
                        type="time"
                        size="md"
                        value={editor.value.timeInput}
                        onChange={(event) => editor.setTimeInput(event.currentTarget.value)}
                        aria-label="执行时刻"
                        disabled={editor.saving}
                      />
                    </Field>
                  )}
                  <Field
                    label="固定时区"
                    controlId="schedule-time-zone"
                    hint="计划按此时区计算，不随设备时区变动。"
                  >
                    <FieldSelect
                      id="schedule-time-zone"
                      options={timeZoneOptions}
                      value={timing.timeZone}
                      onChange={(timeZone) =>
                        updateTiming((current) => ({
                          ...current,
                          timeZone: timeZone as ScheduleTiming['timeZone'],
                        }))
                      }
                      size="md"
                      disabled={editor.saving}
                    />
                  </Field>
                  <Field
                    label="本期统计期间"
                    controlId="schedule-period"
                    hint="只描述本期主期间；历史对比要求继续写在工作要求中。"
                  >
                    <FieldSelect
                      id="schedule-period"
                      options={schedulePeriodOptions}
                      value={editor.value.config.periodRule}
                      onChange={(periodRule) =>
                        editor.updateConfig((config) => ({
                          ...config,
                          periodRule: periodRule as ScheduleEditorValue['config']['periodRule'],
                        }))
                      }
                      size="md"
                      disabled={editor.saving}
                    />
                  </Field>
                  <Field label="接下来三次计划" group hint="由 Main 同时钟与调度规则生成。">
                    {timeInvalid ? (
                      <InlineError message="先输入有效的 24 小时时刻，再查看预览。" />
                    ) : editor.previewError ? (
                      <InlineError message={editor.previewError} onRetry={editor.retryPreview} />
                    ) : editor.previewLoading ? (
                      <StatusNote message="正在更新计划预览…" />
                    ) : editor.preview ? (
                      <ol className="schedule-editor-preview-list">
                        {editor.preview.items.map((item) => (
                          <li key={item.scheduledAt}>
                            <span>{scheduleTimestampLabel(item.scheduledAt, timing.timeZone)}</span>
                            <span>
                              {item.period.label || periodRuleLabel(editor.value.config.periodRule)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <StatusNote message="正在读取计划预览…" />
                    )}
                  </Field>
                </div>
              </section>

              <section>
                <SectionHeader
                  variant="block"
                  title="保存与启用"
                  hint="保存并暂停不会开始后台执行；启用前 Main 会检查当前模型、专家能力与环境。"
                />
                <StatusNote message="启用后会按所选专家调用已配置模型与工具，可能产生费用；错过不补跑，结果需要人工检查。" />
                {editor.saveError && (
                  <InlineError
                    message={editor.saveError}
                    problems={[
                      ...editor.validationErrors,
                      ...(editor.preflight?.status === 'blocked'
                        ? editor.preflight.problems.map((problem) => problem.message)
                        : []),
                    ]}
                    className="schedule-editor-error"
                  />
                )}
                <ActionBar label="保存定时任务">
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    disabled={editor.saving}
                    onClick={requestClose}
                  >
                    取消
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    disabled={editor.saving}
                    onClick={() => editor.save('paused')}
                  >
                    {editor.savingTarget === 'paused' ? '正在保存…' : '保存并暂停'}
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    type="button"
                    disabled={editor.saving}
                    onClick={() => editor.save('enabled')}
                  >
                    {editor.savingTarget === 'enabled' ? '正在保存…' : '保存并启用'}
                  </Button>
                </ActionBar>
              </section>
            </div>
          </div>
        </ScrollRegion>
      </section>
      {confirmDiscard && (
        <ConfirmationDialog
          title="放弃未保存的配置？"
          detail="当前输入尚未保存。离开后这些修改将丢失；定时规则不会被创建或更新。"
          confirmLabel="放弃草稿"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}
