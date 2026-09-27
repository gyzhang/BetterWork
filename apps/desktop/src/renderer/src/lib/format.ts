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

/**
 * 相对时间：一分钟内「刚刚」，一小时内「N 分钟前」，一天内「N 小时前」，
 * 超过一天回到「M 月 D 日」。消息中心原本把这段留在业务文件里，
 * 而列表行的 meta 槽天然要用同一个口径，所以提到 lib（docs/12 §2）。
 * `now` 只为测试可判定而注入，生产调用不传。
 */
export const relativeTime = (timestamp: number, now: number = Date.now()): string => {
  const elapsed = now - timestamp;
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
};
