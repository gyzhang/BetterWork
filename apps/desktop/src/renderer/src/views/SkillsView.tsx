import type { SkillSummary } from '@betterwork/agent-protocol';
import { useCallback, useState } from 'react';

import { AsyncButton } from '../components/AsyncButton';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { CatalogCard, CatalogRow, type EntryFacts } from '../components/CatalogCard';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Disclosure } from '../components/Disclosure';
import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { Field } from '../components/Field';
import { InlineError } from '../components/InlineError';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { Modal } from '../components/Modal';
import { SectionHeader } from '../components/SectionHeader';
import { DependencyPanel } from '../components/skills/DependencyPanel';
import { StatusNote } from '../components/StatusNote';
import { Switch } from '../components/Switch';
import { SegmentedControl } from '../components/Tabs';
import { TextField } from '../components/TextField';
import { TransientToast } from '../components/TransientToast';
import type { SkillDependenciesState } from '../hooks/use-skill-dependencies';
import { useSkillDependencies } from '../hooks/use-skill-dependencies';
import type { SkillsState } from '../hooks/use-skills';
import { useViewMode } from '../hooks/use-view-mode';
import { ChevronLeftIcon, InfoIcon, PlusIcon } from '../icons';
import { reportAction } from '../lib/async-action';
import { skillBlockedReasonName, skillEnvironmentName } from '../lib/labels';
import {
  declaredToolchainRequirements,
  unconfiguredEnvironmentVariableClues,
} from '../lib/skill-runtime-discovery';

const VIEW_MODE_STORAGE_KEY = 'skills-view-mode';

const sourceName = { builtin: '内置', user: '用户' } as const;
const trustName = {
  untrusted: '未信任',
  trusted: '已信任',
  'needs-review': '需复核',
  revoked: '已撤销',
} as const;

type ChipKind = 'source' | 'trust' | 'enabled' | 'environment';

/**
 * 删除的后果按仓储与 Schema 的实际语义写，不写成「不能恢复」一句带过：
 * `skills` 的四个子表都是 `ON DELETE CASCADE`，其中 `skill_revisions` 又带着
 * `run_skill_bindings` 一起级联——Run 本身留着，但「那次运行用了哪个 Skill 的哪一版」
 * 这条事实会消失（专家那边是 RESTRICT，删不掉被历史引用的，见 ADR-0030 §决策 3）。
 */
const DELETE_SKILL_WARNING =
  '将删除这个用户 Skill 的受管副本、运行配置与本地资源目录，并连带删除它的修订、启用偏好和依赖授权。' +
  '历史运行记录里指向这些修订的技能绑定也会一起删除——那次运行仍在，但不再能回答「当时用的是哪个版本的这个 Skill」。此操作不能恢复。';

/** 卡片与列表行共用的就地动作回调；确认框由 `SkillsPage` 统一持有。 */
interface SkillActions {
  onOpen: (skill: SkillSummary) => void;
  onToggleEnabled: (skill: SkillSummary) => void;
  onTrust: (skill: SkillSummary) => void;
  onRevokeTrust: (skill: SkillSummary) => void;
  onCopy: (skill: SkillSummary) => void;
  onDelete: (skill: SkillSummary) => void;
}

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

/**
 * 卡片与列表行共用的一组就地动作（docs/10 §10.1、ADR-0030 §决策 5 的同一口径）。
 *
 * 内置 Skill 正常启动时由发布清单重新登记，删不掉（`deleteUserSkill` 直接拒绝非 user 来源），
 * 所以那一档给「复制副本」而不给禁用按钮——禁用入口点了只知道「不行」，不告诉用户下一步。
 */
function SkillActionButtons({
  skill,
  actions,
}: {
  skill: SkillSummary;
  actions: SkillActions;
}): React.JSX.Element {
  const trusted = skill.trustStatus === 'trusted' || skill.trustStatus === 'needs-review';
  return (
    <>
      <Button variant="text" size="sm" type="button" onClick={() => actions.onOpen(skill)}>
        详情
      </Button>
      <Button variant="text" size="sm" type="button" onClick={() => actions.onToggleEnabled(skill)}>
        {skill.enabled ? '停用' : '启用'}
      </Button>
      {trusted ? (
        <Button variant="text" size="sm" type="button" onClick={() => actions.onRevokeTrust(skill)}>
          撤销信任
        </Button>
      ) : (
        <Button variant="text" size="sm" type="button" onClick={() => actions.onTrust(skill)}>
          信任
        </Button>
      )}
      {skill.sourceKind === 'builtin' ? (
        <Button variant="text" size="sm" type="button" onClick={() => actions.onCopy(skill)}>
          复制副本
        </Button>
      ) : (
        <Button
          variant="text"
          size="sm"
          tone="danger"
          type="button"
          onClick={() => actions.onDelete(skill)}
        >
          删除
        </Button>
      )}
    </>
  );
}

/**
 * 一条 Skill 要交代的那几件事，卡片档与列表档共用同一份（docs/10 §10.1、ADR-0032）。
 *
 * Skill 没有悬停才显形的主行动，四枚状态片同时充当标签行与状态说明；整行可点只有
 * 卡片档拿得到，由调用方作为 `onOpen` 传给 `CatalogCard`。
 */
function skillFacts(skill: SkillSummary, actions: SkillActions): EntryFacts {
  return {
    mark: skill.name.slice(0, 1).toUpperCase(),
    name: skill.name,
    byline: `${sourceName[skill.sourceKind]} Skill`,
    description: skill.description || '暂无描述',
    actions: <SkillActionButtons skill={skill} actions={actions} />,
    notes: <SkillChips skill={skill} />,
  };
}

export function SkillsPage({ state }: { state: SkillsState }): React.JSX.Element {
  const { selected, dismissToast: dismissStateToast } = state;
  const dependencies = useSkillDependencies(selected, state.refresh);
  const { dismissToast: dismissDepsToast } = dependencies;
  const toast = state.toast || dependencies.toast;
  const dismissToast = useCallback((): void => {
    dismissStateToast();
    dismissDepsToast();
  }, [dismissStateToast, dismissDepsToast]);
  const { viewMode, changeViewMode } = useViewMode(VIEW_MODE_STORAGE_KEY);
  // 确认框由页面持有：卡片和列表行各有一组动作，同一时刻只可能有一个待确认对象。
  const [pendingRevoke, setPendingRevoke] = useState<SkillSummary>();
  const [pendingDelete, setPendingDelete] = useState<SkillSummary>();
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const submitUrl = (): void => {
    reportAction(
      state.importSkillFromUrl(importUrl).then((imported) => {
        if (!imported) return;
        setImportUrlOpen(false);
        setImportUrl('');
      }),
      state.clearError,
      '导入 Skill 失败。',
    );
  };
  const actions: SkillActions = {
    onOpen: (skill) => state.select(skill),
    onToggleEnabled: (skill) => state.setEnabled(skill, !skill.enabled),
    onTrust: (skill) => state.setTrust(skill, true),
    onRevokeTrust: (skill) => setPendingRevoke(skill),
    onCopy: (skill) => state.copy(skill),
    onDelete: (skill) => setPendingDelete(skill),
  };

  return (
    <section className="skills-page">
      <PageHeader
        eyebrow="技能"
        title="管理可复用的工作方法"
        leading={
          selected ? (
            <Button variant="text" size="sm" type="button" onClick={state.deselect}>
              <ChevronLeftIcon size={13} /> 返回
            </Button>
          ) : undefined
        }
        actions={
          selected ? undefined : (
            <>
              <Button
                variant="secondary"
                size="lg"
                type="button"
                onClick={() => {
                  state.clearError();
                  setImportUrlOpen(true);
                }}
              >
                从链接导入
              </Button>
              <SegmentedControl
                size="lg"
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
                size="lg"
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
      {state.error && !importUrlOpen && (
        <InlineError message={state.error} onDismiss={state.clearError} />
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
              detail="导入文件夹、ZIP 包或 HTTPS 链接，也可以等待内置技能加入这里。"
            />
          ) : viewMode === 'grid' ? (
            <ViewContainer mode="grid" className="skill-cards">
              {state.skills.map((skill) => (
                <CatalogCard
                  key={skill.id}
                  facts={skillFacts(skill, actions)}
                  onOpen={() => actions.onOpen(skill)}
                />
              ))}
            </ViewContainer>
          ) : (
            <ViewContainer mode="list" className="skill-rows">
              {state.skills.map((skill) => (
                <CatalogRow key={skill.id} facts={skillFacts(skill, actions)} />
              ))}
            </ViewContainer>
          )}
        </section>
      </ScrollRegion>
      {pendingRevoke ? (
        <ConfirmationDialog
          title="撤销 Skill 信任？"
          detail="撤销后将立即禁止新的脚本执行；正在运行的执行会由运行服务负责清理。"
          confirmLabel="撤销信任"
          onCancel={() => setPendingRevoke(undefined)}
          onConfirm={() => {
            const target = pendingRevoke;
            setPendingRevoke(undefined);
            state.revokeTrust(target);
          }}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmationDialog
          title="删除这个 Skill？"
          detail={DELETE_SKILL_WARNING}
          confirmLabel="删除 Skill"
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(undefined);
            reportAction(state.deleteSkill(target), state.clearError, '删除 Skill 失败，请重试。');
          }}
        />
      ) : null}
      {importUrlOpen ? (
        <Modal variant="dialog" label="从链接导入 Skill" onClose={() => setImportUrlOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitUrl();
            }}
          >
            <SectionHeader variant="block" title="从链接导入 Skill" />
            <Field
              controlId="skill-package-url"
              label="Skill ZIP 链接"
              hint="使用 HTTPS ZIP 包。BetterWork 会读取包内元数据并校验依赖，不会在导入时执行脚本。"
            >
              <TextField
                id="skill-package-url"
                size="md"
                type="url"
                autoComplete="url"
                value={importUrl}
                onChange={(event) => setImportUrl(event.currentTarget.value)}
                placeholder="https://example.com/skill-package.zip"
              />
            </Field>
            {state.error && <InlineError message={state.error} onDismiss={state.clearError} />}
            <div className="dependency-actions">
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => setImportUrlOpen(false)}
              >
                取消
              </Button>
              <AsyncButton
                variant="primary"
                size="md"
                type="submit"
                busy={state.importing}
                label="导入"
                busyLabel="正在下载并导入…"
                disabled={!importUrl.trim()}
              />
            </div>
          </form>
        </Modal>
      ) : null}
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
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!skill) return <></>;
  const profile = skill.runtimeProfile?.profile;
  const toolchainRequirements = declaredToolchainRequirements(profile);
  const unconfiguredEnvironmentVariables = unconfiguredEnvironmentVariableClues(
    skill.runtimeDiscovery,
    toolchainRequirements,
  );
  const hasUnconfiguredPythonDependencies =
    !profile?.dependencyLockId &&
    !profile?.dependencyBundle &&
    (skill.runtimeDiscovery ?? []).some(
      (finding) => finding.kind === 'package-install-hint' || finding.kind === 'dependency-file',
    );
  const runtimeConfigurationNeedsReview =
    unconfiguredEnvironmentVariables.length > 0 || hasUnconfiguredPythonDependencies;
  const displayedEnvironmentStatus = runtimeConfigurationNeedsReview
    ? 'unprepared'
    : skill.environmentStatus;
  const displayedBlockedReasons = runtimeConfigurationNeedsReview
    ? [...skill.blockedReasons, '导入扫描发现尚未配置的 Skill 运行需求']
    : skill.blockedReasons;
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
          <strong>{skillEnvironmentName[displayedEnvironmentStatus]}</strong>
        </div>
      </div>
      <div className="skill-trust-box">
        <Switch
          label="受信任：允许在已授权范围内执行脚本"
          checked={trustRequested}
          onChange={(next) => state.setTrust(skill, next)}
        />
        <p>
          <InfoIcon size={13} /> 脚本以本机用户权限运行，信任不提供沙箱隔离。
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
          title="Skill 运行需求"
          hint="应用识别并显示 Skill 声明的需求；导入检查只读取文件，不会执行脚本。"
        />
        {profile ? (
          <>
            <p>
              Python {profile.pythonRequirement ?? '由应用默认选择'}
              {profile.dependencyBundle
                ? ` · Skill 包依赖锁 ${profile.dependencyBundle.id}`
                : profile.dependencyLockId
                  ? ` · 依赖锁 ${profile.dependencyLockId}`
                  : ''}
            </p>
            <p>
              执行入口：
              {profile.commands.length > 0
                ? profile.commands.map((command) => command.label).join('、')
                : '无脚本命令'}
            </p>
            <p>
              外部工具链：
              {toolchainRequirements.length > 0
                ? toolchainRequirements
                    .map(
                      (requirement) =>
                        `${requirement.name}${requirement.versionHint ? ` ${requirement.versionHint}` : ''}（${requirement.environmentVariable}）`,
                    )
                    .join('、')
                : unconfiguredEnvironmentVariables.length > 0
                  ? '未配置（发现线索待确认）'
                  : '未在运行配置中声明'}
              {toolchainRequirements.length > 0 && unconfiguredEnvironmentVariables.length > 0
                ? ` · 另有线索待确认：${unconfiguredEnvironmentVariables.join('、')}`
                : ''}
            </p>
          </>
        ) : (
          <StatusNote
            tone="warning"
            message="当前 Skill 尚未匹配已审核的运行配置。静态发现结果只提供线索，不会自动允许执行。"
          />
        )}
        {skill.runtimeDiscovery && skill.runtimeDiscovery.length > 0 ? (
          <Disclosure
            className="skill-runtime-discovery"
            label={<Badge>导入时发现的线索({skill.runtimeDiscovery.length})</Badge>}
          >
            <ul>
              {skill.runtimeDiscovery.map((finding, index) => (
                <li key={`${finding.sourcePath}:${finding.lineNumber}:${index}`}>
                  {finding.label} · {finding.sourcePath}:{finding.lineNumber}
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : (
          <p>没有发现常见 Python 脚本、依赖声明文件或外部工具链引用。</p>
        )}
      </div>
      <DependencyPanel
        skill={skill}
        state={dependencies}
        onOpenSkill={(skillId) => {
          const referenced = state.skills.find((item) => item.id === skillId);
          if (referenced) state.select(referenced);
        }}
      />
      <div className="skill-detail-section">
        <SectionHeader title="可运行性" />
        {displayedBlockedReasons.length ? (
          <StatusNote
            tone="warning"
            problems={displayedBlockedReasons.map(skillBlockedReasonName)}
          />
        ) : (
          <StatusNote tone="success" message="当前没有阻塞原因。" />
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
            skill.trustStatus !== 'trusted' ||
            !skill.enabled ||
            displayedBlockedReasons.length > 0 ||
            runtimeConfigurationNeedsReview
          }
          onClick={() => state.testRun(skill)}
        >
          试运行
        </Button>
      </div>
      <div className="skill-detail-section">
        <SectionHeader title="本地 Skill" />
        {skill.sourceKind === 'builtin' ? (
          <>
            <p>
              内置 Skill
              正常启动时由发布清单重新登记，改不了也删不掉；要按自己的方式用，先复制一份。
            </p>
            <Button variant="secondary" size="md" type="button" onClick={() => state.copy(skill)}>
              复制副本
            </Button>
          </>
        ) : (
          <>
            <p>删除会移除受管用户副本及其本地配置，不能恢复。</p>
            <Button
              variant="quiet"
              size="sm"
              tone="danger"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              删除 Skill
            </Button>
          </>
        )}
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
          detail={DELETE_SKILL_WARNING}
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
