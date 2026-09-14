import type {
  ExpertDetail,
  ExpertRevisionDraft,
  ExpertSummary,
  MaterialCandidate,
  MaterialReference,
  McpConnectionSummary,
  SkillSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import type { ExpertsState } from '../hooks/use-experts';
import { ExpertIcon, PlusIcon } from '../icons';
import { reportAction } from '../lib/async-action';
import { canToggleMcpTool } from '../lib/mcp-selection';

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

const defaultDraft = (): ExpertRevisionDraft => ({
  name: '',
  summary: '',
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

const draftOf = (detail: ExpertDetail): ExpertRevisionDraft => ({
  name: detail.revision.name,
  summary: detail.revision.summary,
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

const referenceKey = (reference: MaterialReference): string => {
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

const referencePurpose = (candidate: MaterialCandidate): 'rule' | 'historical-comparison' =>
  candidate.reference.kind === 'knowledge-revision' ? 'rule' : 'historical-comparison';

const referenceApplicableToWorkspace = (
  candidate: MaterialCandidate,
  workspaceId?: string,
): boolean => {
  if (candidate.reference.kind !== 'artifact-version') return true;
  return Boolean(workspaceId && candidate.reference.originWorkspaceId === workspaceId);
};

function ExpertCard({
  expert,
  onOpen,
  onSummon,
  onError,
}: {
  expert: ExpertSummary;
  onOpen: (expert: ExpertSummary) => void;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
}): React.JSX.Element {
  const blocked = expert.blockedReasons.length > 0;
  const unavailable = expert.lifecycle !== 'active';
  return (
    <article className="expert-card">
      <button className="expert-card-main" type="button" onClick={() => onOpen(expert)}>
        <div className="expert-card-head">
          <span className="expert-card-mark" aria-hidden="true">
            <ExpertIcon size={18} />
          </span>
          <div>
            <strong>{expert.name}</strong>
            <small>{lifecycleName[expert.lifecycle]}</small>
          </div>
        </div>
        <p className="expert-card-desc">{expert.summary || '暂无说明'}</p>
      </button>
      {blocked && (
        <p className="expert-card-status">
          配置待补全：
          {expert.blockedReasons.map((reason) => blockedReasonName[reason] ?? reason).join('、')}
        </p>
      )}
      <div className="expert-card-actions">
        <button
          className="primary-button"
          type="button"
          disabled={unavailable}
          onClick={() => reportAction(onSummon(expert), onError, '无法召唤该专家。')}
        >
          召唤
        </button>
        <button className="text-button" type="button" onClick={() => onOpen(expert)}>
          查看配置
        </button>
      </div>
    </article>
  );
}

function ExpertEditor({
  draft,
  skills,
  mcpConnections,
  materialCandidates,
  workspaceId,
  editing,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ExpertRevisionDraft;
  skills: SkillSummary[];
  mcpConnections: McpConnectionSummary[];
  materialCandidates: MaterialCandidate[];
  workspaceId?: string;
  editing: boolean;
  saving: boolean;
  onChange: (draft: ExpertRevisionDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  const toolNames =
    draft.builtinToolPolicy.mode === 'allow-list' ? draft.builtinToolPolicy.toolNames : [];
  const referenceMaterials = draft.referenceMaterials ?? [];
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
          <button className="text-button" type="button" onClick={onCancel}>
            返回列表
          </button>
        }
      />
      <div className="page-scroll skills-scroll">
        <div className="page-body expert-editor-body">
          <label>
            名称
            <input
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            简介
            <textarea
              value={draft.summary}
              onChange={(event) => onChange({ ...draft, summary: event.target.value })}
              rows={2}
            />
          </label>
          <label>
            人格与职责
            <textarea
              value={draft.identity}
              onChange={(event) => onChange({ ...draft, identity: event.target.value })}
              rows={4}
            />
          </label>
          <label>
            工作原则（每行一条）
            <textarea
              value={draft.principles.join('\n')}
              onChange={(event) => updateLines('principles', event.target.value)}
              rows={3}
            />
          </label>
          <label>
            输入要求（每行一条）
            <textarea
              value={draft.inputRequirements.join('\n')}
              onChange={(event) => updateLines('inputRequirements', event.target.value)}
              rows={3}
            />
          </label>
          <label>
            交付要求（每行一条）
            <textarea
              value={draft.deliveryRequirements.join('\n')}
              onChange={(event) => updateLines('deliveryRequirements', event.target.value)}
              rows={3}
            />
          </label>
          <fieldset>
            <legend>Skill 预设</legend>
            <div className="expert-option-list">
              {skills.length === 0 ? (
                <span className="muted-text">当前还没有可配置的 Skill。</span>
              ) : (
                skills.map((skill) => {
                  const checked = draft.skillPreset.some((binding) => binding.skillId === skill.id);
                  return (
                    <label key={skill.id} className="expert-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            skillPreset: event.target.checked
                              ? [
                                  ...draft.skillPreset,
                                  { skillId: skill.id, revisionId: skill.currentRevisionId },
                                ]
                              : draft.skillPreset.filter((binding) => binding.skillId !== skill.id),
                          })
                        }
                      />
                      <span>{skill.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend>内置工具</legend>
            <label className="expert-option">
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
              使用算台默认工具
            </label>
            {draft.builtinToolPolicy.mode === 'allow-list' && (
              <div className="expert-option-list">
                {builtinToolNames.map((toolName) => (
                  <label key={toolName} className="expert-option">
                    <input
                      type="checkbox"
                      checked={toolNames.includes(toolName)}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          builtinToolPolicy: {
                            mode: 'allow-list',
                            toolNames: event.target.checked
                              ? [...toolNames, toolName]
                              : toolNames.filter((name) => name !== toolName),
                          },
                        })
                      }
                    />
                    {toolName}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend>MCP 工具预设</legend>
            {mcpConnections.length === 0 ? (
              <span className="muted-text">请先在设置 → MCP 工具中配置并检测连接。</span>
            ) : (
              <div className="selected-mcp-list">
                {mcpConnections.map((connection) => (
                  <div className="selected-mcp-connection" key={connection.id}>
                    <strong>{connection.name}</strong>
                    {connection.tools.length === 0 ? (
                      <small className="muted-text">尚未检测到工具</small>
                    ) : (
                      <div className="expert-option-list">
                        {connection.tools.map((tool) => {
                          const bindings = draft.mcpToolBindings ?? [];
                          const checked = bindings.some((binding) => binding.toolId === tool.id);
                          return (
                            <label className="expert-option" key={tool.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!canToggleMcpTool(connection.status, checked)}
                                onChange={(event) =>
                                  onChange({
                                    ...draft,
                                    mcpToolBindings: event.target.checked
                                      ? [
                                          ...bindings,
                                          { connectionId: connection.id, toolId: tool.id },
                                        ]
                                      : bindings.filter((binding) => binding.toolId !== tool.id),
                                  })
                                }
                              />
                              <span title={tool.description}>{tool.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend>常用参考</legend>
            <small className="muted-text">
              召唤专家时带入选定的知识修订或历史成果；本期任务仍可移除或补充。
            </small>
            <div className="expert-option-list">
              {materialCandidates.filter(
                (candidate) => candidate.reference.kind !== 'workspace-input-snapshot',
              ).length === 0 ? (
                <span className="muted-text">当前工作空间还没有可引用的知识或成果。</span>
              ) : (
                materialCandidates
                  .filter((candidate) => candidate.reference.kind !== 'workspace-input-snapshot')
                  .map((candidate) => {
                    const key = referenceKey(candidate.reference);
                    const checked = referenceMaterials.some(
                      (item) => referenceKey(item.reference) === key,
                    );
                    const applicable = referenceApplicableToWorkspace(candidate, workspaceId);
                    return (
                      <label className="expert-option" key={key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={(!applicable || candidate.status === 'unavailable') && !checked}
                          onChange={(event) =>
                            onChange({
                              ...draft,
                              referenceMaterials: event.target.checked
                                ? [
                                    ...referenceMaterials,
                                    {
                                      reference: candidate.reference,
                                      purpose: referencePurpose(candidate),
                                    },
                                  ]
                                : referenceMaterials.filter(
                                    (item) => referenceKey(item.reference) !== key,
                                  ),
                            })
                          }
                        />
                        <span>
                          {candidate.title} · {candidate.sourceLabel}
                          {candidate.detail ? ` · ${candidate.detail}` : ''}
                          {!applicable ? ' · 不适用于当前工作空间' : ''}
                        </span>
                      </label>
                    );
                  })
              )}
            </div>
          </fieldset>
          <div className="expert-editor-actions">
            <button className="primary-button" type="button" disabled={saving} onClick={onSave}>
              {saving ? '正在保存…' : '保存修订'}
            </button>
            <button className="text-button" type="button" onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExpertDetailPanel({
  detail,
  onEdit,
  onCopy,
  onSummon,
  onBack,
  onLifecycle,
}: {
  detail: ExpertDetail;
  onEdit: () => void;
  onCopy: () => void;
  onSummon: () => void;
  onBack: () => void;
  onLifecycle: (lifecycle: 'active' | 'disabled' | 'archived') => void;
}): React.JSX.Element {
  return (
    <section className="expert-detail-page">
      <PageHeader
        eyebrow="专家"
        title={detail.name}
        leading={
          <button className="text-button" type="button" onClick={onBack}>
            返回列表
          </button>
        }
        actions={
          <>
            <button
              className="primary-button"
              type="button"
              disabled={detail.lifecycle !== 'active'}
              onClick={onSummon}
            >
              召唤
            </button>
            <button className="secondary-button" type="button" onClick={onEdit}>
              编辑配置
            </button>
          </>
        }
      />
      <div className="page-scroll skills-scroll">
        <div className="page-body expert-detail-body">
          <p className="expert-detail-summary">{detail.summary || '暂无说明'}</p>
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
          </section>
          <section className="expert-detail-section">
            <h2>生命周期</h2>
            <div className="expert-detail-actions">
              {detail.lifecycle === 'active' && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => onLifecycle('disabled')}
                >
                  停用
                </button>
              )}
              {detail.lifecycle === 'disabled' && (
                <button className="text-button" type="button" onClick={() => onLifecycle('active')}>
                  重新启用
                </button>
              )}
              {detail.lifecycle !== 'archived' && (
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() => onLifecycle('archived')}
                >
                  归档
                </button>
              )}
              {detail.sourceKind === 'builtin' && (
                <button className="text-button" type="button" onClick={onCopy}>
                  复制为用户专家
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

export function ExpertsPage({
  state,
  skills,
  mcpConnections,
  materialCandidates,
  workspaceId,
  actions,
  onSummon,
  onError,
}: {
  state: ExpertsState;
  skills: SkillSummary[];
  mcpConnections: McpConnectionSummary[];
  materialCandidates: MaterialCandidate[];
  workspaceId?: string;
  actions: Pick<ExpertsState, 'get' | 'create' | 'saveRevision' | 'copy' | 'setLifecycle'>;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<ExpertDetail>();
  const [draft, setDraft] = useState<ExpertRevisionDraft>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

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
    setDraft(defaultDraft());
    setEditorOpen(true);
  };
  const openEdit = (): void => {
    if (!selected) return;
    setDraft(draftOf(selected));
    setEditorOpen(true);
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
        materialCandidates={materialCandidates}
        {...(workspaceId ? { workspaceId } : {})}
        editing={Boolean(selected)}
        saving={saving}
        onChange={setDraft}
        onCancel={() => setEditorOpen(false)}
        onSave={save}
      />
    );
  }
  if (selected) {
    return (
      <ExpertDetailPanel
        detail={selected}
        onEdit={openEdit}
        onCopy={copy}
        onSummon={() => reportAction(onSummon(selected), onError, '无法召唤该专家。')}
        onBack={() => setSelected(undefined)}
        onLifecycle={setLifecycle}
      />
    );
  }
  return (
    <section className="experts-page">
      <PageHeader
        eyebrow="专家"
        title="召唤固定的工作方式"
        actions={
          <button className="primary-button" type="button" onClick={openCreate}>
            <PlusIcon size={13} /> 新建专家
          </button>
        }
      />
      {state.error && (
        <p className="inline-message error" role="alert">
          {state.error}
        </p>
      )}
      <div className="page-scroll skills-scroll">
        <section className="page-body skills-body">
          {state.loading || detailLoading ? (
            <LoadingPage label="正在加载专家…" />
          ) : state.experts.length === 0 ? (
            <EmptyPage
              eyebrow="专家"
              title="还没有可召唤的专家"
              detail="创建一个固定的工作方式，之后可以直接召唤开始工作。"
            />
          ) : (
            <div className="expert-cards">
              {state.experts.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  expert={expert}
                  onOpen={openDetail}
                  onSummon={onSummon}
                  onError={onError}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
