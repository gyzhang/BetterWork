import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ActivityGroup {
  id: 'understand' | 'tools' | 'compose' | 'finish';
  title: string;
  description: string;
  status: ActivityStatus;
  updatedAt: number;
}

const toolLabel = (name: string): string => {
  if (name === 'calculator') return '计算数据';
  if (name === 'read_text_file') return '阅读资料';
  return '调用工作工具';
};

const mostRecent = (events: AgentRuntimeEvent[]): AgentRuntimeEvent | undefined => events.at(-1);

export function deriveActivityGroups(events: AgentRuntimeEvent[]): ActivityGroup[] {
  if (events.length === 0) return [];
  const latest = mostRecent(events)!;
  const toolEvents = events.filter((event) => event.type.startsWith('tool.'));
  const messageEvents = events.filter((event) => event.type.startsWith('message.'));
  const reasoningEvents = events.filter((event) => event.type === 'reasoning.delta');
  const terminal = latest.type === 'run.completed' || latest.type === 'run.failed' || latest.type === 'run.cancelled';
  const terminalStatus: ActivityStatus = latest.type === 'run.failed' ? 'failed' : latest.type === 'run.cancelled' ? 'cancelled' : 'completed';
  const groups: ActivityGroup[] = [{
    id: 'understand', title: '理解任务', description: reasoningEvents.length > 0 ? '已确定下一步工作方式' : '正在理解你的目标',
    status: reasoningEvents.length > 0 || toolEvents.length > 0 || messageEvents.length > 0 ? 'completed' : 'running', updatedAt: latest.createdAt,
  }];

  if (toolEvents.length > 0) {
    const requested = toolEvents.filter((event) => event.type === 'tool.requested' || event.type === 'tool.started');
    const completed = toolEvents.filter((event) => event.type === 'tool.completed');
    const failed = toolEvents.find((event) => event.type === 'tool.failed');
    const toolName = requested.find((event): event is Extract<AgentRuntimeEvent, { type: 'tool.requested' | 'tool.started' }> => event.type === 'tool.requested' || event.type === 'tool.started')?.toolCall.name;
    groups.push({
      id: 'tools', title: toolName ? toolLabel(toolName) : '处理工作材料',
      description: failed ? failed.error : completed.length > 0 ? `已完成 ${completed.length} 个工作步骤` : '正在执行工作步骤',
      status: failed ? 'failed' : completed.length > 0 && terminal ? 'completed' : 'running', updatedAt: mostRecent(toolEvents)?.createdAt ?? latest.createdAt,
    });
  }

  if (messageEvents.length > 0) {
    const complete = messageEvents.some((event) => event.type === 'message.completed');
    groups.push({
      id: 'compose', title: '整理结果', description: complete ? '已生成本次回复' : '正在整理并撰写结果',
      status: complete ? 'completed' : 'running', updatedAt: mostRecent(messageEvents)?.createdAt ?? latest.createdAt,
    });
  }

  if (terminal) {
    groups.push({
      id: 'finish', title: terminalStatus === 'completed' ? '任务完成' : terminalStatus === 'cancelled' ? '任务已停止' : '任务未完成',
      description: terminalStatus === 'completed' ? '本次工作已保存到最近任务' : terminalStatus === 'cancelled' ? '你可以随时重新开始这项工作' : latest.type === 'run.failed' ? latest.error : '',
      status: terminalStatus, updatedAt: latest.createdAt,
    });
  }

  return groups;
}
