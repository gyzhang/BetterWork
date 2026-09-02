import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRuntimeEvent, RunSummary } from '@betterwork/agent-protocol';

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

  const refreshRuns = async (): Promise<void> => setRuns(await window.betterwork.runs.list());

  useEffect(() => {
    void refreshRuns();
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
        <header><div><h1>Agent 运行实验台</h1><p>观察一次请求如何经过模型、工具、持久化与界面。</p></div><span className="phase-badge">PHASE 0</span></header>
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
          <div><span>Fake Provider · 工具调用演示</span>{isRunning && activeRunId ? <button type="button" className="stop" onClick={() => void window.betterwork.runs.cancel({ runId: activeRunId })}>停止</button> : <button type="submit" disabled={!prompt.trim() || !workspacePath}>运行</button>}</div>
        </form>
      </section>

      <aside className="timeline">
        <header><h2>执行时间线</h2><p>{events.length} 个持久化事件</p></header>
        <div className="timeline-list">
          {events.map((event) => <div className="timeline-event" key={event.id}><i /><div><strong>{eventTitle(event)}</strong><p>{eventDetail(event)}</p><small>#{event.sequence} · {new Date(event.createdAt).toLocaleTimeString()}</small></div></div>)}
          {events.length === 0 && <div className="empty-timeline">运行任务后，这里会展示事件顺序。</div>}
        </div>
      </aside>
    </main>
  );
}
