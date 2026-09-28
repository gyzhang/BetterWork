import type {
  ExpertDetail,
  ExpertRevisionDraft,
  ExpertSummary,
  MaterialCandidate,
  McpConnectionSummary,
  MemoryRecord,
  ModelProfileSummary,
  SkillSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { ActionBar } from '../components/ActionBar';
import { AsyncButton } from '../components/AsyncButton';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { CheckList } from '../components/CheckList';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { Field } from '../components/Field';
import { FieldSelect } from '../components/FieldSelect';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { ListRow } from '../components/ListRow';
import { McpToolBindingsPicker } from '../components/McpToolBindingsPicker';
import { SegmentedControl } from '../components/Tabs';
import { Tooltip } from '../components/Tooltip';
import type { ExpertsState } from '../hooks/use-experts';
import { useViewMode } from '../hooks/use-view-mode';
import { ExpertIcon, PlusIcon, SummonIcon } from '../icons';
import { reportAction } from '../lib/async-action';
import { materialCandidateAppliesToWorkspace, materialReferenceKey } from '../lib/materials';

const VIEW_MODE_STORAGE_KEY = 'experts-view-mode';

const lifecycleName = {
  active: '可召唤',
  disabled: '已停用',
  archived: '已归档',
} as const;
const blockedReasonName: Record<string, string> = {
  'missing-skill': '缺少 Skill',
  'skill-blocked': 'Skill 不可用',
  'missing-model': '缺少模型',
  'model-disabled': '模型已停用',
  'invalid-tool': '内置工具无效',
  'mcp-unavailable': 'MCP 工具不可用',
};

const builtinToolNames = [
  'calculator',
  'analyze_business_metrics',
  'read_text_file',
  'knowledge_search',
  'web_search',
  'web_fetch',
  'read_office_material',
] as const;

const MAX_TAGS = 6;

const defaultDraft = (): ExpertRevisionDraft => ({
  name: '',
  summary: '',
  author: '',
  tags: [],
  identity: '',
  principles: [],
  inputRequirements: [],
  deliveryRequirements: [],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
  mcpToolBindings: [],
  referenceMaterials: [],
});

const linesOf = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** 标签是一行短句，用逗号（中英文皆可）或换行分隔；重复与超出上限的直接丢掉。 */
const tagsOf = (value: string): string[] =>
  [
    ...new Set(
      value
        .split(/[,，、\n]/u)
        .map((tag) => tag.trim().slice(0, 40))
        .filter((tag) => tag.length > 0),
    ),
  ].slice(0, MAX_TAGS);

const draftOf = (detail: ExpertDetail): ExpertRevisionDraft => ({
  name: detail.revision.name,
  summary: detail.revision.summary,
  author: detail.revision.author,
  tags: detail.revision.tags,
  ...(detail.revision.avatarKey ? { avatarKey: detail.revision.avatarKey } : {}),
  identity: detail.revision.identity,
  principles: detail.revision.principles,
  inputRequirements: detail.revision.inputRequirements,
  deliveryRequirements: detail.revision.deliveryRequirements,
  skillPreset: detail.revision.skillPreset,
  builtinToolPolicy: detail.revision.builtinToolPolicy,
  modelReference: detail.revision.modelReference,
  mcpToolBindings: detail.revision.mcpToolBindings ?? [],
  referenceMaterials: detail.revision.referenceMaterials ?? [],
});

const referencePurpose = (candidate: MaterialCandidate): 'rule' | 'historical-comparison' =>
  candidate.reference.kind === 'knowledge-revision' ? 'rule' : 'historical-comparison';

const blockedHint = (expert: ExpertSummary): string =>
  `配置待补全：${expert.blockedReasons.map((reason) => blockedReasonName[reason] ?? reason).join('、')}`;

/** 卡片与列表行共用同一枚召唤按钮：禁用条件与失败措辞只有一份。 */
function ExpertSummon({
  expert,
  onSummon,
  onError,
  className,
}: {
  expert: ExpertSummary;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <Button
      variant="primary"
      size="lg"
      type="button"
      disabled={expert.lifecycle !== 'active'}
      onClick={() => reportAction(onSummon(expert), onError, '无法召唤该专家。')}
      {...(className ? { className } : {})}
    >
      <SummonIcon size={13} /> 召唤
    </Button>
  );
}

/** 署名行：作者（没署名时按来源说明）+ 版本号。版本号就是修订号，保存一次配置就 +1。 */
const expertByline = (expert: ExpertSummary): string =>
  `${expert.author || (expert.sourceKind === 'builtin' ? '内置' : '本机')} · v${expert.currentRevision}`;

/** 用途标签一行；停用／归档的状态片也走这一行，正常状态不占位置。 */
function ExpertTags({ expert }: { expert: ExpertSummary }): React.JSX.Element | null {
  if (expert.tags.length === 0 && expert.lifecycle === 'active') return null;
  return (
    <div className="expert-card-tags">
      {expert.lifecycle === 'active' ? undefined : (
        <Badge tone="neutral">{lifecycleName[expert.lifecycle]}</Badge>
      )}
      {expert.tags.map((tag) => (
        <Badge key={tag} shape="tag">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

interface ExpertActionProps {
  onOpen: (expert: ExpertSummary) => void;
  onEdit: (expert: ExpertSummary) => void;
  onCopy: (expert: ExpertSummary) => void;
  onDelete: (expert: ExpertSummary) => void;
  onToggleEnabled: (expert: ExpertSummary) => void;
}

/** 卡片与列表行拿的是同一份输入，两种视图因此不会各自长出一套动作。 */
interface ExpertCardProps {
  expert: ExpertSummary;
  actions: ExpertActionProps;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * 一排就地动作：详情／编辑（内置改为复制副本）／删除 ＋ 启用停用。
 *
 * 内置专家每次启动都由发布清单重新登记，改它会被后端拒（expert_builtin_readonly）、
 * 删了也还会回来，所以这两个入口换成「复制副本」，不给点了才知道不行的按钮。
 */
function ExpertActionButtons({
  expert,
  onOpen,
  onEdit,
  onCopy,
  onDelete,
  onToggleEnabled,
}: ExpertActionProps & { expert: ExpertSummary }): React.JSX.Element {
  const builtin = expert.sourceKind === 'builtin';
  return (
    <>
      <Button variant="text" size="sm" type="button" onClick={() => onOpen(expert)}>
        详情
      </Button>
      {builtin ? (
        <Button variant="text" size="sm" type="button" onClick={() => onCopy(expert)}>
          复制副本
        </Button>
      ) : (
        <>
          <Button variant="text" size="sm" type="button" onClick={() => onEdit(expert)}>
            编辑
          </Button>
          <Button
            variant="text"
            size="sm"
            tone="danger"
            type="button"
            onClick={() => onDelete(expert)}
          >
            删除
          </Button>
        </>
      )}
      <Button variant="text" size="sm" type="button" onClick={() => onToggleEnabled(expert)}>
        {expert.lifecycle === 'active' ? '停用' : '启用'}
      </Button>
    </>
  );
}

/**
 * 卡片：召唤是悬停才出现的浮层动作（`.expert-card-summon`），
 * 平时卡片只讲「这是谁、谁做的、第几版、干什么用」。
 */
function ExpertCard({ expert, onSummon, onError, actions }: ExpertCardProps): React.JSX.Element {
  return (
    <article className="expert-card">
      <div className="expert-card-top">
        <button className="expert-card-main" type="button" onClick={() => actions.onOpen(expert)}>
          <span className="expert-card-head">
            <span className="expert-card-mark" aria-hidden="true">
              <ExpertIcon size={18} />
            </span>
            <span className="expert-card-title">
              <strong>{expert.name}</strong>
              <small>{expertByline(expert)}</small>
            </span>
          </span>
          <Tooltip className="expert-card-desc">{expert.summary || '暂无说明'}</Tooltip>
        </button>
        <ExpertSummon
          className="expert-card-summon"
          expert={expert}
          onSummon={onSummon}
          onError={onError}
        />
      </div>
      <ExpertTags expert={expert} />
      {expert.blockedReasons.length > 0 && (
        <p className="expert-card-status">{blockedHint(expert)}</p>
      )}
      <div className="expert-card-actions">
        <ExpertActionButtons {...actions} expert={expert} />
      </div>
    </article>
  );
}

/** 列表模式：右槽已有按钮，所以整行不再是点击区；描述交给行的单行省略。 */
function ExpertRow({ expert, onSummon, onError, actions }: ExpertCardProps): React.JSX.Element {
  return (
    <ListRow
      as="article"
      variant="card"
      leading={
        <span className="expert-card-mark" aria-hidden="true">
          <ExpertIcon size={18} />
        </span>
      }
      title={expert.name}
      detail={expert.summary || '暂无说明'}
      meta={expertByline(expert)}
      actions={
        <>
          <ExpertSummon expert={expert} onSummon={onSummon} onError={onError} />
          <ExpertActionButtons {...actions} expert={expert} />
        </>
      }
    >
      <ExpertTags expert={expert} />
      {expert.blockedReasons.length > 0 && (
        <p className="expert-card-status">{blockedHint(expert)}</p>
      )}
    </ListRow>
  );
}

function ExpertEditor({
  draft,
  skills,
  mcpConnections,
  models,
  materialCandidates,
  workspaceId,
  editing,
  saving,
  backLabel,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ExpertRevisionDraft;
  skills: SkillSummary[];
  mcpConnections: McpConnectionSummary[];
  models: ModelProfileSummary[];
  materialCandidates: MaterialCandidate[];
  workspaceId?: string;
  editing: boolean;
  saving: boolean;
  /** 编辑器可能从列表卡片进来，也可能从配置页进来：返回按钮说的必须是它真正去的地方。 */
  backLabel: string;
  onChange: (draft: ExpertRevisionDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  const toolNames =
    draft.builtinToolPolicy.mode === 'allow-list' ? draft.builtinToolPolicy.toolNames : [];
  // 标签输入框保留用户正在敲的分隔符：直接把 draft.tags 拼回去会在敲完一个逗号后
  // 立刻把它吃掉，光标跟着被拽回去。
  const [tagText, setTagText] = useState(() => draft.tags.join('，'));
  const referenceMaterials = draft.referenceMaterials ?? [];
  const languageModels = models.filter((model) => model.role === 'language');
  const selectedModelProfileId =
    draft.modelReference.mode === 'profile' ? draft.modelReference.modelProfileId : undefined;
  const updateLines = (
    key: 'principles' | 'inputRequirements' | 'deliveryRequirements',
    value: string,
  ): void => onChange({ ...draft, [key]: linesOf(value) });
  return (
    <section className="expert-editor" aria-label={editing ? '编辑专家' : '新建专家'}>
      <PageHeader
        eyebrow="专家配置"
        title={editing ? '编辑专家修订' : '新建专家'}
        leading={
          <Button variant="text" size="sm" type="button" onClick={onCancel}>
            {backLabel}
          </Button>
        }
      />
      <ScrollRegion ariaLabel="专家编辑表单">
        <div className="page-body expert-editor-body">
          <Field label="名称">
            <input
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="简介">
            <textarea
              value={draft.summary}
              onChange={(event) => onChange({ ...draft, summary: event.target.value })}
              rows={2}
            />
          </Field>
          <Field
            controlId="expert-author"
            label="作者"
            hint="显示在卡片标题下方；留空时按来源显示「内置」或「本机」。"
          >
            <input
              id="expert-author"
              value={draft.author}
              onChange={(event) => onChange({ ...draft, author: event.target.value })}
            />
          </Field>
          <Field
            controlId="expert-tags"
            label={`用途标签（逗号分隔，最多 ${MAX_TAGS} 个）`}
            hint="给卡片上的一眼看：这个专家擅长什么，例如「研究报告、数据分析」。"
          >
            <input
              id="expert-tags"
              value={tagText}
              onChange={(event) => {
                setTagText(event.target.value);
                onChange({ ...draft, tags: tagsOf(event.target.value) });
              }}
            />
          </Field>
          <Field label="人格与职责">
            <textarea
              value={draft.identity}
              onChange={(event) => onChange({ ...draft, identity: event.target.value })}
              rows={4}
            />
          </Field>
          <Field label="工作原则（每行一条）">
            <textarea
              value={draft.principles.join('\n')}
              onChange={(event) => updateLines('principles', event.target.value)}
              rows={3}
            />
          </Field>
          <Field label="输入要求（每行一条）">
            <textarea
              value={draft.inputRequirements.join('\n')}
              onChange={(event) => updateLines('inputRequirements', event.target.value)}
              rows={3}
            />
          </Field>
          <Field label="交付要求（每行一条）">
            <textarea
              value={draft.deliveryRequirements.join('\n')}
              onChange={(event) => updateLines('deliveryRequirements', event.target.value)}
              rows={3}
            />
          </Field>
          <fieldset>
            <legend>Skill 预设</legend>
            <CheckList
              empty={<span className="muted-text">当前还没有可配置的 Skill。</span>}
              options={skills.map((skill) => ({
                id: skill.id,
                label: skill.name,
                checked: draft.skillPreset.some((binding) => binding.skillId === skill.id),
              }))}
              onToggle={(id, checked) =>
                onChange({
                  ...draft,
                  skillPreset: checked
                    ? [
                        ...draft.skillPreset,
                        {
                          skillId: id,
                          revisionId:
                            skills.find((skill) => skill.id === id)?.currentRevisionId ?? '',
                        },
                      ]
                    : draft.skillPreset.filter((binding) => binding.skillId !== id),
                })
              }
            />
          </fieldset>
          <fieldset>
            <legend>内置工具</legend>
            <label className="check-list-item">
              <input
                type="checkbox"
                checked={draft.builtinToolPolicy.mode === 'application-defaults'}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    builtinToolPolicy: event.target.checked
                      ? { mode: 'application-defaults' }
                      : { mode: 'allow-list', toolNames: [] },
                  })
                }
              />
              <span>使用算台默认工具</span>
            </label>
            {draft.builtinToolPolicy.mode === 'allow-list' && (
              <CheckList
                label="内置工具白名单"
                options={builtinToolNames.map((toolName) => ({
                  id: toolName,
                  label: toolName,
                  checked: toolNames.includes(toolName),
                }))}
                onToggle={(id, checked) =>
                  onChange({
                    ...draft,
                    builtinToolPolicy: {
                      mode: 'allow-list',
                      toolNames: checked
                        ? [...toolNames, id]
                        : toolNames.filter((name) => name !== id),
                    },
                  })
                }
              />
            )}
          </fieldset>
          <fieldset>
            <legend>模型偏好</legend>
            <Field label="新任务默认使用的语言模型">
              <FieldSelect
                ariaLabel="专家模型偏好"
                value={
                  draft.modelReference.mode === 'profile'
                    ? draft.modelReference.modelProfileId
                    : 'application-default'
                }
                onChange={(modelId) =>
                  onChange({
                    ...draft,
                    modelReference:
                      modelId === 'application-default'
                        ? { mode: 'application-default' }
                        : { mode: 'profile', modelProfileId: modelId },
                  })
                }
                options={[
                  { id: 'application-default', label: '应用默认模型' },
                  ...(selectedModelProfileId &&
                  !languageModels.some((model) => model.id === selectedModelProfileId)
                    ? [{ id: selectedModelProfileId, label: '当前配置的模型不可用' }]
                    : []),
                  ...languageModels.map((model) => ({
                    id: model.id,
                    label: `${model.name} · ${model.model}${model.enabled ? '' : '（已停用）'}`,
                    ...(model.enabled ? {} : { disabled: true }),
                  })),
                ]}
              />
            </Field>
            {languageModels.length === 0 && (
              <small className="muted-text">还没有配置语言模型，当前任务会使用应用默认模型。</small>
            )}
          </fieldset>
          <fieldset>
            <legend>MCP 工具预设</legend>
            <McpToolBindingsPicker
              connections={mcpConnections}
              bindings={draft.mcpToolBindings ?? []}
              onChange={(bindings) => onChange({ ...draft, mcpToolBindings: bindings })}
            />
          </fieldset>
          <fieldset>
            <legend>常用参考</legend>
            <small className="muted-text">
              召唤专家时带入选定的知识修订或历史成果；本期任务仍可移除或补充。
            </small>
            <CheckList
              empty={<span className="muted-text">当前工作空间还没有可引用的知识或成果。</span>}
              options={materialCandidates
                .filter((candidate) => candidate.reference.kind !== 'workspace-input-snapshot')
                .map((candidate) => {
                  const key = materialReferenceKey(candidate.reference);
                  const checked = referenceMaterials.some(
                    (item) => materialReferenceKey(item.reference) === key,
                  );
                  const applicable = materialCandidateAppliesToWorkspace(candidate, workspaceId);
                  return {
                    id: key,
                    label: (
                      <>
                        {candidate.title} · {candidate.sourceLabel}
                        {candidate.detail ? ` · ${candidate.detail}` : ''}
                        {!applicable ? ' · 不适用于当前工作空间' : ''}
                      </>
                    ),
                    checked,
                    disabled: (!applicable || candidate.status === 'unavailable') && !checked,
                  };
                })}
              onToggle={(id, checked) => {
                const candidate = materialCandidates.find(
                  (item) => materialReferenceKey(item.reference) === id,
                );
                if (!candidate) return;
                onChange({
                  ...draft,
                  referenceMaterials: checked
                    ? [
                        ...referenceMaterials,
                        {
                          reference: candidate.reference,
                          purpose: referencePurpose(candidate),
                        },
                      ]
                    : referenceMaterials.filter(
                        (item) => materialReferenceKey(item.reference) !== id,
                      ),
                });
              }}
            />
          </fieldset>
          <ActionBar as="div" label="保存专家修订">
            <Button variant="text" size="md" type="button" onClick={onCancel}>
              取消
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              busy={saving}
              label="保存修订"
              busyLabel="正在保存…"
              onClick={onSave}
            />
          </ActionBar>
        </div>
      </ScrollRegion>
    </section>
  );
}

function ExpertDetailPanel({
  detail,
  memories,
  models,
  workspaceId,
  onEdit,
  onCopy,
  onSummon,
  onBack,
  onLifecycle,
  onManageMemories,
}: {
  detail: ExpertDetail;
  memories: MemoryRecord[];
  models: ModelProfileSummary[];
  workspaceId?: string;
  onEdit: () => void;
  onCopy: () => void;
  onSummon: () => void;
  onBack: () => void;
  onLifecycle: (lifecycle: 'active' | 'disabled' | 'archived') => void;
  onManageMemories: () => void;
}): React.JSX.Element {
  const selectedModelProfileId =
    detail.revision.modelReference.mode === 'profile'
      ? detail.revision.modelReference.modelProfileId
      : undefined;
  const selectedModel = selectedModelProfileId
    ? models.find((model) => model.id === selectedModelProfileId)
    : undefined;
  const expertMemories = memories.filter((memory) => {
    if (memory.status === 'deleted') return false;
    if (memory.scope.kind === 'expert') return memory.scope.expertId === detail.id;
    return (
      memory.scope.kind === 'expert-workspace' &&
      memory.scope.expertId === detail.id &&
      memory.scope.workspaceId === workspaceId
    );
  });
  const confirmedMemoryCount = expertMemories.filter(
    (memory) => memory.status === 'confirmed',
  ).length;
  const candidateMemoryCount = expertMemories.filter(
    (memory) => memory.status === 'candidate',
  ).length;
  return (
    <section className="expert-detail-page">
      <PageHeader
        eyebrow="专家"
        title={detail.name}
        leading={
          <Button variant="text" size="sm" type="button" onClick={onBack}>
            返回列表
          </Button>
        }
        actions={
          <>
            <Button
              variant="primary"
              size="lg"
              type="button"
              disabled={detail.lifecycle !== 'active'}
              onClick={onSummon}
            >
              <SummonIcon size={13} /> 召唤
            </Button>
            {/* 内置专家后端拒绝直接改（expert_builtin_readonly）：入口按来源分档，
                不再让人点一次才知道不能改（ADR-0011，与技能页同口径）。 */}
            {detail.sourceKind === 'builtin' ? (
              <Button variant="secondary" size="md" type="button" onClick={onCopy}>
                复制为用户专家
              </Button>
            ) : (
              <Button variant="secondary" size="md" type="button" onClick={onEdit}>
                编辑配置
              </Button>
            )}
          </>
        }
      />
      <ScrollRegion ariaLabel="专家详情">
        <div className="page-body expert-detail-body">
          <div className="expert-detail-head">
            <p className="expert-detail-byline">{expertByline(detail)}</p>
            <p className="expert-detail-summary">{detail.summary || '暂无说明'}</p>
            <ExpertTags expert={detail} />
          </div>
          <section className="expert-detail-section">
            <h2>人格与职责</h2>
            <p>{detail.revision.identity}</p>
          </section>
          <section className="expert-detail-section">
            <h2>能力</h2>
            <p>
              {detail.revision.skillPreset.length} 个 Skill 预设 ·{' '}
              {detail.revision.builtinToolPolicy.mode === 'application-defaults'
                ? '使用算台默认工具'
                : `${detail.revision.builtinToolPolicy.toolNames.length} 个内置工具`}
              {detail.revision.mcpToolBindings?.length
                ? ` · ${detail.revision.mcpToolBindings.length} 个 MCP 工具预设`
                : ''}
              {detail.revision.referenceMaterials?.length
                ? ` · ${detail.revision.referenceMaterials.length} 个常用参考`
                : ''}
            </p>
            <small className="muted-text">
              模型偏好：
              {detail.revision.modelReference.mode === 'application-default'
                ? '应用默认模型'
                : (selectedModel?.name ?? '指定模型（当前不可用）')}
            </small>
          </section>
          <section className="expert-detail-section">
            <h2>记忆</h2>
            <p>
              {confirmedMemoryCount} 条已确认
              {candidateMemoryCount > 0 ? ` · ${candidateMemoryCount} 条待确认` : ''}
            </p>
            {expertMemories.length > 0 && (
              <ul className="expert-memory-summary">
                {expertMemories.slice(0, 3).map((memory) => (
                  <li key={memory.id}>{memory.content}</li>
                ))}
              </ul>
            )}
            {expertMemories.length === 0 && (
              <small className="muted-text">还没有与此专家关联的记忆，可在任务中确认经验。</small>
            )}
            <Button variant="text" size="sm" type="button" onClick={onManageMemories}>
              管理记忆
            </Button>
          </section>
          <section className="expert-detail-section">
            <h2>生命周期</h2>
            <div className="expert-detail-actions">
              {detail.lifecycle === 'active' && (
                <Button
                  variant="text"
                  size="sm"
                  type="button"
                  onClick={() => onLifecycle('disabled')}
                >
                  停用
                </Button>
              )}
              {detail.lifecycle === 'disabled' && (
                <Button
                  variant="text"
                  size="sm"
                  type="button"
                  onClick={() => onLifecycle('active')}
                >
                  重新启用
                </Button>
              )}
              {detail.lifecycle !== 'archived' && (
                <Button
                  variant="text"
                  size="sm"
                  tone="danger"
                  type="button"
                  onClick={() => onLifecycle('archived')}
                >
                  归档
                </Button>
              )}
            </div>
          </section>
        </div>
      </ScrollRegion>
    </section>
  );
}

export function ExpertsPage({
  state,
  skills,
  mcpConnections,
  memories,
  models,
  materialCandidates,
  workspaceId,
  actions,
  onSummon,
  onError,
  onManageMemories,
}: {
  state: ExpertsState;
  skills: SkillSummary[];
  mcpConnections: McpConnectionSummary[];
  memories: MemoryRecord[];
  models: ModelProfileSummary[];
  materialCandidates: MaterialCandidate[];
  workspaceId?: string;
  actions: Pick<
    ExpertsState,
    'get' | 'create' | 'saveRevision' | 'copy' | 'setLifecycle' | 'remove'
  >;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
  onManageMemories: (expert: ExpertDetail) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<ExpertDetail>();
  const [draft, setDraft] = useState<ExpertRevisionDraft>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorReturn, setEditorReturn] = useState<'list' | 'detail'>('list');
  const [pendingDelete, setPendingDelete] = useState<ExpertSummary>();
  const { viewMode, changeViewMode } = useViewMode(VIEW_MODE_STORAGE_KEY);

  const openDetail = (summary: ExpertSummary): void => {
    setDetailLoading(true);
    reportAction(
      actions.get(summary.id).then((detail) => {
        setSelected(detail ?? undefined);
        setDetailLoading(false);
      }),
      onError,
      '无法加载专家配置。',
    );
  };
  const openCreate = (): void => {
    setSelected(undefined);
    setEditorReturn('list');
    setDraft(defaultDraft());
    setEditorOpen(true);
  };
  const openEdit = (): void => {
    if (!selected) return;
    setEditorReturn('detail');
    setDraft(draftOf(selected));
    setEditorOpen(true);
  };
  /** 卡片上的「编辑」：先把当前修订取回来，不让人对着摘要行改配置。 */
  const openEditFromCard = (summary: ExpertSummary): void => {
    setDetailLoading(true);
    reportAction(
      actions.get(summary.id).then((detail) => {
        setDetailLoading(false);
        if (!detail) return;
        setSelected(detail);
        setEditorReturn('list');
        setDraft(draftOf(detail));
        setEditorOpen(true);
      }),
      onError,
      '无法加载专家配置。',
    );
  };
  /** 编辑器离开时必须回到它来的那一层：写着「返回列表」却落在配置页，等于让人多点一次。 */
  const cancelEditor = (): void => {
    setEditorOpen(false);
    if (editorReturn === 'list') setSelected(undefined);
  };
  const copyFromCard = (summary: ExpertSummary): void => {
    reportAction(
      actions.copy(summary.id).then(() => state.refresh()),
      onError,
      '复制专家失败。',
    );
  };
  const toggleEnabled = (summary: ExpertSummary): void => {
    reportAction(
      actions
        .setLifecycle({
          expertId: summary.id,
          lifecycle: summary.lifecycle === 'active' ? 'disabled' : 'active',
          expectedRevision: summary.currentRevision,
        })
        .then(() => state.refresh()),
      onError,
      '更新专家状态失败。',
    );
  };
  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    setPendingDelete(undefined);
    reportAction(
      actions.remove(pendingDelete.id).then(() => state.refresh()),
      onError,
      '删除专家失败。',
    );
  };
  /** 卡片与列表行共用同一组就地动作，两种视图的行为不允许分叉。 */
  const rowActions: ExpertActionProps = {
    onOpen: openDetail,
    onEdit: openEditFromCard,
    onCopy: copyFromCard,
    onDelete: setPendingDelete,
    onToggleEnabled: toggleEnabled,
  };
  const save = (): void => {
    if (!draft || !draft.name.trim() || !draft.identity.trim()) {
      onError('专家名称和人格与职责不能为空。');
      return;
    }
    setSaving(true);
    const action = selected
      ? actions.saveRevision({
          expertId: selected.id,
          expectedRevision: selected.currentRevision,
          revision: draft,
        })
      : actions.create(draft);
    reportAction(
      action
        .then(({ expert }) => {
          setSelected(expert);
          setDraft(undefined);
          setEditorOpen(false);
          state.refresh();
        })
        .finally(() => setSaving(false)),
      onError,
      '保存专家配置失败。',
    );
  };
  const copy = (): void => {
    if (!selected) return;
    reportAction(
      actions.copy(selected.id).then(({ expert }) => {
        setSelected(expert);
        state.refresh();
      }),
      onError,
      '复制专家失败。',
    );
  };
  const setLifecycle = (lifecycle: 'active' | 'disabled' | 'archived'): void => {
    if (!selected) return;
    reportAction(
      actions
        .setLifecycle({
          expertId: selected.id,
          lifecycle,
          expectedRevision: selected.currentRevision,
        })
        .then(({ expert }) => {
          setSelected(expert);
          state.refresh();
        }),
      onError,
      '更新专家状态失败。',
    );
  };

  if (editorOpen && draft) {
    return (
      <ExpertEditor
        draft={draft}
        skills={skills}
        mcpConnections={mcpConnections}
        models={models}
        materialCandidates={materialCandidates}
        {...(workspaceId ? { workspaceId } : {})}
        editing={Boolean(selected)}
        saving={saving}
        backLabel={editorReturn === 'detail' ? '返回详情' : '返回列表'}
        onChange={setDraft}
        onCancel={cancelEditor}
        onSave={save}
      />
    );
  }
  if (selected) {
    return (
      <ExpertDetailPanel
        detail={selected}
        memories={memories}
        models={models}
        {...(workspaceId ? { workspaceId } : {})}
        onEdit={openEdit}
        onCopy={copy}
        onSummon={() => reportAction(onSummon(selected), onError, '无法召唤该专家。')}
        onBack={() => setSelected(undefined)}
        onLifecycle={setLifecycle}
        onManageMemories={() => onManageMemories(selected)}
      />
    );
  }
  return (
    <section className="experts-page">
      <PageHeader
        eyebrow="专家"
        title="召唤固定的工作方式"
        actions={
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
            <Button variant="primary" size="lg" type="button" onClick={openCreate}>
              <PlusIcon size={13} /> 新建专家
            </Button>
          </>
        }
      />
      {state.error && (
        <p className="inline-message error" role="alert">
          {state.error}
        </p>
      )}
      <ScrollRegion ariaLabel="专家列表" busy={state.loading || detailLoading}>
        <section className="page-body skills-body">
          {state.loading || detailLoading ? (
            <LoadingPage label="正在加载专家…" />
          ) : state.experts.length === 0 ? (
            <EmptyPage
              eyebrow="专家"
              title="还没有可召唤的专家"
              detail="创建一个固定的工作方式，之后可以直接召唤开始工作。"
            />
          ) : viewMode === 'grid' ? (
            <ViewContainer mode="grid" className="expert-cards">
              {state.experts.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  expert={expert}
                  actions={rowActions}
                  onSummon={onSummon}
                  onError={onError}
                />
              ))}
            </ViewContainer>
          ) : (
            <ViewContainer mode="list" className="expert-rows">
              {state.experts.map((expert) => (
                <ExpertRow
                  key={expert.id}
                  expert={expert}
                  actions={rowActions}
                  onSummon={onSummon}
                  onError={onError}
                />
              ))}
            </ViewContainer>
          )}
        </section>
      </ScrollRegion>
      {pendingDelete && (
        <ConfirmationDialog
          title={`删除「${pendingDelete.name}」？`}
          detail="将删除这个专家的全部配置修订，以及挂在它名下的长期记忆，不能恢复。已经用它跑过的任务不受影响；若历史运行仍引用该专家，删除会被挡下，请改用归档。"
          confirmLabel="删除专家"
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}
