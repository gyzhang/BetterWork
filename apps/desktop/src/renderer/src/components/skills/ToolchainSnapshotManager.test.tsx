// @vitest-environment jsdom

import type { ManagedDependencySnapshot } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolchainSnapshotManager } from './ToolchainSnapshotManager';

const snapshotOf = (
  overrides: Partial<ManagedDependencySnapshot> = {},
): ManagedDependencySnapshot => ({
  id: 'snapshot-1',
  origin: '/Users/fixture/ppt-master',
  originCommit: '82dd5cccec652cbcff342cbdabce85a1ae7af1e5',
  originState: 'dirty',
  manifestHash: 'a'.repeat(64),
  pathKey: `dependency-assets/${'a'.repeat(64)}`,
  fileCount: 13_061,
  totalBytes: 116_355_331,
  exclusions: [],
  createdAt: 1_760_000_000_000,
  usage: [
    {
      skillId: 'ppt-skill',
      skillName: 'PPT 生成 Skill',
      activeAuthorizationCount: 1,
      revokedAuthorizationCount: 0,
      runCount: 2,
    },
  ],
  canDelete: false,
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ToolchainSnapshotManager', () => {
  it('按 Skill 展示授权与历史 Run，并禁用仍在使用的快照删除', () => {
    const onOpenSkill = vi.fn();
    const onClose = vi.fn();
    render(
      <main>
        <button type="button">打开管理</button>
        <ToolchainSnapshotManager
          snapshots={[snapshotOf()]}
          onDelete={vi.fn()}
          onOpenSkill={onOpenSkill}
          onClose={onClose}
        />
      </main>,
    );

    expect(screen.getByText('PPT 生成 Skill')).toBeTruthy();
    expect(screen.getByText(/当前授权 1 · 已撤销 0 · 历史 Run 2/)).toBeTruthy();
    expect(screen.getByText(/正在使用，暂不能删除/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除快照' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '打开 Skill' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenSkill).toHaveBeenCalledWith('ppt-skill');
  });

  it('删除前展示源目录和影响范围，并在清理未完成时提示', async () => {
    const onDelete = vi.fn(async () => ({
      status: 'deleted' as const,
      cleanupPending: true,
      clearedRevokedAuthorizationReferences: 1,
    }));
    render(
      <main>
        <button type="button">打开管理</button>
        <ToolchainSnapshotManager
          snapshots={[
            snapshotOf({
              usage: [
                {
                  skillId: 'ppt-skill',
                  skillName: 'PPT 生成 Skill',
                  activeAuthorizationCount: 0,
                  revokedAuthorizationCount: 1,
                  runCount: 0,
                },
              ],
              canDelete: true,
            }),
          ]}
          onDelete={onDelete}
          onClose={vi.fn()}
        />
      </main>,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除快照' }));
    expect(screen.getByText(/源目录 \/Users\/fixture\/ppt-master 不会被修改/)).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: '删除快照',
      }),
    );

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('snapshot-1'));
    expect(await screen.findByText('快照登记记录已删除，但受管文件未能完全清理。')).toBeTruthy();
  });
});
