import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRuntimeEvent, ModelProfileInput, ModelProfileSummary, RunSummary } from '@betterwork/agent-protocol';

const taskId = 'phase-0-playground';
const sessionId = 'phase-0-session';

const eventTitle = (event: AgentRuntimeEvent): string => {
  const titles: Record<AgentRuntimeEvent['type'], string> = {
    'run.started': '开始运行', 'message.started': '开始回答', 'message.delta': '输出文本',
    'message.completed': '回答完成', 'reasoning.delta': '执行判断', 'tool.requested': '请求工具',
    'tool.started': '工具开始', 'tool.progress': '工具进度', 'tool.completed': '工具完成',
    'tool.failed': '工具失败', 'run.completed': '运行完成', 'run.failed': '运行失败',
    'run.cancelled': '运行已取消',
  };
  return titles[event.type];
};

const eventDetail = (event: AgentRuntimeEvent): string => {
  if (event.type === 'message.delta') return event.delta;
  if (event.type === 'reasoning.delta') return event.delta;
  if (event.type === 'tool.requested' || event.type === 'tool.started') return event.toolCall.name;
  if (event.type === 'tool.progress') return event.message;
  if (event.type === 'tool.completed') return JSON.stringify(event.output);
  if (event.type === 'tool.failed' || event.type === 'run.failed') return event.error;
  return '';
};

export function App(): React.JSX.Element {
  const [prompt, setPrompt] = useState('计算: (12 + 8) * 3');
  const [workspacePath, setWorkspacePath] = useState('');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [models, setModels] = useState<ModelProfileSummary[]>([]);
  const [modelMessage, setModelMessage] = useState('');
  const emptyModel: ModelProfileInput = { name: '', provider: 'openai-compatible', baseUrl: '', model: '', role: 'language', apiKey: '', maxContextTokens: 8192, maxOutputTokens: 8192, temperature: 0.7, enabled: true };
  const [modelForm, setModelForm] = useState<ModelProfileInput>(emptyModel);
  const [editingModelId, setEditingModelId] = useState<string>();
  const [modelFilter, setModelFilter] = useState<ModelProfileSummary['role'] | 'all'>('all');

  const refreshRuns = async (): Promise<void> => setRuns(await window.betterwork.runs.list());
  const refreshModels = async (): Promise<void> => setModels(await window.betterwork.models.list());

  useEffect(() => {
    void refreshRuns();
    void refreshModels();
    void window.betterwork.workspace.getDefaultPath().then(setWorkspacePath);
    return window.betterwork.runs.onEvent((event) => {
      setEvents((current) => event.runId === activeRunIdRef.current ? [...current, event] : current);
      if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') void refreshRuns();
    });
  }, []);

  const assistantText = useMemo(() => events
    .filter((event): event is Extract<AgentRuntimeEvent, { type: 'message.delta' }> => event.type === 'message.delta')
    .map((event) => event.delta).join(''), [events]);
  const activeRun = runs.find((run) => run.id === activeRunId);
  const activeLanguageModel = models.find((model) => model.role === 'language' && model.enabled);
  const isRunning = activeRun?.status === 'running' || events.at(-1)?.type === 'run.started' ||
    (!!activeRunId && !events.some((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await window.betterwork.runs.start({ taskId, sessionId, prompt, workspacePath });
    activeRunIdRef.current = result.runId;
    setActiveRunId(result.runId);
    setEvents([]);
    await refreshRuns();
  };

  const selectRun = async (run: RunSummary): Promise<void> => {
    activeRunIdRef.current = run.id;
    setActiveRunId(run.id);
    setPrompt(run.prompt);
    setEvents(await window.betterwork.runs.listEvents({ runId: run.id }));
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">算</span><div><strong>算台</strong><small>BetterWork</small></div></div>
        <button className="new-task" onClick={() => { activeRunIdRef.current = undefined; setActiveRunId(undefined); setEvents([]); }}>＋ 新任务</button>
        <p className="section-label">最近运行</p>
        <div className="run-list">
          {runs.map((run) => (
            <button key={run.id} className={run.id === activeRunId ? 'run-item active' : 'run-item'} onClick={() => void selectRun(run)}>
              <span>{run.prompt}</span><small>{run.status}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">Phase 0 · 教学链路</div>
      </aside>

      <section className="conversation">
        <header><div><h1>Agent 运行实验台</h1><p>观察一次请求如何经过模型、工具、持久化与界面。</p></div><div className="header-actions"><button className="settings-button" onClick={() => { setShowModelSettings(true); void refreshModels(); }}>模型设置</button><span className="phase-badge">PHASE 0</span></div></header>
        <div className="messages">
          {events.length === 0 ? (
            <div className="welcome"><div className="abacus">● ━ ● ━ ●</div><h2>以我所知，成我所作。</h2><p>输入计算表达式，或读取当前工作区里的文本文件。</p><div className="examples"><button onClick={() => setPrompt('计算: (128 + 72) / 4')}>计算: (128 + 72) / 4</button><button onClick={() => setPrompt('读取: README.md')}>读取: README.md</button></div></div>
          ) : (
            <>
              <div className="message user"><span>你</span><p>{prompt}</p></div>
              {assistantText && <div className="message assistant"><span>算台</span><p>{assistantText}</p></div>}
              {events.filter((event) => event.type === 'tool.completed' || event.type === 'tool.failed').map((event) => (
                <div className="tool-card" key={event.id}><strong>{event.type === 'tool.completed' ? '工具执行完成' : '工具执行失败'}</strong><code>{eventDetail(event)}</code></div>
              ))}
            </>
          )}
        </div>
        <form className="composer" onSubmit={(event) => void submit(event)}>
          <label>工作区<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} /><button type="button" className="choose-workspace" onClick={() => void window.betterwork.workspace.selectDirectory().then((selected) => { if (selected) setWorkspacePath(selected); })}>选择</button></label>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
          <div><span>{activeLanguageModel ? `${activeLanguageModel.provider} · ${activeLanguageModel.model}` : 'Fake Provider · 工具调用演示'}</span>{isRunning && activeRunId ? <button type="button" className="stop" onClick={() => void window.betterwork.runs.cancel({ runId: activeRunId })}>停止</button> : <button type="submit" disabled={!prompt.trim() || !workspacePath}>运行</button>}</div>
        </form>
      </section>

      <aside className="timeline">
        <header><h2>执行时间线</h2><p>{events.length} 个持久化事件</p></header>
        <div className="timeline-list">
          {events.map((event) => <div className="timeline-event" key={event.id}><i /><div><strong>{eventTitle(event)}</strong><p>{eventDetail(event)}</p><small>#{event.sequence} · {new Date(event.createdAt).toLocaleTimeString()}</small></div></div>)}
          {events.length === 0 && <div className="empty-timeline">运行任务后，这里会展示事件顺序。</div>}
        </div>
      </aside>
      {showModelSettings && <div className="modal-backdrop" onClick={() => setShowModelSettings(false)}><section className="model-settings" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title"><div><h2>模型设置</h2><p>配置语言、视觉或 Embedding 模型。API Key 只在主进程保存。</p></div><button onClick={() => setShowModelSettings(false)}>×</button></div>
        <div className="model-filters"><button className={modelFilter === 'all' ? 'selected' : ''} onClick={() => setModelFilter('all')}>全部</button>{(['language', 'vision', 'embedding'] as const).map((role) => <button key={role} className={modelFilter === role ? 'selected' : ''} onClick={() => setModelFilter(role)}>{role === 'language' ? '语言' : role === 'vision' ? '视觉' : 'Embedding'}</button>)}</div>
        <div className="configured-models">{models.filter((model) => modelFilter === 'all' || model.role === modelFilter).map((model) => <div className={model.enabled ? 'model-row' : 'model-row disabled'} key={model.id}><div><strong>{model.name}</strong><small>{model.provider} · {model.model} · {model.role}{model.apiKeyConfigured ? ' · 已配置凭据' : ' · 无凭据'}</small></div><div className="model-row-actions"><button onClick={() => { setEditingModelId(model.id); setModelForm({ name: model.name, provider: model.provider, baseUrl: model.baseUrl, model: model.model, role: model.role, apiKey: '', maxContextTokens: model.maxContextTokens, maxOutputTokens: model.maxOutputTokens, temperature: model.temperature, enabled: model.enabled, priority: model.priority }); }}>编辑</button><button onClick={() => void window.betterwork.models.save({ name: model.name, provider: model.provider, baseUrl: model.baseUrl, model: model.model, role: model.role, apiKey: '', maxContextTokens: model.maxContextTokens, maxOutputTokens: model.maxOutputTokens, temperature: model.temperature, enabled: !model.enabled, priority: model.priority }).then(() => refreshModels())}>{model.enabled ? '停用' : '启用'}</button><button onClick={() => void window.betterwork.models.delete({ id: model.id }).then(() => refreshModels())}>删除</button></div></div>)}</div>
        <form className="model-form" onSubmit={(event) => { event.preventDefault(); void window.betterwork.models.save({ ...modelForm, ...(editingModelId ? { id: editingModelId } : {}) }).then(() => { setModelMessage('模型已保存'); setModelForm(emptyModel); setEditingModelId(undefined); return refreshModels(); }).catch((error: unknown) => setModelMessage(error instanceof Error ? error.message : '保存失败')); }}>
          <div className="form-grid"><label>显示名称<input required value={modelForm.name} onChange={(event) => setModelForm({ ...modelForm, name: event.target.value })} placeholder="例如：公司主力模型" /></label><label>模型类型<select value={modelForm.role} onChange={(event) => setModelForm({ ...modelForm, role: event.target.value as ModelProfileInput['role'] })}><option value="language">语言模型</option><option value="vision">视觉模型</option><option value="embedding">Embedding 模型</option></select></label><label>Provider<input required value={modelForm.provider} onChange={(event) => setModelForm({ ...modelForm, provider: event.target.value })} placeholder="openai-compatible" /></label><label>模型名称<input required value={modelForm.model} onChange={(event) => setModelForm({ ...modelForm, model: event.target.value })} placeholder="模型服务中的 model id" /></label></div>
          <label>API 地址<input required type="url" value={modelForm.baseUrl} onChange={(event) => setModelForm({ ...modelForm, baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label><label>API Key<input type="password" value={modelForm.apiKey} onChange={(event) => setModelForm({ ...modelForm, apiKey: event.target.value })} placeholder="可留空" /></label>
          <div className="model-form-actions"><button type="button" onClick={() => void window.betterwork.models.test(modelForm).then((result) => setModelMessage(result.message))}>测试连接</button>{editingModelId && <button type="button" onClick={() => { setEditingModelId(undefined); setModelForm(emptyModel); }}>取消编辑</button>}<button type="submit">{editingModelId ? '保存修改' : '添加模型'}</button></div>
        </form><p className="model-message">{modelMessage}</p>
      </section></div>}
    </main>
  );
}
