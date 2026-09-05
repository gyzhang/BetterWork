import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

/** 原始事件载荷，只在过程详情里展开，不得进入主界面（docs/10 §11.1）。 */
export const rawEventPayload = (event: AgentRuntimeEvent): string => {
  if (event.type === 'message.delta' || event.type === 'reasoning.delta') return event.delta;
  if (event.type === 'tool.requested' || event.type === 'tool.started') return event.toolCall.name;
  if (event.type === 'tool.progress') return event.message;
  if (event.type === 'tool.completed') return JSON.stringify(event.output);
  if (event.type === 'tool.failed' || event.type === 'run.failed') return event.error;
  return '';
};

export const formatTime = (value: number): string =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fileNameOf = (value: string): string =>
  value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);
