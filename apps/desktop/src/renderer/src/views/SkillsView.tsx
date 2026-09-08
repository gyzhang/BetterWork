import type { RuntimeProfileDraft, SkillSummary } from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';

import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import type { SkillsState } from '../hooks/use-skills';
import { InfoIcon, PlusIcon } from '../icons';
import { reportAction } from '../lib/async-action';

const sourceName = { builtin: '内置', user: '用户' } as const;
const trustName = {
  untrusted: '未信任',
  trusted: '已信任',
  'needs-review': '需复核',
  revoked: '已撤销',
} as const;
const environmentName = {
  unprepared: '未准备',
  preparing: '准备中',
  ready: '已就绪',
  failed: '准备失败',
  cancelled: '已取消',
  invalid: '无效',
} as const;

function SkillRow({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillSummary;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      className={selected ? 'skill-row selected' : 'skill-row'}
      type="button"
      onClick={onSelect}
    >
      <span className="skill-row-mark" aria-hidden="true">
        {skill.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="skill-row-main">
        <strong>{skill.name}</strong>
        <small>{skill.description || '暂无描述'}</small>
      </span>
      <span className="skill-statuses">
        <em>{sourceName[skill.sourceKind]}</em>
        <em>{trustName[skill.trustStatus]}</em>
        <em>{skill.enabled ? '已启用' : '已停用'}</em>
        <em>{environmentName[skill.environmentStatus]}</em>
      </span>
    </button>
  );
}

export function SkillsPage({ state }: { state: SkillsState }): React.JSX.Element {
  const { selected, selectedId } = state;
  return (
    <section className="skills-page">
      <PageHeader
        eyebrow="能力 · Skill"
        title="管理可复用的工作方法"
        actions={
          <button
            className="primary-button"
            type="button"
            disabled={state.importing}
            onClick={() => reportAction(state.importSkill(), state.clearError, '导入 Skill 失败。')}
          >
            <PlusIcon size={13} /> {state.importing ? '正在导入…' : '导入 Skill'}
          </button>
        }
      />
      {state.error && (
        <p className="inline-message error" role="alert">
          {state.error}
          <button type="button" onClick={state.clearError}>
            关闭
          </button>
        </p>
      )}
      {state.message && <p className="inline-message">{state.message}</p>}
      <div className="skills-layout">
        <ScrollRegion className="skill-list" ariaLabel="Skill 列表">
          {state.loading ? (
            <LoadingPage label="正在加载 Skill…" />
          ) : state.skills.length === 0 ? (
            <EmptyPage
              eyebrow="能力"
              title="还没有 Skill"
              detail="导入一个目录型 Skill，或等待内置能力加入这里。"
            />
          ) : (
            state.skills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                selected={skill.id === selectedId}
                onSelect={() => state.select(skill)}
              />
            ))
          )}
        </ScrollRegion>
        <ScrollRegion className="skill-detail" ariaLabel="Skill 详情">
          {state.detailLoading ? (
            <LoadingPage label="正在加载详情…" />
          ) : selected ? (
            <SkillDetail state={state} />
          ) : (
            <EmptyPage
              eyebrow="Skill 详情"
              title="选择一个 Skill"
              detail="查看来源、授权状态和运行配置草稿。"
            />
          )}
        </ScrollRegion>
      </div>
    </section>
  );
}

function SkillDetail({ state }: { state: SkillsState }): React.JSX.Element {
  const skill = state.selected;
  const initialProfile = JSON.stringify(
    skill?.runtimeProfile?.profile ?? {
      commands: [],
      environmentRequirements: [],
      outputContract: { outputPaths: [] },
    },
    null,
    2,
  );
  const [profileText, setProfileText] = useState(initialProfile);
  const [profileError, setProfileError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setProfileText(initialProfile);
    setProfileError('');
  }, [initialProfile]);
  if (!skill) return <></>;
  const save = (): void => {
    try {
      const profile = JSON.parse(profileText) as RuntimeProfileDraft;
      setProfileError('');
      reportAction(state.saveProfile(skill.id, profile), setProfileError, '运行配置格式不正确。');
    } catch {
      setProfileError('运行配置必须是有效的 JSON。');
    }
  };
  const trustRequested = skill.trustStatus === 'trusted' || skill.trustStatus === 'needs-review';
  return (
    <>
      <div className="skill-detail-heading">
        <div>
          <p className="eyebrow">{sourceName[skill.sourceKind]} Skill</p>
          <h2>{skill.name}</h2>
          <p>{skill.description || '暂无描述'}</p>
        </div>
        <div className="skill-detail-actions">
          <button
            type="button"
            onClick={() => state.copy(skill)}
            disabled={skill.sourceKind === 'user'}
          >
            {skill.sourceKind === 'builtin' ? '复制并编辑' : '用户副本'}
          </button>
          <button type="button" onClick={() => state.exportSkill(skill)}>
            导出
          </button>
        </div>
      </div>
      <div className="skill-state-grid">
        <div>
          <span>来源</span>
          <strong>{sourceName[skill.sourceKind]}</strong>
        </div>
        <div>
          <span>信任</span>
          <strong>{trustName[skill.trustStatus]}</strong>
        </div>
        <div>
          <span>启用</span>
          <strong>{skill.enabled ? '已启用' : '已停用'}</strong>
        </div>
        <div>
          <span>环境</span>
          <strong>{environmentName[skill.environmentStatus]}</strong>
        </div>
      </div>
      <div className="skill-trust-box">
        <label>
          <input
            type="checkbox"
            checked={trustRequested}
            onChange={(event) => state.setTrust(skill, event.target.checked)}
          />{' '}
          受信任：允许在已授权范围内执行脚本
        </label>
        <p>
          <InfoIcon size={14} /> 脚本以本机用户权限运行，信任不提供沙箱隔离。
        </p>
        {skill.trustStatus === 'trusted' && (
          <button type="button" className="danger-text" onClick={() => setConfirmRevoke(true)}>
            撤销信任
          </button>
        )}
      </div>
      <div className="skill-detail-section">
        <div className="skill-section-heading">
          <div>
            <p className="eyebrow">运行配置</p>
            <h3>保存配置草稿</h3>
          </div>
          <button type="button" className="secondary-button" onClick={save}>
            保存草稿
          </button>
        </div>
        <p>当前仅保存配置，不会伪造环境已就绪，也不会启动脚本。</p>
        <textarea
          aria-label="运行配置 JSON"
          value={profileText}
          onChange={(event) => setProfileText(event.target.value)}
          spellCheck={false}
        />
        {profileError && (
          <p className="field-error" role="alert">
            {profileError}
          </p>
        )}
      </div>
      <div className="skill-detail-section">
        <h3>可运行性</h3>
        {skill.blockedReasons.length ? (
          <ul className="skill-blocked-reasons">
            {skill.blockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="success-copy">当前没有阻塞原因。</p>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={() => state.setEnabled(skill, !skill.enabled)}
        >
          {skill.enabled ? '停用 Skill' : '启用 Skill'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled
          title="执行能力将在后续任务实现"
        >
          试运行（A07 后开放）
        </button>
      </div>
      <div className="skill-detail-section">
        <h3>本地 Skill</h3>
        <p>删除会移除受管用户副本及其本地配置，不能恢复。</p>
        <button
          type="button"
          className="danger-text"
          disabled={skill.sourceKind === 'builtin'}
          onClick={() => setConfirmDelete(true)}
        >
          删除 Skill
        </button>
      </div>
      {confirmRevoke && (
        <ConfirmationDialog
          title="撤销 Skill 信任？"
          detail="撤销后将立即禁止新的脚本执行；正在运行的执行会由运行服务负责清理。"
          confirmLabel="撤销信任"
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => {
            setConfirmRevoke(false);
            state.revokeTrust(skill);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmationDialog
          title="删除这个 Skill？"
          detail="将删除用户 Skill 的受管副本和配置。内置 Skill 不能删除，请使用复制并编辑。"
          confirmLabel="删除 Skill"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            reportAction(state.deleteSkill(skill), state.clearError, '删除 Skill 失败，请重试。');
          }}
        />
      )}
    </>
  );
}
