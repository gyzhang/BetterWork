import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';

import { type AssistantAnswerSource, finalAssistantAnswer } from './memory-capture';
import { extractAssistantText, finalRunContent } from './run-events';

export interface WorkRunProjection {
  content: string;
  finalContent: string | undefined;
  narrations: AssistantNarration[];
  answer: AssistantAnswerSource | undefined;
  completed: boolean;
  terminal: boolean;
  cancelled: boolean;
  failure: string | undefined;
}

export interface AssistantNarration {
  messageId: string;
  content: string;
  streaming: boolean;
}

interface ProjectedNarration extends AssistantNarration {
  completedEventId: string | undefined;
}

function projectNarrations(
  events: AgentRuntimeEvent[],
  finalAnswerEventId: string | undefined,
): AssistantNarration[] {
  const messages = new Map<string, ProjectedNarration>();
  // 工作页事件由 mergeRunEvents 按 sequence 排序，避免每个流式增量都重新全量排序。
  for (const event of events) {
    if (event.type === 'message.started') {
      if (!messages.has(event.messageId)) {
        messages.set(event.messageId, {
          messageId: event.messageId,
          content: '',
          streaming: true,
          completedEventId: undefined,
        });
      }
    } else if (event.type === 'message.delta') {
      const current = messages.get(event.messageId);
      messages.set(event.messageId, {
        messageId: event.messageId,
        content: `${current?.content ?? ''}${event.delta}`,
        streaming: true,
        completedEventId: current?.completedEventId,
      });
    } else if (event.type === 'message.completed') {
      messages.set(event.messageId, {
        messageId: event.messageId,
        content: event.content,
        streaming: false,
        completedEventId: event.id,
      });
    }
  }
  return [...messages.values()]
    .filter(
      (message) =>
        message.content.trim().length > 0 &&
        (finalAnswerEventId === undefined || message.completedEventId !== finalAnswerEventId),
    )
    .map(({ messageId, content, streaming }) => ({
      messageId,
      content,
      streaming,
    }));
}

export function projectWorkRun(events: AgentRuntimeEvent[]): WorkRunProjection {
  const completed = events.some((event) => event.type === 'run.completed');
  const finalContent = completed ? finalRunContent(events) : undefined;
  const failure = events.find((event) => event.type === 'run.failed');
  const cancelled = events.some((event) => event.type === 'run.cancelled');
  const terminal = completed || cancelled || failure !== undefined;
  const answer = completed ? finalAssistantAnswer(events) : undefined;
  return {
    content: finalContent ?? extractAssistantText(events),
    finalContent,
    narrations: projectNarrations(events, answer?.eventId),
    answer,
    completed,
    terminal,
    cancelled,
    failure: failure?.type === 'run.failed' ? (failure.error ?? '') : undefined,
  };
}
