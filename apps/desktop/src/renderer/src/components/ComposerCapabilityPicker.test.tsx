// @vitest-environment jsdom

import type { MaterialCandidate, TaskMaterialSelection } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerCapabilityPicker } from './ComposerCapabilityPicker';

const candidate: MaterialCandidate = {
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-rules',
    knowledgeRevisionId: 'revision-rules-2',
    contentHash: 'hash-rules-2',
    sourcePath: '/workspace/财务规则.md',
  },
  title: '财务规则',
  sourceLabel: '知识 · 财务规则.md',
  status: 'ready',
  detail: '修订 v2',
};

const pickerProps = (
  overrides?: Partial<React.ComponentProps<typeof ComposerCapabilityPicker>>,
) => ({
  skills: [],
  selected: [],
  materials: [],
  materialCandidates: [candidate],
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onRequestSkillDetail: vi.fn(),
  onRequestExpert: vi.fn(),
  onRequestMaterials: vi.fn(),
  onDismissMaterialPicker: vi.fn(),
  onCommitMaterials: vi.fn(),
  ...overrides,
});

afterEach(cleanup);

describe('ComposerCapabilityPicker materials', () => {
  it('keeps the original selection when a material picker is cancelled', () => {
    const onCommitMaterials = vi.fn();
    const onRequestMaterials = vi.fn();
    const props = pickerProps({ onCommitMaterials, onRequestMaterials });
    const { rerender } = render(<ComposerCapabilityPicker {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '添加能力' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /引用知识/ }));
    expect(onRequestMaterials).toHaveBeenCalledWith('knowledge');

    rerender(<ComposerCapabilityPicker {...props} materialPickerKind="knowledge" />);
    fireEvent.click(screen.getByRole('menuitem', { name: /财务规则/ }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onCommitMaterials).not.toHaveBeenCalled();
  });

  it('commits a selected revision with a useful default purpose', () => {
    const onCommitMaterials = vi.fn();
    const props = pickerProps({ onCommitMaterials });
    render(<ComposerCapabilityPicker {...props} materialPickerKind="knowledge" />);

    fireEvent.click(screen.getByRole('menuitem', { name: /财务规则/ }));
    fireEvent.click(screen.getByRole('button', { name: '添加已选材料' }));

    expect(onCommitMaterials).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        reference: candidate.reference,
        purpose: 'rule',
        addedFrom: 'workspace-candidate',
      }),
    ] satisfies [TaskMaterialSelection]);
  });

  it('allows a selected material to use the other purpose', () => {
    const onCommitMaterials = vi.fn();
    const selected: TaskMaterialSelection = {
      reference: candidate.reference,
      purpose: 'rule',
      addedFrom: 'workspace-candidate',
    };
    render(
      <ComposerCapabilityPicker {...pickerProps({ onCommitMaterials, materials: [selected] })} />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '财务规则用途' }), {
      target: { value: 'other' },
    });

    expect(onCommitMaterials).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ purpose: 'other' }),
    ] satisfies [TaskMaterialSelection]);
  });
});
