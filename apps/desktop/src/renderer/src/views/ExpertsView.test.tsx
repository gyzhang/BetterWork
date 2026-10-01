// @vitest-environment jsdom

import type { ExpertSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExpertsState } from '../hooks/use-experts';
import { ExpertsPage } from './ExpertsView';

afterEach(cleanup);

const userExpert: ExpertSummary = {
  id: 'expert-user',
  sourceKind: 'user',
  lifecycle: 'active',
  name: '纪要整理',
  summary: '把会议记录整理成结论与待办',
  author: '财务组',
  tags: ['纪要'],
  currentRevision: 3,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 1,
};
const builtinExpert: ExpertSummary = {
  ...userExpert,
  id: 'expert-builtin',
  sourceKind: 'builtin',
  name: '研究顾问',
  author: '',
  currentRevision: 2,
};

/** 本测试只看列表档给出什么，不点开详情，所以这些动作一律钉成「谁碰谁红」。 */
function unused(): never {
  throw new Error('专家列表测试不该触发这条动作');
}

function stateStub(experts: ExpertSummary[]): ExpertsState {
  return {
    experts,
    loading: false,
    error: '',
    refresh: vi.fn(),
    get: vi.fn(async () => unused()),
    create: vi.fn(async () => unused()),
    saveRevision: vi.fn(async () => unused()),
    copy: vi.fn(async () => unused()),
    setLifecycle: vi.fn(async () => unused()),
    remove: vi.fn(async () => unused()),
  };
}

function renderCatalog(experts: ExpertSummary[]): HTMLElement {
  const state = stateStub(experts);
  const { container } = render(
    <ExpertsPage
      state={state}
      skills={[]}
      mcpConnections={[]}
      memories={[]}
      models={[]}
      materialCandidates={[]}
      actions={state}
      onSummon={vi.fn(async () => undefined)}
      onError={vi.fn()}
      onManageMemories={vi.fn()}
    />,
  );
  return container;
}

/** 一张条目上给出的动作集合；排序比较的是「有哪几颗」，不是「摆在哪一格」。
 * 卡片自己的整片可点区不算动作——它的可及名称是标题与说明的聚合。 */
function actionLabels(root: Element): string[] {
  return [...root.querySelectorAll('button:not(.card-main)')]
    .map((button) => (button.textContent ?? '').trim())
    .filter((label) => label !== '')
    .sort();
}

describe('ExpertsPage 的目录条目', () => {
  it('逐卡给出自己的动作：内置只有复制副本，没有编辑与删除', () => {
    const container = renderCatalog([userExpert, builtinExpert]);
    const cards = container.querySelectorAll('.card');
    expect(cards).toHaveLength(2);

    const editable = cards[0] as HTMLElement;
    const readonly = cards[1] as HTMLElement;
    expect(actionLabels(editable)).toEqual(['停用', '删除', '召唤', '编辑', '详情'].sort());
    expect(actionLabels(readonly)).toEqual(['停用', '复制副本', '召唤', '详情'].sort());
    expect(within(readonly).queryByRole('button', { name: '删除' })).toBeNull();
    expect(within(readonly).queryByRole('button', { name: '编辑' })).toBeNull();
    expect(within(editable).queryByRole('button', { name: '复制副本' })).toBeNull();
  });

  it('切到列表档后，同一条目的动作与署名一格不少——两种视图不许各自长出一套', async () => {
    const container = renderCatalog([userExpert, builtinExpert]);
    const cards = [...container.querySelectorAll('.card')];
    const bylineOnCards = cards.map((card) => card.querySelector('.card-byline')?.textContent);
    expect(bylineOnCards).toEqual(['用户 · 财务组 · v3', '内置 · v2']);

    fireEvent.click(screen.getByRole('button', { name: '列表' }));
    await waitFor(() => expect(container.querySelector('.list-row')).not.toBeNull());

    const rows = [...container.querySelectorAll('.list-row[data-variant="card"]')];
    expect(rows).toHaveLength(2);
    for (const [index, row] of rows.entries()) {
      const card = cards[index] as Element;
      expect(actionLabels(row)).toEqual(actionLabels(card));
      expect(row.querySelector('.list-row-meta')?.textContent).toBe(bylineOnCards[index]);
    }
  });
});
