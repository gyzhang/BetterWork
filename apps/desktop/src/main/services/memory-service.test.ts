import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { MemoryService } from './memory-service';

describe('MemoryService', () => {
  const stores: AppStore[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('rebuilds a managed Markdown projection from SQLite records', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-memory-'));
    directories.push(directory);
    const store = AppStore.open(':memory:');
    stores.push(store);
    const service = new MemoryService(store, directory);
    await service.create({
      scope: { kind: 'user' },
      kind: 'preference',
      content: '交付物优先使用中文。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });

    const projection = await readFile(path.join(directory, 'memory', 'user', 'index.md'), 'utf8');
    expect(projection).toContain('BetterWork 记忆');
    expect(projection).toContain('交付物优先使用中文。');
    expect(projection).toContain('请通过算台管理记忆');
  });
});
