import type { SkillDetail, SkillEnvironmentStatus } from '@betterwork/agent-protocol';
import { useState } from 'react';

import type { SkillDependenciesState } from '../../hooks/use-skill-dependencies';
import { skillEnvironmentName } from '../../lib/labels';
import {
  effectiveToolchainRequirements,
  unconfiguredExternalRuntimeClues,
} from '../../lib/skill-runtime-discovery';
import { ActionBar } from '../ActionBar';
import { InlineLoading } from '../AsyncButton';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Disclosure } from '../Disclosure';
import { Field } from '../Field';
import { FieldSelect } from '../FieldSelect';
import { InlineError } from '../InlineError';
import { SectionHeader } from '../SectionHeader';
import { StatusNote } from '../StatusNote';
import { ToolchainSnapshotManager } from './ToolchainSnapshotManager';

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

const environmentActionCopy = (
  status: SkillEnvironmentStatus | undefined,
  pending: boolean,
  checking: boolean,
  operationKind: 'prepare' | 'repair' | undefined,
): { label: string; hint: string } => {
  if (pending && operationKind === 'repair') {
    return {
      label: '正在修复环境…',
      hint: '正在重建 Skill 专属隔离环境并安装依赖锁中的包。',
    };
  }
  if (pending) {
    return {
      label: '正在准备环境…',
      hint: '正在创建 Skill 专属隔离环境并安装依赖锁中的包。',
    };
  }
  if (checking) {
    return {
      label: '正在检查环境…',
      hint: '正在检查依赖锁声明的 Python 模块能否导入。',
    };
  }
  if (status === 'ready') {
    return {
      label: '检查环境',
      hint: '检查会验证依赖锁声明的模块能否导入，不会重新安装。检查失败后可修复环境。',
    };
  }
  if (status === 'invalid') {
    return {
      label: '修复环境',
      hint: '上次环境检查未通过。修复会重建 Skill 专属环境，并安装依赖锁中的包。',
    };
  }
  if (status === 'failed' || status === 'cancelled') {
    return {
      label: '重新准备环境',
      hint: '上次准备未完成。重新准备会重建 Skill 专属环境，并安装依赖锁中的包。',
    };
  }
  return {
    label: '准备环境',
    hint: '准备会创建 Skill 专属隔离环境并安装依赖锁中的包；准备环境不会授权执行 Skill。',
  };
};

export function DependencyPanel({
  skill,
  state,
  onOpenSkill,
}: {
  skill: SkillDetail;
  state: SkillDependenciesState;
  onOpenSkill?: ((skillId: string) => void) | undefined;
}): React.JSX.Element {
  const [managingSnapshots, setManagingSnapshots] = useState(false);
  const { options, plan, operation, grant } = state;
  const environment = plan?.environment ?? undefined;
  const pending = operation?.status === 'queued' || operation?.status === 'running';
  const environmentAction = environmentActionCopy(
    environment?.status,
    pending,
    state.checking,
    operation?.kind,
  );
  const canExecute =
    skill.trustStatus === 'trusted' &&
    environment?.status === 'ready' &&
    grant?.grantActive === true;
  const profile = skill.runtimeProfile?.profile;
  const dependencyLockId = profile?.dependencyBundle?.id ?? profile?.dependencyLockId;
  const toolchainRequirements = effectiveToolchainRequirements(profile);
  const externalRuntimeClues = unconfiguredExternalRuntimeClues(
    skill.runtimeDiscovery,
    toolchainRequirements,
  );
  const hasUnconfiguredExternalClues = externalRuntimeClues.length > 0;
  const managedDistribution = options?.distributions.find(
    (distribution) =>
      state.base?.kind === 'managed' && distribution.id === state.base.distributionId,
  );

  if (!profile) {
    return (
      <section className="skill-detail-section dependency-panel">
        <SectionHeader eyebrow="运行环境" title="等待审核运行配置" />
        <StatusNote
          tone="warning"
          message="当前 Skill 只发现了静态线索，尚未匹配已审核的运行配置；在配置确认前不会准备依赖或外部工具链。"
        />
      </section>
    );
  }

  return (
    <div className="skill-detail-section dependency-panel">
      <SectionHeader
        eyebrow="运行环境"
        title="依赖与工具链"
        actions={
          <Badge tone="outline">
            {environment ? skillEnvironmentName[environment.status] : '未准备'}
          </Badge>
        }
      />

      <p>
        基础 Python 由 BetterWork 在“设置 → 运行组件”统一管理
        {managedDistribution ? `，当前使用 ${managedDistribution.version}` : ''}；首次准备 Skill
        环境时自动下载并校验。
      </p>
      {!state.base && !state.loading && (
        <StatusNote
          tone="warning"
          message={`没有找到符合 Skill 声明版本 ${profile?.pythonRequirement ?? ''} 的受管 Python；请检查“设置 → 运行组件”或打开高级选项。`}
        />
      )}
      <Disclosure label="高级：更换基础 Python">
        <Field
          controlId="dependency-base"
          label="基础 Python"
          hint="本机解释器只用来创建 Skill 专属环境，不会修改全局 site-packages。"
        >
          <FieldSelect
            size="md"
            id="dependency-base"
            disabled={state.checking}
            value={state.base?.kind === 'managed' ? state.base.distributionId : '__local__'}
            onChange={(value) => {
              if (value === '__local__') {
                state.chooseLocalInterpreter();
                return;
              }
              state.selectManagedDistribution(value);
            }}
            options={[
              ...(options?.distributions ?? []).map((distribution) => ({
                id: distribution.id,
                label: `算台受管 Python ${distribution.version}（${distribution.platform.os}/${distribution.platform.arch}）${distribution.installed ? '· 已落地' : '· 首次使用时准备'}`,
              })),
              {
                id: '__local__',
                label:
                  state.base?.kind === 'local'
                    ? `本机解释器 ${state.base.path}`
                    : '选择本机 Python…',
              },
            ]}
          />
        </Field>
      </Disclosure>

      <Field
        controlId="dependency-lock"
        label="依赖锁"
        hint={
          plan ? (
            <>
              {plan.lock.packages.length} 个精确版本包 · {plan.platform.os}/{plan.platform.arch}/
              {plan.platform.abi} · 必需模块 {plan.lock.importProbes.join('、') || '无'}
              {plan.missingWheels.length > 0 && (
                <span className="dependency-warning">
                  随包资源缺少 {plan.missingWheels.join('、')}；准备时需要显式联网下载并逐个校验。
                </span>
              )}
            </>
          ) : !dependencyLockId ? (
            '运行配置尚未指定依赖锁。请确认兼容的审核锁后手动选择；BetterWork 不会自动套用目录中的锁。'
          ) : undefined
        }
      >
        {dependencyLockId ? (
          <p>
            {dependencyLockId}
            {profile?.dependencyBundle ? '（随 Skill 包提供）' : ''}
          </p>
        ) : (
          <FieldSelect
            size="md"
            id="dependency-lock"
            disabled={state.checking}
            value={state.lockId}
            onChange={(lockId) => state.selectLock(lockId)}
            options={(options?.lockIds ?? []).map((lockId) => ({ id: lockId, label: lockId }))}
          />
        )}
      </Field>

      {toolchainRequirements.map((requirement, index) => (
        <Field
          key={requirement.id}
          controlId={`dependency-snapshot-${requirement.id}`}
          label={`${requirement.name}${requirement.versionHint ? ` ${requirement.versionHint}` : ''}`}
          hint={`${requirement.environmentVariable} 将指向只读的受管快照；源目录后续修改不会改变已登记内容。`}
        >
          <div className="dependency-inline">
            <FieldSelect
              size="md"
              id={`dependency-snapshot-${requirement.id}`}
              disabled={state.checking}
              value={state.snapshotIds[index] ?? ''}
              onChange={(snapshotId) => state.selectSnapshot(index, snapshotId)}
              options={[
                { id: '', label: '选择已登记快照…' },
                ...(options?.snapshots ?? []).map((snapshot) => ({
                  id: snapshot.id,
                  label: `${snapshot.manifestHash.slice(0, 12)} · ${snapshot.fileCount} 文件 · ${snapshot.originState === 'dirty' ? '含本地修改' : snapshot.originState} · 当前授权 ${snapshot.usage.reduce((total, entry) => total + entry.activeAuthorizationCount, 0)} · 历史 Run ${snapshot.usage.reduce((total, entry) => total + entry.runCount, 0)}`,
                })),
              ]}
            />
            <Button
              variant="secondary"
              size="md"
              type="button"
              disabled={state.checking}
              onClick={() => state.registerToolchain(index)}
            >
              登记目录…
            </Button>
          </div>
        </Field>
      ))}
      {toolchainRequirements.length === 0 &&
        (hasUnconfiguredExternalClues ? (
          <StatusNote
            tone="warning"
            message={`导入扫描发现尚未映射到运行配置的目录或工具链线索：${externalRuntimeClues.join('、')}。依赖环境就绪不代表这些资源已准备。`}
          />
        ) : (
          <p>当前运行配置未声明外部工具链。</p>
        ))}

      {options && options.snapshots.length > 0 && (
        <ActionBar
          as="div"
          label="工具链快照管理"
          hint={`${options.snapshots.length} 条快照；查看使用它们的 Skill、授权和历史 Run`}
        >
          <Button
            variant="secondary"
            size="md"
            type="button"
            disabled={state.checking}
            onClick={() => setManagingSnapshots(true)}
          >
            管理已登记快照
          </Button>
        </ActionBar>
      )}

      <div className="dependency-actions">
        <Button
          variant="primary"
          size="md"
          type="button"
          onClick={environment?.status === 'ready' ? state.checkEnvironment : state.prepare}
          disabled={
            !state.base ||
            !state.lockId ||
            state.loading ||
            state.preparing ||
            state.checking ||
            pending
          }
        >
          {environmentAction.label}
        </Button>
        <Button
          variant="secondary"
          size="md"
          type="button"
          onClick={state.cancel}
          disabled={!pending}
        >
          取消准备
        </Button>
        {state.loading && (
          <InlineLoading className="dependency-progress" label="正在计算依赖计划…" />
        )}
      </div>
      <p className="dependency-action-hint">{environmentAction.hint}</p>

      {operation && (
        <div className="dependency-operation">
          <strong>{operationStatusName[operation.status] ?? operation.status}</strong>
          {operation.step && <span>{operationStepName[operation.step] ?? operation.step}</span>}
          {operation.message && <p>{operation.message}</p>}
          {operation.failureCode && (
            <InlineError
              message={`${operation.failureCode}${operation.failureSummary ? `：${operation.failureSummary}` : ''}`}
            />
          )}
        </div>
      )}

      {environment?.failureSummary && !pending && (
        <InlineError
          message={`环境${skillEnvironmentName[environment.status]}：${environment.failureSummary}`}
        />
      )}

      <div className="dependency-grant">
        {grant?.grantActive ? (
          <StatusNote tone="success" message="当前依赖已有有效执行授权。" />
        ) : (
          <>
            <StatusNote
              tone="warning"
              message={grant?.blockedReason ?? '依赖确定后需要确认授权才能执行脚本。'}
            />
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={state.confirmGrant}
              disabled={
                !state.lockId ||
                (skill.trustStatus !== 'trusted' && skill.trustStatus !== 'needs-review')
              }
            >
              确认依赖授权
            </Button>
          </>
        )}
        <p>
          {canExecute
            ? '环境就绪且授权有效，可以执行脚本。'
            : environment?.status === 'ready'
              ? 'Python 依赖环境已就绪，但当前依赖授权尚未生效，不能执行 Skill。'
              : '环境准备不需要信任授权，但执行脚本必须同时满足「已信任 + 授权覆盖当前依赖 + 环境就绪」。'}
        </p>
      </div>

      {state.error && <InlineError message={state.error} />}
      {managingSnapshots && options && (
        <ToolchainSnapshotManager
          snapshots={options.snapshots}
          onDelete={state.deleteToolchainSnapshot}
          onOpenSkill={onOpenSkill}
          onClose={() => setManagingSnapshots(false)}
        />
      )}
    </div>
  );
}
