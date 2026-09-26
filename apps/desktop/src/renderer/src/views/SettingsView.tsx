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
import { TransientToast } from '../components/TransientToast';
import type { McpConnectionsState } from '../hooks/use-mcp-connections';
import type { MemoriesState } from '../hooks/use-memories';
import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import { useSearchEngineSettings } from '../hooks/use-search-engine-settings';
import { useTransientToast } from '../hooks/use-transient-toast';
import { CheckIcon, PlusIcon } from '../icons';
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
export function SettingsPage(props: SettingsPageProps): React.JSX.Element {
  const { tab, setTab } = props;
  return (
    <div className={tab === 'memory' ? 'settings-layout settings-layout-fixed' : 'settings-layout'}>
      <aside className="settings-nav-list">
        <p className="eyebrow">设置</p>
        <h1>偏好与能力</h1>
        <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>
          模型
        </button>
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
          搜索
        </button>
        <button className={tab === 'mcp' ? 'active' : ''} onClick={() => setTab('mcp')}>
          MCP
        </button>
        <button className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>
          记忆
        </button>
        <button
          className={tab === 'appearance' ? 'active' : ''}
          onClick={() => setTab('appearance')}
        >
          外观
        </button>
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
          通用
        </button>
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
            <p className="eyebrow">通用</p>
            <h2>工作偏好</h2>
            <div className="setting-placeholder">
              <strong>通用设置将在后续阶段开放</strong>
              <p>工作目录、语言、数据与更新设置会在这里统一管理。</p>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
export function ModelSettings({
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
      <div className="settings-heading">
        <div>
          <p className="eyebrow">模型</p>
          <h2>让每一种工作使用合适的模型</h2>
          <p>
            API Key 仅保存于本机主进程。语言模型会用于当前任务，视觉与嵌入能力将在对应工作流启用。
          </p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <PlusIcon size={13} /> 添加模型
        </button>
      </div>
      <div className="filter-bar">
        {(['all', 'language', 'vision', 'embedding'] as const).map((role) => (
          <button
            className={modelFilter === role ? 'active' : ''}
            key={role}
            onClick={() => setModelFilter(role)}
          >
            {role === 'all' ? '全部' : roleName[role]}
          </button>
        ))}
      </div>
      <div className="model-list">
        {models.length === 0 ? (
          <div className="empty-models">
            <strong>尚未配置模型</strong>
            <p>添加一个 OpenAI-compatible 服务后，即可从教学链路切换到真实模型。</p>
          </div>
        ) : (
          models.map((model) => {
            const isDefault = defaultModelIds.get(model.role) === model.id;
            return (
              <article
                className={model.enabled ? 'model-row' : 'model-row disabled'}
                key={model.id}
              >
                <div className="model-role-icon" aria-hidden="true">
                  {model.role === 'language' ? '文' : model.role === 'vision' ? '图' : '嵌'}
                </div>
                <div className="model-main">
                  <div>
                    <strong>{model.name}</strong>
                    {isDefault && (
                      <span className="current-badge">
                        {model.role === 'language' ? '当前工作模型' : '默认模型'}
                      </span>
                    )}
                  </div>
                  <p>
                    {roleName[model.role]} · {model.provider} · {model.model}
                  </p>
                  <small>
                    {model.apiKeyConfigured ? '已配置凭据' : '未配置凭据'} ·{' '}
                    <span className={`connection-status ${model.connectionStatus}`}>
                      {connectionStatusName[model.connectionStatus]}
                    </span>{' '}
                    · {model.enabled ? '已启用' : '已停用'}
                  </small>
                </div>
                <div className="model-actions">
                  <button onClick={() => onEdit(model)}>编辑</button>
                  {!isDefault && (
                    <button disabled={!model.enabled} onClick={() => onSetDefault(model)}>
                      设为默认
                    </button>
                  )}
                  <button onClick={() => onToggle(model)}>{model.enabled ? '停用' : '启用'}</button>
                  <button className="danger-text" onClick={() => onDelete(model)}>
                    删除
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
export function AppearanceSettings({
  appearance,
  resolvedAppearance,
  onMode,
  onScheme,
}: SettingsPageProps): React.JSX.Element {
  return (
    <section className="settings-section appearance-settings">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">外观</p>
          <h2>选择适合长期工作的界面</h2>
          <p>外观模式与色系独立保存；跟随系统时仍会保留你选择的色系。</p>
        </div>
      </div>
      <h3>外观模式</h3>
      <div className="appearance-modes">
        {(
          [
            ['light', '浅色'],
            ['dark', '深色'],
            ['system', '跟随系统'],
          ] as const
        ).map(([mode, label]) => (
          <button
            className={appearance.mode === mode ? 'selected' : ''}
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
      <h3>色系</h3>
      <div className="scheme-grid">
        {colorSchemes.map((scheme) => (
          <button
            className={appearance.scheme === scheme.id ? 'selected' : ''}
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
      <div className="appearance-note">
        <span>
          <CheckIcon size={13} />
        </span>
        <p>
          所有色系都提供浅色与深色 Variant。应用换肤不会改变 Word、PPT、Excel 和其他成果自身的配色。
        </p>
      </div>
    </section>
  );
}
export function SearchSettings(): React.JSX.Element {
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
      <div className="settings-heading">
        <div>
          <p className="eyebrow">搜索</p>
          <h2>为智能体接入联网搜索</h2>
          <p>
            API Key
            仅保存于本机主进程。启用后，智能体在任务需要时会搜索互联网，并给过程与成果标注网页来源。
          </p>
        </div>
      </div>
      {error && (
        <p className="inline-message error" role="alert">
          {error}
        </p>
      )}
      <div className="search-form">
        <label>
          搜索引擎
          <select defaultValue="baidu_qianfan">
            <option value="baidu_qianfan">百度千帆 AI 搜索</option>
            <option disabled>更多搜索引擎即将支持</option>
          </select>
        </label>
        <label>
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured?.apiKeyConfigured ? '留空则保持原有凭据' : '粘贴服务商控制台生成的 API Key'
            }
          />
        </label>
        <details>
          <summary>高级参数</summary>
          <label>
            网页结果数量 top_k
            <input
              type="number"
              min={1}
              max={20}
              value={webTopK}
              onChange={(event) => setWebTopK(Number(event.target.value))}
            />
          </label>
        </details>
        <div className="search-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => trackAction(test(), '测试搜索连接')}
          >
            {busy ? '连接中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => trackAction(save(), '保存搜索配置')}
          >
            保存并启用
          </button>
        </div>
      </div>
      <p className="search-status">
        {configured ? (
          <>
            当前状态：{configured.enabled ? '已启用' : '已停用'} ·{' '}
            {configured.apiKeyConfigured ? '已配置凭据' : '未配置凭据'} ·{' '}
            <span className={`connection-status ${configured.connectionStatus}`}>
              {connectionStatusName[configured.connectionStatus]}
            </span>
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

export function McpSettings({ state }: { state: McpConnectionsState }): React.JSX.Element {
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
      <div className="settings-heading">
        <div>
          <p className="eyebrow">MCP</p>
          <h2>连接外部工作能力</h2>
          <p>
            连接只保存本机启动命令和参数。检测后，专家和当前任务分别选择具体工具；新增工具不会自动进入既有选择。
          </p>
        </div>
        <button className="primary-button" type="button" onClick={() => beginEdit()}>
          新建连接
        </button>
      </div>
      {state.loading ? (
        <p className="muted-text">正在加载连接…</p>
      ) : state.connections.length === 0 ? (
        <div className="setting-placeholder">
          <strong>还没有 MCP 连接</strong>
          <p>添加一个 stdio 服务后，在专家配置或任务资料面板选择工具。</p>
        </div>
      ) : (
        <div className="mcp-connection-list">
          {state.connections.map((connection) => (
            <article className="mcp-connection-row" key={connection.id}>
              <div className="mcp-connection-main">
                <strong>{connection.name}</strong>
                <p>
                  {connection.transport.command} · {connection.tools.length} 个已发现工具
                </p>
                <small className={`connection-status ${connection.status}`}>
                  {mcpStatusName[connection.status]}
                  {connection.failureMessage ? ` · ${connection.failureMessage}` : ''}
                </small>
              </div>
              <div className="model-actions">
                <button
                  type="button"
                  disabled={busyId === connection.id}
                  onClick={() => test(connection)}
                >
                  检测
                </button>
                <button type="button" onClick={() => beginEdit(connection)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="danger-text"
                  disabled={busyId === connection.id}
                  onClick={() => remove(connection)}
                >
                  删除
                </button>
              </div>
              {connection.tools.length > 0 && (
                <div className="mcp-tool-summary">
                  {connection.tools.map((tool) => (
                    <span className="skill-chip" key={tool.id}>
                      {tool.name}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editorOpen && (
        <div className="mcp-editor">
          <h3>{editingId ? '编辑连接' : '新建连接'}</h3>
          <label>
            名称
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            启动命令
            <input
              value={form.command}
              onChange={(event) => setForm({ ...form, command: event.target.value })}
              placeholder="node"
            />
          </label>
          <label>
            参数（每行一个）
            <textarea
              rows={3}
              value={form.args}
              onChange={(event) => setForm({ ...form, args: event.target.value })}
            />
          </label>
          <label>
            工作目录（可选）
            <input
              value={form.cwd}
              onChange={(event) => setForm({ ...form, cwd: event.target.value })}
            />
          </label>
          {error && (
            <p className="inline-message error" role="alert">
              {error}
            </p>
          )}
          <div className="mcp-editor-actions">
            <button
              className="primary-button"
              type="button"
              disabled={busyId !== undefined}
              onClick={save}
            >
              保存
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setEditorOpen(false);
                setEditingId(undefined);
                setForm(emptyMcpForm());
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {toast && <TransientToast {...toast} onDismiss={dismissToast} />}
    </section>
  );
}
