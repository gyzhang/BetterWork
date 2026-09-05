import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { toolStageLabel } from './lib/labels';

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ActivityGroup {
  id: 'understand' | 'tools' | 'compose' | 'finish';
  title: string;
  description: string;
  status: ActivityStatus;
  updatedAt: number;
}

type ToolStartedEvent = Extract<AgentRuntimeEvent, { type: 'tool.requested' | 'tool.started' }>;
type ToolCompletedEvent = Extract<AgentRuntimeEvent, { type: 'tool.completed' }>;
type ToolFailedEvent = Extract<AgentRuntimeEvent, { type: 'tool.failed' }>;

const mostRecent = <T>(items: readonly T[]): T | undefined => items.at(-1);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 检索类工具的输出带 results 数组，据此给出「已查阅 N 条来源」这种具体摘要。 */
const countSources = (event: ToolCompletedEvent): number | undefined => {
  if (!isRecord(event.output) || !Array.isArray(event.output.results)) return undefined;
  return event.output.results.length;
};

/**
 * 把原始事件流聚合为用户能理解的工作阶段。
 *
 * 这是展示层派生而不是持久化的 Step：刷新后由已落库的 run_events 重新算出，
 * 因此这里不持有状态，也不得有副作用。
 */
export function deriveActivityGroups(events: AgentRuntimeEvent[]): ActivityGroup[] {
  const latest = mostRecent(events);
  if (!latest) return [];

  const toolEvents = events.filter((event) => event.type.startsWith('tool.'));
  const messageEvents = events.filter((event) => event.type.startsWith('message.'));
  const reasoningEvents = events.filter((event) => event.type === 'reasoning.delta');
  const terminal =
    latest.type === 'run.completed' ||
    latest.type === 'run.failed' ||
    latest.type === 'run.cancelled';
  const terminalStatus: ActivityStatus =
    latest.type === 'run.failed'
      ? 'failed'
      : latest.type === 'run.cancelled'
        ? 'cancelled'
        : 'completed';

  const groups: ActivityGroup[] = [
    {
      id: 'understand',
      title: '理解任务',
      description: reasoningEvents.length > 0 ? '已确定下一步工作方式' : '正在理解你的目标',
      status:
        reasoningEvents.length > 0 || toolEvents.length > 0 || messageEvents.length > 0
          ? 'completed'
          : 'running',
      updatedAt: latest.createdAt,
    },
  ];

  if (toolEvents.length > 0) {
    const started = toolEvents.filter(
      (event): event is ToolStartedEvent =>
        event.type === 'tool.requested' || event.type === 'tool.started',
    );
    const completed = toolEvents.filter(
      (event): event is ToolCompletedEvent => event.type === 'tool.completed',
    );
    const failed = toolEvents.find(
      (event): event is ToolFailedEvent => event.type === 'tool.failed',
    );
    const lastCompleted = mostRecent(completed);
    const sources = lastCompleted ? countSources(lastCompleted) : undefined;

    groups.push({
      id: 'tools',
      title: toolStageLabel(mostRecent(started)?.toolCall.name),
      description: failed
        ? failed.error
        : completed.length === 0
          ? '正在执行工作步骤'
          : sources === undefined
            ? `已完成 ${completed.length} 个工作步骤`
            : `已查阅 ${sources} 条来源`,
      status: failed ? 'failed' : completed.length > 0 && terminal ? 'completed' : 'running',
      updatedAt: mostRecent(toolEvents)?.createdAt ?? latest.createdAt,
    });
  }

  if (messageEvents.length > 0) {
    const complete = messageEvents.some((event) => event.type === 'message.completed');
    groups.push({
      id: 'compose',
      title: '整理结果',
      description: complete ? '已生成本次回复' : '正在整理并撰写结果',
      status: complete ? 'completed' : 'running',
      updatedAt: mostRecent(messageEvents)?.createdAt ?? latest.createdAt,
    });
  }

  if (terminal) {
    groups.push({
      id: 'finish',
      title:
        terminalStatus === 'completed'
          ? '任务完成'
          : terminalStatus === 'cancelled'
            ? '任务已停止'
            : '任务未完成',
      description:
        terminalStatus === 'completed'
          ? '本次工作已保存到最近任务'
          : terminalStatus === 'cancelled'
            ? '你可以随时重新开始这项工作'
            : latest.type === 'run.failed'
              ? latest.error
              : '',
      status: terminalStatus,
      updatedAt: latest.createdAt,
    });
  }

  return groups;
}
