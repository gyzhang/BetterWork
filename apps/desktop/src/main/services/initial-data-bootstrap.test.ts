import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { initializeInitialData } from './initial-data-bootstrap';

const temporaryDirectories: string[] = [];
const stores: AppStore[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-initial-data-'));
  temporaryDirectories.push(directory);
  return directory;
};

const openStore = (directory: string): AppStore => {
  const store = AppStore.open(path.join(directory, 'betterwork.db'));
  stores.push(store);
  return store;
};

const closeStore = (store: AppStore): void => {
  store.close();
  const index = stores.indexOf(store);
  if (index >= 0) stores.splice(index, 1);
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('initializeInitialData', () => {
  it('creates the named default workspace on first startup and reuses it after restart', () => {
    const directory = createTemporaryDirectory();
    const defaultWorkspaceRoot = path.join(directory, 'home', 'BetterWork');
    const legacyWorkspaceRoot = path.join(directory, 'Documents');
    const firstStore = openStore(directory);

    expect(
      initializeInitialData({
        workspaces: firstStore.workspaces,
        defaultWorkspaceRoot,
        legacyWorkspaceRoot,
      }),
    ).toBe(defaultWorkspaceRoot);
    expect(existsSync(defaultWorkspaceRoot)).toBe(true);

    const created = firstStore.workspaces.listAll();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: '默认工作空间',
      rootPath: defaultWorkspaceRoot,
      iconId: 'folder',
      accentId: 'moss',
    });
    const workspaceId = created[0]?.id;
    expect(workspaceId).toBeTypeOf('string');
    if (!workspaceId) throw new Error('Initial workspace was not created');

    firstStore.workspaces.updateIdentity(workspaceId, { name: '用户改过的名称' });
    closeStore(firstStore);

    const reopenedStore = openStore(directory);
    expect(
      initializeInitialData({
        workspaces: reopenedStore.workspaces,
        defaultWorkspaceRoot,
        legacyWorkspaceRoot,
      }),
    ).toBe(defaultWorkspaceRoot);
    expect(reopenedStore.workspaces.listAll()).toMatchObject([
      { id: workspaceId, name: '用户改过的名称', rootPath: defaultWorkspaceRoot },
    ]);
  });

  it('keeps the prior default location when the database already has workspaces', () => {
    const directory = createTemporaryDirectory();
    const defaultWorkspaceRoot = path.join(directory, 'home', 'BetterWork');
    const legacyWorkspaceRoot = path.join(directory, 'Documents');
    const existingWorkspaceRoot = path.join(directory, 'existing-project');
    mkdirSync(existingWorkspaceRoot, { recursive: true });
    const store = openStore(directory);
    const existing = store.workspaces.create(existingWorkspaceRoot, '已有项目', 'project', 'teal');

    expect(
      initializeInitialData({
        workspaces: store.workspaces,
        defaultWorkspaceRoot,
        legacyWorkspaceRoot,
      }),
    ).toBe(legacyWorkspaceRoot);
    expect(existsSync(defaultWorkspaceRoot)).toBe(false);
    expect(store.workspaces.listAll()).toEqual([existing]);
  });
});
