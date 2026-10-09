import type { TaskContextRevision, TaskMaterialSelection } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import type { CapabilityChip } from '../components/ComposerCapabilityPicker';
import { emptyTaskDraft, taskDraftReducer, type TaskDraftState } from './task-draft';

const preset: CapabilityChip = {
  kind: 'skill',
  id: 'preset',
  name: 'Preset',
  revisionId: 'preset-revision',
  status: 'ready',
  source: 'expert-preset',
};
const manual: CapabilityChip = { ...preset, id: 'manual', source: 'task-selection' };
const material: TaskMaterialSelection = {
  reference: {
    kind: 'artifact-version',
    artifactId: 'artifact',
    artifactVersionId: 'version',
    contentHash: 'hash',
    originWorkspaceId: 'workspace',
  },
  purpose: 'historical-comparison',
  addedFrom: 'user-input',
};
const context: TaskContextRevision = {
  id: 'context',
  taskId: 'task',
  revision: 3,
  executor: { kind: 'expert', expertId: 'expert', expertRevisionId: 'expert-revision' },
  skillBindings: [{ skillId: preset.id, revisionId: 'preset-revision', source: 'expert-preset' }],
  materials: [material],
  excludedMemoryIds: ['excluded'],
  mcpToolBindings: [],
  createdAt: 1,
  updatedAt: 1,
};
const configuredDraft = (): TaskDraftState => ({
  context,
  expert: { id: 'expert', revisionId: 'expert-revision', name: 'Expert' },
  bindings: [preset, manual],
  materials: [material],
  excludedMemoryIds: ['excluded'],
  mcpToolBindings: [{ connectionId: 'connection', toolId: 'tool' }],
});

describe('task draft transitions', () => {
  it('new Task discards every previous configuration and CAS baseline', () => {
    expect(taskDraftReducer(configuredDraft(), { type: 'reset', preserveBindings: false })).toEqual(
      emptyTaskDraft(),
    );
  });

  it('workspace transition preserves selected skills while clearing scoped configuration', () => {
    const draft = configuredDraft();
    expect(taskDraftReducer(draft, { type: 'reset', preserveBindings: true })).toEqual({
      ...emptyTaskDraft(),
      bindings: draft.bindings,
    });
  });

  it('restores the full context snapshot and clears absent fields on legacy contexts', () => {
    const first = taskDraftReducer(emptyTaskDraft(), {
      type: 'restore',
      context,
      expert: configuredDraft().expert,
      bindings: [preset],
    });
    expect(first).toEqual({ ...configuredDraft(), bindings: [preset], mcpToolBindings: [] });
    const legacy = taskDraftReducer(first, {
      type: 'restore',
      context: undefined,
      expert: undefined,
      bindings: [manual],
    });
    expect(legacy).toEqual({ ...emptyTaskDraft(), bindings: [manual] });
  });

  it('a save receipt advances CAS without overwriting unsaved materials, skills or authorization', () => {
    const working = {
      ...configuredDraft(),
      materials: [],
      bindings: [manual],
      excludedMemoryIds: ['local'],
    };
    const saved = { ...context, revision: 4 };
    expect(
      taskDraftReducer(working, { type: 'context-saved', context: saved, updateExclusions: false }),
    ).toEqual({
      ...working,
      context: saved,
    });
    expect(context.revision).toBe(3);
  });

  it('exclusion receipts change only CAS and exclusions, preserving local edits', () => {
    const working = { ...configuredDraft(), materials: [], bindings: [manual] };
    const saved = { ...context, revision: 4, excludedMemoryIds: ['new-exclusion'] };
    expect(
      taskDraftReducer(working, { type: 'context-saved', context: saved, updateExclusions: true }),
    ).toEqual({
      ...working,
      context: saved,
      excludedMemoryIds: ['new-exclusion'],
    });
  });

  it('removing an Expert keeps manually selected skills and explicit material/MCP choices', () => {
    const working = configuredDraft();
    expect(taskDraftReducer(working, { type: 'remove-expert' })).toEqual({
      ...working,
      context: undefined,
      expert: undefined,
      bindings: [manual],
    });
  });

  it('preparing a source-version Task replaces old permissions and resets its CAS baseline', () => {
    expect(
      taskDraftReducer(configuredDraft(), {
        type: 'prepare',
        configuration: {
          expert: undefined,
          bindings: [],
          materials: [material],
          excludedMemoryIds: [],
          mcpToolBindings: [],
        },
      }),
    ).toEqual({ ...emptyTaskDraft(), materials: [material] });
  });
});
