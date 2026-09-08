import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

/** 返回一次已完成 Run 的最终回复；中间轮次文本只用于过程展示，不能保存为成果。 */
export const finalRunContent = (events: AgentRuntimeEvent[]): string | undefined => {
  const completed = [...events]
    .reverse()
    .find(
      (event): event is Extract<AgentRuntimeEvent, { type: 'run.completed' }> =>
        event.type === 'run.completed',
    );
  return completed?.finalContent.trim() || undefined;
};

/**
 * 把 IPC 事件快照与加载期间收到的增量合并。
 * 同一事件以 id 去重，再依 sequence 保证事件日志的原始顺序。
 */
export const mergeRunEvents = (
  snapshot: AgentRuntimeEvent[],
  incremental: AgentRuntimeEvent[],
): AgentRuntimeEvent[] => {
  const byId = new Map<string, AgentRuntimeEvent>();
  for (const event of snapshot) byId.set(event.id, event);
  for (const event of incremental) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
};

/** 从事件列表中提取助手回复文本（拼接所有 message.delta）。 */
export const extractAssistantText = (events: AgentRuntimeEvent[]): string =>
  events
    .filter(
      (event): event is Extract<AgentRuntimeEvent, { type: 'message.delta' }> =>
        event.type === 'message.delta',
    )
    .map((event) => event.delta)
    .join('')
    .trim();

/** 从事件列表中提取已完成的工具调用卡片。 */
export const extractCompletedTools = (
  events: AgentRuntimeEvent[],
): Array<Extract<AgentRuntimeEvent, { type: 'tool.completed' | 'tool.failed' }>> =>
  events.filter(
    (event): event is Extract<AgentRuntimeEvent, { type: 'tool.completed' | 'tool.failed' }> =>
      event.type === 'tool.completed' || event.type === 'tool.failed',
  );
