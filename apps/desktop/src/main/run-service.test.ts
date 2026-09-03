import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeVault } from './knowledge-vault';
import { RunJournal } from './run-journal';
import { RunService } from './run-service';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

const waitForCompletion = async (journal: RunJournal, runId: string): Promise<void> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (journal.listRuns().find((run) => run.id === runId)?.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Run did not complete in time');
};

describe('RunService', () => {
  it('records local knowledge search results as task evidence', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-run-'));
    temporaryDirectories.push(directory);
    const note = path.join(directory, '客户资料.md');
    await writeFile(note, '客户续约风险需要在季度复盘中重点跟进。');
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    await vault.importPaths([note]);
    const journal = new RunJournal(':memory:');
    const service = new RunService(journal, vault, () => null);
    const runId = service.start({ taskId: 'task-1', sessionId: 'session-1', prompt: '搜索知识: 续约风险', workspacePath: directory });
    await waitForCompletion(journal, runId);
    expect(journal.listEvidence('task-1')).toEqual([expect.objectContaining({ runId, title: '客户资料', locator: '全文', sourceUri: note })]);
    vault.close();
    journal.close();
  });
});
