import type {
  DeleteToolchainSnapshotResult,
  DependencyBaseChoice,
  DependencyOperation,
  DependencyOptions,
  DependencyPlan,
  RefreshSkillDependencyGrantResult,
  SkillDetail,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, reportAction, trackAction } from '../lib/async-action';
import { effectiveToolchainRequirements } from '../lib/skill-runtime-discovery';

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
  snapshotIds: string[];
  loading: boolean;
  preparing: boolean;
  checking: boolean;
  error: string;
  toast: string;
  selectManagedDistribution: (distributionId: string) => void;
  selectLock: (lockId: string) => void;
  selectSnapshot: (index: number, snapshotId: string) => void;
  chooseLocalInterpreter: () => void;
  registerToolchain: (index: number) => void;
  deleteToolchainSnapshot: (
    snapshotId: string,
  ) => Promise<DeleteToolchainSnapshotResult | { status: 'error'; message: string }>;
  prepare: () => void;
  checkEnvironment: () => void;
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
  const [snapshotIds, setSnapshotIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const requestId = useRef(0);
  const snapshotIdsRef = useRef<string[]>([]);
  /** 重复点击只启动一个作业：in-flight 期间不再发起第二次准备。 */
  const prepareInFlight = useRef(false);
  const verificationInFlight = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const grantReviewId = useRef(0);

  const skillId = skill?.id;
  const profile = skill?.runtimeProfile?.profile;
  const toolchainCount = effectiveToolchainRequirements(profile).length;

  const stopPolling = useCallback((): void => {
    const timer = pollTimer.current;
    if (timer) clearInterval(timer);
    pollTimer.current = undefined;
  }, []);

  const reviewGrant = useCallback(
    (
      currentSkillId: string,
      currentLockId: string,
      currentSnapshotIds: string[] | undefined,
      token: number,
      availableSnapshotIds?: readonly string[],
    ): void => {
      if (!currentLockId) return;
      const reviewId = grantReviewId.current + 1;
      grantReviewId.current = reviewId;
      const restoringSelection = currentSnapshotIds === undefined;
      trackAction(
        window.betterwork.skills
          .refreshDependencyGrant({
            skillId: currentSkillId,
            lockId: currentLockId,
            ...(currentSnapshotIds === undefined
              ? {}
              : { snapshotIds: currentSnapshotIds.filter((id) => id.length > 0) }),
          })
          .then((result) => {
            if (requestId.current !== token || grantReviewId.current !== reviewId) return;
            setGrant(result);
            if (restoringSelection) {
              const available = new Set(availableSnapshotIds ?? []);
              const restoredSnapshotIds = Array.from({ length: toolchainCount }, (_, index) => {
                const snapshotId = result.selectedSnapshotIds[index];
                return snapshotId && available.has(snapshotId) ? snapshotId : '';
              });
              snapshotIdsRef.current = restoredSnapshotIds;
              setSnapshotIds(restoredSnapshotIds);
            }
          }),
        '复核依赖授权',
      );
    },
    [toolchainCount],
  );

  const inspect = useCallback(
    (choice: DependencyBaseChoice, currentLockId: string, token: number): void => {
      if (!currentLockId) return;
      setLoading(true);
      trackAction(
        window.betterwork.dependencies
          .inspectPlan({
            base: choice,
            lockId: currentLockId,
            ...(skillId ? { skillId } : {}),
          })
          .then((result) => {
            if (requestId.current !== token) return;
            setPlan(result);
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
          })
          .catch((error: unknown) => {
            if (requestId.current !== token) return;
            setError(describeActionError(error, '查看依赖计划失败，请重试。'));
          })
          .finally(() => {
            if (requestId.current === token) setLoading(false);
          }),
        '查看依赖计划',
      );
    },
    [skillId],
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
    setChecking(false);
    prepareInFlight.current = false;
    verificationInFlight.current = false;
    snapshotIdsRef.current = [];
    if (!skillId || !profile) {
      setOptions(undefined);
      setBase(undefined);
      setLockId('');
      setSnapshotIds([]);
      setLoading(false);
      return;
    }
    trackAction(
      window.betterwork.dependencies.listOptions().then((result) => {
        if (requestId.current !== token) return;
        setOptions(result);
        // A catalog lock is not evidence that this Skill needs it. Only inspect and prepare
        // a lock explicitly declared by its reviewed runtime profile or chosen by the user.
        const configuredLockId = profile?.dependencyBundle?.id ?? profile?.dependencyLockId ?? '';
        const requestedPython = profile?.pythonRequirement;
        const platformDistributions = result.distributions.filter(
          (distribution) =>
            distribution.platform.os === 'darwin' && distribution.platform.arch === 'arm64',
        );
        const preferred = requestedPython
          ? platformDistributions.find((distribution) =>
              distribution.version.startsWith(requestedPython),
            )
          : (platformDistributions[0] ?? result.distributions[0]);
        const nextBase: DependencyBaseChoice | undefined = preferred
          ? { kind: 'managed', distributionId: preferred.id }
          : undefined;
        // A registered snapshot is only a candidate; never bind it to a requirement by list order.
        const nextSnapshots = Array.from({ length: toolchainCount }, () => '');
        snapshotIdsRef.current = nextSnapshots;
        setLockId(configuredLockId);
        setSnapshotIds(nextSnapshots);
        setBase(nextBase);
        if (nextBase && configuredLockId) inspect(nextBase, configuredLockId, token);
        reviewGrant(
          skillId,
          configuredLockId,
          undefined,
          token,
          result.snapshots.map((snapshot) => snapshot.id),
        );
      }),
      '加载依赖选项',
    );
  }, [skillId, inspect, profile, reviewGrant, stopPolling, toolchainCount]);

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
            if (skillId) reviewGrant(skillId, lockId, snapshotIds, token);
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
    snapshotIds,
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
        reviewGrant(skillId, lockId, snapshotIds, token);
      }
    },
    [inspect, lockId, reviewGrant, skillId, snapshotIds],
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

  const registerToolchain = useCallback(
    (index: number): void => {
      const token = requestId.current;
      reportAction(
        window.betterwork.dependencies.registerToolchain({}).then((result) => {
          if (requestId.current !== token) return;
          const snapshot = result.snapshot;
          if (result.cancelled || !snapshot) return;
          const nextSnapshotIds = [...snapshotIdsRef.current];
          nextSnapshotIds[index] = snapshot.id;
          snapshotIdsRef.current = nextSnapshotIds;
          setSnapshotIds(nextSnapshotIds);
          setOptions((current) =>
            current
              ? {
                  ...current,
                  snapshots: [
                    snapshot,
                    ...current.snapshots.filter((entry) => entry.id !== snapshot.id),
                  ],
                }
              : current,
          );
          setToast(
            result.reused
              ? '同样内容的工具链快照已存在，直接复用。'
              : `工具链快照已登记（${snapshot.fileCount} 个文件）。`,
          );
          if (skillId && lockId) reviewGrant(skillId, lockId, nextSnapshotIds, token);
        }),
        setError,
        '登记工具链快照失败，请重试。',
      );
    },
    [lockId, reviewGrant, skillId],
  );

  const deleteToolchainSnapshot = useCallback(
    async (
      snapshotId: string,
    ): Promise<DeleteToolchainSnapshotResult | { status: 'error'; message: string }> => {
      try {
        const result = await window.betterwork.dependencies.deleteToolchainSnapshot({ snapshotId });
        if (result.status === 'in-use') {
          setOptions((current) =>
            current
              ? {
                  ...current,
                  snapshots: current.snapshots.map((snapshot) =>
                    snapshot.id === result.snapshot.id ? result.snapshot : snapshot,
                  ),
                }
              : current,
          );
          return result;
        }
        if (result.status === 'not-found') {
          setOptions((current) =>
            current
              ? {
                  ...current,
                  snapshots: current.snapshots.filter((snapshot) => snapshot.id !== snapshotId),
                }
              : current,
          );
          return result;
        }

        setOptions((current) =>
          current
            ? {
                ...current,
                snapshots: current.snapshots.filter((snapshot) => snapshot.id !== snapshotId),
              }
            : current,
        );
        const nextSnapshotIds = snapshotIdsRef.current.map((id) => (id === snapshotId ? '' : id));
        snapshotIdsRef.current = nextSnapshotIds;
        setSnapshotIds(nextSnapshotIds);
        if (skillId && lockId) {
          reviewGrant(skillId, lockId, nextSnapshotIds, requestId.current);
        }
        if (!result.cleanupPending) {
          setToast(
            result.clearedRevokedAuthorizationReferences > 0
              ? `工具链快照已删除，并清理了 ${result.clearedRevokedAuthorizationReferences} 条已撤销授权引用。`
              : '工具链快照已删除。',
          );
        }
        return result;
      } catch (error) {
        return {
          status: 'error',
          message: describeActionError(error, '删除工具链快照失败，请重试。'),
        };
      }
    },
    [lockId, reviewGrant, skillId],
  );

  const prepare = useCallback((): void => {
    if (!base || !lockId || prepareInFlight.current || verificationInFlight.current) return;
    const token = requestId.current;
    prepareInFlight.current = true;
    setPreparing(true);
    setError('');
    reportAction(
      window.betterwork.dependencies
        .prepare({
          base,
          lockId,
          ...(skillId ? { skillId } : {}),
          ...(plan?.environment?.status === 'invalid' ? { kind: 'repair' as const } : {}),
        })
        .then((receipt) => {
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
  }, [base, lockId, plan?.environment?.status, skillId]);

  const checkEnvironment = useCallback((): void => {
    const environment = plan?.environment;
    if (
      !environment ||
      environment.status !== 'ready' ||
      prepareInFlight.current ||
      verificationInFlight.current
    ) {
      return;
    }
    const token = requestId.current;
    verificationInFlight.current = true;
    setChecking(true);
    setError('');
    const verification = Promise.resolve()
      .then(() =>
        window.betterwork.dependencies.verifyEnvironment({ environmentId: environment.id }),
      )
      .then((checkedEnvironment) => {
        if (requestId.current !== token) return;
        setPlan((current) => (current ? { ...current, environment: checkedEnvironment } : current));
        if (checkedEnvironment.status === 'ready') {
          setToast('环境检查通过，锁定模块均可导入。');
        } else {
          setError(
            checkedEnvironment.failureSummary
              ? `环境检查未通过：${checkedEnvironment.failureSummary}`
              : '环境检查未通过，请修复环境后重试。',
          );
        }
        refreshSkills();
      })
      .finally(() => {
        if (requestId.current !== token) return;
        setChecking(false);
        verificationInFlight.current = false;
      });
    reportAction(
      verification,
      (message) => {
        if (requestId.current !== token) return;
        setError(message);
      },
      '检查环境失败，请重试。',
    );
  }, [plan?.environment, refreshSkills]);

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
          snapshotIds: snapshotIds.filter((id) => id.length > 0),
          confirm: true,
        })
        .then((result) => {
          if (requestId.current !== token) return;
          setGrant(result);
          setToast(result.grantCreated ? '已按当前依赖建立执行授权。' : '授权状态已更新。');
          refreshSkills();
        }),
      setError,
      '确认授权失败，请重试。',
    );
  }, [lockId, refreshSkills, skillId, snapshotIds]);

  const dismissToast = useCallback((): void => setToast(''), []);
  const clearError = useCallback((): void => setError(''), []);

  return {
    options,
    plan,
    operation,
    grant,
    base,
    lockId,
    snapshotIds,
    loading,
    preparing,
    checking,
    error,
    toast,
    selectManagedDistribution,
    selectLock: (nextLockId: string): void => {
      setLockId(nextLockId);
      const token = requestId.current;
      if (base && skillId) {
        inspect(base, nextLockId, token);
        reviewGrant(skillId, nextLockId, snapshotIds, token);
      }
    },
    selectSnapshot: (index: number, nextSnapshotId: string): void => {
      const nextSnapshotIds = [...snapshotIdsRef.current];
      nextSnapshotIds[index] = nextSnapshotId;
      snapshotIdsRef.current = nextSnapshotIds;
      setSnapshotIds(nextSnapshotIds);
      const token = requestId.current;
      if (skillId && lockId) reviewGrant(skillId, lockId, nextSnapshotIds, token);
    },
    chooseLocalInterpreter,
    registerToolchain,
    deleteToolchainSnapshot,
    prepare,
    checkEnvironment,
    cancel,
    confirmGrant,
    dismissToast,
    clearError,
  };
}
