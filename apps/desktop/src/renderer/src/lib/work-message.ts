import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

import { type AssistantAnswerSource, finalAssistantAnswer } from './memory-capture';
import { extractAssistantText, finalRunContent } from './run-events';

export interface WorkRunProjection {
  content: string;
  finalContent: string | undefined;
  answer: AssistantAnswerSource | undefined;
  completed: boolean;
  terminal: boolean;
  cancelled: boolean;
  failure: string | undefined;
}

export function projectWorkRun(events: AgentRuntimeEvent[]): WorkRunProjection {
  const completed = events.some((event) => event.type === 'run.completed');
  const finalContent = completed ? finalRunContent(events) : undefined;
  const failure = events.find((event) => event.type === 'run.failed');
  const cancelled = events.some((event) => event.type === 'run.cancelled');
  return {
    content: finalContent ?? extractAssistantText(events),
    finalContent,
    answer: completed ? finalAssistantAnswer(events) : undefined,
    completed,
    terminal: completed || cancelled || failure !== undefined,
    cancelled,
    failure: failure?.type === 'run.failed' ? (failure.error ?? '') : undefined,
  };
}
