import type {
  McpToolBinding,
  TaskContextRevision,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { type SetStateAction, useCallback, useReducer, useRef, useState } from 'react';

import type { CapabilityChip } from '../components/ComposerCapabilityPicker';
import {
  emptyTaskDraft,
  type TaskDraftConfiguration,
  type TaskDraftExpert,
  taskDraftReducer,
  type TaskDraftState,
} from '../lib/task-draft';

interface TaskDraftResetOptions {
  preservePrompt?: boolean;
  preserveBindings?: boolean;
}

interface TaskDraftOwner {
  draft: TaskDraftState;
  promptResetRevision: number;
  memoryPreviewPrompt: string;
  readPrompt: () => string;
  changePrompt: (value: string) => void;
  settlePrompt: (value: string) => void;
  replacePrompt: (value: string) => void;
  reset: (options?: TaskDraftResetOptions) => void;
  prepare: (configuration: TaskDraftConfiguration) => void;
  restore: (
    context: TaskContextRevision | undefined,
    expert: TaskDraftExpert | undefined,
    bindings: CapabilityChip[],
  ) => void;
  acceptSavedContext: (context: TaskContextRevision, updateExclusions?: boolean) => void;
  removeExpert: () => void;
  setBindings: (value: SetStateAction<CapabilityChip[]>) => void;
  setMaterials: (value: SetStateAction<TaskMaterialSelection[]>) => void;
  setMcpToolBindings: (value: McpToolBinding[]) => void;
}

export function useTaskDraft(): TaskDraftOwner {
  const [draft, dispatch] = useReducer(taskDraftReducer, undefined, emptyTaskDraft);
  // Composer owns live input; this ref supplies the draft on its next mount.
  const promptRef = useRef('');
  const [promptResetRevision, setPromptResetRevision] = useState(0);
  const [memoryPreviewPrompt, settlePrompt] = useState('');
  const readPrompt = useCallback((): string => promptRef.current, []);
  const changePrompt = useCallback((value: string): void => {
    promptRef.current = value;
    settlePrompt('');
  }, []);
  const replacePrompt = useCallback((value: string): void => {
    promptRef.current = value;
    setPromptResetRevision((current) => current + 1);
    settlePrompt(value);
  }, []);
  const reset = useCallback(
    (options: TaskDraftResetOptions = {}): void => {
      dispatch({ type: 'reset', preserveBindings: options.preserveBindings ?? false });
      if (!options.preservePrompt) replacePrompt('');
    },
    [replacePrompt],
  );
  const prepare = useCallback((configuration: TaskDraftConfiguration): void => {
    dispatch({ type: 'prepare', configuration });
  }, []);
  const restore = useCallback(
    (
      context: TaskContextRevision | undefined,
      expert: TaskDraftExpert | undefined,
      bindings: CapabilityChip[],
    ): void => {
      dispatch({ type: 'restore', context, expert, bindings });
    },
    [],
  );
  const acceptSavedContext = useCallback(
    (context: TaskContextRevision, updateExclusions = false): void => {
      dispatch({ type: 'context-saved', context, updateExclusions });
    },
    [],
  );
  const removeExpert = useCallback((): void => dispatch({ type: 'remove-expert' }), []);
  const setBindings = useCallback((value: SetStateAction<CapabilityChip[]>): void => {
    dispatch({ type: 'bindings', value });
  }, []);
  const setMaterials = useCallback((value: SetStateAction<TaskMaterialSelection[]>): void => {
    dispatch({ type: 'materials', value });
  }, []);
  const setMcpToolBindings = useCallback((value: McpToolBinding[]): void => {
    dispatch({ type: 'mcp-bindings', value });
  }, []);
  return {
    draft,
    promptResetRevision,
    memoryPreviewPrompt,
    readPrompt,
    changePrompt,
    settlePrompt,
    replacePrompt,
    reset,
    prepare,
    restore,
    acceptSavedContext,
    removeExpert,
    setBindings,
    setMaterials,
    setMcpToolBindings,
  };
}
