import type {
  ArtifactSummary,
  CreateDiscussionCheckpointRequest,
  DiscussionCheckpoint,
  DiscussionCheckpointStage,
} from '@betterwork/agent-protocol';
import { useMemo, useState } from 'react';

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
    submit().catch(() => undefined);
  };

  return (
    <section className="discussion-checkpoints" aria-label="讨论节点">
      <div className="discussion-checkpoints-header">
        <div>
          <span className="eyebrow">讨论节点</span>
          <strong>{latestOpen ? stageLabel(latestOpen.stage) : '尚未记录阶段'}</strong>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起' : '记录节点'}
        </button>
      </div>
      {latestOpen && (
        <p className="discussion-checkpoint-summary">
          {latestOpen.title} · {latestOpen.summary}
          {latestOpen.nextAction ? ` 下一步：${latestOpen.nextAction}` : ''}
        </p>
      )}
      {expanded && (
        <div className="discussion-checkpoint-form">
          <div className="discussion-checkpoint-fields">
            <label>
              阶段
              <select
                value={stage}
                onChange={(event) => setStage(event.target.value as DiscussionCheckpointStage)}
              >
                {STAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
              />
            </label>
            <label>
              当前结论
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                rows={3}
              />
            </label>
            <label>
              审阅反馈（可选）
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={2}
              />
            </label>
            <label>
              下一步（可选）
              <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
            </label>
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
          <div className="discussion-checkpoint-footer">
            {latestOpen && <span>保存后会把上一节点标记为已替代</span>}
            <button
              type="button"
              className="primary-button"
              disabled={saving || !title.trim() || !summary.trim()}
              onClick={handleSubmit}
            >
              {saving ? '正在保存…' : '保存节点'}
            </button>
          </div>
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
