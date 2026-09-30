import type {
  McpConnectionSummary,
  ModelProfileSummary,
  SaveMcpConnectionRequest,
} from '@betterwork/agent-protocol';
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
import { TransientToast } from '../components/TransientToast';
import type { McpConnectionsState } from '../hooks/use-mcp-connections';
import type { MemoriesState } from '../hooks/use-memories';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
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
        {tab === 'models' && <ModelSettings {...props} />}
        {tab === 'search' && <SearchSettings />}
        {tab === 'mcp' && <McpSettings state={props.mcp} />}
        {tab === 'memory' && (
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
        )}
        {tab === 'appearance' && <AppearanceSettings {...props} />}
        {tab === 'general' && (
          <section className="settings-section">
            <SectionHeader variant="block" eyebrow="通用" title="工作偏好" />
            <EmptyNotice
              title="通用设置将在后续阶段开放"
              detail="工作目录、语言、数据与更新设置会在这里统一管理。"
            />
          </section>
        )}
      </section>
    </div>
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
        hint="API Key 仅保存于本机主进程。语言模型会用于当前任务，视觉与嵌入能力将在对应工作流启用。"
        actions={
          <Button variant="primary" size="lg" type="button" onClick={onAdd}>
            <PlusIcon size={13} /> 添加模型
          </Button>
        }
      />
      <SegmentedControl
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
            value={engine}
            onChange={setEngine}
            options={SEARCH_ENGINE_OPTIONS}
            ariaLabel="搜索引擎"
          />
        </Field>
        <Field label="API Key">
          <input
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
            <input
              type="number"
              min={1}
              max={20}
              value={webTopK}
              onChange={(event) => setWebTopK(Number(event.target.value))}
            />
          </Field>
        </Disclosure>
        <div className="search-actions">
          <AsyncButton
            variant="secondary"
            busy={busy}
            label="测试连接"
            busyLabel="连接中…"
            onClick={() => trackAction(test(), '测试搜索连接')}
          />
          <Button
            variant="primary"
            size="lg"
            type="button"
            onClick={() => trackAction(save(), '保存搜索配置')}
          >
            保存并启用
          </Button>
        </div>
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
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="启动命令">
            <input
              value={form.command}
              onChange={(event) => setForm({ ...form, command: event.target.value })}
              placeholder="node"
            />
          </Field>
          <Field label="参数（每行一个）">
            <textarea
              rows={3}
              value={form.args}
              onChange={(event) => setForm({ ...form, args: event.target.value })}
            />
          </Field>
          <Field label="工作目录（可选）">
            <input
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
