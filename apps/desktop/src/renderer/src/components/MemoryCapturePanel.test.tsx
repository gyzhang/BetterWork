// @vitest-environment jsdom

import type { MemoryScope } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MemoryCaptureDraft, MemoryCapturePanel } from './MemoryCapturePanel';

const raw = '本季把资源集中到三条产品线，其余两条收缩。';
const scopes: MemoryScope[] = [{ kind: 'workspace', workspaceId: 'w1' }];

const draft = (overrides: Partial<MemoryCaptureDraft> = {}): MemoryCaptureDraft => ({
  runId: 'r1',
  eventId: 'e1',
  raw,
  initialContent: '三条产品线优先。',
  range: { start: 0, end: 11 },
  ...overrides,
});

const panel = (overrides: Partial<MemoryCaptureDraft> = {}): void => {
  render(
    <MemoryCapturePanel
      capture={draft(overrides)}
      scopes={scopes}
      error=""
      onRangeChange={() => {}}
      onSubmit={async () => true}
      onClose={() => {}}
    />,
  );
};

afterEach(() => {
  cleanup();
});

describe('MemoryCapturePanel 基座', () => {
  it('只读原文与可改写正文同时在场，正文预填来自选区', () => {
    panel();

    const source = screen.getByRole('textbox', { name: '回答原文' });
    const content = screen.getByRole('textbox', { name: '记忆正文' });
    expect(source).toHaveProperty('readOnly', true);
    expect(source).toHaveProperty('value', raw);
    expect(content).toHaveProperty('value', '三条产品线优先。');
  });

  it('没有选区时仍然呈现原文，让用户在下面重选', () => {
    panel({ range: undefined, initialContent: '' });

    expect(screen.getByRole('textbox', { name: '记忆正文' })).toHaveProperty('value', '');
    expect(screen.getByText(/来源摘录取自这条回答的原文/)).toBeTruthy();
  });

  it('取消把草稿交回页面，面板自己不清状态', () => {
    const onClose = vi.fn();
    render(
      <MemoryCapturePanel
        capture={draft()}
        scopes={scopes}
        error=""
        onRangeChange={() => {}}
        onSubmit={async () => true}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('错误只走内联错误态，不开第二条反馈通道', () => {
    render(
      <MemoryCapturePanel
        capture={draft({ range: undefined })}
        scopes={scopes}
        error="选中的片段在这条回答里出现了不止一次，请重选。"
        onRangeChange={() => {}}
        onSubmit={async () => true}
        onClose={() => {}}
      />,
    );

    const note = screen.getByRole('alert');
    expect(note.getAttribute('class')).toBe('inline-message error');
  });
});
