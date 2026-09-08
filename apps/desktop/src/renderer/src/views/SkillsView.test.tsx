// @vitest-environment jsdom

import type { SkillDetail, SkillSummary } from '@betterwork/agent-protocol';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSkills } from '../hooks/use-skills';
import { SkillsPage } from './SkillsView';

const summary: SkillSummary = {
  id: 'skill-1',
  name: '研究方法',
  description: '整理研究步骤',
  sourceKind: 'user',
  enabled: true,
  currentRevisionId: 'revision-1',
  trustStatus: 'untrusted',
  environmentStatus: 'unprepared',
  blockedReasons: ['untrusted', 'environment-unprepared'],
};
const detail: SkillDetail = {
  ...summary,
  revision: {
    id: 'revision-1',
    skillId: 'skill-1',
    contentHash: 'hash-1',
    resourceKey: 'user/skill-1/revisions/hash-1',
    frontmatter: {},
    createdAt: 1,
  },
};

function Harness(): React.JSX.Element {
  const state = useSkills();
  return <SkillsPage state={state} />;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('SkillsPage', () => {
  it('shows source, trust, enabled and environment independently', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { skills: { list: vi.fn(async () => [summary]), get: vi.fn(async () => detail) } },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() => expect(screen.getByText('未信任')).toBeTruthy());
    expect(screen.getAllByText('用户').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已启用').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未准备').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /试运行/ })).toHaveProperty('disabled', true);
  });

  it('does not let an older detail response replace the new selection', async () => {
    const second: SkillSummary = { ...summary, id: 'skill-2', name: '第二个 Skill' };
    let resolveFirst: ((value: SkillDetail) => void) | undefined;
    const firstRequest = new Promise<SkillDetail>((resolve) => {
      resolveFirst = resolve;
    });
    const get = vi.fn((input: { id: string }) =>
      input.id === 'skill-1'
        ? firstRequest
        : Promise.resolve({
            ...detail,
            ...second,
            revision: { ...detail.revision, skillId: 'skill-2' },
          }),
    );
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { skills: { list: vi.fn(async () => [summary, second]), get } },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('第二个 Skill')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    screen.getByRole('button', { name: /第二个 Skill/ }).click();
    await waitFor(() => expect(screen.getByRole('heading', { name: '第二个 Skill' })).toBeTruthy());
    resolveFirst?.(detail);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('heading', { name: '第二个 Skill' })).toBeTruthy();
  });

  it('keeps the trust intent checked while runtime setup still needs review', async () => {
    const trustedSummary: SkillSummary = {
      ...summary,
      trustStatus: 'needs-review',
      blockedReasons: ['trust-needs-review', 'environment-unprepared'],
    };
    const trustedDetail: SkillDetail = { ...detail, ...trustedSummary };
    const setTrust = vi.fn(async () => ({ skill: trustedSummary }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        skills: {
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => trustedDetail),
          setTrust,
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() => expect(screen.getByRole('checkbox')).toHaveProperty('checked', true));
  });

  it('routes short-lived success feedback through the shared toast', async () => {
    const disabledSummary: SkillSummary = { ...summary, enabled: false };
    const setEnabled = vi.fn(async () => ({ skill: disabledSummary }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        skills: {
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
          setEnabled,
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() => expect(screen.getByRole('heading', { name: '研究方法' })).toBeTruthy());

    screen.getByRole('button', { name: '停用 Skill' }).click();
    const toast = await screen.findByRole('status');
    expect(within(toast).getByText('Skill 已停用。')).toBeTruthy();
    expect(setEnabled).toHaveBeenCalledWith({ skillId: summary.id, enabled: false });
    expect(document.querySelector('.inline-message:not(.error)')).toBeNull();
  });

  it('requires explicit confirmation before deleting a user Skill', async () => {
    const deleteSkill = vi.fn(async () => ({ deleted: true }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        skills: {
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
          delete: deleteSkill,
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() => expect(screen.getByRole('heading', { name: '研究方法' })).toBeTruthy());

    screen.getByRole('button', { name: '删除 Skill' }).click();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('删除这个 Skill？')).toBeTruthy();
    expect(deleteSkill).not.toHaveBeenCalled();
    within(dialog).getByRole('button', { name: '取消' }).click();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleteSkill).not.toHaveBeenCalled();

    screen.getByRole('button', { name: '删除 Skill' }).click();
    const confirmedDialog = await screen.findByRole('alertdialog');
    within(confirmedDialog).getByRole('button', { name: '删除 Skill' }).click();
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith({ skillId: summary.id }));
  });
});
