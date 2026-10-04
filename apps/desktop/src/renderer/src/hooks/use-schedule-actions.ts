import type {
  ScheduleCallResult,
  ScheduleConfigDraft,
  ScheduleDetail,
  ScheduleLifecycle,
  ScheduleOutputReceipt,
  SchedulePreflightView,
} from '@betterwork/agent-protocol';
import { useCallback, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export type ScheduleActionKind =
  | 'execute-now'
  | 'execute-missed'
  | 'stop-occurrence'
  | 'pause'
  | 'enable'
  | 'archive'
  | 'retry-output'
  | 'apply-expert-revision';

interface ScheduleActionCompletion {
  message?: string;
  occurrenceId?: string;
}

export interface ScheduleActionsState {
  busyAction?: ScheduleActionKind;
  error: string;
  toast: string;
  dismissToast: () => void;
  preflightDraft: (
    workspaceId: string,
    config: ScheduleConfigDraft,
  ) => Promise<ScheduleCallResult<SchedulePreflightView>>;
  executeNow: () => void;
  executeMissed: (occurrenceId: string) => void;
  stopOccurrence: (occurrenceId: string) => void;
  setLifecycle: (lifecycle: Extract<ScheduleLifecycle, 'enabled' | 'paused' | 'archived'>) => void;
  retryOutput: (receipt: ScheduleOutputReceipt) => void;
  applyExpertRevision: (revisionId: string, preflightFingerprint?: string) => void;
}

export function useScheduleActions({
  detail,
  onChanged,
  onOccurrenceSelected,
}: {
  detail: ScheduleDetail;
  onChanged: () => void;
  onOccurrenceSelected: (occurrenceId: string) => void;
}): ScheduleActionsState {
  const [busyAction, setBusyAction] = useState<ScheduleActionKind>();
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const busyRef = useRef(false);
  const scheduleId = detail.aggregate.schedule.id;
  const scheduleRevision = detail.aggregate.schedule.revision;

  const runAction = useCallback(
    (
      action: ScheduleActionKind,
      label: string,
      execute: () => Promise<ScheduleActionCompletion>,
    ): void => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusyAction(action);
      setError('');
      setToast('');

      const run = async (): Promise<void> => {
        try {
          const completion = await execute();
          if (completion.occurrenceId) onOccurrenceSelected(completion.occurrenceId);
          if (completion.message) setToast(completion.message);
          onChanged();
        } catch (caughtError) {
          setError(describeActionError(caughtError, '定时任务操作失败，请重试。'));
        } finally {
          busyRef.current = false;
          setBusyAction(undefined);
        }
      };
      trackAction(run(), label);
    },
    [onChanged, onOccurrenceSelected],
  );

  const readPreflight = useCallback(
    async (actionLabel: string): Promise<string> => {
      const response = await window.betterwork.schedules.preflight({
        target: 'schedule',
        scheduleId,
      });
      if (response.status === 'rejected') throw new Error(response.error.message);
      if (response.data.status === 'blocked') {
        const problem = response.data.problems.map((item) => item.message).join('；');
        throw new Error(
          problem
            ? `${actionLabel}预检未通过：${problem}`
            : `${actionLabel}预检未通过，请检查专家和能力配置。`,
        );
      }
      return response.data.fingerprint;
    },
    [scheduleId],
  );

  const preflightDraft = useCallback(
    (
      workspaceId: string,
      config: ScheduleConfigDraft,
    ): Promise<ScheduleCallResult<SchedulePreflightView>> =>
      window.betterwork.schedules.preflight({ target: 'draft', workspaceId, config }),
    [],
  );

  const executeNow = useCallback((): void => {
    runAction('execute-now', '立即执行定时任务', async () => {
      const preflightFingerprint = await readPreflight('立即执行');
      const response = await window.betterwork.schedules.executeNow({
        scheduleId,
        expectedRevision: scheduleRevision,
        requestKey: window.crypto.randomUUID(),
        preflightFingerprint,
      });
      if (response.status === 'rejected') {
        if (response.error.existingOccurrenceId) {
          return {
            occurrenceId: response.error.existingOccurrenceId,
            message: '这条规则已有进行中的实例，已打开该期；没有创建第二期。',
          };
        }
        throw new Error(response.error.message);
      }
      return {
        occurrenceId: response.data.occurrence.id,
        message: response.data.duplicate
          ? '重复请求已复用原有期次。'
          : '已创建立即执行期次；准备状态与结果会留在执行历史。',
      };
    });
  }, [readPreflight, runAction, scheduleId, scheduleRevision]);

  const executeMissed = useCallback(
    (occurrenceId: string): void => {
      runAction('execute-missed', '人工补做错过的定时期间', async () => {
        const preflightFingerprint = await readPreflight('人工补做');
        const response = await window.betterwork.schedules.executeMissed({
          scheduleId,
          originalOccurrenceId: occurrenceId,
          expectedRevision: scheduleRevision,
          requestKey: window.crypto.randomUUID(),
          preflightFingerprint,
        });
        if (response.status === 'rejected') {
          if (response.error.existingOccurrenceId) {
            return {
              occurrenceId: response.error.existingOccurrenceId,
              message: '这条规则已有进行中的实例，已打开该期；没有创建第二期。',
            };
          }
          throw new Error(response.error.message);
        }
        return {
          occurrenceId: response.data.occurrence.id,
          message: response.data.duplicate
            ? '重复请求已复用原有补做期次。'
            : '已创建关联原错过期间的补做期次；原错过记录仍保留。',
        };
      });
    },
    [readPreflight, runAction, scheduleId, scheduleRevision],
  );

  const stopOccurrence = useCallback(
    (occurrenceId: string): void => {
      runAction('stop-occurrence', '停止定时任务本期', async () => {
        const response = await window.betterwork.schedules.cancelOccurrence({ occurrenceId });
        if (response.status === 'rejected') throw new Error(response.error.message);
        const messageByResult: Record<typeof response.data.result, string> = {
          'cancelled-preparation': '本期准备已停止；没有启动 Run。',
          'cancel-requested': '已请求停止本期 Run；执行终态会更新在历史记录中。',
          'already-terminal': '本期已经结束，历史结果保持原样。',
          'not-found': '本期实例已不存在，请刷新历史。',
        };
        if (response.data.result === 'not-found') throw new Error(messageByResult['not-found']);
        return { message: messageByResult[response.data.result] };
      });
    },
    [runAction],
  );

  const setLifecycle = useCallback(
    (lifecycle: Extract<ScheduleLifecycle, 'enabled' | 'paused' | 'archived'>): void => {
      const action: ScheduleActionKind =
        lifecycle === 'enabled' ? 'enable' : lifecycle === 'paused' ? 'pause' : 'archive';
      runAction(action, `${lifecycle} 定时任务`, async () => {
        const preflightFingerprint =
          lifecycle === 'enabled' ? await readPreflight('启用') : undefined;
        const response = await window.betterwork.schedules.setLifecycle({
          scheduleId,
          expectedRevision: scheduleRevision,
          lifecycle,
          ...(preflightFingerprint ? { preflightFingerprint } : {}),
        });
        if (response.status === 'rejected') throw new Error(response.error.message);
        const message =
          lifecycle === 'enabled'
            ? '定时任务已启用；只在 BetterWork 本地进程运行时派发，错过不会补跑。'
            : lifecycle === 'paused'
              ? '规则已暂停；只影响后续自动触发，正在运行的本期需单独停止。'
              : '规则已归档；不会再自动触发，历史与已保存成果仍保留。';
        return { message };
      });
    },
    [readPreflight, runAction, scheduleId, scheduleRevision],
  );

  const retryOutput = useCallback(
    (receipt: ScheduleOutputReceipt): void => {
      runAction('retry-output', '重试保存定时成果', async () => {
        const response = await window.betterwork.schedules.retryOutput({
          receiptId: receipt.id,
          expectedAttempt: receipt.attempt,
        });
        if (response.status === 'rejected') throw new Error(response.error.message);
        return { message: '已重试保存原成果版本；没有重新调用模型。' };
      });
    },
    [runAction],
  );

  const applyExpertRevision = useCallback(
    (revisionId: string, preflightFingerprint?: string): void => {
      runAction('apply-expert-revision', '应用定时任务的专家修订', async () => {
        const response = await window.betterwork.schedules.applyExpertRevision({
          scheduleId,
          expectedRevision: scheduleRevision,
          expertRevisionId: revisionId,
          ...(preflightFingerprint ? { preflightFingerprint } : {}),
        });
        if (response.status === 'rejected') throw new Error(response.error.message);
        return {
          message: `已将后续期次的调用绑定更新到修订 ${detail.expertUpdate.currentRevision.revision}；专家定义和历史期次未更改。`,
        };
      });
    },
    [detail.expertUpdate.currentRevision.revision, runAction, scheduleId, scheduleRevision],
  );

  const dismissToast = useCallback((): void => setToast(''), []);

  return {
    ...(busyAction ? { busyAction } : {}),
    error,
    toast,
    dismissToast,
    preflightDraft,
    executeNow,
    executeMissed,
    stopOccurrence,
    setLifecycle,
    retryOutput,
    applyExpertRevision,
  };
}
