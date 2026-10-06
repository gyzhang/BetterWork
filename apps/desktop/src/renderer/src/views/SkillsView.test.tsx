// @vitest-environment jsdom

import type { SkillDetail, SkillSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const state = useSkills({ onTestRunRequested: vi.fn() });
  return <SkillsPage state={state} />;
}

/** A12 之后技能页会同时加载依赖面板：视图测试只需一个安静的替身，不触发任何真实准备。 */
function dependencyStub() {
  return {
    listOptions: vi.fn(async () => ({
      distributions: [],
      lockIds: [],
      snapshots: [],
      environments: [],
    })),
    inspectPlan: vi.fn(async () => undefined),
    prepare: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    getOperation: vi.fn(async () => null),
    chooseInterpreter: vi.fn(async () => ({ cancelled: true })),
    registerToolchain: vi.fn(async () => ({ cancelled: true, snapshot: null, reused: false })),
  };
}

function grantStub(): (input: unknown) => Promise<Record<string, unknown>> {
  return vi.fn(async () => ({
    skill: summary,
    selectedSnapshotIds: [],
    grantActive: false,
    grantCreated: false,
    blockedReason: '尚未记录信任意愿',
  }));
}

const originalLocalStorage = window.localStorage;

/**
 * 卡片／列表偏好读自 `window.localStorage`，而 jsdom 这份 storage 在同一文件内是跨用例持久的：
 * 不逐用例换新，前一个用例点过「列表」就会漏进后一个用例的缺省视图。本机 jsdom 恰好取不到
 * `window.localStorage`（读失败兜底成卡片）才一直没暴露，依赖这个巧合等于把用例正确性交给环境。
 */
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe('SkillsPage', () => {
  it('shows source, trust, enabled and environment independently', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
        },
      },
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

  it('shows import-time runtime clues without exposing profile JSON or preparing an unknown Skill', async () => {
    const dependencies = dependencyStub();
    const importedDetail: SkillDetail = {
      ...detail,
      runtimeDiscovery: [
        {
          kind: 'package-install-hint',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现 Python 包安装提示 python-pptx',
        },
        {
          kind: 'python-runtime-hint',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现 Python 运行环境说明',
        },
        {
          kind: 'environment-variable',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现外部目录变量 PPTM_HOME',
        },
        {
          kind: 'toolchain-name',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现外部工具链引用 ppt-master',
        },
      ],
    };
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies,
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => importedDetail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();

    const findingsTrigger = await screen.findByText('导入时发现的线索(4)');
    const findingsDisclosure = findingsTrigger.closest('details');
    expect(findingsDisclosure?.hasAttribute('open')).toBe(false);
    expect(screen.getByText('发现 Python 包安装提示 python-pptx · SKILL.md:34')).toBeTruthy();
    fireEvent.click(findingsTrigger);
    expect(findingsDisclosure?.hasAttribute('open')).toBe(true);
    expect(screen.getByText('发现 Python 运行环境说明 · SKILL.md:34')).toBeTruthy();
    expect(screen.getByText('发现外部目录变量 PPTM_HOME · SKILL.md:34')).toBeTruthy();
    expect(screen.getByText('发现外部工具链引用 ppt-master · SKILL.md:34')).toBeTruthy();
    expect(screen.queryByLabelText('运行配置 JSON')).toBeNull();
    expect(screen.queryByRole('button', { name: '准备环境' })).toBeNull();
    expect(dependencies.listOptions).not.toHaveBeenCalled();
  });

  it('does not summarize discovered external dependencies as absent from an empty profile', async () => {
    const dependencies = dependencyStub();
    const configuredDetail: SkillDetail = {
      ...detail,
      environmentStatus: 'ready',
      blockedReasons: [],
      runtimeProfile: {
        id: 'profile-empty',
        skillId: 'skill-1',
        profileHash: 'profile-hash-empty',
        profile: {
          commands: [],
          environmentRequirements: [],
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
      runtimeDiscovery: [
        {
          kind: 'environment-variable',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现外部目录变量 PPTM_HOME',
        },
        {
          kind: 'toolchain-name',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现外部工具链引用 ppt-master',
        },
      ],
    };
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies,
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => configuredDetail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();

    expect(await screen.findByText('外部工具链：未配置（发现线索待确认）')).toBeTruthy();
    expect(screen.queryByText('外部工具链：无')).toBeNull();
    expect(
      await screen.findByText(/尚未映射到运行配置的目录或工具链线索：PPTM_HOME、ppt-master/),
    ).toBeTruthy();
    expect(screen.getByText('导入扫描发现尚未配置的 Skill 运行需求')).toBeTruthy();
    expect(screen.queryByText('当前没有阻塞原因。')).toBeNull();
    expect(screen.getByRole('button', { name: '试运行' })).toHaveProperty('disabled', true);
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
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary, second]),
          get,
        },
      },
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

  it('refreshes the list after returning from a detail mutation', async () => {
    const list = vi.fn(async () => [summary]);
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list,
          get: vi.fn(async () => detail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() => expect(screen.getByRole('heading', { name: '研究方法' })).toBeTruthy());
    screen.getByRole('button', { name: '返回' }).click();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
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
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => trustedDetail),
          setTrust,
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /^受信任/ }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    expect(screen.getByText('当前依赖尚未授权执行')).toBeTruthy();
    expect(screen.getByText('当前依赖环境尚未准备或绑定')).toBeTruthy();
    expect(screen.queryByText('trust-needs-review')).toBeNull();
    expect(screen.queryByText('environment-unprepared')).toBeNull();
  });

  it('refreshes selected Skill readiness after dependency authorization without reloading its runtime profile', async () => {
    const profileDetail: SkillDetail = {
      ...detail,
      trustStatus: 'needs-review',
      blockedReasons: ['trust-needs-review', 'environment-unprepared'],
      runtimeProfile: {
        id: 'skill-1-profile',
        skillId: 'skill-1',
        profileHash: 'skill-1-profile-hash',
        profile: {
          commands: [],
          environmentRequirements: [],
          dependencyLockId: 'skill-1-lock',
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
    };
    const authorizedSummary: SkillSummary = {
      ...summary,
      trustStatus: 'trusted',
      environmentStatus: 'ready',
      blockedReasons: [],
    };
    const list = vi
      .fn<() => Promise<SkillSummary[]>>()
      .mockResolvedValueOnce([summary])
      .mockResolvedValue([authorizedSummary]);
    const refreshDependencyGrant = vi
      .fn<(input: unknown) => Promise<Record<string, unknown>>>()
      .mockResolvedValueOnce({
        skill: profileDetail,
        selectedSnapshotIds: [],
        grantActive: false,
        grantCreated: false,
        blockedReason: '依赖已确定但没有覆盖它的授权，需要用户确认后建立',
      })
      .mockResolvedValue({
        skill: authorizedSummary,
        selectedSnapshotIds: [],
        grantActive: true,
        grantCreated: true,
      });
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant,
          list,
          get: vi.fn(async () => profileDetail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    (await screen.findByRole('button', { name: '确认依赖授权' })).click();

    expect(await screen.findByText('当前没有阻塞原因。')).toBeTruthy();
    expect(screen.getByText('已信任')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
    expect(refreshDependencyGrant).toHaveBeenCalledTimes(2);
  });

  it('routes short-lived success feedback through the shared toast', async () => {
    const disabledSummary: SkillSummary = { ...summary, enabled: false };
    const setEnabled = vi.fn(async () => ({ skill: disabledSummary }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
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
    expect(document.querySelector('.inline-message')).toBeNull();
  });

  it('requires explicit confirmation before deleting a user Skill', async () => {
    const deleteSkill = vi.fn(async () => ({ deleted: true }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
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

  it('lists one row of in-place actions per card, and never offers delete for a builtin Skill', async () => {
    const builtin: SkillSummary = {
      ...summary,
      id: 'skill-2',
      name: '内置样本',
      sourceKind: 'builtin',
      trustStatus: 'trusted',
    };
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary, builtin]),
          get: vi.fn(async () => detail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());

    // 逐张卡断言，不数全局个数：把「内置给复制副本」的条件取反，两条计数都不变，
    // 只比数量的断言会照样绿——那等于没测。
    const userCard = screen.getByText('研究方法').closest('.card');
    const builtinCard = screen.getByText('内置样本').closest('.card');
    if (!userCard || !builtinCard) throw new Error('两张卡没都渲染出来，本条用例是空跑');

    expect(within(userCard as HTMLElement).getByRole('button', { name: '停用' })).toBeTruthy();
    expect(within(userCard as HTMLElement).getByRole('button', { name: '信任' })).toBeTruthy();
    expect(within(userCard as HTMLElement).getByRole('button', { name: '删除' })).toBeTruthy();
    expect(within(userCard as HTMLElement).queryByRole('button', { name: '复制副本' })).toBeNull();

    expect(
      within(builtinCard as HTMLElement).getByRole('button', { name: '撤销信任' }),
    ).toBeTruthy();
    expect(
      within(builtinCard as HTMLElement).getByRole('button', { name: '复制副本' }),
    ).toBeTruthy();
    expect(within(builtinCard as HTMLElement).queryByRole('button', { name: '删除' })).toBeNull();
  });

  it('asks for confirmation from the card footer without opening the detail page', async () => {
    const deleteSkill = vi.fn(async () => ({ deleted: true }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
          delete: deleteSkill,
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());

    screen.getByRole('button', { name: '删除' }).click();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('删除这个 Skill？')).toBeTruthy();
    // 措辞要说清级联到哪：技能绑定随修订一起删，历史 Run 就回答不了「当时用的哪一版」。
    expect(within(dialog).getByText(/技能绑定/)).toBeTruthy();
    // 页脚动作不得冒泡进整片点击区——点删除不该同时把人带进详情。
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
    expect(deleteSkill).not.toHaveBeenCalled();

    within(dialog).getByRole('button', { name: '删除 Skill' }).click();
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith({ skillId: summary.id }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the actions in the list row and drops the whole-row click target', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    within(screen.getByRole('group', { name: '视图模式' }))
      .getByRole('button', { name: '列表' })
      .click();
    await waitFor(() =>
      expect(document.querySelector('.list-row[data-variant=card]')).toBeTruthy(),
    );

    // 右槽已有按钮，整行就不再是点击区：卡片模式那枚包住身份与说明的按钮必须消失。
    expect(screen.queryByRole('button', { name: /研究方法/ })).toBeNull();
    expect(screen.getByRole('button', { name: '详情' })).toBeTruthy();

    screen.getByRole('button', { name: '详情' }).click();
    await waitFor(() => expect(screen.getByRole('heading', { name: '研究方法' })).toBeTruthy());
  });

  it('switches between card and list view via the segmented control', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());

    const group = screen.getByRole('group', { name: '视图模式' });
    const cardButton = within(group).getByRole('button', { name: '卡片' });
    const listButton = within(group).getByRole('button', { name: '列表' });
    expect(cardButton.getAttribute('aria-pressed')).toBe('true');
    expect(listButton.getAttribute('aria-pressed')).toBe('false');

    expect(document.querySelector('.card')).toBeTruthy();
    expect(document.querySelector('.list-row[data-variant=card]')).toBeNull();

    listButton.click();
    await waitFor(() => {
      const updatedGroup = screen.getByRole('group', { name: '视图模式' });
      expect(
        within(updatedGroup).getByRole('button', { name: '列表' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(
        within(updatedGroup).getByRole('button', { name: '卡片' }).getAttribute('aria-pressed'),
      ).toBe('false');
    });
    expect(document.querySelector('.list-row[data-variant=card]')).toBeTruthy();
    expect(document.querySelector('.card')).toBeNull();
  });

  it('returns to browse when the back button is pressed in detail view', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());
    screen.getByRole('button', { name: /研究方法/ }).click();
    await waitFor(() => expect(screen.getByRole('heading', { name: '研究方法' })).toBeTruthy());

    screen.getByRole('button', { name: /返回/ }).click();
    await waitFor(() => expect(screen.getByRole('group', { name: '视图模式' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: '研究方法' })).toBeNull();
  });

  it('persists the chosen view mode to localStorage', async () => {
    const setItem = vi.fn();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem },
    });
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        dependencies: dependencyStub(),
        skills: {
          refreshDependencyGrant: grantStub(),
          list: vi.fn(async () => [summary]),
          get: vi.fn(async () => detail),
        },
      },
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByText('研究方法')).toBeTruthy());

    within(screen.getByRole('group', { name: '视图模式' }))
      .getByRole('button', { name: '列表' })
      .click();
    expect(setItem).toHaveBeenCalledWith('skills-view-mode', 'list');
  });
});
