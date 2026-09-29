// @vitest-environment jsdom

import { MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS } from '@betterwork/agent-protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryCaptureSource } from './MemoryCaptureSource';

const RAW = '收入按回款金额统计。先核对财务规则。';

afterEach(() => {
  cleanup();
});

/**
 * 回答捕获的原文选择区（改进 Spec §4.1）。
 *
 * 这里守的是「用户能不能知道这块只能选、不能改」：`Field` 不给 `controlId` 时整个渲染成
 * 包裹式 `<label>`（`Field.tsx:41-45`），那句「回答原文（只读，可拖选或用键盘选择）」就是
 * 这个文本域唯一的名称来源。内层再写一个 `aria-label` 会把名称覆盖成半句，只读性从此在
 * 读屏里消失——而它恰好是最需要先听到的那半句。
 */
describe('MemoryCaptureSource 基座', () => {
  it('可及名称带上「只读」那半句，不被内层 aria-label 覆盖', () => {
    render(<MemoryCaptureSource raw={RAW} range={undefined} onRangeChange={vi.fn()} />);

    // 先证控件真的渲染出来了：否则下面「按名称查不到」会被读成「名称不对」，其实是根本没这个元素。
    expect(screen.queryAllByRole('textbox')).toHaveLength(1);

    expect(
      screen.queryByRole('textbox', { name: /只读/ }),
      '内层 aria-label 会盖掉 Field 包裹式 label 的名称，把「只读，可拖选或用键盘选择」从可及名称里抹掉',
    ).not.toBeNull();
  });

  it('未确认选区时说清还没确认，并给出码点上限', () => {
    render(<MemoryCaptureSource raw={RAW} range={undefined} onRangeChange={vi.fn()} />);

    expect(screen.getByText(/尚未确认来源摘录/).textContent).toContain(
      String(MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS),
    );
  });

  it('给出区间后显示已确认的码点数与那段摘录正文', () => {
    render(<MemoryCaptureSource raw={RAW} range={{ start: 0, end: 5 }} onRangeChange={vi.fn()} />);

    expect(screen.getByRole('strong').textContent).toBe(
      `已确认 5 码点（上限 ${MEMORY_SOURCE_EXCERPT_MAX_CODE_POINTS}）`,
    );
    expect(screen.queryByText(/尚未确认来源摘录/)).toBeNull();
  });
});
