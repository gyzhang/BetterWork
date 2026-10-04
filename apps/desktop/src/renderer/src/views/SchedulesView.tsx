import type {
  ExpertDetail,
  ExpertSummary,
  ScheduleDetail,
  ScheduleOccurrenceDetail,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyNotice, EmptyPage, ErrorPage, LoadingPage } from '../components/EmptyState';
import { FieldSelect } from '../components/FieldSelect';
import { InlineError } from '../components/InlineError';
import { PageHeader } from '../components/layout/PageHeader';
import { PageToolbar } from '../components/layout/PageToolbar';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { ListRow } from '../components/ListRow';
import { StatusNote } from '../components/StatusNote';
import { TransientToast } from '../components/TransientToast';
import type { SchedulesState } from '../hooks/use-schedules';
import { reportAction } from '../lib/async-action';
import {
  filterSchedulesByWorkspace,
  lifecycleLabel,
  lifecycleTone,
  occurrenceResultLabel,
  occurrenceResultTone,
  periodRuleLabel,
  scheduleTimestampLabel,
  scheduleTimingLabel,
  workspaceFilterOptions,
} from '../lib/schedules';
import { ScheduleDetailPage } from './schedules/ScheduleDetail';
import { ScheduleEditor } from './schedules/ScheduleEditor';

function ScheduleListRow({
  detail,
  workspaceName,
  onEdit,
  onOpenDetail,
  onReviewVersion,
}: {
  detail: ScheduleDetail;
  workspaceName: string;
  onEdit: () => void;
  onOpenDetail: () => void;
  onReviewVersion: (versionId: string) => void;
}): React.JSX.Element {
  const { schedule } = detail.aggregate;
  const { config } = detail.aggregate;
  const latest = detail.history.items[0];
  const generated = latest?.result.status === 'generated';
  const reviewVersionId =
    generated && latest.result.outputReceipts.length === 1
      ? latest.result.outputReceipts[0]?.artifactVersionId
      : undefined;
  const lastRunLabel = latest
    ? `最近一期 · ${
        latest.occurrence.scheduledAt !== undefined
          ? scheduleTimestampLabel(latest.occurrence.scheduledAt, config.timing.timeZone)
          : latest.occurrence.trigger === 'manual-now'
            ? '人工立即执行'
            : '人工补做错过期'
      }`
    : '最近一期 · 尚未执行';
  const nextLabel =
    schedule.lifecycle === 'enabled' && schedule.nextScheduledAt !== undefined
      ? `下次 ${scheduleTimestampLabel(schedule.nextScheduledAt, config.timing.timeZone)}`
      : schedule.lifecycle === 'enabled'
        ? '下一次计划时间暂不可用'
        : schedule.lifecycle === 'paused'
          ? '已暂停；人工执行仍可用'
          : '已归档；历史与成果仍可回看';

  return (
    <ListRow
      as="article"
      title={config.name}
      detail={`执行专家：${detail.expertUpdate.boundRevision.name} · 工作空间：${workspaceName}`}
      meta={`${scheduleTimingLabel(config.timing)} · ${nextLabel} · 统计范围：${periodRuleLabel(config.periodRule)} · ${lastRunLabel}`}
      trailing={
        <Badge tone={lifecycleTone(schedule.lifecycle)}>{lifecycleLabel(schedule.lifecycle)}</Badge>
      }
      actions={
        <>
          {generated && (
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={() => (reviewVersionId ? onReviewVersion(reviewVersionId) : onOpenDetail())}
            >
              审阅本期成果
            </Button>
          )}
          <Button variant="secondary" size="sm" type="button" onClick={onOpenDetail}>
            规则与历史
          </Button>
          {schedule.lifecycle !== 'archived' && (
            <Button variant="secondary" size="sm" type="button" onClick={onEdit}>
              编辑
            </Button>
          )}
        </>
      }
      multiline
    >
      <Badge tone={occurrenceResultTone(latest?.result.status)}>
        {generated ? '成果已生成' : occurrenceResultLabel(latest?.result.status)}
      </Badge>
      {detail.expertUpdate.available && <Badge tone="warning">专家有新版本</Badge>}
      {schedule.dispatchBlock && (
        <StatusNote tone="warning" message={schedule.dispatchBlock.message} />
      )}
    </ListRow>
  );
}

export function SchedulesPage({
  state,
  workspaces,
  experts,
  expertsLoading,
  expertsError,
  getExpert,
  onOpenTask,
  onOpenArtifactVersion,
  onOpenSource,
}: {
  state: SchedulesState;
  workspaces: readonly WorkspaceSummary[];
  experts: readonly ExpertSummary[];
  expertsLoading: boolean;
  expertsError: string;
  getExpert: (id: string) => Promise<ExpertDetail | null>;
  onOpenTask: (taskId: string, continuation?: ScheduleOccurrenceDetail) => Promise<void>;
  onOpenArtifactVersion: (versionId: string) => Promise<void>;
  onOpenSource: (sourceUri: string) => Promise<void>;
}): React.JSX.Element {
  const [workspaceId, setWorkspaceId] = useState('all');
  const [editorTarget, setEditorTarget] = useState<
    { kind: 'create' } | { kind: 'edit'; detail: ScheduleDetail } | undefined
  >();
  const [detailTarget, setDetailTarget] = useState<ScheduleDetail>();
  const [savedMessage, setSavedMessage] = useState('');
  const [openError, setOpenError] = useState('');
  const options = workspaceFilterOptions(workspaces);
  const visibleDetails = filterSchedulesByWorkspace(state.details, workspaceId);

  if (detailTarget && !editorTarget) {
    const latestDetail =
      state.details.find(
        (item) => item.aggregate.schedule.id === detailTarget.aggregate.schedule.id,
      ) ?? detailTarget;
    return (
      <ScheduleDetailPage
        detail={latestDetail}
        workspaceName={
          workspaces.find((item) => item.id === latestDetail.aggregate.schedule.workspaceId)
            ?.name ?? '工作空间不可用'
        }
        onBack={() => setDetailTarget(undefined)}
        onEdit={() => setEditorTarget({ kind: 'edit', detail: latestDetail })}
        onOpenTask={onOpenTask}
        onOpenArtifactVersion={onOpenArtifactVersion}
        onOpenSource={onOpenSource}
        onScheduleChanged={state.refresh}
      />
    );
  }

  if (editorTarget) {
    const detail = editorTarget.kind === 'edit' ? editorTarget.detail : undefined;
    return (
      <>
        <ScheduleEditor
          key={detail?.aggregate.schedule.id ?? 'create'}
          {...(detail ? { detail } : {})}
          experts={experts}
          expertsLoading={expertsLoading}
          expertsError={expertsError}
          workspaces={workspaces}
          getExpert={getExpert}
          onClose={() => setEditorTarget(undefined)}
          onSaved={(lifecycle) => {
            setEditorTarget(undefined);
            setSavedMessage(
              lifecycle === 'enabled' ? '定时任务已保存并启用。' : '定时任务已保存并暂停。',
            );
            state.refresh();
          }}
        />
        {savedMessage && (
          <TransientToast
            tone="success"
            message={savedMessage}
            onDismiss={() => setSavedMessage('')}
          />
        )}
      </>
    );
  }

  return (
    <section className="schedules-page">
      <PageHeader
        eyebrow="定时任务"
        title="按约定时间开始工作"
        actions={
          <>
            <Button
              variant="secondary"
              size="lg"
              type="button"
              disabled={state.refreshing}
              onClick={state.refresh}
            >
              刷新
            </Button>
            <Button
              variant="primary"
              size="lg"
              type="button"
              onClick={() => setEditorTarget({ kind: 'create' })}
            >
              新建定时任务
            </Button>
          </>
        }
      />
      {state.refreshError && (
        <InlineError
          className="schedules-refresh-error"
          message={state.refreshError}
          onRetry={state.refresh}
        />
      )}
      <ScrollRegion ariaLabel="定时任务列表" busy={state.loading || state.refreshing}>
        <div className="page-body schedules-body">
          <PageToolbar ariaLabel="定时任务筛选">
            <FieldSelect
              options={options}
              value={workspaceId}
              onChange={setWorkspaceId}
              ariaLabel="按工作空间筛选"
              size="md"
            />
          </PageToolbar>
          <ViewContainer mode="list" className="schedule-rows">
            {state.loading && state.details.length === 0 ? (
              <LoadingPage label="正在读取定时任务…" />
            ) : state.error && state.details.length === 0 ? (
              <ErrorPage
                title="暂时无法读取定时任务"
                detail={state.error}
                onRetry={state.refresh}
              />
            ) : state.details.length === 0 ? (
              <EmptyPage
                eyebrow="定时任务"
                title="尚无定时任务"
                detail="选择已有专家、持续工作空间与周期，逐期查看工作结果。"
              />
            ) : visibleDetails.length === 0 ? (
              <EmptyNotice
                title="这个工作空间下没有定时任务"
                detail="更换工作空间筛选，或选择「全部工作空间」查看其他规则。"
              />
            ) : (
              visibleDetails.map((detail) => (
                <ScheduleListRow
                  key={detail.aggregate.schedule.id}
                  detail={detail}
                  onEdit={() => setEditorTarget({ kind: 'edit', detail })}
                  onOpenDetail={() => setDetailTarget(detail)}
                  onReviewVersion={(versionId) => {
                    setOpenError('');
                    reportAction(
                      onOpenArtifactVersion(versionId),
                      setOpenError,
                      '无法打开本期成果版本。',
                    );
                  }}
                  workspaceName={
                    workspaces.find((item) => item.id === detail.aggregate.schedule.workspaceId)
                      ?.name ?? '工作空间不可用'
                  }
                />
              ))
            )}
          </ViewContainer>
        </div>
      </ScrollRegion>
      {savedMessage && (
        <TransientToast
          tone="success"
          message={savedMessage}
          onDismiss={() => setSavedMessage('')}
        />
      )}
      {openError && (
        <TransientToast tone="error" message={openError} onDismiss={() => setOpenError('')} />
      )}
    </section>
  );
}
