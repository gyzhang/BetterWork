import type {
  ArtifactType,
  ExpertRevision,
  ScheduleDetail as ScheduleDetailModel,
  ScheduleOccurrenceDetail,
} from '@betterwork/agent-protocol';
import { useEffect, useRef, useState } from 'react';

import { ActionBar } from '../../components/ActionBar';
import { AsyncButton } from '../../components/AsyncButton';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { Disclosure } from '../../components/Disclosure';
import { EmptyNotice } from '../../components/EmptyState';
import { InlineError } from '../../components/InlineError';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScrollRegion } from '../../components/layout/ScrollRegion';
import { ListRow } from '../../components/ListRow';
import { Modal } from '../../components/Modal';
import { RunSummaryRow } from '../../components/RunSummaryRow';
import { SectionHeader } from '../../components/SectionHeader';
import { SourceRow } from '../../components/SourceRow';
import { StatusNote } from '../../components/StatusNote';
import { TransientToast } from '../../components/TransientToast';
import { useScheduleActions } from '../../hooks/use-schedule-actions';
import { useScheduleDetail } from '../../hooks/use-schedule-detail';
import { reportAction } from '../../lib/async-action';
import { materialPurposeName } from '../../lib/labels';
import {
  scheduleArtifactTypeLabel,
  scheduleOccurrenceHistoryLabel,
  scheduleOccurrenceNextStep,
  scheduleOccurrenceNoRunMessage,
  scheduleOutputReceiptLabel,
  scheduleSourceOriginLabel,
  scheduleSourceSnapshotStatusLabel,
} from '../../lib/schedule-detail';
import {
  scheduleConfigDraftForExpertRevision,
  scheduleExpertRevisionChanges,
} from '../../lib/schedule-expert-diff';
import {
  lifecycleLabel,
  lifecycleTone,
  occurrenceResultLabel,
  occurrenceResultTone,
  periodRuleLabel,
  scheduleTimingLabel,
} from '../../lib/schedules';

const requiredArtifactTypes = (types: readonly ArtifactType[]): string =>
  types.map(scheduleArtifactTypeLabel).join('、');

type ActionDialog =
  | 'enable'
  | 'execute-now'
  | { kind: 'execute-missed'; occurrenceId: string }
  | 'archive'
  | { kind: 'stop'; occurrenceId: string }
  | undefined;

type ExpertPreflight =
  | { state: 'loading' }
  | { state: 'ready'; fingerprint: string }
  | { state: 'blocked'; problems: string[] }
  | { state: 'error'; message: string };

export function ScheduleDetailPage({
  detail,
  workspaceName,
  onBack,
  onEdit,
  onOpenTask,
  onOpenArtifactVersion,
  onOpenSource,
  onScheduleChanged,
}: {
  detail: ScheduleDetailModel;
  workspaceName: string;
  onBack: () => void;
  onEdit: () => void;
  onOpenTask: (taskId: string, continuation?: ScheduleOccurrenceDetail) => Promise<void>;
  onOpenArtifactVersion: (versionId: string) => Promise<void>;
  onOpenSource: (sourceUri: string) => Promise<void>;
  onScheduleChanged: () => void;
}): React.JSX.Element {
  const state = useScheduleDetail(detail);
  const actions = useScheduleActions({
    detail,
    onChanged: onScheduleChanged,
    onOccurrenceSelected: state.selectOccurrence,
  });
  const { preflightDraft } = actions;
  const [detailActionError, setDetailActionError] = useState('');
  const [actionDialog, setActionDialog] = useState<ActionDialog>();
  const [expertTarget, setExpertTarget] = useState<ExpertRevision>();
  const [expertPreflight, setExpertPreflight] = useState<ExpertPreflight>();
  const [expertPreflightRetry, setExpertPreflightRetry] = useState(0);
  const expertPreflightRequestId = useRef(0);
  const current = state.occurrence;
  const currentHistory = current
    ? {
        occurrence: current.occurrence,
        result: current.result,
        ...(current.run ? { run: current.run } : {}),
      }
    : undefined;
  const config = detail.aggregate.config;
  const schedule = detail.aggregate.schedule;
  const currentTaskId = current?.task?.id;
  const isBusy = actions.busyAction !== undefined;
  const expertChanges = expertTarget
    ? scheduleExpertRevisionChanges(detail.expertUpdate.boundRevision, expertTarget)
    : [];

  useEffect(() => {
    if (actionDialog && actions.toast) setActionDialog(undefined);
  }, [actionDialog, actions.toast]);

  useEffect(() => {
    if (
      expertTarget &&
      detail.aggregate.config.expertRevisionId === expertTarget.id &&
      !detail.expertUpdate.available
    ) {
      setExpertTarget(undefined);
      setExpertPreflight(undefined);
    }
  }, [detail.aggregate.config.expertRevisionId, detail.expertUpdate.available, expertTarget]);

  useEffect(() => {
    if (!expertTarget) return;
    const requestId = expertPreflightRequestId.current + 1;
    expertPreflightRequestId.current = requestId;
    setExpertPreflight({ state: 'loading' });
    const request = preflightDraft(
      schedule.workspaceId,
      scheduleConfigDraftForExpertRevision(config, expertTarget.id),
    );
    request
      .then((response) => {
        if (expertPreflightRequestId.current !== requestId) return;
        if (response.status === 'rejected') {
          setExpertPreflight({ state: 'error', message: response.error.message });
          return;
        }
        if (response.data.status === 'blocked') {
          setExpertPreflight({
            state: 'blocked',
            problems: response.data.problems.map((problem) => problem.message),
          });
          return;
        }
        setExpertPreflight({ state: 'ready', fingerprint: response.data.fingerprint });
      })
      .catch((caughtError: unknown) => {
        if (expertPreflightRequestId.current === requestId) {
          setExpertPreflight({
            state: 'error',
            message:
              caughtError instanceof Error ? caughtError.message : '专家修订检查失败，请重试。',
          });
        }
      });
    return () => {
      expertPreflightRequestId.current += 1;
    };
  }, [config, expertPreflightRetry, expertTarget, preflightDraft, schedule.workspaceId]);

  const openExpertUpdate = (): void => {
    setExpertTarget(detail.expertUpdate.currentRevision);
    setExpertPreflight(undefined);
  };

  const confirmAction = (): void => {
    if (!actionDialog) return;
    if (actionDialog === 'enable') {
      actions.setLifecycle('enabled');
      return;
    }
    if (actionDialog === 'execute-now') {
      actions.executeNow();
      return;
    }
    if (actionDialog === 'archive') {
      setActionDialog(undefined);
      actions.setLifecycle('archived');
      return;
    }
    if (typeof actionDialog === 'object' && actionDialog.kind === 'execute-missed') {
      actions.executeMissed(actionDialog.occurrenceId);
      return;
    }
    if (actionDialog.kind === 'stop') {
      setActionDialog(undefined);
      actions.stopOccurrence(actionDialog.occurrenceId);
    }
  };

  return (
    <section className="schedules-page schedule-detail-page">
      <PageHeader
        eyebrow="定时任务 · 规则详情"
        title={config.name}
        leading={
          <Button variant="link" size="sm" type="button" onClick={onBack}>
            返回列表
          </Button>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="lg"
              type="button"
              disabled={state.occurrenceLoading || !state.selectedOccurrenceId}
              onClick={state.refreshOccurrence}
            >
              刷新本期
            </Button>
            <Button
              variant="secondary"
              size="lg"
              type="button"
              disabled={schedule.lifecycle === 'archived'}
              onClick={onEdit}
            >
              编辑规则
            </Button>
            <Badge tone={lifecycleTone(schedule.lifecycle)}>
              {lifecycleLabel(schedule.lifecycle)}
            </Badge>
          </>
        }
      />
      <ScrollRegion ariaLabel="定时任务详情" busy={state.occurrenceLoading}>
        <div className="page-body schedules-body schedule-detail-body">
          <section className="schedule-detail-section">
            <SectionHeader
              variant="block"
              title="规则"
              hint={`工作空间：${workspaceName} · 固定专家修订：${detail.expertUpdate.boundRevision.name} · ${scheduleTimingLabel(config.timing)} · 统计期间：${periodRuleLabel(config.periodRule)}`}
              actions={
                detail.expertUpdate.available ? (
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    disabled={schedule.lifecycle === 'archived' || isBusy}
                    onClick={openExpertUpdate}
                  >
                    查看专家修订 v{detail.expertUpdate.currentRevision.revision}
                  </Button>
                ) : undefined
              }
            />
            <ListRow
              as="article"
              title="每期工作要求"
              detail={config.requirements}
              meta={`配置版本 v${config.version} · 本期预期成果：${requiredArtifactTypes(config.expectedArtifactTypes)}`}
              multiline
            />
            {schedule.dispatchBlock && (
              <StatusNote tone="warning" message={schedule.dispatchBlock.message} />
            )}
            <SectionHeader
              variant="panel"
              title="规则动作"
              hint="暂停只影响后续自动触发；停止本期只影响选中的运行或准备，不会暂停规则。"
            />
            <ActionBar
              as="div"
              label="定时任务规则动作"
              hint="立即执行和补做会新建独立 Task/Session；不会覆盖原期记录。"
            >
              {schedule.lifecycle !== 'archived' && (
                <>
                  <AsyncButton
                    label="立即执行"
                    busyLabel="正在请求…"
                    size="md"
                    variant="secondary"
                    busy={actions.busyAction === 'execute-now'}
                    disabled={isBusy}
                    onClick={() => setActionDialog('execute-now')}
                  />
                  {schedule.lifecycle === 'enabled' ? (
                    <AsyncButton
                      label="暂停规则"
                      busyLabel="正在暂停…"
                      size="md"
                      variant="secondary"
                      busy={actions.busyAction === 'pause'}
                      disabled={isBusy}
                      onClick={() => actions.setLifecycle('paused')}
                    />
                  ) : (
                    <Button
                      variant="primary"
                      size="md"
                      type="button"
                      disabled={isBusy}
                      onClick={() => setActionDialog('enable')}
                    >
                      启用规则
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="md"
                    type="button"
                    disabled={isBusy}
                    onClick={() => setActionDialog('archive')}
                  >
                    归档规则
                  </Button>
                </>
              )}
              {current?.result.status === 'missed' && schedule.lifecycle !== 'archived' && (
                <Button
                  variant="secondary"
                  size="md"
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    setActionDialog({ kind: 'execute-missed', occurrenceId: current.occurrence.id })
                  }
                >
                  人工补做此期间
                </Button>
              )}
              {(current?.result.status === 'preparing' || current?.result.status === 'running') && (
                <Button
                  variant="danger"
                  size="md"
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    setActionDialog({ kind: 'stop', occurrenceId: current.occurrence.id })
                  }
                >
                  停止本期
                </Button>
              )}
            </ActionBar>
            {actions.error && !expertTarget && !actionDialog && (
              <InlineError message={actions.error} />
            )}
          </section>

          <section className="schedule-detail-section">
            <SectionHeader
              variant="block"
              title={`执行历史 · ${state.historyItems.length} 期`}
              hint="选择某一期可查看当时的固定期间、配置、来源快照、运行证据和成果回执。"
            />
            {state.historyItems.length === 0 ? (
              <EmptyNotice
                title="尚无执行历史"
                detail="首次到期或人工执行后，这里会保留每期事实。"
              />
            ) : (
              <div className="schedule-detail-history">
                {state.historyItems.map((item) => (
                  <ListRow
                    key={item.occurrence.id}
                    variant="plain"
                    title={scheduleOccurrenceHistoryLabel(item)}
                    meta={occurrenceResultLabel(item.result.status)}
                    selected={item.occurrence.id === state.selectedOccurrenceId}
                    label={`查看${scheduleOccurrenceHistoryLabel(item)}，${occurrenceResultLabel(item.result.status)}`}
                    onClick={() => state.selectOccurrence(item.occurrence.id)}
                  />
                ))}
              </div>
            )}
            {state.historyError && (
              <InlineError message={state.historyError} onRetry={state.loadMoreHistory} />
            )}
            {state.historyCursor && (
              <Button
                variant="secondary"
                size="md"
                type="button"
                disabled={state.historyLoading}
                onClick={state.loadMoreHistory}
              >
                {state.historyLoading ? '正在读取…' : '读取更早历史'}
              </Button>
            )}
          </section>

          <section className="schedule-detail-section">
            <SectionHeader variant="block" title="本期事实与结果" />
            {state.occurrenceError ? (
              current ? null : (
                <InlineError message={state.occurrenceError} onRetry={state.refreshOccurrence} />
              )
            ) : !current ? (
              <StatusNote message="正在读取所选期间的固定配置与结果…" />
            ) : undefined}
            {!current ? null : (
              <>
                {state.occurrenceError && (
                  <InlineError message={state.occurrenceError} onRetry={state.refreshOccurrence} />
                )}
                {detailActionError && (
                  <InlineError
                    message={detailActionError}
                    onDismiss={() => setDetailActionError('')}
                  />
                )}
                <StatusNote
                  tone={occurrenceResultTone(current.result.status)}
                  message={`${current.occurrence.period.label} · 配置版本 v${current.config.version} · ${occurrenceResultLabel(current.result.status)}`}
                />
                {current.result.reasonDetail && (
                  <InlineError tone="warning" message={current.result.reasonDetail} />
                )}
                {currentHistory && !current.run && (
                  <StatusNote
                    tone={current.result.status === 'failed' ? 'danger' : 'neutral'}
                    message={scheduleOccurrenceNoRunMessage(currentHistory)}
                  />
                )}
                <ListRow
                  as="article"
                  title="本期固定配置"
                  detail={current.config.requirements}
                  meta={`规则「${current.config.name}」 · 要求成果：${requiredArtifactTypes(current.config.expectedArtifactTypes)} · 时区 ${current.config.timing.timeZone}`}
                  multiline
                />
                <StatusNote
                  message={`下一步：${scheduleOccurrenceNextStep(current.result.status, current.task !== undefined, current.outputReceipts.length > 0)}`}
                />
                {current.task && currentTaskId && !current.run && (
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    onClick={() =>
                      reportAction(
                        onOpenTask(currentTaskId, current),
                        setDetailActionError,
                        '无法打开本期原 Task。',
                      )
                    }
                  >
                    打开本期原 Task「{current.task.title}」
                  </Button>
                )}
                {current.run && current.task && currentTaskId && (
                  <RunSummaryRow
                    run={current.run}
                    title={current.task.title}
                    action="打开原 Task"
                    onSelect={() =>
                      reportAction(
                        onOpenTask(currentTaskId, current),
                        setDetailActionError,
                        '无法打开本期原 Task。',
                      )
                    }
                  />
                )}

                <Disclosure label={`来源快照 · ${state.sourceItems.length} 项候选材料`} defaultOpen>
                  {current.sourceSnapshot && (
                    <StatusNote
                      message={`快照 ${current.sourceSnapshot.id} · ${scheduleSourceSnapshotStatusLabel(current.sourceSnapshot.status)} · ${current.sourceSnapshot.itemCount} 项 · ${current.sourceSnapshot.totalFileBytes} 字节`}
                    />
                  )}
                  {state.sourceError && (
                    <InlineError message={state.sourceError} onRetry={state.refreshSources} />
                  )}
                  {state.sourceItems.length === 0 ? (
                    <EmptyNotice
                      title={state.sourceLoading ? '正在读取来源快照…' : '本期没有候选来源材料'}
                      detail="候选材料范围只描述本期准备时固定的授权输入，不等同于 Run 实际读取。"
                    />
                  ) : (
                    state.sourceItems.map((item) => (
                      <ListRow
                        key={`${item.snapshotId}:${item.ordinal}:${item.reference.kind}`}
                        as="article"
                        title={item.displayName}
                        detail={`${materialPurposeName[item.purpose]} · ${scheduleSourceOriginLabel(item.origin)}`}
                        meta={`快照顺位 ${item.ordinal + 1}`}
                        multiline
                      />
                    ))
                  )}
                </Disclosure>

                <Disclosure label={`Run 实际读取证据 · ${state.evidence.length} 条`}>
                  <StatusNote
                    message={`读取材料计数 ${current.readMaterialCount} · 采用材料计数 ${current.adoptedMaterialCount}。两者是不同事实；候选来源清单不计入实际读取。`}
                  />
                  {state.evidenceError && (
                    <InlineError message={state.evidenceError} onRetry={state.refreshEvidence} />
                  )}
                  {state.evidence.length === 0 ? (
                    <EmptyNotice
                      title={
                        state.evidenceLoading ? '正在读取 Run 证据…' : '本期没有已登记的读取证据'
                      }
                      detail="只显示与本期首个 Run 关联的 Evidence。"
                    />
                  ) : (
                    state.evidence.map((item) => (
                      <SourceRow
                        key={item.id}
                        item={item}
                        onOpenSource={() =>
                          reportAction(
                            onOpenSource(item.sourceUri),
                            setDetailActionError,
                            '无法打开本期来源。',
                          )
                        }
                      />
                    ))
                  )}
                </Disclosure>

                <Disclosure
                  label={`成果版本与目录保存 · ${current.outputReceipts.length} 项回执`}
                  defaultOpen
                >
                  {current.outputReceipts.length === 0 ? (
                    <EmptyNotice
                      title="本期还没有成果回执"
                      detail="只有本期真实登记的成果版本会出现在这里。"
                    />
                  ) : (
                    current.outputReceipts.map((receipt) => (
                      <ListRow
                        key={receipt.id}
                        as="article"
                        title={`${receipt.relativePath} · ${scheduleOutputReceiptLabel(receipt.status)}`}
                        detail={`固定成果版本 ${receipt.artifactVersionId} · 第 ${receipt.attempt} 次保存`}
                        meta={receipt.failureDetail ?? `SHA-256 ${receipt.contentHash}`}
                        actions={
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              type="button"
                              onClick={() =>
                                reportAction(
                                  onOpenArtifactVersion(receipt.artifactVersionId),
                                  setDetailActionError,
                                  '无法打开此成果版本。',
                                )
                              }
                            >
                              打开此成果版本
                            </Button>
                            {receipt.status === 'failed' && (
                              <AsyncButton
                                label="重试保存"
                                busyLabel="正在保存…"
                                size="sm"
                                variant="secondary"
                                busy={actions.busyAction === 'retry-output'}
                                disabled={isBusy}
                                onClick={() => actions.retryOutput(receipt)}
                              />
                            )}
                          </>
                        }
                        multiline
                      />
                    ))
                  )}
                  {current.result.missingArtifactTypes &&
                    current.result.missingArtifactTypes.length > 0 && (
                      <StatusNote
                        tone="warning"
                        message={`缺少约定成果：${requiredArtifactTypes(current.result.missingArtifactTypes)}`}
                      />
                    )}
                </Disclosure>
              </>
            )}
          </section>
        </div>
      </ScrollRegion>
      {actions.toast && (
        <TransientToast tone="success" message={actions.toast} onDismiss={actions.dismissToast} />
      )}
      {actionDialog === 'enable' ||
      actionDialog === 'execute-now' ||
      (typeof actionDialog === 'object' && actionDialog.kind === 'execute-missed') ? (
        <Modal
          variant="dialog"
          label={
            actionDialog === 'enable'
              ? '启用定时任务'
              : actionDialog === 'execute-now'
                ? '立即执行定时任务'
                : '人工补做错过期间'
          }
          onClose={() => setActionDialog(undefined)}
        >
          <SectionHeader
            variant="block"
            eyebrow="定时任务"
            title={
              actionDialog === 'enable'
                ? '启用后按计划派发'
                : actionDialog === 'execute-now'
                  ? '创建立即执行期次'
                  : '补做原错过期间'
            }
          />
          <StatusNote
            tone="warning"
            message={
              actionDialog === 'enable'
                ? '只在 BetterWork 本地进程运行时派发；休眠或进程关闭期间错过不会补跑。会调用已配置的模型与能力，可能产生费用；每期结果和成果仍需你审阅。启用检查会在确认后运行。'
                : actionDialog === 'execute-now'
                  ? '按当前规则、固定专家修订与当前可用来源建立新 Task/Session；本期统计期间以确认时刻计算，不改变下一次正常计划。若规则已有进行中的期次，将打开原期，不会再建一份。'
                  : `原期间：${current?.occurrence.period.label ?? '历史期间'}。将按当前规则与专家绑定重新准备当前可用材料，创建新的人工补做期次；原错过记录与当时来源事实保留，不承诺重建已经变化或丢失的资料。`
            }
          />
          {actions.error && <InlineError message={actions.error} />}
          <ActionBar as="div" label="确认定时任务动作">
            <Button
              variant="secondary"
              size="md"
              type="button"
              disabled={isBusy}
              onClick={() => setActionDialog(undefined)}
            >
              返回
            </Button>
            <AsyncButton
              label={
                actionDialog === 'enable'
                  ? '确认启用'
                  : actionDialog === 'execute-now'
                    ? '创建立即执行期次'
                    : '创建补做期次'
              }
              busyLabel="正在检查并提交…"
              size="md"
              variant="primary"
              busy={isBusy}
              disabled={isBusy}
              onClick={confirmAction}
            />
          </ActionBar>
        </Modal>
      ) : actionDialog === 'archive' ? (
        <ConfirmationDialog
          title="归档这条定时规则？"
          detail={
            actions.error
              ? `归档只停止后续自动触发；历史和已保存成果继续保留。${actions.error}`
              : '归档后不再自动触发；已有历史、Task、ArtifactVersion 和保存副本继续保留。正在运行的 Run 不等于暂停或删除历史。'
          }
          confirmLabel="归档规则"
          onConfirm={confirmAction}
          onCancel={() => setActionDialog(undefined)}
        />
      ) : actionDialog && typeof actionDialog === 'object' && actionDialog.kind === 'stop' ? (
        <ConfirmationDialog
          title="停止选中的本期？"
          detail={
            actions.error
              ? `这只影响所选实例，不会暂停规则。${actions.error}`
              : '这只影响选中的准备或 Run，不会暂停规则；已经登记的部分成果和历史继续保留。'
          }
          confirmLabel="停止本期"
          onConfirm={confirmAction}
          onCancel={() => setActionDialog(undefined)}
        />
      ) : undefined}
      {expertTarget && (
        <Modal
          variant="dialog"
          label={`专家修订差异 v${detail.expertUpdate.boundRevision.revision} 至 v${expertTarget.revision}`}
          onClose={() => {
            setExpertTarget(undefined);
            setExpertPreflight(undefined);
          }}
        >
          <SectionHeader
            variant="block"
            eyebrow="只读比较"
            title={`${detail.expertUpdate.boundRevision.name} · v${detail.expertUpdate.boundRevision.revision} → v${expertTarget.revision}`}
            hint="只更新这条定时规则后续期次的调用绑定，不会编辑专家定义，也不会热换历史期或已运行的实例。"
          />
          {expertChanges.length === 0 ? (
            <EmptyNotice
              title="可见定义字段没有变化"
              detail="修订号仍不同；应用目标固定为当前展示的这一版。"
            />
          ) : (
            <Disclosure label={`修订差异 · ${expertChanges.length} 项`} defaultOpen>
              {expertChanges.map((item) => (
                <ListRow
                  key={item.key}
                  as="article"
                  title={item.label}
                  detail={`旧版：${item.before}`}
                  meta={`新版：${item.after}`}
                  multiline
                />
              ))}
            </Disclosure>
          )}
          {expertPreflight?.state === 'loading' && <StatusNote message="正在检查新修订及其能力…" />}
          {expertPreflight?.state === 'ready' && (
            <StatusNote tone="success" message="新修订通过当前能力与材料预检。" />
          )}
          {expertPreflight?.state === 'blocked' && (
            <InlineError
              tone="warning"
              message="当前新修订存在失效或不可用项；先处理以下问题，再应用这版绑定。"
              problems={expertPreflight.problems}
            />
          )}
          {expertPreflight?.state === 'error' && (
            <InlineError
              message={expertPreflight.message}
              onRetry={() => setExpertPreflightRetry((attempt) => attempt + 1)}
            />
          )}
          {actions.error && <InlineError message={actions.error} />}
          <StatusNote
            message={`工作空间「${workspaceName}」与 ${config.knowledgeSources.length} 项规则附加知识会保留；运行中、准备中和历史期不会热换。`}
          />
          <ActionBar as="div" label="专家修订差异操作">
            <Button
              variant="secondary"
              size="md"
              type="button"
              disabled={isBusy}
              onClick={() => {
                setExpertTarget(undefined);
                setExpertPreflight(undefined);
              }}
            >
              取消
            </Button>
            <AsyncButton
              label={schedule.lifecycle === 'enabled' ? '应用并保持启用' : '应用并保持暂停'}
              busyLabel="正在应用修订…"
              size="md"
              variant="primary"
              busy={actions.busyAction === 'apply-expert-revision'}
              disabled={isBusy || expertPreflight?.state !== 'ready'}
              onClick={() => {
                if (expertPreflight?.state !== 'ready') return;
                actions.applyExpertRevision(
                  expertTarget.id,
                  schedule.lifecycle === 'enabled' ? expertPreflight.fingerprint : undefined,
                );
              }}
            />
          </ActionBar>
        </Modal>
      )}
    </section>
  );
}
