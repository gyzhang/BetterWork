import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { createStoreExtractionSourceReader } from './extraction-source-reader';

const T0 = 1_700_000_000_000;

describe('createStoreExtractionSourceReader', () => {
  const stores: AppStore[] = [];
  const directories: string[] = [];

  const setup = async (): Promise<AppStore> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-extraction-source-'));
    directories.push(directory);
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  /** Run 必须挂在真实链条上：session 由 tasks.create 一并建立，不能凭空造 id。 */
  const addRun = (
    store: AppStore,
    task: { task: { id: string }; sessionId: string },
    prompt: string,
    createdAt: number,
  ): string => {
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt,
      status: 'completed',
      createdAt,
    });
    return runId;
  };

  const snapshot = (store: AppStore, runId: string, taskId: string, workspaceId: string): void => {
    store.runContextSnapshots.create({
      runId,
      taskId,
      workspaceId,
      contextSegmentId: randomUUID(),
      materials: [],
      createdAt: T0,
    });
  };

  it('refuses a run without a preparation snapshot', async () => {
    const store = await setup();
    const workspace = store.workspaces.getOrCreate('/tmp/extraction-source', '来源空间');
    const task = store.tasks.create(workspace.id, '提炼来源', '验证来源真实性');
    const runId = addRun(store, task, '请按回款口径重算收入。', T0);

    expect(
      createStoreExtractionSourceReader(store).readSource({ kind: 'run', runId }),
    ).toBeUndefined();
  });

  it('reads prompt and inherited dependencies from registered entities', async () => {
    const store = await setup();
    const workspace = store.workspaces.getOrCreate('/tmp/extraction-source', '来源空间');
    const task = store.tasks.create(workspace.id, '提炼来源', '验证来源真实性');
    const runId = addRun(store, task, '请把这份长材料按业务线拆开，并给出下一季度的收入确认口径与风险清单，谢谢。', T0);
    snapshot(store, runId, task.task.id, workspace.id);

    const record = createStoreExtractionSourceReader(store).readSource({ kind: 'run', runId });
    expect(record?.kind).toBe('run');
    if (record?.kind !== 'run') return;
    expect(record.completed).toBe(true);
    expect(record.prompt).toContain('收入确认口径');
    expect(record.taskId).toBe(task.task.id);
    expect(record.workspaceId).toBe(workspace.id);
    expect(record.materialDependencies).toEqual([]);
    expect(record.memoryDependencies).toEqual([]);
    // 长且自足的追问不带背景回答。
    expect(record.backgroundAnswer).toBeUndefined();
  });

  it('attaches the previous final answer only when the prompt needs disambiguation', async () => {
    const store = await setup();
    const workspace = store.workspaces.getOrCreate('/tmp/extraction-source', '来源空间');
    const task = store.tasks.create(workspace.id, '提炼来源', '验证来源真实性');
    const previousRunId = addRun(store, task, '给出上季度收入口径。', T0);
    store.runs.appendEvent({
      id: randomUUID(),
      runId: previousRunId,
      sequence: 1,
      createdAt: T0 + 1,
      type: 'message.completed',
      messageId: randomUUID(),
      content: '上季度按回款金额确认收入。',
    });
    const currentRunId = addRun(store, task, '那今年呢？', T0 + 10);
    snapshot(store, currentRunId, task.task.id, workspace.id);

    const record = createStoreExtractionSourceReader(store).readSource({
      kind: 'run',
      runId: currentRunId,
    });
    if (record?.kind !== 'run') {
      expect(record?.kind).toBe('run');
      return;
    }
    expect(record.backgroundAnswer?.runId).toBe(previousRunId);
    expect(record.backgroundAnswer?.text).toBe('上季度按回款金额确认收入。');
  });

  it('reads a checkpoint as its own source with the task workspace', async () => {
    const store = await setup();
    const workspace = store.workspaces.getOrCreate('/tmp/extraction-source', '来源空间');
    const task = store.tasks.create(workspace.id, '提炼来源', '验证来源真实性');
    const runId = addRun(store, task, '总结这次讨论。', T0);
    snapshot(store, runId, task.task.id, workspace.id);
    const checkpoint = store.discussionCheckpoints.create(task.task.id, {
      id: randomUUID(),
      taskId: task.task.id,
      runId,
      stage: 'report',
      title: '收入口径讨论',
      summary: '按回款金额确认收入。',
      feedback: '以后先给结论。',
      artifactVersionIds: [],
    });

    const record = createStoreExtractionSourceReader(store).readSource({
      kind: 'checkpoint',
      checkpointId: checkpoint.id,
    });
    expect(record?.kind).toBe('checkpoint');
    if (record?.kind !== 'checkpoint') return;
    expect(record.feedback).toBe('以后先给结论。');
    expect(record.summary).toBe('按回款金额确认收入。');
    expect(record.workspaceId).toBe(workspace.id);
    expect(record.taskId).toBe(task.task.id);
  });
});
