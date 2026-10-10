import type {
  AgentRuntimeEvent,
  ArtifactSummary,
  RunSummary,
  TaskContinuityBrief,
} from '@betterwork/agent-protocol';
import {
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX,
  TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS,
  TASK_CONTINUITY_OBJECTIVE_MAX_CODE_POINTS,
  TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS,
} from '@betterwork/agent-protocol';
import { useEffect, useId, useState } from 'react';

import type { ActivityGroup } from '../../activity';
import type { TaskContinuityState } from '../../hooks/use-task-continuity';
import { reportAction, trackAction } from '../../lib/async-action';
import { formatTime } from '../../lib/format';
import { runStatusName } from '../../lib/labels';
import { ActionBar } from '../ActionBar';
import { AsyncButton, InlineLoading } from '../AsyncButton';
import { Button } from '../Button';
import { Disclosure } from '../Disclosure';
import { EmptyContext, EmptyNotice } from '../EmptyState';
import { Field } from '../Field';
import { FieldSelect } from '../FieldSelect';
import { InlineError } from '../InlineError';
import { ListRow } from '../ListRow';
import { RunSummaryRow } from '../RunSummaryRow';
import { SectionHeader } from '../SectionHeader';
import { StatusNote } from '../StatusNote';
import { TextArea } from '../TextField';
import { ToolActivity } from '../ToolActivity';
import type { ToastTone } from '../TransientToast';

export interface ProcessContextProps {
  taskId?: string | undefined;
  taskContinuity: TaskContinuityState;
  taskRuns: RunSummary[];
  artifacts: ArtifactSummary[];
  onSelectRun: (run: RunSummary) => void;
  onOpenArtifactVersion: (versionId: string) => Promise<void>;
  events: AgentRuntimeEvent[];
  activeRun?: RunSummary | undefined;
  activityGroups: ActivityGroup[];
  onError: (tone: ToastTone, message: string) => void;
}

export function ProcessContext({
  taskId,
  taskContinuity,
  taskRuns,
  artifacts,
  onSelectRun,
  onOpenArtifactVersion,
  events,
  activeRun,
  activityGroups,
  onError,
}: ProcessContextProps): React.JSX.Element {
  return (
    <>
      {taskId && (
        <TaskContinuitySection
          taskId={taskId}
          state={taskContinuity}
          taskRuns={taskRuns}
          artifacts={artifacts}
          onSelectRun={onSelectRun}
          onOpenArtifactVersion={onOpenArtifactVersion}
          onError={onError}
        />
      )}
      {events.length === 0 ? (
        <EmptyContext
          placement="start"
          title="等待任务开始"
          detail="开始后，这里会按工作阶段呈现过程，而不是堆叠底层日志。"
        />
      ) : (
        <div className="activity-list">
          <div className="activity-summary">
            <span className={`status-dot ${activeRun?.status === 'running' ? 'running' : ''}`} />
            <div>
              <strong>{activeRun ? runStatusName[activeRun.status] : '正在处理任务'}</strong>
              <p>{activityGroups.length} 个工作阶段</p>
            </div>
          </div>
          {activityGroups.map((group) => (
            <ActivityGroupRow group={group} key={group.id} />
          ))}
          <ToolActivity key={activeRun?.id ?? events[0]?.runId} events={events} />
          {taskRuns.length > 1 && (
            <Disclosure className="task-run-history" label={`执行记录 · ${taskRuns.length} 次`}>
              {taskRuns.map((run) => (
                <RunSummaryRow
                  key={run.id}
                  run={run}
                  title={run.prompt}
                  action="查看执行记录"
                  selected={run.id === activeRun?.id}
                  onSelect={() => onSelectRun(run)}
                />
              ))}
            </Disclosure>
          )}
        </div>
      )}
    </>
  );
}

function ActivityGroupRow({ group }: { group: ActivityGroup }): React.JSX.Element {
  return (
    <div className={`activity-row ${group.status}`}>
      <span className="activity-marker" />
      <div>
        <strong>{group.title}</strong>
        <p>{group.description}</p>
        <small>{group.status === 'running' ? '进行中' : formatTime(group.updatedAt)}</small>
      </div>
    </div>
  );
}

interface TaskContinuityRequirementDraft {
  key: string;
  id?: string;
  text: string;
}

interface TaskContinuityProgressDraft {
  status: NonNullable<TaskContinuityBrief['progress']>['status'];
  completedActions: string;
  nextAction: string;
  blockers: string;
  artifactVersionIds: string[];
}

interface TaskContinuityDraft {
  objective: string;
  activeRequirements: TaskContinuityRequirementDraft[];
  progress: TaskContinuityProgressDraft | null;
}

const TASK_CONTINUITY_PROGRESS_LABELS: Record<
  NonNullable<TaskContinuityBrief['progress']>['status'],
  string
> = {
  'in-progress': '进行中',
  blocked: '受阻',
  'awaiting-user': '等待用户',
  complete: '已整理完成',
};

const TASK_CONTINUITY_PROGRESS_OPTIONS = Object.entries(TASK_CONTINUITY_PROGRESS_LABELS).map(
  ([id, label]) => ({ id, label }),
);

const codePointLength = (value: string): number => Array.from(value).length;

const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const draftOfBrief = (brief: TaskContinuityBrief): TaskContinuityDraft => ({
  objective: brief.objective.text,
  activeRequirements: brief.activeRequirements.map((requirement) => ({
    key: requirement.id,
    id: requirement.id,
    text: requirement.text,
  })),
  progress: brief.progress
    ? {
        status: brief.progress.status,
        completedActions: brief.progress.completedActions.join('\n'),
        nextAction: brief.progress.nextAction ?? '',
        blockers: brief.progress.blockers.join('\n'),
        artifactVersionIds: [...brief.progress.artifactVersionIds],
      }
    : null,
});

function taskContinuityDraftError(draft: TaskContinuityDraft): string {
  const objectiveLength = codePointLength(draft.objective.trim());
  if (objectiveLength === 0) return '任务目标不能为空。';
  if (objectiveLength > TASK_CONTINUITY_OBJECTIVE_MAX_CODE_POINTS) {
    return `任务目标不能超过 ${TASK_CONTINUITY_OBJECTIVE_MAX_CODE_POINTS} 个字符。`;
  }
  if (draft.activeRequirements.length > TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX) {
    return `活跃要求最多 ${TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX} 项。`;
  }
  const requirements = draft.activeRequirements.map((requirement) => requirement.text.trim());
  if (requirements.some((text) => text.length === 0)) {
    return '请补全活跃要求，或移除空白项。';
  }
  const requirementLength = requirements.reduce((sum, text) => sum + codePointLength(text), 0);
  if (requirementLength > TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS) {
    return `活跃要求合计不能超过 ${TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX_CODE_POINTS} 个字符。`;
  }
  if (draft.progress) {
    const progressText = [
      ...linesOf(draft.progress.completedActions),
      draft.progress.nextAction.trim(),
      ...linesOf(draft.progress.blockers),
    ];
    const progressLength = progressText.reduce((sum, text) => sum + codePointLength(text), 0);
    if (progressLength > TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS) {
      return `进度内容合计不能超过 ${TASK_CONTINUITY_PROGRESS_MAX_CODE_POINTS} 个字符。`;
    }
  }
  return '';
}

function TaskContinuitySection({
  taskId,
  state,
  taskRuns,
  artifacts,
  onSelectRun,
  onOpenArtifactVersion,
  onError,
}: {
  taskId: string;
  state: TaskContinuityState;
  taskRuns: RunSummary[];
  artifacts: ArtifactSummary[];
  onSelectRun: (run: RunSummary) => void;
  onOpenArtifactVersion: (versionId: string) => Promise<void>;
  onError: (tone: ToastTone, message: string) => void;
}): React.JSX.Element {
  const revision = state.revision;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskContinuityDraft>();
  const idPrefix = useId();

  useEffect(() => {
    if (!revision) {
      setDraft(undefined);
      setEditing(false);
      return;
    }
    setDraft(draftOfBrief(revision.brief));
  }, [revision, taskId]);

  const validationError = draft ? taskContinuityDraftError(draft) : '';
  const openSourceRun = (runId: string): void => {
    const run = taskRuns.find((candidate) => candidate.id === runId);
    if (run) onSelectRun(run);
  };
  const renderPromptSource = (runId: string, promptHash: string): React.JSX.Element => {
    const run = taskRuns.find((candidate) => candidate.id === runId);
    return (
      <div key={`${runId}:${promptHash}`}>
        <StatusNote
          message={`来源请求 · prompt 指纹 ${promptHash.slice(0, 12)}${run ? ` · ${formatTime(run.createdAt)}` : ' · 来源记录不可用'}`}
        />
        {run && (
          <Button variant="link" size="sm" type="button" onClick={() => openSourceRun(runId)}>
            查看来源执行记录
          </Button>
        )}
      </div>
    );
  };
  const renderSourceRun = (runId: string): React.JSX.Element => {
    const run = taskRuns.find((candidate) => candidate.id === runId);
    return (
      <div key={runId}>
        {run ? (
          <RunSummaryRow
            run={run}
            title="来源执行记录"
            action="查看来源执行记录"
            onSelect={() => openSourceRun(runId)}
          />
        ) : (
          <StatusNote message="来源执行记录不可用" />
        )}
      </div>
    );
  };

  const updateDraft = (update: (current: TaskContinuityDraft) => TaskContinuityDraft): void => {
    setDraft((current) => (current ? update(current) : current));
  };
  const startEditing = (): void => {
    if (!revision) return;
    setDraft(draftOfBrief(revision.brief));
    state.clearError();
    setEditing(true);
  };
  const cancelEditing = (): void => {
    if (revision) setDraft(draftOfBrief(revision.brief));
    state.clearError();
    setEditing(false);
  };
  const refresh = (): void => {
    trackAction(state.refresh(), '载入最新任务简报');
  };
  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!draft || !revision || validationError || state.saving) return;
    const progress = draft.progress
      ? {
          status: draft.progress.status,
          completedActions: linesOf(draft.progress.completedActions),
          ...(draft.progress.nextAction.trim()
            ? { nextAction: draft.progress.nextAction.trim() }
            : {}),
          blockers: linesOf(draft.progress.blockers),
          artifactVersionIds: draft.progress.artifactVersionIds,
        }
      : null;
    trackAction(
      state
        .save({
          taskId,
          expectedRevision: revision.revision,
          objective: draft.objective.trim(),
          activeRequirements: draft.activeRequirements.map((requirement) => ({
            ...(requirement.id ? { id: requirement.id } : {}),
            text: requirement.text.trim(),
          })),
          progress,
        })
        .then((result) => {
          if (result?.kind === 'saved') setEditing(false);
        }),
      '保存本任务目标与进度',
    );
  };

  const header = (
    <SectionHeader
      title="本任务目标与进度"
      hint={revision ? `连续简报 · 第 ${revision.revision} 版` : '仅记录当前 Task 的工作上下文'}
      actions={
        revision && !state.loading && state.errorKind !== 'load' && !editing ? (
          <Button variant="secondary" size="sm" type="button" onClick={startEditing}>
            编辑简报
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <section className="context-section">
      {header}
      {state.loading && (
        <InlineLoading label={revision ? '正在载入最新版本…' : '正在读取本任务简报…'} />
      )}
      {state.error && (
        <InlineError
          message={state.error}
          {...(state.conflict
            ? {
                actions: (
                  <Button variant="link" size="sm" type="button" onClick={refresh}>
                    载入最新版本
                  </Button>
                ),
              }
            : state.errorKind === 'load'
              ? { onRetry: refresh }
              : { onDismiss: state.clearError })}
        />
      )}
      {revision === null && !state.loading && !state.error && (
        <EmptyNotice
          title="此 Task 尚无连续简报"
          detail="连续简报从新建 Task 开始记录；旧 Task 不会从历史对话回填。"
        />
      )}
      {revision && editing && draft && (
        <form className="context-section" onSubmit={submit}>
          <Field label="任务目标" controlId={`${idPrefix}-objective`}>
            <TextArea
              id={`${idPrefix}-objective`}
              rows={3}
              autoFocus
              disabled={state.saving || state.loading}
              value={draft.objective}
              onChange={(event) => {
                const objective = event.currentTarget.value;
                updateDraft((current) => ({ ...current, objective }));
              }}
            />
          </Field>
          <section className="context-section">
            <SectionHeader
              title="活跃要求"
              hint={`${draft.activeRequirements.length} / ${TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX} 项`}
              actions={
                <Button
                  variant="chip"
                  size="sm"
                  type="button"
                  disabled={
                    state.saving ||
                    draft.activeRequirements.length >= TASK_CONTINUITY_ACTIVE_REQUIREMENTS_MAX
                  }
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      activeRequirements: [
                        ...current.activeRequirements,
                        { key: crypto.randomUUID(), text: '' },
                      ],
                    }))
                  }
                >
                  添加要求
                </Button>
              }
            />
            {draft.activeRequirements.map((requirement, index) => {
              const inputId = `${idPrefix}-requirement-${requirement.key}`;
              return (
                <Field key={requirement.key} label={`要求 ${index + 1}`} controlId={inputId}>
                  <TextArea
                    id={inputId}
                    rows={2}
                    disabled={state.saving || state.loading}
                    value={requirement.text}
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      updateDraft((current) => ({
                        ...current,
                        activeRequirements: current.activeRequirements.map((item) =>
                          item.key === requirement.key ? { ...item, text } : item,
                        ),
                      }));
                    }}
                  />
                  <Button
                    variant="link"
                    size="sm"
                    tone="danger"
                    type="button"
                    disabled={state.saving || state.loading}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        activeRequirements: current.activeRequirements.filter(
                          (item) => item.key !== requirement.key,
                        ),
                      }))
                    }
                  >
                    移除要求
                  </Button>
                </Field>
              );
            })}
            {draft.activeRequirements.length === 0 && <StatusNote message="当前没有活跃要求。" />}
          </section>
          <section className="context-section">
            <SectionHeader
              title="进度整理"
              hint={
                draft.progress ? TASK_CONTINUITY_PROGRESS_LABELS[draft.progress.status] : '尚未整理'
              }
              actions={
                draft.progress ? (
                  <Button
                    variant="link"
                    size="sm"
                    tone="danger"
                    type="button"
                    disabled={state.saving || state.loading}
                    onClick={() => updateDraft((current) => ({ ...current, progress: null }))}
                  >
                    清除进度
                  </Button>
                ) : (
                  <Button
                    variant="chip"
                    size="sm"
                    type="button"
                    disabled={state.saving || state.loading}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        progress: {
                          status: 'in-progress',
                          completedActions: '',
                          nextAction: '',
                          blockers: '',
                          artifactVersionIds: [],
                        },
                      }))
                    }
                  >
                    添加进度
                  </Button>
                )
              }
            />
            {draft.progress && (
              <>
                <Field label="进度状态" controlId={`${idPrefix}-progress-status`}>
                  <FieldSelect
                    size="sm"
                    ariaLabel="进度状态"
                    value={draft.progress.status}
                    disabled={state.saving || state.loading}
                    options={TASK_CONTINUITY_PROGRESS_OPTIONS}
                    onChange={(value) =>
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                status: value as TaskContinuityProgressDraft['status'],
                              },
                            }
                          : current,
                      )
                    }
                  />
                </Field>
                <Field label="已完成动作" controlId={`${idPrefix}-completed-actions`}>
                  <TextArea
                    id={`${idPrefix}-completed-actions`}
                    rows={3}
                    disabled={state.saving || state.loading}
                    value={draft.progress.completedActions}
                    onChange={(event) => {
                      const completedActions = event.currentTarget.value;
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                completedActions,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </Field>
                <Field label="下一步" controlId={`${idPrefix}-next-action`}>
                  <TextArea
                    id={`${idPrefix}-next-action`}
                    rows={2}
                    disabled={state.saving || state.loading}
                    value={draft.progress.nextAction}
                    onChange={(event) => {
                      const nextAction = event.currentTarget.value;
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                nextAction,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </Field>
                <Field label="阻塞事项" controlId={`${idPrefix}-progress-blockers`}>
                  <TextArea
                    id={`${idPrefix}-progress-blockers`}
                    rows={2}
                    disabled={state.saving || state.loading}
                    value={draft.progress.blockers}
                    onChange={(event) => {
                      const blockers = event.currentTarget.value;
                      updateDraft((current) =>
                        current.progress
                          ? {
                              ...current,
                              progress: {
                                ...current.progress,
                                blockers,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </Field>
                {draft.progress.artifactVersionIds.length > 0 && (
                  <section className="context-section">
                    <SectionHeader title="精确成果版本" />
                    {draft.progress.artifactVersionIds.map((versionId) => {
                      const artifact = artifacts.find(
                        (item) => item.currentVersionId === versionId,
                      );
                      return (
                        <ListRow
                          key={versionId}
                          variant="plain"
                          multiline
                          title={artifact?.title ?? '已登记成果版本'}
                          meta={`精确版本 ${versionId.slice(0, 8)}`}
                          actions={
                            <Button
                              variant="link"
                              size="sm"
                              type="button"
                              disabled={state.saving || state.loading}
                              onClick={() =>
                                updateDraft((current) =>
                                  current.progress
                                    ? {
                                        ...current,
                                        progress: {
                                          ...current.progress,
                                          artifactVersionIds:
                                            current.progress.artifactVersionIds.filter(
                                              (candidate) => candidate !== versionId,
                                            ),
                                        },
                                      }
                                    : current,
                                )
                              }
                            >
                              移除引用
                            </Button>
                          }
                        />
                      );
                    })}
                  </section>
                )}
              </>
            )}
          </section>
          {validationError && <InlineError message={validationError} />}
          <ActionBar label="保存本任务目标与进度">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={state.saving || state.loading}
              onClick={cancelEditing}
            >
              取消
            </Button>
            <AsyncButton
              variant="primary"
              size="sm"
              label="保存简报"
              busyLabel="正在保存…"
              busy={state.saving}
              type="submit"
              disabled={Boolean(validationError) || state.loading || state.errorKind === 'load'}
            />
          </ActionBar>
        </form>
      )}
      {revision && !editing && (
        <>
          <section className="context-section">
            <SectionHeader title="任务目标" />
            <ListRow
              variant="plain"
              multiline
              title={revision.brief.objective.text}
              detail={revision.brief.objective.source === 'task-goal' ? '初始任务目标' : '用户修订'}
              actionsPlacement="below"
              actions={
                revision.brief.objective.sourceRunId ? (
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    onClick={() => openSourceRun(revision.brief.objective.sourceRunId ?? '')}
                  >
                    查看目标来源
                  </Button>
                ) : undefined
              }
            />
          </section>
          <section className="context-section">
            <SectionHeader
              title="活跃要求"
              hint={`${revision.brief.activeRequirements.length} 项`}
            />
            {revision.brief.activeRequirements.length === 0 ? (
              <EmptyNotice title="当前没有活跃要求" />
            ) : (
              revision.brief.activeRequirements.map((requirement) => (
                <ListRow
                  key={requirement.id}
                  variant="plain"
                  multiline
                  title={requirement.text}
                  detail={requirement.authoredBy === 'user-edit' ? '用户修订' : '助手整理'}
                  actionsPlacement="below"
                  actions={requirement.sources?.map((source) =>
                    renderPromptSource(source.runId, source.promptHash),
                  )}
                />
              ))
            )}
          </section>
          <section className="context-section">
            <SectionHeader title="进度整理" />
            {!revision.brief.progress ? (
              <EmptyNotice
                title="尚无进度记录"
                detail="完成的执行记录与登记成果会形成保守的进度事实。"
              />
            ) : (
              <>
                <StatusNote
                  tone={
                    revision.brief.progress.status === 'blocked'
                      ? 'warning'
                      : revision.brief.progress.status === 'complete'
                        ? 'success'
                        : 'neutral'
                  }
                  message={`进度状态：${TASK_CONTINUITY_PROGRESS_LABELS[revision.brief.progress.status]} · ${revision.brief.progress.authoredBy === 'user-edit' ? '用户修订' : '助手整理'}`}
                />
                {revision.brief.progress.completedActions.map((action, index) => (
                  <ListRow key={`${index}:${action}`} variant="plain" multiline title={action} />
                ))}
                {revision.brief.progress.nextAction && (
                  <StatusNote message={`下一步：${revision.brief.progress.nextAction}`} />
                )}
                {revision.brief.progress.blockers.map((blocker, index) => (
                  <StatusNote
                    key={`${index}:${blocker}`}
                    tone="warning"
                    message={`阻塞：${blocker}`}
                  />
                ))}
                {revision.brief.progress.sourceRunId &&
                  renderSourceRun(revision.brief.progress.sourceRunId)}
                {revision.brief.progress.artifactVersionIds.map((versionId) => {
                  const artifact = artifacts.find((item) => item.currentVersionId === versionId);
                  return (
                    <ListRow
                      key={versionId}
                      variant="plain"
                      multiline
                      title={artifact?.title ?? '已登记成果版本'}
                      meta={`精确版本 ${versionId.slice(0, 8)}`}
                      actions={
                        <Button
                          variant="link"
                          size="sm"
                          type="button"
                          onClick={() =>
                            reportAction(
                              onOpenArtifactVersion(versionId),
                              (message) => onError('error', message),
                              '无法打开该成果版本。',
                            )
                          }
                        >
                          查看该版本
                        </Button>
                      }
                    />
                  );
                })}
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}
