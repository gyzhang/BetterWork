import type {
  ListMemoryJobsRequest,
  MemoryJobSummary,
  MemoryViewItem,
  WorkspaceMemorySettings,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { trackAction } from '../lib/async-action';
import { isActiveMemoryJob } from '../lib/memory-labels';
import { settleMemoryCall } from '../lib/memory-result';
import { MEMORY_CONSENT_VERSION } from '../lib/memory-suggestions';
import type { TransientToastMessage } from './use-transient-toast';
import { useTransientToast } from './use-transient-toast';

/**
 * 自动建议的按空间开关、作业状态与候选批次（产品设计 §3.3）。
 *
 * 四条来自验收清单的行为：
 * 1. **同意版本**：开启必须带当前版本，关闭不回填旧任务、也不删已确认记忆；
 * 2. **可见才轮询**：面板不可见、或没有排队/执行中的作业时不计时；
 *    隐藏与卸载都会清掉定时器；
 * 3. **不接受迟到成功**：用户关开关或取消作业时代费递增，在途轮询结果一律作废；
 * 4. **不串空间**：所有状态都带 workspaceId 守卫，切换空间先清空再取数。
 *
 * 「0 条」是成功结果，与失败分别由 `jobOutcomeLabel` 呈现，不混成同一句话。
 *
 * 同意版本与文案只在 `lib/memory-suggestions.ts` 定义一处，界面与请求参数共用。
 */

export interface MemorySuggestionQuery {
  workspaceId: string | undefined;
  /** 面板是否可见：不可见时既不发请求也不轮询（§3.3）。 */
  visible: boolean;
  /** 有值时只看该任务的作业与候选；省略时看整个空间。 */
  taskId: string | undefined;
}

export interface MemorySuggestionsState {
  settings: WorkspaceMemorySettings | undefined;
  settingsLoading: boolean;
  settingsError: string;
  savingSettings: boolean;
  jobs: MemoryJobSummary[];
  jobsError: string;
  activeJob: MemoryJobSummary | undefined;
  candidates: MemoryViewItem[];
  candidatesError: string;
  loadingCandidates: boolean;
  polling: boolean;
  /** 本次开关失败或取消后需要用户看到的结果；短时确认走 TransientToast。 */
  toast: TransientToastMessage | undefined;
  dismissToast: () => void;
  setAutoSuggest: (enabled: boolean) => Promise<void>;
  cancelJob: (job: MemoryJobSummary) => Promise<void>;
  retryJob: (job: MemoryJobSummary) => Promise<void>;
  refresh: () => void;
}

export function useMemorySuggestions(query: MemorySuggestionQuery): MemorySuggestionsState {
  const { workspaceId, visible, taskId } = query;
  const [settings, setSettings] = useState<WorkspaceMemorySettings>();
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [jobs, setJobs] = useState<MemoryJobSummary[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [candidates, setCandidates] = useState<MemoryViewItem[]>([]);
  const [candidatesError, setCandidatesError] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [polling, setPolling] = useState(false);
  const { toast, showToast, dismissToast } = useTransientToast();
  // 一次「代」＝ 一次可见的作用域装载。用户改开关或取消作业都会换代，
  // 于是上一代的迟到响应不可能把已经作废的「成功」写回界面。
  const generation = useRef({ key: '', request: 0 });
  const scopeKey = `${workspaceId ?? '-'}|${taskId ?? '-'}`;

  const beginRequest = useCallback(
    (key: string): { requestId: number; requestKey: string } | undefined => {
      if (!visible || workspaceId === undefined) return undefined;
      generation.current.request += 1;
      generation.current.key = key;
      return { requestId: generation.current.request, requestKey: key };
    },
    [visible, workspaceId],
  );

  const isFresh = (guard: { requestId: number; requestKey: string } | undefined): boolean =>
    guard !== undefined &&
    generation.current.request === guard.requestId &&
    generation.current.key === guard.requestKey;

  const loadSettings = useCallback((): void => {
    if (!visible || workspaceId === undefined) return;
    const guard = beginRequest(scopeKey);
    if (!guard) return;
    setSettingsLoading(true);
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.getSettings({ workspaceId }),
        '读取记忆设置失败，请重试。',
      ).then((outcome) => {
        if (!isFresh(guard)) return;
        setSettingsLoading(false);
        if (outcome.ok) {
          setSettings(outcome.data);
          setSettingsError('');
        } else {
          setSettings(undefined);
          setSettingsError(outcome.message);
        }
      }),
      '读取空间记忆设置',
    );
  }, [beginRequest, scopeKey, visible, workspaceId]);

  const loadJobs = useCallback((): void => {
    if (!visible || workspaceId === undefined) return;
    const guard = beginRequest(scopeKey);
    if (!guard) return;
    const input: ListMemoryJobsRequest = {
      workspaceId,
      ...(taskId ? { taskId } : {}),
    };
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.listJobs(input),
        '读取提炼作业失败，请重试。',
      ).then((outcome) => {
        if (!isFresh(guard)) return;
        if (outcome.ok) {
          setJobs(outcome.data.items);
          setJobsError('');
        } else {
          setJobsError(outcome.message);
        }
      }),
      '读取记忆提炼作业',
    );
  }, [beginRequest, scopeKey, taskId, visible, workspaceId]);

  const loadCandidates = useCallback((): void => {
    if (!visible || workspaceId === undefined) return;
    const guard = beginRequest(scopeKey);
    if (!guard) return;
    setLoadingCandidates(true);
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.list({ workspaceId, statuses: ['candidate'] }),
        '读取经验建议失败，请重试。',
      ).then((outcome) => {
        if (!isFresh(guard)) return;
        setLoadingCandidates(false);
        if (outcome.ok) {
          setCandidates(outcome.data.items);
          setCandidatesError('');
        } else {
          setCandidates([]);
          setCandidatesError(outcome.message);
        }
      }),
      '读取经验建议候选',
    );
  }, [beginRequest, scopeKey, visible, workspaceId]);

  const refresh = useCallback((): void => {
    if (!visible || workspaceId === undefined) return;
    loadSettings();
    loadJobs();
    loadCandidates();
  }, [loadCandidates, loadJobs, loadSettings, visible, workspaceId]);

  useEffect(() => {
    // 换空间或换可见性：先清空，避免上一处的候选与设置留在屏幕上。
    generation.current = { key: '', request: generation.current.request + 1 };
    setSettings(undefined);
    setSettingsError('');
    setJobs([]);
    setJobsError('');
    setCandidates([]);
    setCandidatesError('');
    if (!visible || workspaceId === undefined) return;
    refresh();
  }, [refresh, scopeKey, visible, workspaceId]);

  const activeJob = jobs.find((job) => isActiveMemoryJob(job.status));
  // 轮询的存在与否只看「哪个作业处在哪个状态」。轮询会换掉 jobs 数组、
  // 从而换掉 activeJob 的对象身份；若以对象为依赖，定时器每轮都被重建，
  // 间隔抖动且难以判断是否真的停止。
  const activeJobKey = activeJob ? `${activeJob.id}:${activeJob.status}` : '';

  useEffect(() => {
    if (!visible || activeJobKey === '') {
      setPolling(false);
      return;
    }
    setPolling(true);
    const timer = window.setInterval(() => {
      loadJobs();
      loadCandidates();
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      setPolling(false);
    };
  }, [activeJobKey, loadCandidates, loadJobs, visible]);

  /** 提交开关：`expectedRevision` 用设置行的修订，开启必须带当前同意版本。 */
  const setAutoSuggest = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (workspaceId === undefined) return;
      setSavingSettings(true);
      setSettingsError('');
      const outcome = await settleMemoryCall(
        window.betterwork.memories.setSettings({
          operationId: crypto.randomUUID(),
          workspaceId,
          expectedRevision: settings?.revision ?? 0,
          autoSuggestEnabled: enabled,
          ...(enabled ? { consentVersion: MEMORY_CONSENT_VERSION } : {}),
        }),
        '更新自动建议开关失败，请重试。',
      );
      setSavingSettings(false);
      // 开关一变即作废上一代在途轮询：关闭后不得再把迟到的「成功」写回界面。
      generation.current = { key: '', request: generation.current.request + 1 };
      if (!enabled) {
        // 关闭只停止此后的自动提炼并取消本空间未完成作业：作业行立刻收回，
        // 已确认记忆与历史候选都不动（`memoryConsentOffNotice` 的承诺）。
        setJobs((current) => current.filter((job) => !isActiveMemoryJob(job.status)));
      }
      if (outcome.ok) {
        setSettings(outcome.data.receipt.currentSettings);
        setProjectionNotice(outcome.data.cancelledJobCount, enabled, showToast);
        loadJobs();
        loadSettings();
      } else {
        setSettingsError(outcome.message);
        showToast('error', outcome.message);
      }
    },
    [loadJobs, loadSettings, settings?.revision, showToast, workspaceId],
  );

  const actOnJob = useCallback(
    async (
      job: MemoryJobSummary,
      label: string,
      call: (
        operationId: string,
      ) => Promise<Awaited<ReturnType<(typeof window.betterwork)['memories']['retryJob']>>>,
    ): Promise<void> => {
      const operationId = crypto.randomUUID();
      generation.current = { key: '', request: generation.current.request + 1 };
      const outcome = await settleMemoryCall(call(operationId), `${label}失败，请重试。`);
      if (outcome.ok) showToast('success', `${label}已提交。`);
      else showToast('error', outcome.message);
      loadJobs();
      loadCandidates();
    },
    [loadCandidates, loadJobs, showToast],
  );

  const cancelJob = useCallback(
    (job: MemoryJobSummary): Promise<void> =>
      actOnJob(job, '取消提炼', (operationId) =>
        window.betterwork.memories.cancelJob({
          operationId,
          jobId: job.id,
          expectedRevision: job.revision,
        }),
      ),
    [actOnJob],
  );

  /** 手动重试只授权这一次调用，不改动自动开关（§3.3）。 */
  const retryJob = useCallback(
    (job: MemoryJobSummary): Promise<void> =>
      actOnJob(job, '重新提炼', (operationId) =>
        window.betterwork.memories.retryJob({
          operationId,
          jobId: job.id,
          expectedRevision: job.revision,
          consentVersion: MEMORY_CONSENT_VERSION,
        }),
      ),
    [actOnJob],
  );

  return {
    settings,
    settingsLoading,
    settingsError,
    savingSettings,
    jobs,
    jobsError,
    activeJob,
    candidates,
    candidatesError,
    loadingCandidates,
    polling,
    toast,
    dismissToast,
    setAutoSuggest,
    cancelJob,
    retryJob,
    refresh,
  };
}

function setProjectionNotice(
  cancelledJobCount: number,
  enabled: boolean,
  showToast: (tone: 'success' | 'error', message: string) => void,
): void {
  if (enabled) {
    showToast('success', '已开启自动建议：只处理此后完成的工作，不回填旧任务。');
    return;
  }
  showToast(
    'success',
    cancelledJobCount > 0
      ? `已关闭自动建议，并取消 ${cancelledJobCount} 项未完成的提炼；已确认记忆保留。`
      : '已关闭自动建议；已确认记忆保留。',
  );
}
