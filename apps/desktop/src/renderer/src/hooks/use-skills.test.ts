// @vitest-environment jsdom

import type { SkillDetail, SkillSummary } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSkills } from './use-skills';

/**
 * Skill 页取数的 IPC 收口（docs/12 §5 的 Renderer 小节）。
 *
 * 这一组是 2026-09-30 那轮修的缺陷的回归：`refresh` 与 `select` 走 `trackAction`，
 * 但 `loading`／`detailLoading` 只在 `.then` 的成功路径里清除——失败既没有呈现出口，也不把
 * 转圈停下，`SkillsView` 于是常驻「正在加载 Skill…」／「正在加载详情…」，用户既等不到内容
 * 也等不到一句「读失败」，更没有重试入口。
 *
 * 钉的是形状而不是措辞：**只要把 busy 置为 true，失败路径就必须能清除它，并让这句话到达一个
 * 真实存在的出口。**
 */

const summary: SkillSummary = {
  id: 'skill-1',
  name: '研究方法',
  description: '整理研究步骤',
  sourceKind: 'user',
  enabled: true,
  currentRevisionId: 'revision-1',
  trustStatus: 'untrusted',
  environmentStatus: 'unprepared',
  blockedReasons: ['untrusted'],
};

const detailOf = (id: string): SkillDetail => ({
  ...summary,
  id,
  revision: {
    id: `${id}-revision-1`,
    skillId: id,
    contentHash: 'hash-1',
    resourceKey: `user/${id}/revisions/hash-1`,
    frontmatter: {},
    createdAt: 1,
  },
});

const install = (
  list: () => Promise<SkillSummary[]> = async () => [summary],
  get: (input: { id: string }) => Promise<SkillDetail | null> = async () => detailOf(summary.id),
): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { skills: { list: vi.fn(list), get: vi.fn(get) } },
  });
};

const renderSkills = () => renderHook(() => useSkills({ onTestRunRequested: () => undefined }));

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
});

describe('useSkills 的取数收口', () => {
  it('列表读取失败时停下转圈，并把这句话交给可见出口', async () => {
    install(async () => {
      throw new Error('channel rejected');
    });

    const { result } = renderSkills();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('channel rejected');
    expect(result.current.skills).toHaveLength(0);
  });

  it('列表读取成功时清除转圈且不报错', async () => {
    install();

    const { result } = renderSkills();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('');
    expect(result.current.skills).toHaveLength(1);
  });

  it('详情读取失败时停下详情的转圈，并把这句话交给可见出口', async () => {
    install(undefined, async () => {
      throw new Error('详情通道不可用');
    });

    const { result } = renderSkills();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.select(summary));
    await waitFor(() => expect(result.current.detailLoading).toBe(false));

    expect(result.current.error).toBe('详情通道不可用');
    expect(result.current.selected).toBeUndefined();
  });

  it('换到第二个 Skill 后，第一次请求的迟到失败不覆盖这一次的界面', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    install(undefined, (input) =>
      input.id === summary.id
        ? new Promise<SkillDetail>((_resolve, reject) => {
            rejectFirst = reject;
          })
        : Promise.resolve(detailOf('skill-2')),
    );

    const { result } = renderSkills();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 先真的发出第一次请求并让它悬着——不触发它就证不了「迟到的那一次被丢掉」，
    // 而一条不触发的用例会把「没有泄漏」读成「守卫生效」。
    act(() => result.current.select(summary));
    await waitFor(() => expect(result.current.detailLoading).toBe(true));
    expect(rejectFirst, '夹具没让第一次请求悬住，本条用例是空跑').toBeTypeOf('function');

    act(() => result.current.select({ ...summary, id: 'skill-2', name: '第二个 Skill' }));
    await waitFor(() => expect(result.current.detailLoading).toBe(false));
    expect(result.current.selected?.id).toBe('skill-2');

    act(() => rejectFirst?.(new Error('上一次的失败')));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error, '一次迟到的失败会停掉新内容的转圈并顶上一句无关的报错').toBe('');
    expect(result.current.selected?.id).toBe('skill-2');
    expect(result.current.detailLoading).toBe(false);
  });
});
