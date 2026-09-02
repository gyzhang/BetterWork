import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRuntimeEvent, ModelProfileInput, ModelProfileSummary, RunSummary } from '@betterwork/agent-protocol';
import { applyAppearance, bootstrapAppearance, colorSchemes, getWindowTheme, persistAppearance, type AppearanceMode, type AppearancePreference, type ColorScheme, type ResolvedAppearance } from './appearance';
import { deriveActivityGroups, type ActivityGroup } from './activity';

const taskId = 'phase-0-playground';
const sessionId = 'phase-0-session';
type AppView = 'work' | 'artifacts' | 'knowledge' | 'settings';
type ContextTab = 'process' | 'sources' | 'artifacts';
type SettingsTab = 'models' | 'appearance' | 'general';

const emptyModel: ModelProfileInput = { name: '', provider: 'openai-compatible', baseUrl: '', model: '', role: 'language', apiKey: '', maxContextTokens: 8192, maxOutputTokens: 8192, temperature: 0.7, enabled: true };
const roleName: Record<ModelProfileSummary['role'], string> = { language: '语言', vision: '视觉', embedding: '嵌入' };
const runStatusName: Record<RunSummary['status'], string> = { running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' };

const eventDetail = (event: AgentRuntimeEvent): string => {
  if (event.type === 'message.delta' || event.type === 'reasoning.delta') return event.delta;
  if (event.type === 'tool.requested' || event.type === 'tool.started') return event.toolCall.name;
  if (event.type === 'tool.progress') return event.message;
  if (event.type === 'tool.completed') return JSON.stringify(event.output);
  if (event.type === 'tool.failed' || event.type === 'run.failed') return event.error;
  return '';
};

const formatTime = (value: number): string => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function App(): React.JSX.Element {
  const [prompt, setPrompt] = useState('计算: (12 + 8) * 3');
  const [workspacePath, setWorkspacePath] = useState('');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [models, setModels] = useState<ModelProfileSummary[]>([]);
  const [view, setView] = useState<AppView>('work');
  const [contextTab, setContextTab] = useState<ContextTab>('process');
  const [contextOpen, setContextOpen] = useState(true);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  const [modelEditorOpen, setModelEditorOpen] = useState(false);
  const [modelForm, setModelForm] = useState<ModelProfileInput>(emptyModel);
  const [editingModelId, setEditingModelId] = useState<string>();
  const [modelFilter, setModelFilter] = useState<ModelProfileSummary['role'] | 'all'>('all');
  const [modelMessage, setModelMessage] = useState('');
  const [appearance, setAppearance] = useState<AppearancePreference>(() => bootstrapAppearance());
  const [resolvedAppearance, setResolvedAppearance] = useState<ResolvedAppearance>(() => applyAppearance(bootstrapAppearance()));

  const refreshRuns = async (): Promise<void> => setRuns(await window.betterwork.runs.list());
  const refreshModels = async (): Promise<void> => setModels(await window.betterwork.models.list());

  useEffect(() => {
    void refreshRuns(); void refreshModels(); void window.betterwork.workspace.getDefaultPath().then(setWorkspacePath);
    return window.betterwork.runs.onEvent((event) => {
      setEvents((current) => event.runId === activeRunIdRef.current ? [...current, event] : current);
      if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') void refreshRuns();
    });
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => { if (appearance.mode === 'system') setResolvedAppearance(applyAppearance(appearance)); };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [appearance]);

  useEffect(() => {
    void window.betterwork.chrome.updateTheme(getWindowTheme());
  }, [appearance, resolvedAppearance]);

  const setAppearanceValue = (next: AppearancePreference): void => { setAppearance(next); persistAppearance(next); setResolvedAppearance(applyAppearance(next)); };
  const assistantText = useMemo(() => events.filter((event): event is Extract<AgentRuntimeEvent, { type: 'message.delta' }> => event.type === 'message.delta').map((event) => event.delta).join(''), [events]);
  const activeRun = runs.find((run) => run.id === activeRunId);
  const activeLanguageModel = models.find((model) => model.role === 'language' && model.enabled);
  const defaultModelIds = useMemo(() => new Map((['language', 'vision', 'embedding'] as const).map((role) => [role, models.find((model) => model.role === role && model.enabled)?.id])), [models]);
  const isRunning = activeRun?.status === 'running' || events.at(-1)?.type === 'run.started' || (!!activeRunId && !events.some((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)));
  const completedTools = events.filter((event) => event.type === 'tool.completed' || event.type === 'tool.failed');
  const activityGroups = useMemo(() => deriveActivityGroups(events), [events]);
  const filteredModels = models.filter((model) => modelFilter === 'all' || model.role === modelFilter);
  const completedRuns = runs.filter((run) => run.status === 'completed');

  const startNewTask = (): void => { activeRunIdRef.current = undefined; setActiveRunId(undefined); setEvents([]); setPrompt(''); setView('work'); };
  const startRun = async (): Promise<void> => {
    if (isRunning || !prompt.trim() || !workspacePath) return;
    const result = await window.betterwork.runs.start({ taskId, sessionId, prompt, workspacePath });
    activeRunIdRef.current = result.runId; setActiveRunId(result.runId); setEvents([]); setContextTab('process'); setContextOpen(true); await refreshRuns();
  };
  const submit = (event: FormEvent): void => { event.preventDefault(); void startRun(); };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void startRun();
  };
  const selectRun = async (run: RunSummary): Promise<void> => { activeRunIdRef.current = run.id; setActiveRunId(run.id); setPrompt(run.prompt); setEvents(await window.betterwork.runs.listEvents({ runId: run.id })); setView('work'); };
  const openModelEditor = (model?: ModelProfileSummary): void => {
    setModelMessage('');
    if (model) { setEditingModelId(model.id); setModelForm({ name: model.name, provider: model.provider, baseUrl: model.baseUrl, model: model.model, role: model.role, apiKey: '', maxContextTokens: model.maxContextTokens, maxOutputTokens: model.maxOutputTokens, temperature: model.temperature, enabled: model.enabled, priority: model.priority }); }
    else { setEditingModelId(undefined); setModelForm(emptyModel); }
    setModelEditorOpen(true);
  };
  const saveModel = async (event: FormEvent): Promise<void> => { event.preventDefault(); try { await window.betterwork.models.save({ ...modelForm, ...(editingModelId ? { id: editingModelId } : {}) }); await refreshModels(); setModelEditorOpen(false); setModelMessage(editingModelId ? '模型配置已更新。' : '模型已添加，现在可以用于任务。'); } catch (error) { setModelMessage(error instanceof Error ? error.message : '保存失败，请检查配置。'); } };
  const testModel = async (): Promise<void> => { try { const result = await window.betterwork.models.test(modelForm); setModelMessage(result.message); } catch (error) { setModelMessage(error instanceof Error ? error.message : '连接测试失败。'); } };
  const toggleModel = (model: ModelProfileSummary): void => { void window.betterwork.models.save({ name: model.name, provider: model.provider, baseUrl: model.baseUrl, model: model.model, role: model.role, apiKey: '', maxContextTokens: model.maxContextTokens, maxOutputTokens: model.maxOutputTokens, temperature: model.temperature, enabled: !model.enabled, priority: model.priority }).then(refreshModels); };
  const setDefaultModel = (model: ModelProfileSummary): void => { void window.betterwork.models.setDefault({ id: model.id }).then(async (result) => { setModelMessage(result.updated ? `${model.name} 已设为${roleName[model.role]}默认模型。` : '仅已启用模型可以设为默认。'); await refreshModels(); }); };

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">算</span><div><strong>算台</strong><small>BetterWork</small></div></div>
      <button className="new-task" onClick={startNewTask}><span aria-hidden="true">＋</span> 新建任务</button>
      <nav className="primary-nav" aria-label="主要导航">
        <button className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}><span aria-hidden="true">▣</span> 工作</button>
        <button className={view === 'artifacts' ? 'active' : ''} onClick={() => setView('artifacts')}><span aria-hidden="true">◇</span> 成果</button>
        <button className={view === 'knowledge' ? 'active' : ''} onClick={() => setView('knowledge')}><span aria-hidden="true">▤</span> 知识 <em>即将推出</em></button>
      </nav>
      <div className="sidebar-divider" /><p className="section-label">最近任务</p><div className="run-list">{runs.length === 0 && <p className="empty-runs">你的任务会保存在这里。</p>}{runs.map((run) => <button key={run.id} className={run.id === activeRunId ? 'run-item active' : 'run-item'} onClick={() => void selectRun(run)}><span>{run.prompt}</span><small>{runStatusName[run.status]} · {formatTime(run.createdAt)}</small></button>)}</div>
      <button className={view === 'settings' ? 'settings-nav active' : 'settings-nav'} onClick={() => { setView('settings'); setSettingsTab('models'); void refreshModels(); }}><span aria-hidden="true">⚙</span> 设置</button><div className="sidebar-footer">算台 BetterWork · Phase 0</div>
    </aside>
    <section className="main-stage">
      {view === 'work' && <>
        <header className="task-header"><div><p className="eyebrow">工作</p><h1>{activeRun ? '继续完成任务' : '开始一件工作'}</h1></div><div className="task-actions"><button className="model-chip" onClick={() => { setView('settings'); setSettingsTab('models'); void refreshModels(); }}>{activeLanguageModel ? activeLanguageModel.name : '选择工作模型'} <span>⌄</span></button><button className="context-toggle" onClick={() => setContextOpen((open) => !open)}>{contextOpen ? '收起上下文' : '查看上下文'}</button></div></header>
        <div className="workspace"><div className="messages">{events.length === 0 ? <Welcome setPrompt={setPrompt} /> : <>{<div className="message user"><span>你</span><p>{prompt}</p></div>}{assistantText && <div className="message assistant"><span>算台</span><p>{assistantText}</p></div>}{completedTools.map((event) => <div className={event.type === 'tool.failed' ? 'tool-card failed' : 'tool-card'} key={event.id}><div><span className="tool-icon" aria-hidden="true">{event.type === 'tool.failed' ? '!' : '✓'}</span><strong>{event.type === 'tool.completed' ? '已完成一个工作步骤' : '工作步骤未完成'}</strong></div><code>{eventDetail(event)}</code></div>)}</>}</div>
          <form className="composer" onSubmit={submit}><div className="workspace-row"><span>工作目录</span><input aria-label="工作目录" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} /><button type="button" className="text-button" onClick={() => void window.betterwork.workspace.selectDirectory().then((selected) => { if (selected) setWorkspacePath(selected); })}>选择</button></div><textarea aria-label="任务输入，按 Command 或 Control 加 Enter 开始工作" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleComposerKeyDown} rows={3} placeholder="告诉算台你想完成什么工作…" /><div className="composer-footer"><span>{activeLanguageModel ? `${activeLanguageModel.provider} · ${activeLanguageModel.model}` : '未配置模型时使用教学 Provider'} <kbd>⌘/Ctrl ↵</kbd></span>{isRunning && activeRunId ? <button type="button" className="stop" onClick={() => void window.betterwork.runs.cancel({ runId: activeRunId })}>停止</button> : <button type="submit" disabled={!prompt.trim() || !workspacePath}>开始工作 <span aria-hidden="true">↑</span></button>}</div></form>
        </div>
      </>}
      {view === 'artifacts' && <CompletedWorkPage runs={completedRuns} onOpen={(run) => void selectRun(run)} />}
      {view === 'knowledge' && <EmptyPage eyebrow="知识" title="你的资料，正在等待被组织" detail="本地知识库将在下一阶段接入；资料仍将由你在本机管理。" />}
      {view === 'settings' && <SettingsPage tab={settingsTab} setTab={setSettingsTab} models={filteredModels} modelFilter={modelFilter} setModelFilter={setModelFilter} activeLanguageModel={activeLanguageModel} defaultModelIds={defaultModelIds} onAdd={() => openModelEditor()} onEdit={openModelEditor} onToggle={toggleModel} onSetDefault={setDefaultModel} onDelete={(model) => void window.betterwork.models.delete({ id: model.id }).then(refreshModels)} appearance={appearance} resolvedAppearance={resolvedAppearance} onMode={(mode) => setAppearanceValue({ ...appearance, mode })} onScheme={(scheme) => setAppearanceValue({ ...appearance, scheme })} modelMessage={modelMessage} />}
    </section>
    {view === 'work' && <ContextPanel open={contextOpen} setOpen={setContextOpen} tab={contextTab} setTab={setContextTab} events={events} activeRun={activeRun} activityGroups={activityGroups} />}
    {modelEditorOpen && <ModelEditor form={modelForm} setForm={setModelForm} editing={Boolean(editingModelId)} message={modelMessage} onClose={() => setModelEditorOpen(false)} onSave={saveModel} onTest={() => void testModel()} />}
  </main>;
}

function Welcome({ setPrompt }: { setPrompt: (value: string) => void }): React.JSX.Element { return <div className="welcome"><div className="abacus" aria-hidden="true"><i /><i /><i /><i /></div><p className="eyebrow">算台 · 知识工作台</p><h2>以我所知，成我所作。</h2><p>从一个清楚的问题开始。算台会协助你把过程沉淀为可以继续使用的成果。</p><div className="examples"><button onClick={() => setPrompt('计算: (128 + 72) / 4')}>计算一组数据</button><button onClick={() => setPrompt('读取: README.md')}>读取一份资料</button></div></div>; }
function EmptyContext({ title, detail }: { title: string; detail: string }): React.JSX.Element { return <div className="empty-context"><span aria-hidden="true">◇</span><strong>{title}</strong><p>{detail}</p></div>; }
function EmptyPage({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }): React.JSX.Element { return <section className="empty-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></section>; }
function CompletedWorkPage({ runs, onOpen }: { runs: RunSummary[]; onOpen: (run: RunSummary) => void }): React.JSX.Element { return <section className="completed-work-page"><header><div><p className="eyebrow">成果</p><h1>已完成的工作</h1><p>Phase 0 先展示可以回看的任务交付。研究报告、Word、Excel 与 PPT 将在后续以独立 Artifact 形式管理。</p></div><span className="work-count">{runs.length} 项</span></header>{runs.length === 0 ? <EmptyPage eyebrow="尚无交付" title="完成一项工作，它会出现在这里" detail="当前可使用计算和读取资料的教学链路；后续这里会承载可继续编辑的报告、表格和演示。" /> : <div className="completed-work-list">{runs.map((run) => <button className="completed-work-card" key={run.id} onClick={() => onOpen(run)}><span className="completed-work-icon" aria-hidden="true">✓</span><div><strong>{run.prompt}</strong><p>已完成 · {formatTime(run.completedAt ?? run.createdAt)}</p></div><span aria-hidden="true">›</span></button>)}</div>}</section>; }

function ContextPanel({ open, setOpen, tab, setTab, events, activeRun, activityGroups }: { open: boolean; setOpen: (open: boolean) => void; tab: ContextTab; setTab: (tab: ContextTab) => void; events: AgentRuntimeEvent[]; activeRun?: RunSummary | undefined; activityGroups: ActivityGroup[] }): React.JSX.Element {
  if (!open) return <aside className="context-collapsed"><button aria-label="展开上下文面板" onClick={() => setOpen(true)}>◀</button></aside>;
  return <aside className="context-panel"><div className="context-topline"><span>当前任务</span><button aria-label="收起上下文面板" onClick={() => setOpen(false)}>›</button></div><div className="context-tabs" role="tablist" aria-label="任务上下文">{([['process', '过程'], ['sources', '资料'], ['artifacts', '成果']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div><div className="context-content">{tab === 'process' && (events.length === 0 ? <EmptyContext title="等待任务开始" detail="开始后，这里会按工作阶段呈现过程，而不是堆叠底层日志。" /> : <div className="activity-list"><div className="activity-summary"><span className={`status-dot ${activeRun?.status === 'running' ? 'running' : ''}`} /><div><strong>{activeRun ? runStatusName[activeRun.status] : '正在处理任务'}</strong><p>{activityGroups.length} 个工作阶段</p></div></div>{activityGroups.map((group) => <ActivityGroupRow group={group} key={group.id} />)}</div>)}{tab === 'sources' && <EmptyContext title="尚无引用资料" detail="知识库与网络资料会在研究工作流进入后显示在这里。" />}{tab === 'artifacts' && <EmptyContext title="尚无工作成果" detail="报告、分析、文档和演示会作为可继续编辑的成果出现在这里。" />}</div></aside>;
}

function ActivityGroupRow({ group }: { group: ActivityGroup }): React.JSX.Element { return <div className={`activity-row ${group.status}`}><span className="activity-marker" /><div><strong>{group.title}</strong><p>{group.description}</p><small>{group.status === 'running' ? '进行中' : formatTime(group.updatedAt)}</small></div></div>; }

interface SettingsPageProps { tab: SettingsTab; setTab: (tab: SettingsTab) => void; models: ModelProfileSummary[]; modelFilter: ModelProfileSummary['role'] | 'all'; setModelFilter: (filter: ModelProfileSummary['role'] | 'all') => void; activeLanguageModel?: ModelProfileSummary | undefined; defaultModelIds: Map<ModelProfileSummary['role'], string | undefined>; onAdd: () => void; onEdit: (model: ModelProfileSummary) => void; onToggle: (model: ModelProfileSummary) => void; onSetDefault: (model: ModelProfileSummary) => void; onDelete: (model: ModelProfileSummary) => void; appearance: AppearancePreference; resolvedAppearance: ResolvedAppearance; onMode: (mode: AppearanceMode) => void; onScheme: (scheme: ColorScheme) => void; modelMessage: string; }
function SettingsPage(props: SettingsPageProps): React.JSX.Element { const { tab, setTab } = props; return <div className="settings-layout"><aside className="settings-nav-list"><p className="eyebrow">设置</p><h1>偏好与能力</h1><button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>模型与能力</button><button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>外观</button><button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>通用</button></aside><section className="settings-content">{tab === 'models' && <ModelSettings {...props} />}{tab === 'appearance' && <AppearanceSettings {...props} />}{tab === 'general' && <section className="settings-section"><p className="eyebrow">通用</p><h2>工作偏好</h2><div className="setting-placeholder"><strong>通用设置将在后续阶段开放</strong><p>工作目录、语言、数据与更新设置会在这里统一管理。</p></div></section>}</section></div>; }
function ModelSettings({ models, modelFilter, setModelFilter, defaultModelIds, onAdd, onEdit, onToggle, onSetDefault, onDelete, modelMessage }: SettingsPageProps): React.JSX.Element { return <section className="settings-section"><div className="settings-heading"><div><p className="eyebrow">模型与能力</p><h2>让每一种工作使用合适的模型</h2><p>API Key 仅保存于本机主进程。语言模型会用于当前任务，视觉与嵌入能力将在对应工作流启用。</p></div><button className="primary-button" onClick={onAdd}>＋ 添加模型</button></div>{modelMessage && <p className="inline-message">{modelMessage}</p>}<div className="filter-bar">{(['all', 'language', 'vision', 'embedding'] as const).map((role) => <button className={modelFilter === role ? 'active' : ''} key={role} onClick={() => setModelFilter(role)}>{role === 'all' ? '全部' : roleName[role]}</button>)}</div><div className="model-list">{models.length === 0 ? <div className="empty-models"><strong>尚未配置模型</strong><p>添加一个 OpenAI-compatible 服务后，即可从教学链路切换到真实模型。</p></div> : models.map((model) => { const isDefault = defaultModelIds.get(model.role) === model.id; return <article className={model.enabled ? 'model-row' : 'model-row disabled'} key={model.id}><div className="model-role-icon" aria-hidden="true">{model.role === 'language' ? '文' : model.role === 'vision' ? '图' : '嵌'}</div><div className="model-main"><div><strong>{model.name}</strong>{isDefault && <span className="current-badge">{model.role === 'language' ? '当前工作模型' : '默认模型'}</span>}</div><p>{roleName[model.role]} · {model.provider} · {model.model}</p><small>{model.apiKeyConfigured ? '已配置凭据' : '未配置凭据'} · {model.enabled ? '已启用' : '已停用'}</small></div><div className="model-actions"><button onClick={() => onEdit(model)}>编辑</button>{!isDefault && <button disabled={!model.enabled} onClick={() => onSetDefault(model)}>设为默认</button>}<button onClick={() => onToggle(model)}>{model.enabled ? '停用' : '启用'}</button><button className="danger-text" onClick={() => onDelete(model)}>删除</button></div></article>; })}</div></section>; }
function AppearanceSettings({ appearance, resolvedAppearance, onMode, onScheme }: SettingsPageProps): React.JSX.Element { return <section className="settings-section appearance-settings"><div className="settings-heading"><div><p className="eyebrow">外观</p><h2>选择适合长期工作的界面</h2><p>外观模式与色系独立保存；跟随系统时仍会保留你选择的色系。</p></div></div><h3>外观模式</h3><div className="appearance-modes">{([['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']] as const).map(([mode, label]) => <button className={appearance.mode === mode ? 'selected' : ''} key={mode} onClick={() => onMode(mode)}><span className={`mode-preview ${mode}`}><i /><b /><em /></span><strong>{label}</strong>{mode === 'system' && <small>当前为{resolvedAppearance === 'dark' ? '深色' : '浅色'}</small>}</button>)}</div><h3>色系</h3><div className="scheme-grid">{colorSchemes.map((scheme) => <button className={appearance.scheme === scheme.id ? 'selected' : ''} key={scheme.id} onClick={() => onScheme(scheme.id)}><span className={`scheme-preview ${scheme.id}`}><i /><i /><i /></span><strong>{scheme.name}</strong><small>{scheme.description}</small></button>)}</div><div className="appearance-note"><span>✓</span><p>所有色系都提供浅色与深色 Variant。应用换肤不会改变 Word、PPT、Excel 和其他成果自身的配色。</p></div></section>; }
interface ModelEditorProps { form: ModelProfileInput; setForm: (input: ModelProfileInput) => void; editing: boolean; message: string; onClose: () => void; onSave: (event: FormEvent) => Promise<void>; onTest: () => void; }
function ModelEditor({ form, setForm, editing, message, onClose, onSave, onTest }: ModelEditorProps): React.JSX.Element { return <div className="sheet-backdrop" onMouseDown={onClose}><aside className="model-sheet" role="dialog" aria-modal="true" aria-label={editing ? '编辑模型' : '添加模型'} onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">模型配置</p><h2>{editing ? '编辑模型' : '添加模型'}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header><form onSubmit={(event) => void onSave(event)}><label>显示名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：公司主力模型" /></label><div className="form-grid"><label>模型角色<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as ModelProfileInput['role'] })}><option value="language">语言模型</option><option value="vision">视觉模型</option><option value="embedding">嵌入模型</option></select></label><label>Provider<input required value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} placeholder="openai-compatible" /></label></div><label>模型名称<input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="模型服务中的 model id" /></label><label>API 地址<input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label><label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editing ? '留空则保持原有凭据' : '可留空'} /></label><details><summary>高级参数</summary><div className="form-grid"><label>上下文 Token<input type="number" min="1" value={form.maxContextTokens} onChange={(event) => setForm({ ...form, maxContextTokens: Number(event.target.value) })} /></label><label>最大输出 Token<input type="number" min="1" value={form.maxOutputTokens} onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })} /></label></div></details>{message && <p className="inline-message">{message}</p>}<footer><button type="button" className="secondary-button" onClick={onTest}>测试连接</button><button type="submit" className="primary-button">{editing ? '保存修改' : '添加模型'}</button></footer></form></aside></div>; }
