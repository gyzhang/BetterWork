import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { createStoreProvenanceReader } from './memory-provenance-reader';

const stores: AppStore[] = [];
const setup = () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.getOrCreate('/tmp/assistant-source-read-model', 'source');
  const task = store.tasks.create(workspace.id, 'source', 'source');
  store.runs.create({
    id: 'run',
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: 'source',
    status: 'completed',
    createdAt: 0,
    completedAt: 20,
  });
  const answer: AgentRuntimeEvent = {
    id: 'answer',
    runId: 'run',
    sequence: 10,
    createdAt: 10,
    type: 'message.completed',
    messageId: 'message',
    content: 'answer body',
  };
  store.runs.appendEvent(answer);
  return { store, reader: createStoreProvenanceReader(store) };
};
const afterAnswerTools: AgentRuntimeEvent[] = [
  {
    id: 'tool',
    runId: 'run',
    sequence: 11,
    createdAt: 11,
    type: 'tool.requested',
    toolCall: { id: 'call', name: 'calculator', input: {} },
  },
  {
    id: 'tool',
    runId: 'run',
    sequence: 11,
    createdAt: 11,
    type: 'tool.started',
    toolCall: { id: 'call', name: 'calculator', input: {} },
  },
  {
    id: 'tool',
    runId: 'run',
    sequence: 11,
    createdAt: 11,
    type: 'tool.progress',
    toolCallId: 'call',
    message: 'progress',
  },
  {
    id: 'tool',
    runId: 'run',
    sequence: 11,
    createdAt: 11,
    type: 'tool.completed',
    toolCallId: 'call',
    output: 'output',
  },
  {
    id: 'tool',
    runId: 'run',
    sequence: 11,
    createdAt: 11,
    type: 'tool.failed',
    toolCallId: 'call',
    error: 'failure',
  },
];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

describe('StoreProvenanceReader assistant source evidence', () => {
  it.each(afterAnswerTools)('rejects later $type even beyond irrelevant event traffic', (tool) => {
    const { store, reader } = setup();
    store.runs.appendEvent(tool);
    store.runs.appendEvent({
      id: 'later-delta',
      runId: 'run',
      sequence: 13,
      createdAt: 13,
      type: 'message.delta',
      messageId: 'message',
      delta: 'irrelevant',
    });
    store.runs.appendEvent({
      id: 'terminal',
      runId: 'run',
      sequence: 12,
      createdAt: 12,
      type: 'run.completed',
      finalContent: 'answer body',
    });
    const full = vi.spyOn(store.runs, 'listEvents').mockImplementation(() => {
      throw new Error('full journal');
    });
    expect(reader.runAssistantAnswer('run', 'answer')).toBeUndefined();
    expect(full).not.toHaveBeenCalled();
  });

  it('preserves missing-terminal compatibility and ignores tools before the answer', () => {
    const { store, reader } = setup();
    store.runs.appendEvent({
      ...afterAnswerTools[3]!,
      id: 'early-tool',
      sequence: 1,
      createdAt: 1,
    });
    const full = vi.spyOn(store.runs, 'listEvents').mockImplementation(() => {
      throw new Error('full journal');
    });
    expect(reader.runAssistantAnswer('run', 'answer')).toBe('answer body');
    expect(reader.runAssistantAnswer('run', 'wrong-event')).toBeUndefined();
    expect(reader.runAssistantAnswer('wrong-run', 'answer')).toBeUndefined();
    expect(full).not.toHaveBeenCalled();
  });

  it('uses the first completion for content consistency even when a later terminal matches', () => {
    const { store, reader } = setup();
    store.runs.appendEvent({
      id: 'terminal-first',
      runId: 'run',
      sequence: 12,
      createdAt: 12,
      type: 'run.completed',
      finalContent: 'mismatched',
    });
    store.runs.appendEvent({
      id: 'terminal-last',
      runId: 'run',
      sequence: 13,
      createdAt: 13,
      type: 'run.completed',
      finalContent: 'answer body',
    });
    expect(reader.runAssistantAnswer('run', 'answer')).toBeUndefined();
  });

  it('accepts a consistent final answer and rejects an earlier completion', () => {
    const { store, reader } = setup();
    store.runs.appendEvent({
      id: 'earlier',
      runId: 'run',
      sequence: 0,
      createdAt: 0,
      type: 'message.completed',
      messageId: 'earlier',
      content: 'earlier',
    });
    store.runs.appendEvent({
      id: 'terminal',
      runId: 'run',
      sequence: 12,
      createdAt: 12,
      type: 'run.completed',
      finalContent: 'answer body',
    });
    expect(reader.runAssistantAnswer('run', 'answer')).toBe('answer body');
    expect(reader.runAssistantAnswer('run', 'earlier')).toBeUndefined();
    store.runs.appendEvent({
      id: 'empty',
      runId: 'run',
      sequence: 14,
      createdAt: 14,
      type: 'message.completed',
      messageId: 'empty',
      content: '',
    });
    expect(reader.runAssistantAnswer('run', 'answer')).toBeUndefined();
    expect(reader.runAssistantAnswer('run', 'empty')).toBeUndefined();
    expect(store.runs.getLatestNonEmptyMessageCompletion('run')?.id).toBe('answer');
  });
});
