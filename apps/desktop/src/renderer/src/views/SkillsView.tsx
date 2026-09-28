import type { RuntimeProfileDraft, SkillSummary } from '@betterwork/agent-protocol';
import { useCallback, useEffect, useState } from 'react';

import { AsyncButton } from '../components/AsyncButton';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { ListRow } from '../components/ListRow';
import { SectionHeader } from '../components/SectionHeader';
import { DependencyPanel } from '../components/skills/DependencyPanel';
import { Switch } from '../components/Switch';
import { SegmentedControl } from '../components/Tabs';
import { Tooltip } from '../components/Tooltip';
import { TransientToast } from '../components/TransientToast';
import type { SkillDependenciesState } from '../hooks/use-skill-dependencies';
import { useSkillDependencies } from '../hooks/use-skill-dependencies';
import type { SkillsState } from '../hooks/use-skills';
import { useViewMode } from '../hooks/use-view-mode';
import { ChevronLeftIcon, InfoIcon, PlusIcon } from '../icons';
import { reportAction } from '../lib/async-action';
import { skillEnvironmentName } from '../lib/labels';

const VIEW_MODE_STORAGE_KEY = 'skills-view-mode';

const sourceName = { builtin: '内置', user: '用户' } as const;
const trustName = {
  untrusted: '未信任',
  trusted: '已信任',
  'needs-review': '需复核',
  revoked: '已撤销',
} as const;

type ChipKind = 'source' | 'trust' | 'enabled' | 'environment';

function chipTone(label: string, kind: ChipKind): BadgeTone {
  if (kind === 'trust' && label === '需复核') return 'warning';
  if (kind === 'trust' && label === '已信任') return 'brand';
  if (kind === 'enabled' && label === '已启用') return 'brand';
  if (kind === 'environment' && label === '已就绪') return 'brand';
  return 'neutral';
}

function SkillChips({ skill }: { skill: SkillSummary }): React.JSX.Element {
  const source = sourceName[skill.sourceKind];
  const trust = trustName[skill.trustStatus];
  const enabled = skill.enabled ? '已启用' : '已停用';
  const environment = skillEnvironmentName[skill.environmentStatus];
  return (
    <div className="skill-chips">
      <Badge>{source}</Badge>
      <Badge tone={chipTone(trust, 'trust')}>{trust}</Badge>
      <Badge tone={chipTone(enabled, 'enabled')}>{enabled}</Badge>
      <Badge tone={chipTone(environment, 'environment')}>{environment}</Badge>
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
      <Tooltip className="skill-card-desc">{skill.description || '暂无描述'}</Tooltip>
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
    <ListRow
      variant="card"
      onClick={onClick}
      leading={
        <span className="skill-card-mark" aria-hidden="true">
          {skill.name.slice(0, 1).toUpperCase()}
        </span>
      }
      title={skill.name}
      meta={skill.description || '暂无描述'}
      actions={<SkillChips skill={skill} />}
    />
  );
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
  const { viewMode, changeViewMode } = useViewMode(VIEW_MODE_STORAGE_KEY);

  return (
    <section className="skills-page">
      <PageHeader
        eyebrow="技能"
        title="管理可复用的工作方法"
        leading={
          selected ? (
            <Button variant="text" size="sm" type="button" onClick={state.deselect}>
              <ChevronLeftIcon size={14} /> 返回
            </Button>
          ) : undefined
        }
        actions={
          selected ? undefined : (
            <>
              <SegmentedControl
                label="视图模式"
                value={viewMode}
                onChange={changeViewMode}
                items={[
                  { id: 'grid', label: '卡片' },
                  { id: 'list', label: '列表' },
                ]}
              />
              <AsyncButton
                variant="primary"
                busy={state.importing}
                label={
                  <>
                    <PlusIcon size={13} /> 导入 Skill
                  </>
                }
                busyLabel="正在导入…"
                onClick={() =>
                  reportAction(state.importSkill(), state.clearError, '导入 Skill 失败。')
                }
              />
            </>
          )
        }
      />
      {state.error && (
        <p className="inline-message error" role="alert">
          {state.error}
          <Button variant="link" size="sm" tone="danger" type="button" onClick={state.clearError}>
            关闭
          </Button>
        </p>
      )}
      <ScrollRegion ariaLabel="技能列表与详情" busy={state.loading || state.detailLoading}>
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
              eyebrow="技能"
              title="还没有 Skill"
              detail="导入一个目录型 Skill，或等待内置技能加入这里。"
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
      </ScrollRegion>
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
      <SectionHeader
        variant="block"
        eyebrow={`${sourceName[skill.sourceKind]} Skill`}
        title={skill.name}
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => state.copy(skill)}
              disabled={skill.sourceKind === 'user'}
            >
              {skill.sourceKind === 'builtin' ? '复制并编辑' : '用户副本'}
            </Button>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => state.exportSkill(skill)}
            >
              导出
            </Button>
          </>
        }
      />
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
          <strong>{skillEnvironmentName[skill.environmentStatus]}</strong>
        </div>
      </div>
      <div className="skill-trust-box">
        <Switch
          label="受信任：允许在已授权范围内执行脚本"
          checked={trustRequested}
          onChange={(next) => state.setTrust(skill, next)}
        />
        <p>
          <InfoIcon size={14} /> 脚本以本机用户权限运行，信任不提供沙箱隔离。
        </p>
        {skill.trustStatus === 'trusted' && (
          <Button
            variant="quiet"
            size="sm"
            tone="danger"
            type="button"
            onClick={() => setConfirmRevoke(true)}
          >
            撤销信任
          </Button>
        )}
      </div>
      <div className="skill-detail-section">
        <SectionHeader
          eyebrow="运行配置"
          title="保存配置草稿"
          actions={
            <Button variant="secondary" size="md" type="button" onClick={save}>
              保存草稿
            </Button>
          }
        />
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
        <SectionHeader title="可运行性" />
        {skill.blockedReasons.length ? (
          <ul className="skill-blocked-reasons">
            {skill.blockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="success-copy">当前没有阻塞原因。</p>
        )}
        <Button
          variant="secondary"
          size="md"
          type="button"
          onClick={() => state.setEnabled(skill, !skill.enabled)}
        >
          {skill.enabled ? '停用 Skill' : '启用 Skill'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          type="button"
          disabled={
            skill.trustStatus !== 'trusted' || !skill.enabled || skill.blockedReasons.length > 0
          }
          onClick={() => state.testRun(skill)}
        >
          试运行
        </Button>
      </div>
      <div className="skill-detail-section">
        <SectionHeader title="本地 Skill" />
        <p>删除会移除受管用户副本及其本地配置，不能恢复。</p>
        <Button
          variant="quiet"
          size="sm"
          tone="danger"
          type="button"
          disabled={skill.sourceKind === 'builtin'}
          onClick={() => setConfirmDelete(true)}
        >
          删除 Skill
        </Button>
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
