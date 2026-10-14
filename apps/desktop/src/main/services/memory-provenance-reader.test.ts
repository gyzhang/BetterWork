import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { seedReplayRun } from './fixtures/history-memory-fixtures';
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

describe('persisted provenance identity and missing audit boundaries', () => {
  const tracedRun = (
    store: AppStore,
    options: { omitContext?: boolean; omitSnapshot?: boolean } = {},
  ) => {
    const run = store.runs.get('run')!;
    const workspaceId = store.tasks.getWorkspaceId(run.taskId)!;
    const runId = seedReplayRun(store, {
      taskId: run.taskId,
      sessionId: run.sessionId,
      workspaceId,
      index: 1,
      ...options,
    });
    return { runId, taskId: run.taskId, workspaceId };
  };

  it.each([
    'runPrompt',
    'runWorkspace',
    'runDependencies',
    'checkpointDependencies',
    'artifactVersion',
    'artifactVersionDependencies',
    'memoryRevision',
  ] as const)('refuses to invent %s for an unknown identity', (action) => {
    const { reader } = setup();
    expect(reader[action]('missing')).toBeUndefined();
  });

  it.each([
    { omitContext: true },
    { omitSnapshot: true },
    { omitContext: true, omitSnapshot: true },
  ])('requires both persisted preparation and memory audit facts (%j)', (options) => {
    const { store, reader } = setup();
    const h = tracedRun(store, options);
    expect(reader.runDependencies(h.runId)).toBeUndefined();
    expect(reader.runWorkspace(h.runId)).toBe(h.workspaceId);
    expect(reader.runPrompt(h.runId)).toBe('prompt 1');
  });

  it('accepts a proven empty dependency set while refusing unaudited absence', () => {
    const { store, reader } = setup();
    const h = tracedRun(store);
    expect(reader.runDependencies(h.runId)).toEqual({
      workspaceId: h.workspaceId,
      materials: [],
      memories: [],
    });
    expect(reader.runDependencies('run')).toBeUndefined();
  });

  it('reads checkpoint fields from registered rows and refuses an unaudited summary', () => {
    const { store, reader } = setup();
    const run = store.runs.get('run')!;
    store.discussionCheckpoints.create(run.taskId, {
      id: 'checkpoint',
      taskId: run.taskId,
      stage: 'report',
      title: 'Review',
      summary: 'Persisted summary',
      feedback: 'Persisted feedback',
      artifactVersionIds: [],
    });
    expect(reader.checkpointField('checkpoint', 'summary')).toBe('Persisted summary');
    expect(reader.checkpointField('checkpoint', 'feedback')).toBe('Persisted feedback');
    expect(reader.checkpointField('missing', 'summary')).toBeUndefined();
    expect(reader.checkpointDependencies('checkpoint')).toBeUndefined();
  });

  it('joins a checkpoint to the exact audited Run instead of the latest Task Run', () => {
    const { store, reader } = setup();
    const h = tracedRun(store);
    store.discussionCheckpoints.create(h.taskId, {
      id: 'checkpoint',
      taskId: h.taskId,
      runId: h.runId,
      stage: 'report',
      title: 'Review',
      summary: 'Summary',
      artifactVersionIds: [],
    });
    expect(reader.checkpointDependencies('checkpoint')).toEqual({
      workspaceId: h.workspaceId,
      materials: [],
      memories: [],
    });
    const other = tracedRun(store, { omitContext: true });
    expect(reader.checkpointDependencies('checkpoint')).toEqual({
      workspaceId: h.workspaceId,
      materials: [],
      memories: [],
    });
    expect(reader.runDependencies(other.runId)).toBeUndefined();
  });

  it('keeps artifact text and hash pinned to the selected version across later edits', () => {
    const { store, reader } = setup();
    const h = tracedRun(store);
    const first = store.artifacts.saveMarkdown({
      taskId: h.taskId,
      runId: h.runId,
      origin: 'assistant-run',
      title: 'Report',
      content: 'First content',
    });
    const second = store.artifacts.saveMarkdown({
      taskId: h.taskId,
      artifactId: first.id,
      origin: 'user-edit',
      title: 'Report',
      content: 'Second content',
    });
    const original = reader.artifactVersion(first.currentVersionId);
    expect(original?.readableText).toBe('First content');
    expect(reader.artifactVersion(second.currentVersionId)?.readableText).toBe('Second content');
    expect(reader.artifactVersion(second.currentVersionId)?.contentHash).not.toBe(
      original?.contentHash,
    );
    expect(reader.artifactVersionDependencies(second.currentVersionId)).toEqual({
      workspaceId: h.workspaceId,
      materials: [],
      memories: [],
    });
  });

  it('refuses a user-only artifact chain and an assistant version without preparation audit', () => {
    const { store, reader } = setup();
    const h = tracedRun(store, { omitContext: true });
    const manual = store.artifacts.saveMarkdown({
      taskId: h.taskId,
      origin: 'user-edit',
      title: 'Manual',
      content: 'Manual content',
    });
    const assistant = store.artifacts.saveMarkdown({
      taskId: h.taskId,
      runId: h.runId,
      origin: 'assistant-run',
      title: 'Assistant',
      content: 'Assistant content',
    });
    expect(reader.artifactVersionDependencies(manual.currentVersionId)).toBeUndefined();
    expect(reader.artifactVersionDependencies(assistant.currentVersionId)).toBeUndefined();
    store.discussionCheckpoints.create(h.taskId, {
      id: 'checkpoint',
      taskId: h.taskId,
      runId: h.runId,
      stage: 'report',
      title: 'Review',
      summary: 'Summary',
      artifactVersionIds: [assistant.currentVersionId],
    });
    expect(reader.checkpointDependencies('checkpoint')).toBeUndefined();
  });
});
