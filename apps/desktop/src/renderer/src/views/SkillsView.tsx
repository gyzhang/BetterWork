import type { RuntimeProfileDraft, SkillSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import type { ViewMode } from '../components/layout/ViewContainer';
import { ViewContainer } from '../components/layout/ViewContainer';
import { DependencyPanel } from '../components/skills/DependencyPanel';
import { TransientToast } from '../components/TransientToast';
import type { SkillDependenciesState } from '../hooks/use-skill-dependencies';
import { useSkillDependencies } from '../hooks/use-skill-dependencies';
import type { SkillsState } from '../hooks/use-skills';
import { ChevronLeftIcon, InfoIcon, PlusIcon } from '../icons';
import { reportAction } from '../lib/async-action';

const VIEW_MODE_STORAGE_KEY = 'skills-view-mode';

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

type ChipKind = 'source' | 'trust' | 'enabled' | 'environment';

function chipModifier(label: string, kind: ChipKind): string {
  if (kind === 'trust' && label === '已信任') return ' skill-chip-active';
  if (kind === 'trust' && label === '需复核') return ' skill-chip-warn';
  if (kind === 'enabled' && label === '已启用') return ' skill-chip-active';
  if (kind === 'environment' && label === '已就绪') return ' skill-chip-active';
  return '';
}

function SkillChips({ skill }: { skill: SkillSummary }): React.JSX.Element {
  const source = sourceName[skill.sourceKind];
  const trust = trustName[skill.trustStatus];
  const enabled = skill.enabled ? '已启用' : '已停用';
  const environment = environmentName[skill.environmentStatus];
  return (
    <div className="skill-chips">
      <span className="skill-chip">{source}</span>
      <span className={`skill-chip${chipModifier(trust, 'trust')}`}>{trust}</span>
      <span className={`skill-chip${chipModifier(enabled, 'enabled')}`}>{enabled}</span>
      <span className={`skill-chip${chipModifier(environment, 'environment')}`}>{environment}</span>
    </div>
  );
}

function SkillCard({
  skill,
  onClick,
}: {
  skill: SkillSummary;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button className="skill-card" type="button" onClick={onClick}>
      <div className="skill-card-head">
        <span className="skill-card-mark" aria-hidden="true">
          {skill.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{skill.name}</strong>
          <small>{sourceName[skill.sourceKind]} Skill</small>
        </div>
      </div>
      <p className="skill-card-desc">{skill.description || '暂无描述'}</p>
      <SkillChips skill={skill} />
    </button>
  );
}

function SkillListItem({
  skill,
  onClick,
}: {
  skill: SkillSummary;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button className="skill-list-item" type="button" onClick={onClick}>
      <span className="skill-card-mark" aria-hidden="true">
        {skill.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="skill-list-item-main">
        <strong>{skill.name}</strong>
        <small>{skill.description || '暂无描述'}</small>
      </span>
      <SkillChips skill={skill} />
    </button>
  );
}

function readStoredViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function SkillsPage({ state }: { state: SkillsState }): React.JSX.Element {
  const { selected, dismissToast: dismissStateToast } = state;
  const refreshSkillDetail = useCallback(
    (skillId: string): void => {
      const current = state.skills.find((s) => s.id === skillId);
      if (current) state.select(current);
    },
    [state],
  );
  const dependencies = useSkillDependencies(selected, state.refresh, refreshSkillDetail);
  const { dismissToast: dismissDepsToast } = dependencies;
  const toast = state.toast || dependencies.toast;
  const dismissToast = useCallback((): void => {
    dismissStateToast();
    dismissDepsToast();
  }, [dismissStateToast, dismissDepsToast]);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const changeViewMode = (mode: ViewMode): void => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // storage unavailable — mode still applies for this session
    }
  };

  return (
    <section className="skills-page">
      <PageHeader
        eyebrow="能力 · Skill"
        title="管理可复用的工作方法"
        leading={
          selected ? (
            <button className="text-button" type="button" onClick={state.deselect}>
              <ChevronLeftIcon size={14} /> 返回
            </button>
          ) : undefined
        }
        actions={
          selected ? undefined : (
            <>
              <div className="skill-segmented" role="group" aria-label="视图模式">
                <button
                  type="button"
                  aria-pressed={viewMode === 'grid'}
                  onClick={() => changeViewMode('grid')}
                >
                  卡片
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => changeViewMode('list')}
                >
                  列表
                </button>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={state.importing}
                onClick={() =>
                  reportAction(state.importSkill(), state.clearError, '导入 Skill 失败。')
                }
              >
                <PlusIcon size={13} /> {state.importing ? '正在导入…' : '导入 Skill'}
              </button>
            </>
          )
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
      <div className="page-scroll skills-scroll">
        <section className="page-body skills-body">
          {selected ? (
            state.detailLoading ? (
              <LoadingPage label="正在加载详情…" />
            ) : (
              <SkillDetail state={state} dependencies={dependencies} />
            )
          ) : state.loading ? (
            <LoadingPage label="正在加载 Skill…" />
          ) : state.skills.length === 0 ? (
            <EmptyPage
              eyebrow="能力"
              title="还没有 Skill"
              detail="导入一个目录型 Skill，或等待内置能力加入这里。"
            />
          ) : viewMode === 'grid' ? (
            <ViewContainer mode="grid" className="skill-cards">
              {state.skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onClick={() => state.select(skill)} />
              ))}
            </ViewContainer>
          ) : (
            <ViewContainer mode="list" className="skill-rows">
              {state.skills.map((skill) => (
                <SkillListItem key={skill.id} skill={skill} onClick={() => state.select(skill)} />
              ))}
            </ViewContainer>
          )}
        </section>
      </div>
      {toast && <TransientToast tone="success" message={toast} onDismiss={dismissToast} />}
    </section>
  );
}

function SkillDetail({
  state,
  dependencies,
}: {
  state: SkillsState;
  dependencies: SkillDependenciesState;
}): React.JSX.Element {
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
        </div>
        <div className="skill-detail-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => state.copy(skill)}
            disabled={skill.sourceKind === 'user'}
          >
            {skill.sourceKind === 'builtin' ? '复制并编辑' : '用户副本'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => state.exportSkill(skill)}
          >
            导出
          </button>
        </div>
      </div>
      <p className="skill-detail-description">{skill.description || '暂无描述'}</p>
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
      <DependencyPanel skill={skill} state={dependencies} />
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
