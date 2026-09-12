import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { useId, useState } from 'react';

import { AlertIcon, CheckIcon, ChevronRightIcon } from '../icons';
import { toolStageLabel } from '../lib/labels';
import { deriveToolActivity, formatToolValue, toolTarget } from '../lib/tool-activity';

const statusLabel = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
} as const;

function Payload({ title, value }: { title: string; value: unknown }): React.JSX.Element {
  const entries: Array<[string, unknown]> =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value)
      : [['内容', value]];
  return (
    <section className="tool-payload" aria-label={title}>
      <h4>{title}</h4>
      {entries.length === 0 ? (
        <p>无</p>
      ) : (
        entries.map(([key, field]) => (
          <details key={key} className="tool-field" open={entries.length === 1}>
            <summary>{key}</summary>
            <pre tabIndex={0}>{formatToolValue(field)}</pre>
          </details>
        ))
      )}
    </section>
  );
}

export function ToolActivity({
  events,
}: {
  events: AgentRuntimeEvent[];
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const panelId = useId();
  const tools = deriveToolActivity(events);
  if (tools.length === 0) return null;
  const failed = tools.filter((tool) => tool.status === 'failed').length;
  const cancelled = tools.filter((tool) => tool.status === 'cancelled').length;
  const running = tools.find((tool) => tool.status === 'running' || tool.status === 'pending');
  const selected = tools.find((tool) => tool.id === selectedId);
  const status = running ? 'running' : failed ? 'failed' : cancelled ? 'cancelled' : 'completed';
  return (
    <div className={`tool-activity ${status}`}>
      <button
        type="button"
        className="tool-activity-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
      >
        {running ? (
          <span className="status-dot running" />
        ) : failed || cancelled ? (
          <AlertIcon size={14} />
        ) : (
          <CheckIcon size={14} />
        )}
        <span>
          {running ? `正在${toolStageLabel(running.name)}` : '工作过程'} · {tools.length} 步
        </span>
        {failed > 0 && <span className="tool-failure-count">{failed} 次失败</span>}
        {cancelled > 0 && <span>{cancelled} 步已停止</span>}
        <ChevronRightIcon size={13} />
      </button>
      {expanded && (
        <div id={panelId} className="tool-activity-body">
          <div className="tool-pills" aria-label="工具调用">
            {tools.map((tool, index) => (
              <button
                key={tool.id}
                type="button"
                className={`tool-pill ${tool.status}`}
                aria-expanded={selectedId === tool.id}
                aria-label={`${index + 1} ${toolStageLabel(tool.name)} ${toolTarget(tool)} ${statusLabel[tool.status]}`}
                aria-controls={`${panelId}-detail`}
                title={`${toolStageLabel(tool.name)} ${toolTarget(tool)}`}
                onClick={() => setSelectedId(selectedId === tool.id ? undefined : tool.id)}
              >
                <span className="tool-pill-number">{index + 1}</span>
                <span className="tool-pill-label">
                  {toolStageLabel(tool.name)}
                  {toolTarget(tool) ? ` · ${toolTarget(tool)}` : ''}
                </span>
                <span className="tool-pill-status">{statusLabel[tool.status]}</span>
              </button>
            ))}
          </div>
          {selected && (
            <section id={`${panelId}-detail`} className="tool-call-detail" aria-label="调用详情">
              <div className="tool-detail-heading">
                <strong>{toolStageLabel(selected.name)}</strong>
                <span>{statusLabel[selected.status]}</span>
              </div>
              <p className="tool-detail-name">{selected.name}</p>
              {selected.progress && selected.status === 'running' && <p>{selected.progress}</p>}
              {selected.error && (
                <p className="tool-detail-error" role="alert">
                  {selected.error}
                </p>
              )}
              <Payload title="输入参数" value={selected.input} />
              {selected.status === 'completed' && (
                <Payload title="执行结果" value={selected.output} />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
