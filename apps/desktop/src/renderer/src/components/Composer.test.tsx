// @vitest-environment jsdom

import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer, type ComposerProps } from './Composer';

const workspace: WorkspaceSummary = {
  id: 'w1',
  name: '季度复盘',
  rootPath: '/vault/quarter',
  createdAt: 0,
  updatedAt: 0,
};

const base: ComposerProps = {
  prompt: '把三条产品线的差值列成表',
  onPromptChange: () => {},
  onStartRun: vi.fn(),
  submit: { state: 'idle' },
  locked: false,
  modelLabel: '本地模型 · qwen3',
  workspacePicker: {
    currentWorkspace: workspace,
    workspaces: [workspace],
    onSelectWorkspace: () => {},
    onOpenLocalFolder: () => {},
    onNewWorkspace: () => {},
  },
  expert: undefined,
  onRemoveExpert: () => {},
  skills: [],
  bindings: [],
  onAddBinding: () => {},
  onRemoveBinding: () => {},
  materials: [],
  materialCandidates: [],
  materialsLoading: false,
  onRequestMaterials: () => {},
  onDismissMaterialPicker: () => {},
  onCommitMaterials: () => {},
  onRequestSkillDetail: () => {},
  onRequestExpert: () => {},
};

const composer = (overrides: Partial<ComposerProps> = {}): HTMLElement => {
  const { container } = render(<Composer {...base} {...overrides} />);
  return container;
};

afterEach(() => {
  cleanup();
});

describe('Composer 基座', () => {
  it('提交与 ⌘／Ctrl＋↵ 走同一个入口，单独的 Enter 只换行', () => {
    const onStartRun = vi.fn();
    composer({ onStartRun });
    const box = screen.getByRole('textbox', { name: /任务输入/ });

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onStartRun).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onStartRun).toHaveBeenCalledTimes(2);

    fireEvent.submit(box.closest('form') as HTMLElement);
    expect(onStartRun).toHaveBeenCalledTimes(3);
  });

  it('输入法组合中的 Enter 不打断打字', () => {
    const onStartRun = vi.fn();
    composer({ onStartRun });
    const box = screen.getByRole('textbox', { name: /任务输入/ });

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, isComposing: true });
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it('运行中给出「停止」，绑定区随之锁住', () => {
    const onStop = vi.fn();
    composer({ locked: true, submit: { state: 'running', onStop } });

    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /开始工作/ })).toBeNull();
    expect(screen.getByRole('button', { name: /添加能力/ })).toHaveProperty('disabled', true);
  });

  it('正在启动把提交按钮换成 busy 档', () => {
    composer({ submit: { state: 'starting' } });

    const start = screen.getByRole('button', { name: '正在启动…' });
    expect(start.getAttribute('aria-busy')).toBe('true');
    expect(start).toHaveProperty('disabled', true);
  });

  it('没有工作区就不让开始：先选目录，再谈提交', () => {
    composer({ workspacePicker: { ...base.workspacePicker, currentWorkspace: undefined } });

    expect(screen.getByRole('button', { name: /开始工作/ })).toHaveProperty('disabled', true);
  });
});
