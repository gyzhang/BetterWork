import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

export interface ToolActivityItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  error?: string;
  progress?: string;
}

/** 按稳定 toolCallId 合并生命周期，终态覆盖未完成步骤，不渲染私有推理。 */
export function deriveToolActivity(events: AgentRuntimeEvent[]): ToolActivityItem[] {
  const items = new Map<string, ToolActivityItem>();
  for (const event of events) {
    if (event.type === 'tool.requested' || event.type === 'tool.started') {
      const previous = items.get(event.toolCall.id);
      items.set(event.toolCall.id, {
        ...previous,
        ...event.toolCall,
        status: event.type === 'tool.started' ? 'running' : (previous?.status ?? 'pending'),
      });
    } else if (
      event.type === 'tool.completed' ||
      event.type === 'tool.failed' ||
      event.type === 'tool.progress'
    ) {
      const item = items.get(event.toolCallId) ?? {
        id: event.toolCallId,
        name: '',
        input: {},
        status: 'pending',
      };
      if (event.type === 'tool.completed') {
        items.set(item.id, { ...item, status: 'completed', output: event.output });
      } else if (event.type === 'tool.failed') {
        items.set(item.id, { ...item, status: 'failed', error: event.error });
      } else {
        items.set(item.id, { ...item, progress: event.message });
      }
    } else if (
      event.type === 'run.cancelled' ||
      event.type === 'run.failed' ||
      event.type === 'run.completed'
    ) {
      for (const [id, item] of items) {
        if (item.status !== 'pending' && item.status !== 'running') continue;
        items.set(id, {
          ...item,
          status: event.type === 'run.cancelled' ? 'cancelled' : 'failed',
          ...(event.type === 'run.failed' ? { error: event.error } : {}),
        });
      }
    }
  }
  return [...items.values()];
}

export function toolTarget(item: ToolActivityItem): string {
  const target =
    item.input.commandId ?? item.input.path ?? item.input.relativePath ?? item.input.query;
  return typeof target === 'string' ? target : '';
}

export function formatToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '无';
}
