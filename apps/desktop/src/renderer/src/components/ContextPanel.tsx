import type {
  AgentRuntimeEvent,
  ArtifactSummary,
  EvidenceSummary,
  RunSummary,
} from '@betterwork/agent-protocol';
import { useState } from 'react';

import type { ActivityGroup } from '../activity';
import { ArtifactIcon, ChevronRightIcon, GlobeIcon, KnowledgeIcon } from '../icons';
import { formatTime } from '../lib/format';
import { runStatusName, toolStageLabel } from '../lib/labels';
import { handleTitlebarDoubleClick } from '../lib/titlebar';
import { rawToolOutput } from '../lib/tool-summary';
import type { ContextTab } from '../lib/view-types';
import { EmptyContext } from './EmptyState';

export function ContextPanel({
  open,
  setOpen,
  tab,
  setTab,
  events,
  evidence,
  artifacts,
  activeRun,
  taskRuns,
  activityGroups,
  onSelectRun,
  onOpenSource,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: ContextTab;
  setTab: (tab: ContextTab) => void;
  events: AgentRuntimeEvent[];
  evidence: EvidenceSummary[];
  artifacts: ArtifactSummary[];
  activeRun?: RunSummary | undefined;
  taskRuns: RunSummary[];
  activityGroups: ActivityGroup[];
  onSelectRun: (run: RunSummary) => void;
  onOpenSource: (sourcePath: string) => Promise<void>;
}): React.JSX.Element | null {
  const [sourceMessage, setSourceMessage] = useState('');

  // 终态工具事件只带 toolCallId，工具名要从 requested/started 事件里取回
  const toolNameById = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'tool.requested' || event.type === 'tool.started') {
      toolNameById.set(event.toolCall.id, event.toolCall.name);
    }
  }
  const toolOutputs = events.filter(
    (event): event is Extract<AgentRuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed',
  );

  if (!open) return null;
  return (
    <aside className="context-panel">
      <div className="context-topline" onDoubleClick={handleTitlebarDoubleClick}>
        <span>当前任务</span>
        <button aria-label="收起上下文面板" onClick={() => setOpen(false)}>
          <ChevronRightIcon size={14} />
        </button>
      </div>
      <div className="context-tabs" role="tablist" aria-label="任务上下文">
        {(
          [
            ['process', '过程'],
            ['sources', '资料'],
            ['artifacts', '成果'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="context-content">
        {tab === 'process' &&
          (events.length === 0 ? (
            <EmptyContext
              title="等待任务开始"
              detail="开始后，这里会按工作阶段呈现过程，而不是堆叠底层日志。"
            />
          ) : (
            <div className="activity-list">
              <div className="activity-summary">
                <span
                  className={`status-dot ${activeRun?.status === 'running' ? 'running' : ''}`}
                />
                <div>
                  <strong>{activeRun ? runStatusName[activeRun.status] : '正在处理任务'}</strong>
                  <p>{activityGroups.length} 个工作阶段</p>
                </div>
              </div>
              {activityGroups.map((group) => (
                <ActivityGroupRow group={group} key={group.id} />
              ))}
              {toolOutputs.length > 0 && (
                <details className="raw-tool-output">
                  <summary>原始工具输出 · {toolOutputs.length} 次</summary>
                  {toolOutputs.map((event) => (
                    <article key={event.id}>
                      <strong>{toolStageLabel(toolNameById.get(event.toolCallId))}</strong>
                      <code>{rawToolOutput(event.output)}</code>
                    </article>
                  ))}
                </details>
              )}
              {taskRuns.length > 1 && (
                <details className="task-run-history">
                  <summary>执行记录 · {taskRuns.length} 次</summary>
                  {taskRuns.map((run) => (
                    <button
                      key={run.id}
                      className={run.id === activeRun?.id ? 'active' : ''}
                      onClick={() => onSelectRun(run)}
                    >
                      <span>{runStatusName[run.status]}</span>
                      <strong>{run.prompt}</strong>
                      <small>{formatTime(run.createdAt)}</small>
                    </button>
                  ))}
                </details>
              )}
            </div>
          ))}
        {tab === 'sources' &&
          (evidence.length === 0 ? (
            <EmptyContext title="尚无引用资料" detail="检索到的本地资料与网页来源会显示在这里。" />
          ) : (
            <div className="evidence-list">
              {sourceMessage && <p className="context-source-message">{sourceMessage}</p>}
              {evidence.map((item) =>
                item.sourceType === 'web-page' ? (
                  <article className="evidence-row" key={item.id}>
                    <span aria-hidden="true">
                      <GlobeIcon size={12} />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.locator} · 网页来源</small>
                      <p>{item.excerpt}</p>
                    </div>
                  </article>
                ) : (
                  <article className="evidence-row" key={item.id}>
                    <span aria-hidden="true">
                      <KnowledgeIcon size={12} />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.locator} · 本地资料</small>
                      <p>{item.excerpt}</p>
                    </div>
                    <button
                      className="evidence-open-button"
                      onClick={() =>
                        void onOpenSource(item.sourceUri)
                          .then(() => setSourceMessage(`已打开「${item.title}」原文。`))
                          .catch((reason: unknown) =>
                            setSourceMessage(
                              reason instanceof Error ? reason.message : '无法打开原始资料。',
                            ),
                          )
                      }
                    >
                      原文
                    </button>
                  </article>
                ),
              )}
            </div>
          ))}
        {tab === 'artifacts' &&
          (artifacts.length === 0 ? (
            <EmptyContext
              title="尚无工作成果"
              detail="将完成的回复保存为 Markdown 后，它会出现在这里。"
            />
          ) : (
            <div className="evidence-list">
              {artifacts.map((artifact) => (
                <article className="evidence-row" key={artifact.id}>
                  <span aria-hidden="true">
                    <ArtifactIcon size={12} />
                  </span>
                  <div>
                    <strong>{artifact.title}</strong>
                    <small>Markdown · v{artifact.versionNumber}</small>
                  </div>
                </article>
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}

export function ActivityGroupRow({ group }: { group: ActivityGroup }): React.JSX.Element {
  return (
    <div className={`activity-row ${group.status}`}>
      <span className="activity-marker" />
      <div>
        <strong>{group.title}</strong>
        <p>{group.description}</p>
        <small>{group.status === 'running' ? '进行中' : formatTime(group.updatedAt)}</small>
      </div>
    </div>
  );
}
