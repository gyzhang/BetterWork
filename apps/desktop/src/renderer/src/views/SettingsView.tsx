import type { ModelProfileSummary } from '@betterwork/agent-protocol';

import type {
  AppearanceMode,
  AppearancePreference,
  ColorScheme,
  ResolvedAppearance,
} from '../appearance';
import { colorSchemes } from '../appearance';
import { useSearchEngineSettings } from '../hooks/use-search-engine-settings';
import { CheckIcon, PlusIcon } from '../icons';
import { trackAction } from '../lib/async-action';
import { connectionStatusName, roleName } from '../lib/labels';
import type { SettingsTab } from '../lib/view-types';

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
  modelMessage: string;
}
export function SettingsPage(props: SettingsPageProps): React.JSX.Element {
  const { tab, setTab } = props;
  return (
    <div className="settings-layout">
      <aside className="settings-nav-list">
        <p className="eyebrow">设置</p>
        <h1>偏好与能力</h1>
        <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>
          模型与能力
        </button>
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
          搜索
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
  modelMessage,
}: SettingsPageProps): React.JSX.Element {
  return (
    <section className="settings-section">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">模型与能力</p>
          <h2>让每一种工作使用合适的模型</h2>
          <p>
            API Key 仅保存于本机主进程。语言模型会用于当前任务，视觉与嵌入能力将在对应工作流启用。
          </p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <PlusIcon size={13} /> 添加模型
        </button>
      </div>
      {modelMessage && <p className="inline-message">{modelMessage}</p>}
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
  const { configured, apiKey, setApiKey, webTopK, setWebTopK, message, save, test } =
    useSearchEngineSettings();
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
      {message && <p className="inline-message">{message}</p>}
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
            onClick={() => trackAction(test(), '测试搜索连接')}
          >
            测试连接
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
    </section>
  );
}
