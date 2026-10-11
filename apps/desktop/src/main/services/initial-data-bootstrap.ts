import { mkdirSync } from 'node:fs';

import type { WorkspaceRepository } from '../persistence/workspace-repository';

interface InitialDataBootstrapOptions {
  readonly workspaces: Pick<WorkspaceRepository, 'getOrCreate' | 'listAll'>;
  readonly defaultWorkspaceRoot: string;
  readonly legacyWorkspaceRoot: string;
}

/**
 * Schema migration 后幂等写入最小初始数据。已有工作空间时保留历史默认路径；
 * 新库才创建 ~/BetterWork 与「默认工作空间」。
 */
export function initializeInitialData({
  workspaces,
  defaultWorkspaceRoot,
  legacyWorkspaceRoot,
}: InitialDataBootstrapOptions): string {
  const existingWorkspaces = workspaces.listAll();
  if (existingWorkspaces.some((workspace) => workspace.rootPath === defaultWorkspaceRoot)) {
    return defaultWorkspaceRoot;
  }
  if (existingWorkspaces.length > 0) return legacyWorkspaceRoot;

  mkdirSync(defaultWorkspaceRoot, { recursive: true });
  workspaces.getOrCreate(defaultWorkspaceRoot, '默认工作空间');
  return defaultWorkspaceRoot;
}
