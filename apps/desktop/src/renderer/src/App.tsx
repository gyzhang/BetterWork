import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRuntimeEvent, ArtifactDetail, ArtifactSummary, ArtifactVersionDetail, ArtifactVersionSummary, EvidenceSummary, KnowledgeDocumentSummary, KnowledgeSearchResult, ModelProfileInput, ModelProfileSummary, RecentTaskSummary, RunSummary, WorkspaceSummary } from '@betterwork/agent-protocol';
import { applyAppearance, bootstrapAppearance, colorSchemes, getWindowTheme, persistAppearance, type AppearanceMode, type AppearancePreference, type ColorScheme, type ResolvedAppearance } from './appearance';
import { deriveActivityGroups, type ActivityGroup } from './activity';
import { MarkdownPreview } from './markdown-preview';
import { BrandLogo } from './brand-logo';
import { AlertIcon, ArrowUpIcon, ArtifactIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, KnowledgeIcon, PanelLeftIcon, PlusIcon, SettingsIcon, WorkIcon } from './icons';

type AppView = 'work' | 'artifacts' | 'knowledge' | 'settings';
type ContextTab = 'process' | 'sources' | 'artifacts';
type SettingsTab = 'models' | 'appearance' | 'general';

const emptyModel: ModelProfileInput = { name: '', provider: 'openai-compatible', baseUrl: '', model: '', role: 'language', apiKey: '', maxContextTokens: 8192, maxOutputTokens: 8192, temperature: 0.7, enabled: true };
const roleName: Record<ModelProfileSummary['role'], string> = { language: '语言', vision: '视觉', embedding: '嵌入' };
const runStatusName: Record<RunSummary['status'], string> = { running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' };
const connectionStatusName: Record<ModelProfileSummary['connectionStatus'], string> = { untested: '尚未验证', connected: '连接成功', failed: '连接失败' };

const eventDetail = (event: AgentRuntimeEvent): string => {
  if (event.type === 'message.delta' || event.type === 'reasoning.delta') return event.delta;
  if (event.type === 'tool.requested' || event.type === 'tool.started') return event.toolCall.name;
  if (event.type === 'tool.progress') return event.message;
  if (event.type === 'tool.completed') return JSON.stringify(event.output);
  if (event.type === 'tool.failed' || event.type === 'run.failed') return event.error;
  return '';
};

const formatTime = (value: number): string => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fileNameOf = (value: string): string => value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);

const handleTitlebarDoubleClick = (event: React.MouseEvent): void => {
  if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return;
  void window.betterwork.chrome.toggleMaximize();
};

export function App(): React.JSX.Element {
  const [prompt, setPrompt] = useState('计算: (12 + 8) * 3');
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const workspaceIdRef = useRef<string | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<{ id: string; sessionId: string; title: string }>();
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [taskRuns, setTaskRuns] = useState<RunSummary[]>([]);
  const [recentTasks, setRecentTasks] = useState<RecentTaskSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetail>();
  const [sentPrompt, setSentPrompt] = useState('');
  const [artifactNote, setArtifactNote] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [models, setModels] = useState<ModelProfileSummary[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResult[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeMessage, setKnowledgeMessage] = useState('');
  const [knowledgeIssues, setKnowledgeIssues] = useState<string[]>([]);
  const [isImportingKnowledge, setIsImportingKnowledge] = useState(false);
  const [view, setView] = useState<AppView>('work');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('betterwork-sidebar-collapsed') === 'true');
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
  const refreshTaskRuns = async (taskId = activeTaskIdRef.current): Promise<void> => setTaskRuns(taskId ? await window.betterwork.runs.list({ taskId }) : []);
  const refreshTasks = async (workspaceId = workspaceIdRef.current): Promise<void> => setRecentTasks(await window.betterwork.tasks.list(workspaceId ? { workspaceId } : undefined));
  const refreshModels = async (): Promise<void> => setModels(await window.betterwork.models.list());
  const refreshKnowledge = async (): Promise<void> => setKnowledgeDocuments(await window.betterwork.knowledge.list());
  const refreshEvidence = async (taskId = activeTaskIdRef.current): Promise<void> => {
    if (!taskId) { setEvidence([]); return; }
    setEvidence(await window.betterwork.evidence.list({ taskId }));
  };
  const refreshArtifacts = async (): Promise<void> => setArtifacts(await window.betterwork.artifacts.list());

  useEffect(() => {
    void refreshRuns(); void refreshModels(); void refreshKnowledge(); void refreshArtifacts(); void window.betterwork.workspace.getDefault().then((currentWorkspace) => { workspaceIdRef.current = currentWorkspace.id; setWorkspace(currentWorkspace); void refreshTasks(currentWorkspace.id); });
    return window.betterwork.runs.onEvent((event) => {
      setEvents((current) => event.runId === activeRunIdRef.current ? [...current, event] : current);
      if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') { void refreshRuns(); void refreshTaskRuns(); void refreshTasks(); void refreshEvidence(); void refreshArtifacts(); }
    });
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => { if (appearance.mode === 'system') setResolvedAppearance(applyAppearance(appearance)); };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [appearance]);

  useEffect(() => {
    window.localStorage.setItem('betterwork-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    void window.betterwork.chrome.updateTheme(getWindowTheme());
  }, [appearance, resolvedAppearance]);

  const setAppearanceValue = (next: AppearancePreference): void => { setAppearance(next); persistAppearance(next); setResolvedAppearance(applyAppearance(next)); };
  const assistantText = useMemo(() => events.filter((event): event is Extract<AgentRuntimeEvent, { type: 'message.delta' }> => event.type === 'message.delta').map((event) => event.delta).join(''), [events]);
  const assistantDisplayText = assistantText.trim();
  const activeRun = runs.find((run) => run.id === activeRunId);
  const activeLanguageModel = models.find((model) => model.role === 'language' && model.enabled);
  const defaultModelIds = useMemo(() => new Map((['language', 'vision', 'embedding'] as const).map((role) => [role, models.find((model) => model.role === role && model.enabled)?.id])), [models]);
  const isRunning = activeRun?.status === 'running' || events.at(-1)?.type === 'run.started' || (!!activeRunId && !events.some((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)));
  const completedTools = events.filter((event) => event.type === 'tool.completed' || event.type === 'tool.failed');
  const activityGroups = useMemo(() => deriveActivityGroups(events), [events]);
  const filteredModels = models.filter((model) => modelFilter === 'all' || model.role === modelFilter);
  const currentTaskArtifacts = artifacts.filter((artifact) => artifact.taskId === activeTask?.id);
  const isCompletedRun = events.some((event) => event.type === 'run.completed');

  const startNewTask = (): void => { activeRunIdRef.current = undefined; activeTaskIdRef.current = undefined; setActiveRunId(undefined); setActiveTask(undefined); setTaskRuns([]); setEvidence([]); setEvents([]); setSentPrompt(''); setPrompt(''); setArtifactNote(undefined); setView('work'); };
  const startRun = async (): Promise<void> => {
    if (isRunning || !prompt.trim() || !workspace) return;
    const goal = prompt.trim();
    let task = activeTask;
    if (!task) {
      const created = await window.betterwork.tasks.create({ workspaceId: workspace.id, title: goal.slice(0, 80), goal });
      task = { id: created.task.id, sessionId: created.sessionId, title: created.task.title };
      activeTaskIdRef.current = task.id; setActiveTask(task);
    }
    const result = await window.betterwork.runs.start({ taskId: task.id, sessionId: task.sessionId, prompt, workspacePath: workspace.rootPath });
    activeRunIdRef.current = result.runId; setActiveRunId(result.runId); setEvents([]); setSentPrompt(goal); setPrompt(''); setArtifactNote(undefined); setContextTab('process'); setContextOpen(true); await refreshRuns(); await refreshTaskRuns(task.id); await refreshTasks();
  };
  const submit = (event: FormEvent): void => { event.preventDefault(); void startRun(); };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void startRun();
  };
  const selectRun = async (run: RunSummary): Promise<void> => { activeRunIdRef.current = run.id; activeTaskIdRef.current = run.taskId; setActiveRunId(run.id); setActiveTask({ id: run.taskId, sessionId: run.sessionId, title: run.prompt.slice(0, 80) }); setSentPrompt(run.prompt.trim()); setPrompt(''); setArtifactNote(undefined); setEvents(await window.betterwork.runs.listEvents({ runId: run.id })); await refreshTaskRuns(run.taskId); await refreshEvidence(run.taskId); setView('work'); };
  const selectTask = async (task: RecentTaskSummary): Promise<void> => {
    if (task.latestRun) { await selectRun(task.latestRun); return; }
    activeRunIdRef.current = undefined; activeTaskIdRef.current = task.id;
    setActiveRunId(undefined); setActiveTask({ id: task.id, sessionId: task.sessionId, title: task.title }); setSentPrompt(task.goal); setPrompt(''); setArtifactNote(undefined); setEvents([]); await refreshTaskRuns(task.id); await refreshEvidence(task.id); setView('work');
  };
  const openModelEditor = (model?: ModelProfileSummary): void => {
    setModelMessage('');
    if (model) { setEditingModelId(model.id); setModelForm({ name: model.name, provider: model.provider, baseUrl: model.baseUrl, model: model.model, role: model.role, apiKey: '', maxContextTokens: model.maxContextTokens, maxOutputTokens: model.maxOutputTokens, temperature: model.temperature, enabled: model.enabled, priority: model.priority }); }
    else { setEditingModelId(undefined); setModelForm(emptyModel); }
    setModelEditorOpen(true);
  };
  const saveModel = async (event: FormEvent): Promise<void> => { event.preventDefault(); try { await window.betterwork.models.save({ ...modelForm, ...(editingModelId ? { id: editingModelId } : {}) }); await refreshModels(); setModelEditorOpen(false); setModelMessage(editingModelId ? '模型配置已更新。' : '模型已添加，现在可以用于任务。'); } catch (error) { setModelMessage(error instanceof Error ? error.message : '保存失败，请检查配置。'); } };
  const testModel = async (): Promise<void> => { try { const result = await window.betterwork.models.test({ ...modelForm, ...(editingModelId ? { id: editingModelId } : {}) }); setModelMessage(result.message); await refreshModels(); } catch (error) { setModelMessage(error instanceof Error ? error.message : '连接测试失败。'); } };
  const toggleModel = (model: ModelProfileSummary): void => { void window.betterwork.models.setEnabled({ id: model.id, enabled: !model.enabled }).then(refreshModels); };
  const setDefaultModel = (model: ModelProfileSummary): void => { void window.betterwork.models.setDefault({ id: model.id }).then(async (result) => { setModelMessage(result.updated ? `${model.name} 已设为${roleName[model.role]}默认模型。` : '仅已启用模型可以设为默认。'); await refreshModels(); }); };
  const saveCurrentArtifact = async (): Promise<void> => {
    if (!activeTask || !activeRunId || !assistantDisplayText) return;
    try {
      const artifact = await window.betterwork.artifacts.saveMarkdown({ ...(currentTaskArtifacts[0] ? { artifactId: currentTaskArtifacts[0].id } : {}), taskId: activeTask.id, origin: 'assistant-run', runId: activeRunId, title: activeTask.title, content: assistantDisplayText });
      setArtifactNote({ tone: 'ok', text: `已保存为 Markdown 成果（v${artifact.versionNumber}）。` });
      await refreshArtifacts(); setContextTab('artifacts'); setContextOpen(true);
    } catch (error) { setArtifactNote({ tone: 'error', text: error instanceof Error ? error.message : '保存成果失败。' }); }
  };
  const openArtifact = async (artifact: ArtifactSummary): Promise<void> => {
    const detail = await window.betterwork.artifacts.get({ id: artifact.id });
    if (detail) setSelectedArtifact(detail);
  };
  const reviseArtifact = async (artifact: ArtifactDetail, title: string, content: string): Promise<void> => {
    const saved = await window.betterwork.artifacts.saveMarkdown({ artifactId: artifact.id, taskId: artifact.taskId, origin: 'user-edit', title, content });
    await refreshArtifacts();
    const detail = await window.betterwork.artifacts.get({ id: saved.id });
    if (detail) setSelectedArtifact(detail);
  };
  const exportArtifact = (artifact: ArtifactDetail, versionId?: string): Promise<{ cancelled: boolean; filePath?: string }> => window.betterwork.artifacts.exportMarkdown({ artifactId: artifact.id, ...(versionId ? { versionId } : {}) });
  const openKnowledge = (): void => { setView('knowledge'); void refreshKnowledge(); };
  const openKnowledgeSource = async (sourcePath: string): Promise<void> => {
    const result = await window.betterwork.knowledge.openSource({ sourcePath });
    if (!result.opened) throw new Error(result.error ?? '无法打开原始资料。');
  };
  const importKnowledge = async (): Promise<void> => {
    setIsImportingKnowledge(true); setKnowledgeMessage(''); setKnowledgeIssues([]);
    try {
      const result = await window.betterwork.knowledge.importFromDialog();
      if (result.imported.length || result.skipped.length) {
        setKnowledgeMessage(`已整理 ${result.imported.length} 份资料${result.skipped.length ? `；${result.skipped.length} 份未导入` : ''}。`);
        setKnowledgeIssues(result.skipped.map((item) => `${fileNameOf(item.sourcePath)}：${item.reason}`));
      } else {
        setKnowledgeMessage('已取消导入，未选择文件。');
      }
      await refreshKnowledge();
    } catch (error) { setKnowledgeMessage(error instanceof Error ? error.message : '导入资料失败。'); }
    finally { setIsImportingKnowledge(false); }
  };
  const removeKnowledgeDocument = async (document: KnowledgeDocumentSummary): Promise<void> => {
    if (!window.confirm(`从算台资料库移除「${document.title}」？\n\n这不会删除原始文件，只会删除本地检索索引。`)) return;
    try {
      const result = await window.betterwork.knowledge.remove({ id: document.id });
      setKnowledgeMessage(result.removed ? `已从资料库移除「${document.title}」，原始文件未受影响。` : '资料已不在当前资料库中。');
      setKnowledgeQuery('');
      await refreshKnowledge();
    } catch (error) { setKnowledgeMessage(error instanceof Error ? error.message : '移出资料库失败，请重试。'); }
  };
  const refreshKnowledgeDocument = async (document: KnowledgeDocumentSummary): Promise<void> => {
    setIsImportingKnowledge(true);
    try {
      const result = await window.betterwork.knowledge.refresh({ id: document.id });
      setKnowledgeMessage(result.refreshed ? `已刷新「${document.title}」的本地索引。` : result.error ?? '刷新索引失败。');
      setKnowledgeQuery('');
      await refreshKnowledge();
    } catch (error) { setKnowledgeMessage(error instanceof Error && error.message ? `刷新索引失败：${error.message}` : '刷新索引失败，请重试。'); }
    finally { setIsImportingKnowledge(false); }
  };
  const searchKnowledge = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const query = knowledgeQuery.trim();
    if (!query) { setKnowledgeResults([]); return; }
    try { setKnowledgeResults(await window.betterwork.knowledge.search({ query })); }
    catch (error) { setKnowledgeMessage(error instanceof Error ? error.message : '检索资料失败。'); }
  };

  return <main className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
    <aside className="sidebar">
      <div className="sidebar-top-drag" onDoubleClick={handleTitlebarDoubleClick} />
      <div className="brand" onDoubleClick={handleTitlebarDoubleClick}><span className="brand-mark" aria-hidden="true"><BrandLogo size={24} /></span><div><strong>算台</strong><small>BetterWork</small></div><button className="sidebar-collapse-button" aria-label={sidebarCollapsed ? '展开导航' : '收起导航'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>{sidebarCollapsed ? <ChevronRightIcon size={15} /> : <ChevronLeftIcon size={15} />}</button></div>
      <button className="new-task" onClick={startNewTask}><PlusIcon size={14} /> 新建任务</button>
      <nav className="primary-nav" aria-label="主要导航">
        <button className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}><span aria-hidden="true"><WorkIcon size={15} /></span> 工作</button>
        <button className={view === 'artifacts' ? 'active' : ''} onClick={() => { setView('artifacts'); setSelectedArtifact(undefined); void refreshArtifacts(); }}><span aria-hidden="true"><ArtifactIcon size={15} /></span> 成果</button>
        <button className={view === 'knowledge' ? 'active' : ''} onClick={openKnowledge}><span aria-hidden="true"><KnowledgeIcon size={15} /></span> 知识</button>
      </nav>
      <div className="sidebar-divider" /><p className="section-label">最近任务</p><div className="run-list">{recentTasks.length === 0 && <p className="empty-runs">你的任务会保存在这里。</p>}{recentTasks.map((task) => <button key={task.id} className={task.id === activeTask?.id ? 'run-item active' : 'run-item'} onClick={() => void selectTask(task)}><span>{task.title}</span><small>{task.latestRun ? `${runStatusName[task.latestRun.status]} · ${formatTime(task.latestRun.createdAt)}` : '等待开始'}</small></button>)}</div>
      <button className={view === 'settings' ? 'settings-nav active' : 'settings-nav'} onClick={() => { setView('settings'); setSettingsTab('models'); void refreshModels(); }}><span aria-hidden="true"><SettingsIcon size={15} /></span> 设置</button><div className="sidebar-footer">算台 BetterWork · Phase 0</div>
    </aside>
    <section className="main-stage">
      {view === 'settings' && <div className="window-drag-strip" onDoubleClick={handleTitlebarDoubleClick} />}
      {view === 'work' && <>
        <header className="page-header" onDoubleClick={handleTitlebarDoubleClick}><div><p className="eyebrow">工作</p><h1>{activeRun ? '继续完成任务' : '开始一件工作'}</h1></div><div className="page-header-actions"><button className="model-chip" onClick={() => { setView('settings'); setSettingsTab('models'); void refreshModels(); }}>{activeLanguageModel ? activeLanguageModel.name : '选择工作模型'} <span><ChevronDownIcon size={12} /></span></button><button className="context-toggle" onClick={() => setContextOpen((open) => !open)}>{contextOpen ? '收起上下文' : '查看上下文'}</button></div></header>
        <div className="workspace"><div className="messages"><div className="page-body">{events.length === 0 && !activeRunId ? <Welcome setPrompt={setPrompt} /> : <>{<div className="message user"><span>你</span><p>{sentPrompt}</p></div>}{assistantDisplayText && <div className="message assistant"><span>算台</span><p>{assistantDisplayText}</p></div>}{isCompletedRun && assistantDisplayText && <div className="message-actions"><button className="message-action" onClick={() => void saveCurrentArtifact()}><ArtifactIcon size={13} />保存为成果</button>{artifactNote && <span className={artifactNote.tone === 'ok' ? 'action-note ok' : 'action-note error'}>{artifactNote.text}</span>}</div>}{completedTools.map((event) => <div className={event.type === 'tool.failed' ? 'tool-card failed' : 'tool-card'} key={event.id}><div><span className="tool-icon" aria-hidden="true">{event.type === 'tool.failed' ? <AlertIcon size={11} /> : <CheckIcon size={11} />}</span><strong>{event.type === 'tool.completed' ? '已完成一个工作步骤' : '工作步骤未完成'}</strong></div><code>{eventDetail(event)}</code></div>)}</>}</div></div>
          <form className="composer" onSubmit={submit}><div className="workspace-row"><span>工作区</span><input aria-label="工作区" value={workspace?.rootPath ?? ''} readOnly /><button type="button" className="text-button" onClick={() => void window.betterwork.workspace.selectDirectory().then((selected) => { if (selected) { startNewTask(); workspaceIdRef.current = selected.id; setWorkspace(selected); void refreshTasks(selected.id); } })}>选择</button></div><textarea aria-label="任务输入，按 Command 或 Control 加 Enter 开始工作" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleComposerKeyDown} rows={3} placeholder="告诉算台你想完成什么工作…" /><div className="composer-footer"><span>{activeLanguageModel ? `${activeLanguageModel.provider} · ${activeLanguageModel.model}` : '未配置模型时使用教学 Provider'} <kbd>⌘/Ctrl ↵</kbd></span>{isRunning && activeRunId ? <button type="button" className="stop" onClick={() => void window.betterwork.runs.cancel({ runId: activeRunId })}>停止</button> : <button type="submit" disabled={!prompt.trim() || !workspace}>开始工作 <ArrowUpIcon size={13} /></button>}</div></form>
        </div>
      </>}
      {view === 'artifacts' && <ArtifactPage artifacts={artifacts} selected={selectedArtifact} onSelect={(artifact) => void openArtifact(artifact)} onSave={reviseArtifact} onExport={exportArtifact} onBack={() => setSelectedArtifact(undefined)} />}
      {view === 'knowledge' && <KnowledgePage documents={knowledgeDocuments} results={knowledgeResults} query={knowledgeQuery} setQuery={setKnowledgeQuery} message={knowledgeMessage} issues={knowledgeIssues} importing={isImportingKnowledge} onImport={() => void importKnowledge()} onSearch={(event) => void searchKnowledge(event)} onOpenSource={openKnowledgeSource} onRefresh={refreshKnowledgeDocument} onRemove={removeKnowledgeDocument} />}
      {view === 'settings' && <SettingsPage tab={settingsTab} setTab={setSettingsTab} models={filteredModels} modelFilter={modelFilter} setModelFilter={setModelFilter} activeLanguageModel={activeLanguageModel} defaultModelIds={defaultModelIds} onAdd={() => openModelEditor()} onEdit={openModelEditor} onToggle={toggleModel} onSetDefault={setDefaultModel} onDelete={(model) => void window.betterwork.models.delete({ id: model.id }).then(refreshModels)} appearance={appearance} resolvedAppearance={resolvedAppearance} onMode={(mode) => setAppearanceValue({ ...appearance, mode })} onScheme={(scheme) => setAppearanceValue({ ...appearance, scheme })} modelMessage={modelMessage} />}
    </section>
    {view === 'work' && <ContextPanel open={contextOpen} setOpen={setContextOpen} tab={contextTab} setTab={setContextTab} events={events} evidence={evidence} artifacts={currentTaskArtifacts} activeRun={activeRun} taskRuns={taskRuns} activityGroups={activityGroups} onSelectRun={(run) => void selectRun(run)} onOpenSource={openKnowledgeSource} />}
    {modelEditorOpen && <ModelEditor form={modelForm} setForm={setModelForm} editing={Boolean(editingModelId)} message={modelMessage} onClose={() => setModelEditorOpen(false)} onSave={saveModel} onTest={() => void testModel()} />}
  </main>;
}

function Welcome({ setPrompt }: { setPrompt: (value: string) => void }): React.JSX.Element { return <div className="welcome"><div className="abacus" aria-hidden="true"><i /><i /><i /><i /></div><p className="eyebrow">算台 · 知识工作台</p><h2>以我所知，成我所作</h2><p>从一个清楚的问题开始，算台会协助你把过程沉淀为可以继续使用的成果。</p><div className="examples"><button onClick={() => setPrompt('计算: (128 + 72) / 4')}>计算一组数据</button><button onClick={() => setPrompt('读取: README.md')}>读取一份资料</button></div></div>; }
function EmptyContext({ title, detail }: { title: string; detail: string }): React.JSX.Element { return <div className="empty-context"><span aria-hidden="true"><ArtifactIcon size={16} /></span><strong>{title}</strong><p>{detail}</p></div>; }
function EmptyPage({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }): React.JSX.Element { return <section className="empty-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></section>; }
function KnowledgePage({ documents, results, query, setQuery, message, issues, importing, onImport, onSearch, onOpenSource, onRefresh, onRemove }: { documents: KnowledgeDocumentSummary[]; results: KnowledgeSearchResult[]; query: string; setQuery: (query: string) => void; message: string; issues: string[]; importing: boolean; onImport: () => void; onSearch: (event: FormEvent) => void; onOpenSource: (sourcePath: string) => Promise<void>; onRefresh: (document: KnowledgeDocumentSummary) => Promise<void>; onRemove: (document: KnowledgeDocumentSummary) => Promise<void> }): React.JSX.Element {
  const showingResults = Boolean(query.trim());
  const items: Array<{ document: KnowledgeDocumentSummary; excerpt?: string; locator?: string }> = showingResults ? results.map((result) => ({ document: result.document, locator: result.locator, excerpt: result.excerpt })) : documents.map((document) => ({ document }));
  const [openMessage, setOpenMessage] = useState('');
  return <><header className="page-header" onDoubleClick={handleTitlebarDoubleClick}><div><p className="eyebrow">知识 · 个人资料库</p><h1>让资料成为下一次工作的起点</h1></div><button className="primary-button" disabled={importing} onClick={onImport}>{importing ? '正在处理…' : <><PlusIcon size={13} /> 导入资料</>}</button></header><div className="page-scroll"><section className="page-body knowledge-page"><p className="page-intro">资料保留在你的本机路径；算台只建立可重建的本地文本索引。当前支持 Markdown、文本、PDF 与 Word。</p><form className="knowledge-search" onSubmit={onSearch}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料库中的内容…" aria-label="搜索个人资料库" /><button type="submit">搜索</button>{showingResults && <button type="button" className="clear-search" onClick={() => setQuery('')}>清除</button>}</form>{message && <p className="inline-message">{message}</p>}{issues.length > 0 && <div className="knowledge-issues"><strong>以下资料未导入</strong><ul>{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></div>}{openMessage && <p className="knowledge-open-message">{openMessage}</p>}<div className="knowledge-summary"><span>{showingResults ? `找到 ${items.length} 条相关资料` : `已整理 ${documents.length} 份资料`}</span><small>{showingResults ? '检索仅在本地资料库中进行' : '下一步将支持表格与语义检索'}</small></div>{items.length === 0 ? <EmptyPage eyebrow={showingResults ? '没有匹配结果' : '从一份资料开始'} title={showingResults ? '换个关键词试试' : '把常用资料放进你的资料库'} detail={showingResults ? '当前先按文本内容进行本地检索。' : '导入 Markdown、文本、PDF 或 Word 后，它们会在后续研究和写作中成为可引用的个人资料。'} /> : <div className="knowledge-list">{items.map(({ document, excerpt, locator }) => <article className="knowledge-card" key={`${document.id}-${locator ?? 'document'}`}><span className={`knowledge-format ${document.format}`}>{document.format === 'markdown' ? 'MD' : document.format === 'pdf' ? 'PDF' : document.format === 'docx' ? 'DOC' : 'TXT'}</span><div><strong>{document.title}</strong>{excerpt && <p>{excerpt}</p>}<small>{document.sourcePath}{locator ? ` · ${locator}` : ''} · 更新于 {formatTime(document.updatedAt)}</small></div><div className="knowledge-card-actions"><button className="open-source-button" onClick={() => void onOpenSource(document.sourcePath).then(() => setOpenMessage(`已打开「${document.title}」的原始资料。`)).catch((reason: unknown) => setOpenMessage(reason instanceof Error ? reason.message : '无法打开原始资料。'))}>打开原文</button><button className="refresh-knowledge-button" disabled={importing} onClick={() => void onRefresh(document)}>刷新索引</button><button className="remove-knowledge-button" disabled={importing} onClick={() => void onRemove(document)}>移出资料库</button></div></article>)}</div>}</section></div></>;
}
function CompletedWorkPage({ runs, onOpen }: { runs: RunSummary[]; onOpen: (run: RunSummary) => void }): React.JSX.Element { return <section className="completed-work-page"><header><div><p className="eyebrow">成果</p><h1>已完成的工作</h1><p>Phase 0 先展示可以回看的任务交付。研究报告、Word、Excel 与 PPT 将在后续以独立 Artifact 形式管理。</p></div><span className="work-count">{runs.length} 项</span></header>{runs.length === 0 ? <EmptyPage eyebrow="尚无交付" title="完成一项工作，它会出现在这里" detail="当前可使用计算和读取资料的教学链路；后续这里会承载可继续编辑的报告、表格和演示。" /> : <div className="completed-work-list">{runs.map((run) => <button className="completed-work-card" key={run.id} onClick={() => onOpen(run)}><span className="completed-work-icon" aria-hidden="true"><CheckIcon size={14} /></span><div><strong>{run.prompt}</strong><p>已完成 · {formatTime(run.completedAt ?? run.createdAt)}</p></div><span aria-hidden="true"><ChevronRightIcon size={16} /></span></button>)}</div>}</section>; }
function ArtifactPage({ artifacts, selected, onSelect, onSave, onExport, onBack }: { artifacts: ArtifactSummary[]; selected: ArtifactDetail | undefined; onSelect: (artifact: ArtifactSummary) => void; onSave: (artifact: ArtifactDetail, title: string, content: string) => Promise<void>; onExport: (artifact: ArtifactDetail, versionId?: string) => Promise<{ cancelled: boolean; filePath?: string }>; onBack: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [viewingVersion, setViewingVersion] = useState<ArtifactVersionDetail>();
  const [exportMessage, setExportMessage] = useState('');
  useEffect(() => {
    setEditing(false); setError(''); setExportMessage(''); setTitle(selected?.title ?? ''); setContent(selected?.content ?? ''); setViewingVersion(undefined);
    if (!selected) { setVersions([]); return; }
    void window.betterwork.artifacts.listVersions({ artifactId: selected.id }).then(setVersions);
  }, [selected?.id, selected?.currentVersionId]);
  const visibleVersion = viewingVersion ?? (selected ? { id: selected.currentVersionId, artifactId: selected.id, versionNumber: selected.versionNumber, origin: selected.origin, sourceRunId: selected.sourceRunId, createdAt: selected.updatedAt, content: selected.content, contentHash: selected.contentHash, evidence: selected.evidence } : undefined);
  const selectVersion = async (version: ArtifactVersionSummary): Promise<void> => {
    const detail = await window.betterwork.artifacts.getVersion({ id: version.id });
    if (detail) { setViewingVersion(detail); setEditing(false); setError(''); }
  };
  if (selected && visibleVersion) return <><header className="page-header" onDoubleClick={handleTitlebarDoubleClick}><div className="page-header-leading"><button className="back-button" onClick={onBack}><ChevronLeftIcon size={13} /> 成果</button><div><p className="eyebrow">Markdown · v{visibleVersion.versionNumber}{visibleVersion.origin === 'user-edit' ? ' · 人工修订' : ''}{visibleVersion.id !== selected.currentVersionId ? ' · 历史版本' : ''}</p><h1>{selected.title}</h1></div></div>{!editing && <div className="page-header-actions"><button className="secondary-button" onClick={() => void onExport(selected, visibleVersion.id).then((result) => setExportMessage(result.cancelled ? '' : `已导出到 ${result.filePath ?? '所选位置'}。`)).catch((reason: unknown) => setExportMessage(reason instanceof Error ? reason.message : '导出失败。'))}>导出 Markdown</button><button className="primary-button" onClick={() => { setTitle(selected.title); setContent(visibleVersion.content); setEditing(true); }}>编辑此版本</button></div>}</header><div className="page-scroll"><section className="page-body artifact-detail-page"><p className="page-intro">{visibleVersion.id !== selected.currentVersionId ? '正在查看历史版本；编辑后会从这里创建新的人工修订版本。' : visibleVersion.origin === 'user-edit' ? '这是人工修订版本；此前版本仍可回溯。' : '来自一次任务运行，可在后续继续修订并形成新版本。'}</p>{exportMessage && <p className="artifact-export-message">{exportMessage}</p>}<div className="artifact-detail-layout"><aside className="artifact-version-list"><div><strong>版本历史</strong><span>{versions.length} 个版本</span></div>{versions.map((version) => <button key={version.id} className={version.id === visibleVersion.id ? 'active' : ''} onClick={() => void selectVersion(version)}><span>v{version.versionNumber}</span><small>{version.origin === 'user-edit' ? '人工修订' : 'AI 生成'} · {formatTime(version.createdAt)}</small></button>)}{visibleVersion.evidence.length > 0 && <div className="artifact-evidence-list"><strong>本版来源</strong>{visibleVersion.evidence.map((item) => <article key={item.id}><b><KnowledgeIcon size={10} /></b><div><span>{item.title}</span><small>{item.locator}</small></div></article>)}</div>}</aside>{editing ? <form className="artifact-editor" onSubmit={(event) => { event.preventDefault(); setError(''); void onSave(selected, title, content).then(() => setEditing(false)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '保存修订失败。')); }}><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required /></label><label>Markdown 内容<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={20} required /></label>{error && <p className="artifact-editor-error">{error}</p>}<footer><span>保存后会创建 v{selected.versionNumber + 1} 人工修订版本。</span><div><button type="button" className="secondary-button" onClick={() => { setEditing(false); setError(''); setTitle(selected.title); setContent(visibleVersion.content); }}>取消</button><button type="submit" className="primary-button">保存新版本</button></div></footer></form> : <MarkdownPreview content={visibleVersion.content} />}</div></section></div></>; return <><header className="page-header" onDoubleClick={handleTitlebarDoubleClick}><div><p className="eyebrow">成果</p><h1>可继续工作的交付物</h1></div><span className="work-count">{artifacts.length} 项</span></header><div className="page-scroll"><section className="page-body completed-work-page"><p className="page-intro">Markdown 是第一种可版本化的成果。后续研究报告、Word、Excel 和 PPT 会接入同一条 Artifact 链路。</p>{artifacts.length === 0 ? <EmptyPage eyebrow="尚无成果" title="将一次完成的回复保存为成果" detail="成果不同于运行记录：它会关联任务、来源运行与版本，方便后续继续修改和导出。" /> : <div className="completed-work-list">{artifacts.map((artifact) => <button className="completed-work-card" key={artifact.id} onClick={() => onSelect(artifact)}><span className="completed-work-icon markdown" aria-hidden="true">MD</span><div><strong>{artifact.title}</strong><p>Markdown · v{artifact.versionNumber}{artifact.origin === 'user-edit' ? ' · 人工修订' : ''} · 更新于 {formatTime(artifact.updatedAt)}</p></div><span aria-hidden="true"><ChevronRightIcon size={16} /></span></button>)}</div>}</section></div></>; }

function ContextPanel({ open, setOpen, tab, setTab, events, evidence, artifacts, activeRun, taskRuns, activityGroups, onSelectRun, onOpenSource }: { open: boolean; setOpen: (open: boolean) => void; tab: ContextTab; setTab: (tab: ContextTab) => void; events: AgentRuntimeEvent[]; evidence: EvidenceSummary[]; artifacts: ArtifactSummary[]; activeRun?: RunSummary | undefined; taskRuns: RunSummary[]; activityGroups: ActivityGroup[]; onSelectRun: (run: RunSummary) => void; onOpenSource: (sourcePath: string) => Promise<void> }): React.JSX.Element {
  const [sourceMessage, setSourceMessage] = useState('');
  if (!open) return <aside className="context-collapsed"><div className="window-drag-strip" onDoubleClick={handleTitlebarDoubleClick} /><button aria-label="展开上下文面板" onClick={() => setOpen(true)}><PanelLeftIcon size={14} /></button></aside>;
  return <aside className="context-panel"><div className="context-topline" onDoubleClick={handleTitlebarDoubleClick}><span>当前任务</span><button aria-label="收起上下文面板" onClick={() => setOpen(false)}><ChevronRightIcon size={14} /></button></div><div className="context-tabs" role="tablist" aria-label="任务上下文">{([['process', '过程'], ['sources', '资料'], ['artifacts', '成果']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div><div className="context-content">{tab === 'process' && (events.length === 0 ? <EmptyContext title="等待任务开始" detail="开始后，这里会按工作阶段呈现过程，而不是堆叠底层日志。" /> : <div className="activity-list"><div className="activity-summary"><span className={`status-dot ${activeRun?.status === 'running' ? 'running' : ''}`} /><div><strong>{activeRun ? runStatusName[activeRun.status] : '正在处理任务'}</strong><p>{activityGroups.length} 个工作阶段</p></div></div>{activityGroups.map((group) => <ActivityGroupRow group={group} key={group.id} />)}{taskRuns.length > 1 && <details className="task-run-history"><summary>执行记录 · {taskRuns.length} 次</summary>{taskRuns.map((run) => <button key={run.id} className={run.id === activeRun?.id ? 'active' : ''} onClick={() => onSelectRun(run)}><span>{runStatusName[run.status]}</span><strong>{run.prompt}</strong><small>{formatTime(run.createdAt)}</small></button>)}</details>}</div>)}{tab === 'sources' && (evidence.length === 0 ? <EmptyContext title="尚无引用资料" detail="检索个人资料库后，相关来源会显示在这里。" /> : <div className="evidence-list">{sourceMessage && <p className="context-source-message">{sourceMessage}</p>}{evidence.map((item) => <article className="evidence-row" key={item.id}><span aria-hidden="true"><KnowledgeIcon size={12} /></span><div><strong>{item.title}</strong><small>{item.locator} · 本地资料</small><p>{item.excerpt}</p></div><button className="evidence-open-button" onClick={() => void onOpenSource(item.sourceUri).then(() => setSourceMessage(`已打开「${item.title}」原文。`)).catch((reason: unknown) => setSourceMessage(reason instanceof Error ? reason.message : '无法打开原始资料。'))}>原文</button></article>)}</div>)}{tab === 'artifacts' && (artifacts.length === 0 ? <EmptyContext title="尚无工作成果" detail="将完成的回复保存为 Markdown 后，它会出现在这里。" /> : <div className="evidence-list">{artifacts.map((artifact) => <article className="evidence-row" key={artifact.id}><span aria-hidden="true"><ArtifactIcon size={12} /></span><div><strong>{artifact.title}</strong><small>Markdown · v{artifact.versionNumber}</small></div></article>)}</div>)}</div></aside>;
}

function ActivityGroupRow({ group }: { group: ActivityGroup }): React.JSX.Element { return <div className={`activity-row ${group.status}`}><span className="activity-marker" /><div><strong>{group.title}</strong><p>{group.description}</p><small>{group.status === 'running' ? '进行中' : formatTime(group.updatedAt)}</small></div></div>; }

interface SettingsPageProps { tab: SettingsTab; setTab: (tab: SettingsTab) => void; models: ModelProfileSummary[]; modelFilter: ModelProfileSummary['role'] | 'all'; setModelFilter: (filter: ModelProfileSummary['role'] | 'all') => void; activeLanguageModel?: ModelProfileSummary | undefined; defaultModelIds: Map<ModelProfileSummary['role'], string | undefined>; onAdd: () => void; onEdit: (model: ModelProfileSummary) => void; onToggle: (model: ModelProfileSummary) => void; onSetDefault: (model: ModelProfileSummary) => void; onDelete: (model: ModelProfileSummary) => void; appearance: AppearancePreference; resolvedAppearance: ResolvedAppearance; onMode: (mode: AppearanceMode) => void; onScheme: (scheme: ColorScheme) => void; modelMessage: string; }
function SettingsPage(props: SettingsPageProps): React.JSX.Element { const { tab, setTab } = props; return <div className="settings-layout"><aside className="settings-nav-list"><p className="eyebrow">设置</p><h1>偏好与能力</h1><button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>模型与能力</button><button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>外观</button><button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>通用</button></aside><section className="settings-content">{tab === 'models' && <ModelSettings {...props} />}{tab === 'appearance' && <AppearanceSettings {...props} />}{tab === 'general' && <section className="settings-section"><p className="eyebrow">通用</p><h2>工作偏好</h2><div className="setting-placeholder"><strong>通用设置将在后续阶段开放</strong><p>工作目录、语言、数据与更新设置会在这里统一管理。</p></div></section>}</section></div>; }
function ModelSettings({ models, modelFilter, setModelFilter, defaultModelIds, onAdd, onEdit, onToggle, onSetDefault, onDelete, modelMessage }: SettingsPageProps): React.JSX.Element { return <section className="settings-section"><div className="settings-heading"><div><p className="eyebrow">模型与能力</p><h2>让每一种工作使用合适的模型</h2><p>API Key 仅保存于本机主进程。语言模型会用于当前任务，视觉与嵌入能力将在对应工作流启用。</p></div><button className="primary-button" onClick={onAdd}><PlusIcon size={13} /> 添加模型</button></div>{modelMessage && <p className="inline-message">{modelMessage}</p>}<div className="filter-bar">{(['all', 'language', 'vision', 'embedding'] as const).map((role) => <button className={modelFilter === role ? 'active' : ''} key={role} onClick={() => setModelFilter(role)}>{role === 'all' ? '全部' : roleName[role]}</button>)}</div><div className="model-list">{models.length === 0 ? <div className="empty-models"><strong>尚未配置模型</strong><p>添加一个 OpenAI-compatible 服务后，即可从教学链路切换到真实模型。</p></div> : models.map((model) => { const isDefault = defaultModelIds.get(model.role) === model.id; return <article className={model.enabled ? 'model-row' : 'model-row disabled'} key={model.id}><div className="model-role-icon" aria-hidden="true">{model.role === 'language' ? '文' : model.role === 'vision' ? '图' : '嵌'}</div><div className="model-main"><div><strong>{model.name}</strong>{isDefault && <span className="current-badge">{model.role === 'language' ? '当前工作模型' : '默认模型'}</span>}</div><p>{roleName[model.role]} · {model.provider} · {model.model}</p><small>{model.apiKeyConfigured ? '已配置凭据' : '未配置凭据'} · <span className={`connection-status ${model.connectionStatus}`}>{connectionStatusName[model.connectionStatus]}</span> · {model.enabled ? '已启用' : '已停用'}</small></div><div className="model-actions"><button onClick={() => onEdit(model)}>编辑</button>{!isDefault && <button disabled={!model.enabled} onClick={() => onSetDefault(model)}>设为默认</button>}<button onClick={() => onToggle(model)}>{model.enabled ? '停用' : '启用'}</button><button className="danger-text" onClick={() => onDelete(model)}>删除</button></div></article>; })}</div></section>; }
function AppearanceSettings({ appearance, resolvedAppearance, onMode, onScheme }: SettingsPageProps): React.JSX.Element { return <section className="settings-section appearance-settings"><div className="settings-heading"><div><p className="eyebrow">外观</p><h2>选择适合长期工作的界面</h2><p>外观模式与色系独立保存；跟随系统时仍会保留你选择的色系。</p></div></div><h3>外观模式</h3><div className="appearance-modes">{([['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']] as const).map(([mode, label]) => <button className={appearance.mode === mode ? 'selected' : ''} key={mode} onClick={() => onMode(mode)}><span className={`mode-preview ${mode}`}><i /><b /><em /></span><strong>{label}</strong>{mode === 'system' && <small>当前为{resolvedAppearance === 'dark' ? '深色' : '浅色'}</small>}</button>)}</div><h3>色系</h3><div className="scheme-grid">{colorSchemes.map((scheme) => <button className={appearance.scheme === scheme.id ? 'selected' : ''} key={scheme.id} onClick={() => onScheme(scheme.id)}><span className={`scheme-preview ${scheme.id}`}><i /><i /><i /></span><strong>{scheme.name}</strong><small>{scheme.description}</small></button>)}</div><div className="appearance-note"><span><CheckIcon size={13} /></span><p>所有色系都提供浅色与深色 Variant。应用换肤不会改变 Word、PPT、Excel 和其他成果自身的配色。</p></div></section>; }
interface ModelEditorProps { form: ModelProfileInput; setForm: (input: ModelProfileInput) => void; editing: boolean; message: string; onClose: () => void; onSave: (event: FormEvent) => Promise<void>; onTest: () => void; }
function ModelEditor({ form, setForm, editing, message, onClose, onSave, onTest }: ModelEditorProps): React.JSX.Element { return <div className="sheet-backdrop" onMouseDown={onClose}><aside className="model-sheet" role="dialog" aria-modal="true" aria-label={editing ? '编辑模型' : '添加模型'} onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">模型配置</p><h2>{editing ? '编辑模型' : '添加模型'}</h2></div><button aria-label="关闭" onClick={onClose}><CloseIcon size={14} /></button></header><form onSubmit={(event) => void onSave(event)}><label>显示名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：公司主力模型" /></label><div className="form-grid"><label>模型角色<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as ModelProfileInput['role'] })}><option value="language">语言模型</option><option value="vision">视觉模型</option><option value="embedding">嵌入模型</option></select></label><label>Provider<input required value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} placeholder="openai-compatible" /></label></div><label>模型名称<input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="模型服务中的 model id" /></label><label>API 地址<input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label><label>API Key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editing ? '留空则保持原有凭据' : '可留空'} /></label><details><summary>高级参数</summary><div className="form-grid"><label>上下文 Token<input type="number" min="1" value={form.maxContextTokens} onChange={(event) => setForm({ ...form, maxContextTokens: Number(event.target.value) })} /></label><label>最大输出 Token<input type="number" min="1" value={form.maxOutputTokens} onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })} /></label></div></details>{message && <p className="inline-message">{message}</p>}<footer><button type="button" className="secondary-button" onClick={onTest}>测试连接</button><button type="submit" className="primary-button">{editing ? '保存修改' : '添加模型'}</button></footer></form></aside></div>; }
