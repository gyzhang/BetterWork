import type { SkillDetail } from '@betterwork/agent-protocol';

import type { SkillDependenciesState } from '../../hooks/use-skill-dependencies';

/**
 * Skill 依赖与运行环境面板（A12）。
 *
 * 用户在这里选择基础解释器、依赖锁与工具链快照，查看缺项，准备/取消/修复环境，
 * 全程不需要输入任何 Shell 命令。面板同时明确区分两件容易混淆的事：
 * **未信任也可以准备环境**，但**环境就绪不等于可以执行**——执行还需要有效授权。
 */

const operationStepName: Record<string, string> = {
  'resolve-interpreter': '解析基础解释器',
  'create-environment': '创建专属环境',
  'install-packages': '安装锁定依赖',
  'probe-imports': '探测必需模块',
  finalize: '收尾',
};

const operationStatusName: Record<string, string> = {
  queued: '排队中',
  running: '准备中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

const environmentStatusName: Record<string, string> = {
  unprepared: '未准备',
  preparing: '准备中',
  ready: '就绪',
  failed: '失败',
  cancelled: '已取消',
  invalid: '已失效',
};

export function DependencyPanel({
  skill,
  state,
}: {
  skill: SkillDetail;
  state: SkillDependenciesState;
}): React.JSX.Element {
  const { options, plan, operation, grant } = state;
  const environment = plan?.environment ?? undefined;
  const pending = operation?.status === 'queued' || operation?.status === 'running';
  const canExecute = skill.trustStatus === 'trusted' && environment?.status === 'ready';

  return (
    <div className="skill-detail-section dependency-panel">
      <div className="skill-section-heading">
        <div>
          <p className="eyebrow">运行环境</p>
          <h3>依赖与解释器</h3>
        </div>
        <span className="dependency-status-chip">
          {environment ? environmentStatusName[environment.status] : '未准备'}
        </span>
      </div>

      <div className="dependency-field">
        <label htmlFor="dependency-base">基础 Python</label>
        <select
          id="dependency-base"
          value={state.base?.kind === 'managed' ? state.base.distributionId : '__local__'}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '__local__') {
              state.chooseLocalInterpreter();
              return;
            }
            state.selectManagedDistribution(value);
          }}
        >
          {(options?.distributions ?? []).map((distribution) => (
            <option key={distribution.id} value={distribution.id}>
              算台受管 Python {distribution.version}（{distribution.platform.os}/
              {distribution.platform.arch}）{distribution.installed ? '· 已下载' : '· 需下载'}
            </option>
          ))}
          <option value="__local__">
            {state.base?.kind === 'local' ? `本机解释器 ${state.base.path}` : '选择本机 Python…'}
          </option>
        </select>
        <p>
          受管制品按固定版本与校验值使用；本机解释器只作为 venv 基础，不会修改它的全局
          site-packages。
        </p>
      </div>

      <div className="dependency-field">
        <label htmlFor="dependency-lock">依赖锁</label>
        <select
          id="dependency-lock"
          value={state.lockId}
          onChange={(event) => state.selectLock(event.target.value)}
        >
          {(options?.lockIds ?? []).map((lockId) => (
            <option key={lockId} value={lockId}>
              {lockId}
            </option>
          ))}
        </select>
        {plan && (
          <p>
            {plan.lock.packages.length} 个精确版本包 · {plan.platform.os}/{plan.platform.arch}/
            {plan.platform.abi} · 必需模块 {plan.lock.importProbes.join('、') || '无'}
          </p>
        )}
        {plan && plan.missingWheels.length > 0 && (
          <p className="dependency-warning">
            随包资源缺少 {plan.missingWheels.join('、')}；准备时需要显式联网下载并逐个校验。
          </p>
        )}
      </div>

      <div className="dependency-field">
        <label htmlFor="dependency-snapshot">外部工具链快照</label>
        <div className="dependency-inline">
          <select
            id="dependency-snapshot"
            value={state.snapshotId}
            onChange={(event) => state.selectSnapshot(event.target.value)}
          >
            <option value="">不使用外部工具链</option>
            {(options?.snapshots ?? []).map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshot.manifestHash.slice(0, 12)} · {snapshot.fileCount} 文件 ·{' '}
                {snapshot.originState === 'dirty' ? '含本地修改' : snapshot.originState}
              </option>
            ))}
          </select>
          <button type="button" className="secondary-button" onClick={state.registerToolchain}>
            登记目录…
          </button>
        </div>
        <p>
          快照是外部目录的受管不可变副本，运行时 PPTM_HOME 指向它；源目录之后再改动也不影响
          已登记的快照。
        </p>
      </div>

      <div className="dependency-actions">
        <button
          type="button"
          className="primary-button"
          onClick={state.prepare}
          disabled={!state.base || !state.lockId || state.preparing || pending}
        >
          {environment?.status === 'ready' ? '重新准备（修复）' : '准备环境'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={state.cancel}
          disabled={!pending}
        >
          取消准备
        </button>
        {state.loading && <span className="dependency-progress">正在计算依赖计划…</span>}
      </div>

      {operation && (
        <div className="dependency-operation">
          <strong>{operationStatusName[operation.status] ?? operation.status}</strong>
          {operation.step && <span>{operationStepName[operation.step] ?? operation.step}</span>}
          {operation.message && <p>{operation.message}</p>}
          {operation.failureCode && (
            <p className="field-error" role="alert">
              {operation.failureCode}
              {operation.failureSummary ? `：${operation.failureSummary}` : ''}
            </p>
          )}
        </div>
      )}

      {environment?.failureSummary && !pending && (
        <p className="field-error" role="alert">
          环境{environmentStatusName[environment.status]}：{environment.failureSummary}
        </p>
      )}

      <div className="dependency-grant">
        {grant?.grantActive ? (
          <p className="success-copy">当前依赖已有有效执行授权。</p>
        ) : (
          <>
            <p className="dependency-warning">
              {grant?.blockedReason ?? '依赖确定后需要确认授权才能执行脚本。'}
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={state.confirmGrant}
              disabled={skill.trustStatus !== 'trusted' && skill.trustStatus !== 'needs-review'}
            >
              确认依赖授权
            </button>
          </>
        )}
        <p>
          {canExecute
            ? '环境就绪且授权有效，可以执行脚本。'
            : '环境准备不需要信任授权，但执行脚本必须同时满足「已信任 + 授权覆盖当前依赖 + 环境就绪」。'}
        </p>
      </div>

      {state.error && (
        <p className="inline-message error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
