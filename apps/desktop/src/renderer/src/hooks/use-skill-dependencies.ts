import type {
  DependencyBaseChoice,
  DependencyOperation,
  DependencyOptions,
  DependencyPlan,
  RefreshSkillDependencyGrantResult,
  SkillDetail,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { reportAction, trackAction } from '../lib/async-action';

/**
 * Skill 依赖与环境准备（A12）。
 *
 * 状态按「当前 Skill + 当前请求代号」隔离：切换 Skill 时旧进度立刻清空，迟到的响应
 * 不会覆盖新选择（docs/12 §5）。准备是后台作业，界面每秒最多轮询一次阶段状态，
 * 不伪造百分比；关闭页面再回来时按环境键找回未完成的作业，进度可继续回看。
 */

const pollIntervalMs = 1_000;

export interface SkillDependenciesState {
  options: DependencyOptions | undefined;
  plan: DependencyPlan | undefined;
  operation: DependencyOperation | undefined;
  grant: RefreshSkillDependencyGrantResult | undefined;
  base: DependencyBaseChoice | undefined;
  lockId: string;
  snapshotId: string;
  loading: boolean;
  preparing: boolean;
  error: string;
  toast: string;
  selectManagedDistribution: (distributionId: string) => void;
  selectLock: (lockId: string) => void;
  selectSnapshot: (snapshotId: string) => void;
  chooseLocalInterpreter: () => void;
  registerToolchain: () => void;
  prepare: () => void;
  cancel: () => void;
  confirmGrant: () => void;
  dismissToast: () => void;
  clearError: () => void;
}

const isPending = (operation: DependencyOperation | undefined): boolean =>
  operation?.status === 'queued' || operation?.status === 'running';

export function useSkillDependencies(
  skill: SkillDetail | undefined,
  refreshSkills: () => void,
): SkillDependenciesState {
  const [options, setOptions] = useState<DependencyOptions>();
  const [plan, setPlan] = useState<DependencyPlan>();
  const [operation, setOperation] = useState<DependencyOperation>();
  const [grant, setGrant] = useState<RefreshSkillDependencyGrantResult>();
  const [base, setBase] = useState<DependencyBaseChoice>();
  const [lockId, setLockId] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const requestId = useRef(0);
  /** 重复点击只启动一个作业：in-flight 期间不再发起第二次准备。 */
  const prepareInFlight = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const skillId = skill?.id;

  const stopPolling = useCallback((): void => {
    const timer = pollTimer.current;
    if (timer) clearInterval(timer);
    pollTimer.current = undefined;
  }, []);

  const reviewGrant = useCallback(
    (
      currentSkillId: string,
      currentLockId: string,
      currentSnapshotId: string,
      token: number,
    ): void => {
      if (!currentLockId) return;
      trackAction(
        window.betterwork.skills
          .refreshDependencyGrant({
            skillId: currentSkillId,
            lockId: currentLockId,
            snapshotIds: currentSnapshotId ? [currentSnapshotId] : [],
          })
          .then((result) => {
            if (requestId.current !== token) return;
            setGrant(result);
          }),
        '复核依赖授权',
      );
    },
    [],
  );

  const inspect = useCallback(
    (choice: DependencyBaseChoice, currentLockId: string, token: number): void => {
      if (!currentLockId) return;
      setLoading(true);
      trackAction(
        window.betterwork.dependencies
          .inspectPlan({ base: choice, lockId: currentLockId })
          .then((result) => {
            if (requestId.current !== token) return;
            setPlan(result);
            setLoading(false);
            // 关闭页面再回来：按环境键找回未完成的作业并继续回看进度。
            if (result.openOperationId) {
              trackAction(
                window.betterwork.dependencies
                  .getOperation({ operationId: result.openOperationId })
                  .then((found) => {
                    if (requestId.current !== token) return;
                    setOperation(found ?? undefined);
                  }),
                '恢复准备作业进度',
              );
            } else {
              setOperation(undefined);
            }
          }),
        '查看依赖计划',
      );
    },
    [],
  );

  // 切换 Skill：清空上一个 Skill 的计划、进度与授权提示，再按当前选择重新加载。
  useEffect(() => {
    const token = requestId.current + 1;
    requestId.current = token;
    stopPolling();
    setPlan(undefined);
    setOperation(undefined);
    setGrant(undefined);
    setError('');
    setToast('');
    setPreparing(false);
    prepareInFlight.current = false;
    if (!skillId) {
      setBase(undefined);
      setLockId('');
      setSnapshotId('');
      return;
    }
    trackAction(
      window.betterwork.dependencies.listOptions().then((result) => {
        if (requestId.current !== token) return;
        setOptions(result);
        const firstLock = result.lockIds[0] ?? '';
        const preferred =
          result.distributions.find(
            (distribution) =>
              distribution.platform.os === 'darwin' && distribution.platform.arch === 'arm64',
          ) ?? result.distributions[0];
        const nextBase: DependencyBaseChoice | undefined = preferred
          ? { kind: 'managed', distributionId: preferred.id }
          : undefined;
        const nextSnapshot = result.snapshots[0]?.id ?? '';
        setLockId(firstLock);
        setSnapshotId(nextSnapshot);
        setBase(nextBase);
        if (nextBase && firstLock) inspect(nextBase, firstLock, token);
        reviewGrant(skillId, firstLock, nextSnapshot, token);
      }),
      '加载依赖选项',
    );
  }, [skillId, inspect, reviewGrant, stopPolling]);

  // 作业进行中每秒轮询一次阶段状态；终态后停止并刷新环境与授权。
  useEffect(() => {
    const current = operation;
    if (!current || !isPending(current) || !plan) {
      stopPolling();
      return;
    }
    const operationId = current.id;
    const token = requestId.current;
    stopPolling();
    pollTimer.current = setInterval(() => {
      trackAction(
        window.betterwork.dependencies.getOperation({ operationId }).then((found) => {
          if (requestId.current !== token || !found) return;
          setOperation(found);
          if (found.status === 'succeeded') {
            setPreparing(false);
            prepareInFlight.current = false;
            setToast('环境已就绪。');
            refreshSkills();
            if (base && lockId) inspect(base, lockId, token);
            if (skillId) reviewGrant(skillId, lockId, snapshotId, token);
          }
          if (found.status === 'failed' || found.status === 'cancelled') {
            setPreparing(false);
            prepareInFlight.current = false;
          }
        }),
        '刷新准备作业进度',
      );
    }, pollIntervalMs);
    return stopPolling;
  }, [
    operation,
    plan,
    base,
    lockId,
    snapshotId,
    skillId,
    inspect,
    reviewGrant,
    stopPolling,
    refreshSkills,
  ]);

  useEffect(() => stopPolling, [stopPolling]);

  const applyChoice = useCallback(
    (choice: DependencyBaseChoice): void => {
      setBase(choice);
      const token = requestId.current;
      if (skillId && lockId) {
        inspect(choice, lockId, token);
        reviewGrant(skillId, lockId, snapshotId, token);
      }
    },
    [inspect, lockId, reviewGrant, skillId, snapshotId],
  );

  const selectManagedDistribution = useCallback(
    (distributionId: string): void => {
      applyChoice({ kind: 'managed', distributionId });
    },
    [applyChoice],
  );

  const chooseLocalInterpreter = useCallback((): void => {
    reportAction(
      window.betterwork.dependencies.chooseInterpreter().then((result) => {
        if (result.cancelled || !result.path) return;
        applyChoice({ kind: 'local', path: result.path });
      }),
      setError,
      '选择解释器失败，请重试。',
    );
  }, [applyChoice]);

  const registerToolchain = useCallback((): void => {
    const token = requestId.current;
    reportAction(
      window.betterwork.dependencies.registerToolchain({}).then((result) => {
        if (requestId.current !== token) return;
        const snapshot = result.snapshot;
        if (result.cancelled || !snapshot) return;
        setSnapshotId(snapshot.id);
        setOptions((current) =>
          current ? { ...current, snapshots: [snapshot, ...current.snapshots] } : current,
        );
        setToast(
          result.reused
            ? '同样内容的工具链快照已存在，直接复用。'
            : `工具链快照已登记（${snapshot.fileCount} 个文件）。`,
        );
        if (skillId && lockId) reviewGrant(skillId, lockId, snapshot.id, token);
      }),
      setError,
      '登记工具链快照失败，请重试。',
    );
  }, [lockId, reviewGrant, skillId]);

  const prepare = useCallback((): void => {
    if (!base || !lockId || prepareInFlight.current) return;
    const token = requestId.current;
    prepareInFlight.current = true;
    setPreparing(true);
    setError('');
    reportAction(
      window.betterwork.dependencies.prepare({ base, lockId }).then((receipt) => {
        if (requestId.current !== token) return;
        setToast(
          receipt.reused ? '已有同一环境的准备作业，正在回看它的进度。' : '已开始准备环境。',
        );
        return window.betterwork.dependencies
          .getOperation({ operationId: receipt.operationId })
          .then((found) => {
            if (requestId.current !== token) return;
            setOperation(found ?? undefined);
          });
      }),
      (message) => {
        prepareInFlight.current = false;
        setPreparing(false);
        setError(message);
      },
      '准备环境失败，请重试。',
    );
  }, [base, lockId]);

  const cancel = useCallback((): void => {
    const current = operation;
    if (!current) return;
    reportAction(
      window.betterwork.dependencies.cancel({ operationId: current.id }).then((result) => {
        setPreparing(false);
        prepareInFlight.current = false;
        setToast(
          result.applied
            ? `准备作业已${result.status === 'cancelled' ? '取消' : '结束'}。`
            : '作业已结束，无需取消。',
        );
        return window.betterwork.dependencies
          .getOperation({ operationId: current.id })
          .then((found) => setOperation(found ?? undefined));
      }),
      setError,
      '取消准备作业失败，请重试。',
    );
  }, [operation]);

  const confirmGrant = useCallback((): void => {
    if (!skillId || !lockId) return;
    const token = requestId.current;
    reportAction(
      window.betterwork.skills
        .refreshDependencyGrant({
          skillId,
          lockId,
          snapshotIds: snapshotId ? [snapshotId] : [],
          confirm: true,
        })
        .then((result) => {
          if (requestId.current !== token) return;
          setGrant(result);
          setToast(result.grantCreated ? '已按当前依赖建立执行授权。' : '授权状态已更新。');
        }),
      setError,
      '确认授权失败，请重试。',
    );
  }, [lockId, skillId, snapshotId]);

  return {
    options,
    plan,
    operation,
    grant,
    base,
    lockId,
    snapshotId,
    loading,
    preparing,
    error,
    toast,
    selectManagedDistribution,
    selectLock: (nextLockId: string): void => {
      setLockId(nextLockId);
      const token = requestId.current;
      if (base && skillId) {
        inspect(base, nextLockId, token);
        reviewGrant(skillId, nextLockId, snapshotId, token);
      }
    },
    selectSnapshot: (nextSnapshotId: string): void => {
      setSnapshotId(nextSnapshotId);
      const token = requestId.current;
      if (skillId && lockId) reviewGrant(skillId, lockId, nextSnapshotId, token);
    },
    chooseLocalInterpreter,
    registerToolchain,
    prepare,
    cancel,
    confirmGrant,
    dismissToast: (): void => setToast(''),
    clearError: (): void => setError(''),
  };
}
