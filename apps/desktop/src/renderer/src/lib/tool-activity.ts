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

export interface CompletedToolOutcome {
  status: 'failed' | 'cancelled';
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readText = (value: unknown): string => (typeof value === 'string' ? value : '');

const executionReasonLabels: Record<string, string> = {
  'spawn-failed': '启动命令失败',
  'execute-failed': '命令执行失败',
  'validate-failed': '输出校验失败',
  'publish-failed': '产物发布失败',
  'cleanup-failed': '清理执行环境失败',
  interrupted: '命令执行中断',
  'timed-out': '命令执行超时',
};

/** Skill 命令以结构化结果返回时，按实际执行状态覆盖外层 tool.completed。 */
export function completedToolOutcome(
  toolName: string | undefined,
  output: unknown,
): CompletedToolOutcome | undefined {
  if (toolName !== 'skill_execute' || !isRecord(output)) return undefined;

  if (output.status === 'failed') {
    const reason = readText(output.reason);
    return {
      status: 'failed',
      error: executionReasonLabels[reason] ?? '技能命令执行失败',
    };
  }
  if (output.status === 'timed-out') {
    return { status: 'failed', error: '技能命令执行超时' };
  }
  if (output.status === 'cancelled') return { status: 'cancelled' };
  return undefined;
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
        const outcome = completedToolOutcome(item.name, event.output);
        items.set(item.id, {
          ...item,
          status: outcome?.status ?? 'completed',
          output: event.output,
          ...(outcome?.error ? { error: outcome.error } : {}),
        });
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
