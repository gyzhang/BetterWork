import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

export const eventDetail = (event: AgentRuntimeEvent): string => {
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
