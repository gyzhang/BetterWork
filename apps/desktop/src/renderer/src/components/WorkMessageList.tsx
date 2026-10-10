import type { AgentRuntimeEvent, RunSummary } from '@betterwork/agent-protocol';
import { memo, type ReactNode, type RefObject, useMemo } from 'react';

import type { RunArtifactSaveState, RunArtifactTarget } from '../hooks/use-run-artifact-save';
import { ArtifactIcon } from '../icons';
import { trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import type { AssistantAnswerSource } from '../lib/memory-capture';
import { projectWorkRun } from '../lib/work-message';
import { InlineLoading } from './AsyncButton';
import { Button } from './Button';
import { InlineError } from './InlineError';
import { MessageBlock } from './MessageBlock';
import { StatusNote } from './StatusNote';
import { ToolActivity } from './ToolActivity';
import { TransientToast } from './TransientToast';

const emptyEvents: AgentRuntimeEvent[] = [];

interface WorkMessageListProps {
  runs: RunSummary[];
  events: Map<string, AgentRuntimeEvent[]>;
  activeRunId: string | undefined;
  savedRunIds: ReadonlySet<string>;
  artifactSave: RunArtifactSaveState;
  userName: string;
  assistantName: string;
  latestReplyRef: RefObject<HTMLDivElement | null>;
  onRemember: (
    runId: string,
    answer: AssistantAnswerSource | undefined,
    trigger: HTMLButtonElement,
  ) => void;
  capture: { runId: string; panel: ReactNode } | undefined;
}

interface WorkRunMessageProps {
  run: RunSummary;
  events: AgentRuntimeEvent[];
  divider: boolean;
  active: boolean;
  rememberable: boolean;
  saved: boolean;
  savingRunId: string | undefined;
  error: string | undefined;
  dismissFeedback: () => void;
  onSave: (target: RunArtifactTarget) => Promise<void>;
  userName: string;
  assistantName: string;
  anchorRef: RefObject<HTMLDivElement | null> | undefined;
  onRemember: WorkMessageListProps['onRemember'];
  capturePanel: ReactNode;
}

const WorkRunMessage = memo(function WorkRunMessage({
  run,
  events,
  divider,
  active,
  rememberable,
  saved,
  savingRunId,
  error,
  dismissFeedback,
  onSave,
  userName,
  assistantName,
  anchorRef,
  onRemember,
  capturePanel,
}: WorkRunMessageProps): React.JSX.Element {
  const projection = useMemo(() => projectWorkRun(events), [events]);
  return (
    <div className="run-group">
      {divider && (
        <div className="run-divider">
          <span>{formatTime(run.createdAt)}</span>
        </div>
      )}
      <MessageBlock author="user" authorName={userName} content={run.prompt} />
      <ToolActivity events={events} />
      {projection.content && (
        <MessageBlock
          author="assistant"
          authorName={assistantName}
          content={projection.content}
          anchorRef={anchorRef}
          actions={
            projection.completed ? (
              <>
                {rememberable && (
                  <Button
                    variant="text"
                    size="sm"
                    onClick={(event) => onRemember(run.id, projection.answer, event.currentTarget)}
                  >
                    记住这段经验
                  </Button>
                )}
                {projection.finalContent && (
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() =>
                      trackAction(
                        onSave({ run, content: projection.finalContent ?? '' }),
                        '保存成果',
                      )
                    }
                    disabled={saved || savingRunId !== undefined}
                  >
                    <ArtifactIcon size={13} />
                    {savingRunId === run.id ? '正在保存…' : saved ? '已保存为成果' : '保存为成果'}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      )}
      {projection.failure !== undefined && (
        <InlineError message={`本次运行未完成，回复内容未登记为正式成果。${projection.failure}`} />
      )}
      {projection.cancelled && <StatusNote message="本次运行已停止。可以调整要求后重新开始。" />}
      {error && <InlineError message={error} onDismiss={dismissFeedback} />}
      {capturePanel}
      {active && events.length > 0 && !projection.terminal && <InlineLoading label="正在执行…" />}
    </div>
  );
});

export function WorkMessageList({
  runs,
  events,
  activeRunId,
  savedRunIds,
  artifactSave,
  userName,
  assistantName,
  latestReplyRef,
  onRemember,
  capture,
}: WorkMessageListProps): React.JSX.Element {
  const latestCompletedId = [...runs]
    .reverse()
    .find((run) => events.get(run.id)?.some((event) => event.type === 'run.completed'))?.id;
  return (
    <>
      {runs.map((run, index) => (
        <WorkRunMessage
          key={run.id}
          run={run}
          events={events.get(run.id) ?? emptyEvents}
          divider={index > 0}
          active={run.id === activeRunId}
          rememberable={run.id === latestCompletedId}
          saved={savedRunIds.has(run.id)}
          savingRunId={artifactSave.savingRunId}
          error={
            artifactSave.feedback?.tone === 'error' && artifactSave.feedback.runId === run.id
              ? artifactSave.feedback.message
              : undefined
          }
          dismissFeedback={artifactSave.dismissFeedback}
          onSave={artifactSave.save}
          userName={userName}
          assistantName={assistantName}
          anchorRef={index === runs.length - 1 ? latestReplyRef : undefined}
          onRemember={onRemember}
          capturePanel={capture?.runId === run.id ? capture.panel : undefined}
        />
      ))}
      {artifactSave.feedback?.tone === 'success' && (
        <TransientToast
          tone="success"
          message={artifactSave.feedback.message}
          onDismiss={artifactSave.dismissFeedback}
        />
      )}
    </>
  );
}
