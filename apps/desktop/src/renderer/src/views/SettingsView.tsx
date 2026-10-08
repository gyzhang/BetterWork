import type {
  McpConnectionSummary,
  ModelProfileSummary,
  SaveMcpConnectionRequest,
} from '@betterwork/agent-protocol';
import { DEFAULT_MAX_SKILL_TOOL_ROUNDS, MAX_SKILL_TOOL_ROUNDS } from '@betterwork/agent-protocol';
import React from 'react';

import type {
  AppearanceMode,
  AppearancePreference,
  ColorScheme,
  ResolvedAppearance,
} from '../appearance';
import { colorSchemes } from '../appearance';
import { ActionBar } from '../components/ActionBar';
import { AsyncButton, InlineLoading } from '../components/AsyncButton';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { Disclosure } from '../components/Disclosure';
import { EmptyNotice } from '../components/EmptyState';
import { Field } from '../components/Field';
import { FieldSelect } from '../components/FieldSelect';
import { InlineError } from '../components/InlineError';
import { ListRow } from '../components/ListRow';
import { type NavEntry, NavList } from '../components/NavList';
import { SectionHeader } from '../components/SectionHeader';
import { StatusNote } from '../components/StatusNote';
import { Switch } from '../components/Switch';
import { SegmentedControl } from '../components/Tabs';
import { TextArea, TextField } from '../components/TextField';
import { TransientToast } from '../components/TransientToast';
import type { ConversationAddresses } from '../hooks/use-conversation-addresses';
import type { McpConnectionsState } from '../hooks/use-mcp-connections';
import type { MemoriesState } from '../hooks/use-memories';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import { useRunSettings } from '../hooks/use-run-settings';
import { useRuntimeComponents } from '../hooks/use-runtime-components';
import { useSearchEngineSettings } from '../hooks/use-search-engine-settings';
import { useTransientToast } from '../hooks/use-transient-toast';
import { PlusIcon } from '../icons';
import { reportAction, trackAction } from '../lib/async-action';
import { connectionStatusName, roleName } from '../lib/labels';
import type { SettingsTab } from '../lib/view-types';
import { type MemoryManagementTarget, MemoryPage } from './MemoryView';

export interface SettingsPageProps {
  tab: SettingsTab;
  setTab: (tab: SettingsTab) => void;
  models: ModelProfileSummary[];
  modelFilter: ModelProfileSummary['role'] | 'all';
  setModelFilter: (filter: ModelProfileSummary['role'] | 'all') => void;
  activeLanguageModel?: ModelProfileSummary | undefined;
  defaultModelIds: Map<ModelProfileSummary['role'], string | undefined>;
  onAdd: () => void;
  onEdit: (model: ModelProfileSummary) => void;
  onToggle: (model: ModelProfileSummary) => void;
  onSetDefault: (model: ModelProfileSummary) => void;
  onDelete: (model: ModelProfileSummary) => void;
  appearance: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  onMode: (mode: AppearanceMode) => void;
  onScheme: (scheme: ColorScheme) => void;
  conversationAddresses: ConversationAddresses;
  onAssistantAddressChange: (value: string) => void;
  onUserAddressChange: (value: string) => void;
  memories: MemoriesState;
  memoryTarget?: MemoryManagementTarget;
  onClearMemoryTarget: () => void;
  /** 自动建议区（§3.3）：只在设置 → 记忆 期间取数与轮询。 */
  memorySuggestions?: MemorySuggestionsState;
  workspaceId?: string;
  workspaceName?: string;
  expertName?: string;
  /** 从任务面板「编辑并确认」或简报跳转过来时预开的候选。 */
  memoryFocusId?: string;
  onClearMemoryFocus: () => void;
  mcp: McpConnectionsState;
}
/**
 * 设置左侧分区。选中态由 `NavList` 给 `aria-current` 与底色，
 * 这里只声明顺序与名称——顺序即信息架构，改动前先对 docs/10 §6.4。
 */
/** 模型清单的角色筛选：切换的是同一份清单的显示范围，所以是切换组而不是页签。 */
const MODEL_FILTER_ITEMS = (['all', 'language', 'vision', 'embedding'] as const).map((role) => ({
  id: role,
  label: role === 'all' ? '全部' : roleName[role],
}));

const SETTINGS_NAV_ITEMS: readonly NavEntry<SettingsTab>[] = [
  { id: 'models', label: '模型' },
  { id: 'search', label: '搜索' },
  { id: 'mcp', label: 'MCP' },
  { id: 'runtime', label: '运行' },
  { id: 'memory', label: '记忆' },
  { id: 'appearance', label: '外观' },
  { id: 'general', label: '通用' },
];

export function SettingsPage(props: SettingsPageProps): React.JSX.Element {
  const { tab, setTab } = props;
  return (
    <div className={tab === 'memory' ? 'settings-layout settings-layout-fixed' : 'settings-layout'}>
      <aside className="settings-nav-list">
        <p className="eyebrow">设置</p>
        <h1>偏好与能力</h1>
        <NavList
          variant="panel"
          label="设置分区"
          value={tab}
          onSelect={setTab}
          items={SETTINGS_NAV_ITEMS}
        />
      </aside>
      <section className="settings-content">
        <SettingsContent {...props} />
      </section>
    </div>
  );
}

/** 显式分支让每个设置分区的标题/布局都能独立检查，避免多组互斥条件被合并计数。 */
function SettingsContent(props: SettingsPageProps): React.JSX.Element {
  switch (props.tab) {
    case 'models':
      return <ModelSettings {...props} />;
    case 'search':
      return <SearchSettings />;
    case 'mcp':
      return <McpSettings state={props.mcp} />;
    case 'memory':
      return (
        <MemoryPage
          state={props.memories}
          {...(props.memoryTarget ? { scopeTarget: props.memoryTarget } : {})}
          onClearScope={props.onClearMemoryTarget}
          {...(props.memorySuggestions ? { suggestions: props.memorySuggestions } : {})}
          {...(props.workspaceId ? { workspaceId: props.workspaceId } : {})}
          {...(props.workspaceName ? { workspaceName: props.workspaceName } : {})}
          {...(props.expertName ? { expertName: props.expertName } : {})}
          {...(props.memoryFocusId ? { focusMemoryId: props.memoryFocusId } : {})}
          onFocusHandled={props.onClearMemoryFocus}
        />
      );
    case 'appearance':
      return <AppearanceSettings {...props} />;
    case 'runtime':
      return <RuntimeSettings />;
    case 'general':
      return <GeneralSettings {...props} />;
  }
}

function RuntimeSettings(): React.JSX.Element {
  return (
    <div className="settings-section-stack">
      <RunExecutionSettings />
      <RuntimeComponentsSettings />
    </div>
  );
}

export function RuntimeComponentsSettings(): React.JSX.Element {
  const { distributions, loading, error, refresh } = useRuntimeComponents();

  return (
    <section className="settings-section">
      <SectionHeader
        variant="block"
        eyebrow="运行时"
        title="由 BetterWork 管理 Skill 的运行时"
        hint="应用统一维护受管 CPython；首次准备 Skill 环境时会按固定来源下载并校验。通常无需选择 Python 路径，依赖安装在 Skill 专属环境中。"
        actions={
          <Button variant="secondary" size="lg" type="button" onClick={refresh}>
            重新检查
          </Button>
        }
      />
      {error && <InlineError message={error} />}
      {loading ? (
        <InlineLoading label="正在检查运行时…" />
      ) : distributions.length > 0 ? (
        <div className="runtime-component-list">
          {distributions.map((distribution) => (
            <ListRow
              key={distribution.id}
              title={`受管 CPython ${distribution.version}`}
              detail={`${distribution.platform.os}/${distribution.platform.arch} · ${distribution.license}`}
              meta={distribution.installed ? '运行时制品已落地' : '尚未下载，首次使用时自动准备'}
              trailing={
                <Badge tone={distribution.installed ? 'success' : 'outline'}>
                  {distribution.installed ? '已落地' : '按需准备'}
                </Badge>
              }
            />
          ))}
        </div>
      ) : (
        <EmptyNotice
          title="没有适用于当前设备的受管 Python"
          detail="当前 Skill 运行时目录没有可用发行版本。"
        />
      )}
    </section>
  );
}

function GeneralSettings({
  conversationAddresses,
  onAssistantAddressChange,
  onUserAddressChange,
}: SettingsPageProps): React.JSX.Element {
  return (
    <section className="settings-section">
      <SectionHeader
        variant="block"
        eyebrow="通用"
        title="相互称呼"
        hint="工作对话中的发言人标签会使用这里设置的称呼。"
      />
      <Field
        label="AI 的称呼"
        controlId="conversation-assistant-address"
        hint="显示在 AI 回复上方。"
      >
        <TextField
          id="conversation-assistant-address"
          size="md"
          maxLength={40}
          value={conversationAddresses.assistant}
          onChange={(event) => onAssistantAddressChange(event.target.value)}
        />
      </Field>
      <Field label="我的称呼" controlId="conversation-user-address" hint="显示在你的发言上方。">
        <TextField
          id="conversation-user-address"
          size="md"
          maxLength={40}
          value={conversationAddresses.user}
          onChange={(event) => onUserAddressChange(event.target.value)}
        />
      </Field>
    </section>
  );
}

function RunExecutionSettings(): React.JSX.Element {
  const {
    settings,
    draft,
    enableBuiltinSkills,
    enableBuiltinExperts,
    loading,
    saving,
    error,
    setDraft,
    setEnableBuiltinSkills,
    setEnableBuiltinExperts,
    flushDraft,
    retrySave,
    refresh,
  } = useRunSettings();
  const value = Number(draft);
  const valid = Number.isInteger(value) && value >= 1 && value <= MAX_SKILL_TOOL_ROUNDS;

  return (
    <section className="settings-section">
      <SectionHeader
        variant="block"
        eyebrow="运行"
        title="运行设置"
        hint="控制内置 Skill 与专家的可用范围，以及带 Skill 的 Run 工具调用轮数。开关立即保存；轮数停止输入后自动保存，也会在离开输入框时保存。"
      />
      {loading && <InlineLoading label="正在读取运行设置…" />}
      {!loading && !settings && error && <InlineError message={error} onRetry={refresh} />}
      {!loading && settings && (
        <>
          {error && <InlineError message={error} onRetry={retrySave} />}
          {saving && <StatusNote message="正在保存运行设置…" />}
          <SectionHeader
            variant="block"
            eyebrow="运行 · 内置资源"
            title="启用内置 Skill 与专家"
            hint="更改后立即影响列表和新 Run。关闭会隐藏已有内置项并阻止新 Run 使用，不删除数据库记录或历史；关闭内置 Skill 时，依赖它的内置专家也不可用。若本地缺少记录，重新开启后普通启动应用会完成登记。"
          />
          <div className="settings-switch-list">
            <Switch
              label="启用内置 Skill"
              checked={enableBuiltinSkills}
              disabled={loading}
              onChange={setEnableBuiltinSkills}
            />
            <Switch
              label="启用内置专家"
              checked={enableBuiltinExperts}
              disabled={loading}
              onChange={setEnableBuiltinExperts}
            />
          </div>
          <SectionHeader
            variant="block"
            eyebrow="运行"
            title="Skill 工具调用上限"
            hint="默认 200 轮，只影响新启动的、绑定了 Skill 的 Run。调高可容纳更长的生成与修订流程；上限越高，运行时间和模型调用量也可能增加。"
          />
          <Field
            label="最大工具轮数"
            controlId="max-skill-tool-rounds"
            hint={
              valid
                ? `允许范围 1–${MAX_SKILL_TOOL_ROUNDS}；当前默认值为 ${DEFAULT_MAX_SKILL_TOOL_ROUNDS}。`
                : `请输入 1–${MAX_SKILL_TOOL_ROUNDS} 之间的整数；修正后会自动保存。`
            }
          >
            <TextField
              id="max-skill-tool-rounds"
              size="md"
              type="number"
              min={1}
              max={MAX_SKILL_TOOL_ROUNDS}
              step={1}
              value={draft}
              disabled={loading}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={flushDraft}
              aria-invalid={!valid}
            />
          </Field>
        </>
      )}
    </section>
  );
}

function ModelSettings({
  models,
  modelFilter,
  setModelFilter,
  defaultModelIds,
  onAdd,
  onEdit,
  onToggle,
  onSetDefault,
  onDelete,
}: SettingsPageProps): React.JSX.Element {
  return (
    <section className="settings-section">
      <SectionHeader
        variant="block"
        eyebrow="模型"
        title="让每一种工作使用合适的模型"
        hint="API Key 仅保存于本机主进程。语言模型用于任务协作；嵌入模型用于知识语义检索，索引状态在知识页管理。"
        actions={
          <Button variant="primary" size="lg" type="button" onClick={onAdd}>
            <PlusIcon size={13} /> 添加模型
          </Button>
        }
      />
      <SegmentedControl
        size="md"
        className="model-filter"
        label="按角色筛选模型"
        value={modelFilter}
        onChange={setModelFilter}
        items={MODEL_FILTER_ITEMS}
      />
      <div className="model-list">
        {models.length === 0 ? (
          <EmptyNotice
            title="尚未配置模型"
            detail="添加一个 OpenAI-compatible 服务后，即可从教学链路切换到真实模型。"
          />
        ) : (
          models.map((model) => {
            const isDefault = defaultModelIds.get(model.role) === model.id;
            return (
              <ListRow
                key={model.id}
                as="article"
                tone={model.enabled ? 'default' : 'muted'}
                leading={
                  <span className="model-role-icon" aria-hidden="true">
                    {model.role === 'language' ? '文' : model.role === 'vision' ? '图' : '嵌'}
                  </span>
                }
                title={
                  <>
                    {model.name}
                    {isDefault && (
                      <Badge tone="brand" shape="tag">
                        {model.role === 'language' ? '当前工作模型' : '默认模型'}
                      </Badge>
                    )}
                  </>
                }
                detail={`${roleName[model.role]} · ${model.provider} · ${model.model}`}
                meta={
                  <>
                    {model.apiKeyConfigured ? '已配置凭据' : '未配置凭据'} ·{' '}
                    <ConnectionStatus
                      status={model.connectionStatus}
                      label={connectionStatusName[model.connectionStatus]}
                    />{' '}
                    · {model.enabled ? '已启用' : '已停用'}
                  </>
                }
                actions={
                  <>
                    <Button variant="quiet" size="sm" type="button" onClick={() => onEdit(model)}>
                      编辑
                    </Button>
                    {!isDefault && (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={!model.enabled}
                        onClick={() => onSetDefault(model)}
                      >
                        设为默认
                      </Button>
                    )}
                    <Switch label="启用" checked={model.enabled} onChange={() => onToggle(model)} />
                    <Button
                      variant="quiet"
                      size="sm"
                      tone="danger"
                      type="button"
                      onClick={() => onDelete(model)}
                    >
                      删除
                    </Button>
                  </>
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
function AppearanceSettings({
  appearance,
  resolvedAppearance,
  onMode,
  onScheme,
}: SettingsPageProps): React.JSX.Element {
  return (
    <section className="settings-section appearance-settings">
      <SectionHeader
        variant="block"
        eyebrow="外观"
        title="选择适合长期工作的界面"
        hint="外观模式与色系独立保存；跟随系统时仍会保留你选择的色系。"
      />
      <section className="appearance-group">
        <SectionHeader title="外观模式" />
        <div className="appearance-modes">
          {(
            [
              ['light', '浅色'],
              ['dark', '深色'],
              ['system', '跟随系统'],
            ] as const
          ).map(([mode, label]) => (
            <button
              type="button"
              className="option-card"
              aria-pressed={appearance.mode === mode}
              key={mode}
              onClick={() => onMode(mode)}
            >
              <span className={`mode-preview ${mode}`}>
                <i />
                <b />
                <em />
              </span>
              <strong>{label}</strong>
              {mode === 'system' && (
                <small>当前为{resolvedAppearance === 'dark' ? '深色' : '浅色'}</small>
              )}
            </button>
          ))}
        </div>
      </section>
      <section className="appearance-group">
        <SectionHeader title="色系" />
        <div className="scheme-grid">
          {colorSchemes.map((scheme) => (
            <button
              type="button"
              className="option-card"
              aria-pressed={appearance.scheme === scheme.id}
              key={scheme.id}
              onClick={() => onScheme(scheme.id)}
            >
              <span className={`scheme-preview ${scheme.id}`}>
                <i />
                <i />
                <i />
              </span>
              <strong>{scheme.name}</strong>
              <small>{scheme.description}</small>
            </button>
          ))}
        </div>
      </section>
      <StatusNote message="所有色系都提供浅色与深色 Variant。应用换肤不会改变 Word、PPT、Excel 和其他成果自身的配色。" />
    </section>
  );
}

/** 目前只有千帆接通了协议字段，其余引擎先作为不可选项占位。 */
const SEARCH_ENGINE_OPTIONS = [
  { id: 'baidu_qianfan', label: '百度千帆 AI 搜索' },
  { id: 'more', label: '更多搜索引擎即将支持', disabled: true },
];

export function SearchSettings(): React.JSX.Element {
  const [engine, setEngine] = React.useState('baidu_qianfan');
  const {
    configured,
    apiKey,
    setApiKey,
    webTopK,
    setWebTopK,
    toast,
    error,
    busy,
    dismissToast,
    save,
    test,
  } = useSearchEngineSettings();
  return (
    <section className="settings-section search-settings">
      <SectionHeader
        variant="block"
        eyebrow="搜索"
        title="为智能体接入联网搜索"
        hint="API Key 仅保存于本机主进程。启用后，智能体在任务需要时会搜索互联网，并给过程与成果标注网页来源。"
      />
      {error && <InlineError message={error} />}
      <div className="search-form">
        <Field label="搜索引擎">
          <FieldSelect
            size="md"
            value={engine}
            onChange={setEngine}
            options={SEARCH_ENGINE_OPTIONS}
            ariaLabel="搜索引擎"
          />
        </Field>
        <Field label="API Key">
          <TextField
            size="md"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured?.apiKeyConfigured ? '留空则保持原有凭据' : '粘贴服务商控制台生成的 API Key'
            }
          />
        </Field>
        <Disclosure label="高级参数">
          <Field label="网页结果数量 top_k">
            <TextField
              size="md"
              type="number"
              min={1}
              max={20}
              value={webTopK}
              onChange={(event) => setWebTopK(Number(event.target.value))}
            />
          </Field>
        </Disclosure>
        <ActionBar as="div" label="联网搜索设置操作">
          <AsyncButton
            variant="secondary"
            size="md"
            busy={busy}
            label="测试连接"
            busyLabel="连接中…"
            onClick={() => trackAction(test(), '测试搜索连接')}
          />
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={() => trackAction(save(), '保存搜索配置')}
          >
            保存并启用
          </Button>
        </ActionBar>
      </div>
      <p className="search-status">
        {configured ? (
          <>
            当前状态：{configured.enabled ? '已启用' : '已停用'} ·{' '}
            {configured.apiKeyConfigured ? '已配置凭据' : '未配置凭据'} ·{' '}
            <ConnectionStatus
              status={configured.connectionStatus}
              label={connectionStatusName[configured.connectionStatus]}
            />
          </>
        ) : (
          '当前状态：未配置。保存并启用后，智能体即可联网搜索。'
        )}
      </p>
      {toast && <TransientToast {...toast} onDismiss={dismissToast} />}
    </section>
  );
}

const mcpStatusName: Record<McpConnectionSummary['status'], string> = {
  unconfigured: '未检测',
  connecting: '检测中',
  ready: '可用',
  failed: '失败',
  disconnected: '已断开',
};

interface McpFormState {
  name: string;
  command: string;
  args: string;
  cwd: string;
}

const emptyMcpForm = (): McpFormState => ({ name: '', command: '', args: '', cwd: '' });

function McpSettings({ state }: { state: McpConnectionsState }): React.JSX.Element {
  const [form, setForm] = React.useState<McpFormState>(emptyMcpForm);
  const [editingId, setEditingId] = React.useState<string>();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [error, setError] = React.useState('');
  const { toast, showToast, dismissToast } = useTransientToast();
  const [busyId, setBusyId] = React.useState<string>();
  const beginEdit = (connection?: McpConnectionSummary): void => {
    setError('');
    if (!connection) {
      setEditingId(undefined);
      setForm(emptyMcpForm());
      setEditorOpen(true);
      return;
    }
    setEditingId(connection.id);
    setEditorOpen(true);
    setForm({
      name: connection.name,
      command: connection.transport.command,
      args: connection.transport.args.join('\n'),
      cwd: connection.transport.cwd ?? '',
    });
  };
  const save = (): void => {
    if (!form.name.trim() || !form.command.trim()) {
      setError('连接名称和启动命令不能为空。');
      return;
    }
    const input: SaveMcpConnectionRequest = {
      ...(editingId ? { id: editingId } : {}),
      name: form.name.trim(),
      transport: {
        kind: 'stdio',
        command: form.command.trim(),
        args: form.args
          .split('\n')
          .map((arg) => arg.trim())
          .filter(Boolean),
        ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      },
    };
    setBusyId(editingId ?? 'new');
    setError('');
    reportAction(
      state
        .save(input)
        .then(() => {
          setEditorOpen(false);
          setEditingId(undefined);
          setForm(emptyMcpForm());
          state.refresh();
          showToast('success', '连接已保存。请检测后再授权具体工具。');
        })
        .finally(() => setBusyId(undefined)),
      (message) => showToast('error', message),
      '保存 MCP 连接失败，请重试。',
    );
  };
  const test = (connection: McpConnectionSummary): void => {
    setBusyId(connection.id);
    setError('');
    reportAction(
      state
        .test(connection.id)
        .then((result) => {
          state.refresh();
          showToast('success', `${result.connection.name} 已发现 ${result.tools.length} 个工具。`);
        })
        .finally(() => setBusyId(undefined)),
      (message) => showToast('error', message),
      '检测 MCP 连接失败，请重试。',
    );
  };
  const remove = (connection: McpConnectionSummary): void => {
    setBusyId(connection.id);
    setError('');
    reportAction(
      state
        .remove(connection.id)
        .then(() => {
          if (editingId === connection.id) {
            setEditorOpen(false);
            setEditingId(undefined);
            setForm(emptyMcpForm());
          }
          state.refresh();
          showToast('success', '连接已删除，历史任务中的绑定仍会保留为失效记录。');
        })
        .finally(() => setBusyId(undefined)),
      (message) => showToast('error', message),
      '删除 MCP 连接失败，请重试。',
    );
  };
  return (
    <section className="settings-section mcp-settings">
      <SectionHeader
        variant="block"
        eyebrow="MCP"
        title="连接外部工作能力"
        hint="连接只保存本机启动命令和参数。检测后，专家和当前任务分别选择具体工具；新增工具不会自动进入既有选择。"
        actions={
          <Button variant="primary" size="lg" type="button" onClick={() => beginEdit()}>
            新建连接
          </Button>
        }
      />
      {state.loading ? (
        <InlineLoading label="正在加载连接…" />
      ) : state.error ? (
        // 读失败不能说成「还没有 MCP 连接」——清单没读回来，界面并不知道它是不是空的。
        <InlineError message={state.error} onRetry={state.refresh} />
      ) : state.connections.length === 0 ? (
        <EmptyNotice
          title="还没有 MCP 连接"
          detail="添加一个 stdio 服务后，在专家配置或任务资料面板选择工具。"
        />
      ) : (
        <div className="mcp-connection-list">
          {state.connections.map((connection) => (
            <ListRow
              key={connection.id}
              as="article"
              title={connection.name}
              detail={`${connection.transport.command} · ${connection.tools.length} 个已发现工具`}
              meta={
                <>
                  <ConnectionStatus
                    status={connection.status}
                    label={mcpStatusName[connection.status]}
                  />
                  {connection.failureMessage ? ` · ${connection.failureMessage}` : ''}
                </>
              }
              actions={
                <>
                  <Button
                    variant="quiet"
                    size="sm"
                    type="button"
                    disabled={busyId === connection.id}
                    onClick={() => test(connection)}
                  >
                    检测
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    type="button"
                    onClick={() => beginEdit(connection)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    tone="danger"
                    type="button"
                    disabled={busyId === connection.id}
                    onClick={() => remove(connection)}
                  >
                    删除
                  </Button>
                </>
              }
            >
              {connection.tools.length > 0 && (
                <div className="mcp-tool-summary">
                  {connection.tools.map((tool) => (
                    <Badge key={tool.id}>{tool.name}</Badge>
                  ))}
                </div>
              )}
            </ListRow>
          ))}
        </div>
      )}
      {editorOpen && (
        <div className="mcp-editor">
          <SectionHeader title={editingId ? '编辑连接' : '新建连接'} />
          <Field label="名称">
            <TextField
              size="md"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="启动命令">
            <TextField
              size="md"
              value={form.command}
              onChange={(event) => setForm({ ...form, command: event.target.value })}
              placeholder="node"
            />
          </Field>
          <Field label="参数（每行一个）">
            <TextArea
              mono
              rows={3}
              value={form.args}
              onChange={(event) => setForm({ ...form, args: event.target.value })}
            />
          </Field>
          <Field label="工作目录（可选）">
            <TextField
              size="md"
              value={form.cwd}
              onChange={(event) => setForm({ ...form, cwd: event.target.value })}
            />
          </Field>
          {error && <InlineError message={error} />}
          <ActionBar as="div" label="保存 MCP 连接">
            <Button
              variant="text"
              size="md"
              type="button"
              onClick={() => {
                setEditorOpen(false);
                setEditingId(undefined);
                setForm(emptyMcpForm());
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              type="button"
              disabled={busyId !== undefined}
              onClick={save}
            >
              保存
            </Button>
          </ActionBar>
        </div>
      )}
      {toast && <TransientToast {...toast} onDismiss={dismissToast} />}
    </section>
  );
}
