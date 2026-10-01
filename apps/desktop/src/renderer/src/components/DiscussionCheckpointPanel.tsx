import type {
  ArtifactSummary,
  CreateDiscussionCheckpointRequest,
  DiscussionCheckpoint,
  DiscussionCheckpointStage,
} from '@betterwork/agent-protocol';
import { useMemo, useState } from 'react';

import { ActionBar } from './ActionBar';
import { AsyncButton } from './AsyncButton';
import { Button } from './Button';
import { Field } from './Field';
import { FieldSelect } from './FieldSelect';
import { SectionHeader } from './SectionHeader';

const STAGES: Array<{ value: DiscussionCheckpointStage; label: string }> = [
  { value: 'understanding', label: '理解与目标' },
  { value: 'research-complete', label: '研究完成' },
  { value: 'report-outline', label: '报告大纲' },
  { value: 'report', label: '报告完成' },
  { value: 'ppt-outline', label: 'PPT 大纲' },
  { value: 'ppt-complete', label: 'PPT 完成' },
  { value: 'iteration', label: '迭代返工' },
];

const stageLabel = (stage: DiscussionCheckpointStage): string =>
  STAGES.find((item) => item.value === stage)?.label ?? stage;

interface DiscussionCheckpointPanelProps {
  taskId: string;
  runId?: string;
  checkpoints: DiscussionCheckpoint[];
  artifacts: ArtifactSummary[];
  onCreate: (input: CreateDiscussionCheckpointRequest) => Promise<void>;
}

export function DiscussionCheckpointPanel({
  taskId,
  runId,
  checkpoints,
  artifacts,
  onCreate,
}: DiscussionCheckpointPanelProps): React.JSX.Element {
  const latestOpen = useMemo(
    () => [...checkpoints].reverse().find((checkpoint) => checkpoint.status === 'open'),
    [checkpoints],
  );
  const [expanded, setExpanded] = useState(false);
  const [stage, setStage] = useState<DiscussionCheckpointStage>(
    latestOpen?.stage ?? 'understanding',
  );
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [feedback, setFeedback] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [artifactVersionIds, setArtifactVersionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    if (!title.trim() || !summary.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({
        id: crypto.randomUUID(),
        taskId,
        ...(runId ? { runId } : {}),
        stage,
        title: title.trim(),
        summary: summary.trim(),
        artifactVersionIds,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        ...(nextAction.trim() ? { nextAction: nextAction.trim() } : {}),
        ...(latestOpen ? { supersedesId: latestOpen.id } : {}),
      });
      setTitle('');
      setSummary('');
      setFeedback('');
      setNextAction('');
      setArtifactVersionIds([]);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  };
  const handleSubmit = (): void => {
    // 失败已经由 `App.tsx` 的 `createDiscussionCheckpoint` 呈现（`setActionError`）并重新抛出，
    // 抛出只是为了让 `submit()` 里的清空表单那几行不执行；这里接住它，避免变成未处理的 rejection。
    submit().catch(() => undefined);
  };

  return (
    <section className="discussion-checkpoints" aria-label="讨论节点">
      <SectionHeader
        eyebrow="讨论节点"
        title={latestOpen ? stageLabel(latestOpen.stage) : '尚未记录阶段'}
        actions={
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : '记录节点'}
          </Button>
        }
      />
      {latestOpen && (
        <p className="discussion-checkpoint-summary">
          {latestOpen.title} · {latestOpen.summary}
          {latestOpen.nextAction ? ` 下一步：${latestOpen.nextAction}` : ''}
        </p>
      )}
      {expanded && (
        <div className="discussion-checkpoint-form">
          <div className="discussion-checkpoint-fields">
            <Field label="阶段">
              <FieldSelect
                size="md"
                value={stage}
                onChange={(next) => setStage(next as DiscussionCheckpointStage)}
                options={STAGES.map((item) => ({ id: item.value, label: item.label }))}
              />
            </Field>
            <Field label="标题">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label="当前结论">
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                rows={3}
              />
            </Field>
            <Field label="审阅反馈（可选）">
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={2}
              />
            </Field>
            <Field label="下一步（可选）">
              <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
            </Field>
          </div>
          {artifacts.length > 0 && (
            <fieldset className="discussion-checkpoint-artifacts">
              <legend>关联当前成果版本</legend>
              {artifacts.map((artifact) => (
                <label key={artifact.id}>
                  <input
                    type="checkbox"
                    checked={artifactVersionIds.includes(artifact.currentVersionId)}
                    onChange={(event) =>
                      setArtifactVersionIds((current) =>
                        event.target.checked
                          ? [...current, artifact.currentVersionId]
                          : current.filter((id) => id !== artifact.currentVersionId),
                      )
                    }
                  />
                  {artifact.title}
                </label>
              ))}
            </fieldset>
          )}
          <ActionBar
            as="div"
            label="保存讨论节点"
            hint={latestOpen ? '保存后会把上一节点标记为已替代' : undefined}
          >
            <AsyncButton
              variant="primary"
              size="md"
              busy={saving}
              disabled={!title.trim() || !summary.trim()}
              label="保存节点"
              busyLabel="正在保存…"
              onClick={handleSubmit}
            />
          </ActionBar>
        </div>
      )}
      {checkpoints.length > 1 && (
        <div className="discussion-checkpoint-history">
          {checkpoints.slice(-4).map((checkpoint) => (
            <span key={checkpoint.id} data-status={checkpoint.status}>
              {stageLabel(checkpoint.stage)} · {checkpoint.status === 'open' ? '当前' : '已替代'}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
