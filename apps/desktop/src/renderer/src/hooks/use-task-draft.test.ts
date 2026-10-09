// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTaskDraft } from './use-task-draft';

afterEach(cleanup);

describe('Task prompt ownership', () => {
  it('typing keeps the remount draft current and invalidates settled preview without resetting the input', () => {
    const { result } = renderHook(() => useTaskDraft());
    act(() => result.current.replacePrompt('previous'));
    const revision = result.current.promptResetRevision;
    act(() => result.current.changePrompt('unsent draft'));
    expect(result.current.readPrompt()).toBe('unsent draft');
    expect(result.current.memoryPreviewPrompt).toBe('');
    expect(result.current.promptResetRevision).toBe(revision);
    act(() => result.current.settlePrompt('unsent draft'));
    expect(result.current.memoryPreviewPrompt).toBe('unsent draft');
  });

  it('workspace reset preserves prompt and skills, then a new Task clears both', () => {
    const { result } = renderHook(() => useTaskDraft());
    act(() => {
      result.current.replacePrompt('continue here');
      result.current.setBindings([{ kind: 'skill', id: 'skill', name: 'Skill', status: 'ready' }]);
    });
    const revision = result.current.promptResetRevision;
    act(() => result.current.reset({ preservePrompt: true, preserveBindings: true }));
    expect(result.current.readPrompt()).toBe('continue here');
    expect(result.current.promptResetRevision).toBe(revision);
    expect(result.current.draft.bindings.map((chip) => chip.id)).toEqual(['skill']);
    act(() => result.current.reset());
    expect(result.current.readPrompt()).toBe('');
    expect(result.current.memoryPreviewPrompt).toBe('');
    expect(result.current.draft.bindings).toEqual([]);
    expect(result.current.promptResetRevision).toBe(revision + 1);
  });

  it('queued binding updates compose against the latest draft instead of a render snapshot', () => {
    const { result } = renderHook(() => useTaskDraft());
    act(() => {
      result.current.setBindings((current) => [
        ...current,
        { kind: 'skill', id: 'first', name: 'First', status: 'ready' },
      ]);
      result.current.setBindings((current) => [
        ...current,
        { kind: 'skill', id: 'second', name: 'Second', status: 'ready' },
      ]);
      result.current.setBindings((current) => current.filter((chip) => chip.id !== 'first'));
    });
    expect(result.current.draft.bindings.map((chip) => chip.id)).toEqual(['second']);
  });
});
