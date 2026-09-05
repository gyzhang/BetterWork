import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeVault } from './knowledge-vault';
import { RunJournal } from './run-journal';
import { RunService, createRunTools } from './run-service';
import type { BrowserWindow } from 'electron';

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

  it('cancels a running run, records the terminal event, and broadcasts every event to the window', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-run-'));
    temporaryDirectories.push(directory);
    const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
    const journal = new RunJournal(':memory:');
    const sent: Array<{ type: string }> = [];
    const windowStub = { isDestroyed: () => false, webContents: { send: (_channel: string, event: { type: string }) => { sent.push(event); } } };
    const service = new RunService(journal, vault, () => windowStub as unknown as BrowserWindow);
    const runId = service.start({ taskId: 'task-cancel', sessionId: 'session-cancel', prompt: '随便聊聊', workspacePath: directory });
    expect(service.cancel(runId)).toBe(true);
    await waitForCompletion(journal, runId);

    const events = journal.listEvents(runId).map((event) => event.type);
    expect(events[0]).toBe('run.started');
    expect(events.at(-1)).toBe('run.cancelled');
    expect(sent.map((event) => event.type)).toEqual(events);

    for (let attempt = 0; attempt < 40 && service.cancel(runId); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(service.cancel(runId)).toBe(false);
    vault.close();
    journal.close();
  });

  it('registers the web search tool only when a search engine is configured', () => {
    const knowledgeSearch = () => [];
    expect(createRunTools({ knowledgeSearch }).map((tool) => tool.name)).toEqual(['calculator', 'read_text_file', 'knowledge_search']);
    expect(createRunTools({ knowledgeSearch, webSearch: async () => ({ results: [] }) }).map((tool) => tool.name)).toEqual(['calculator', 'read_text_file', 'knowledge_search', 'web_search']);
  });
});
