import type {
  ExpertModelReference,
  McpToolBinding,
  TaskContextRevision,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import type { SetStateAction } from 'react';

import type { CapabilityChip } from '../components/ComposerCapabilityPicker';

export interface TaskDraftExpert {
  id: string;
  revisionId: string;
  name: string;
  modelReference?: ExpertModelReference;
}

export interface TaskDraftConfiguration {
  expert: TaskDraftExpert | undefined;
  bindings: CapabilityChip[];
  materials: TaskMaterialSelection[];
  excludedMemoryIds: string[];
  mcpToolBindings: McpToolBinding[];
}

export interface TaskDraftState extends TaskDraftConfiguration {
  context: TaskContextRevision | undefined;
}

export type TaskDraftAction =
  | { type: 'reset'; preserveBindings: boolean }
  | { type: 'prepare'; configuration: TaskDraftConfiguration }
  | {
      type: 'restore';
      context: TaskContextRevision | undefined;
      expert: TaskDraftExpert | undefined;
      bindings: CapabilityChip[];
    }
  | { type: 'context-saved'; context: TaskContextRevision; updateExclusions: boolean }
  | { type: 'remove-expert' }
  | { type: 'bindings'; value: SetStateAction<CapabilityChip[]> }
  | { type: 'materials'; value: SetStateAction<TaskMaterialSelection[]> }
  | { type: 'mcp-bindings'; value: McpToolBinding[] };

export function emptyTaskDraft(): TaskDraftState {
  return {
    expert: undefined,
    context: undefined,
    bindings: [],
    materials: [],
    excludedMemoryIds: [],
    mcpToolBindings: [],
  };
}

export function taskDraftReducer(state: TaskDraftState, action: TaskDraftAction): TaskDraftState {
  switch (action.type) {
    case 'reset':
      return { ...emptyTaskDraft(), bindings: action.preserveBindings ? state.bindings : [] };
    case 'prepare':
      return { ...action.configuration, context: undefined };
    case 'restore':
      return {
        context: action.context,
        expert: action.expert,
        bindings: action.bindings,
        materials: action.context?.materials ?? [],
        excludedMemoryIds: action.context?.excludedMemoryIds ?? [],
        mcpToolBindings: action.context?.mcpToolBindings ?? [],
      };
    case 'context-saved':
      // A receipt advances the CAS baseline without restoring over the working draft.
      return {
        ...state,
        context: action.context,
        excludedMemoryIds: action.updateExclusions
          ? (action.context.excludedMemoryIds ?? [])
          : state.excludedMemoryIds,
      };
    case 'remove-expert':
      return {
        ...state,
        expert: undefined,
        context: undefined,
        bindings: state.bindings.filter((chip) => chip.source !== 'expert-preset'),
      };
    case 'bindings':
      return {
        ...state,
        bindings: typeof action.value === 'function' ? action.value(state.bindings) : action.value,
      };
    case 'materials':
      return {
        ...state,
        materials:
          typeof action.value === 'function' ? action.value(state.materials) : action.value,
      };
    case 'mcp-bindings':
      return { ...state, mcpToolBindings: action.value };
  }
}
