import type {
  McpToolBinding,
  ScheduleOccurrenceDetail,
  TaskContextRevision,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { useCallback, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';

export interface ScheduleTaskContinuationView {
  occurrence: ScheduleOccurrenceDetail;
  sourceSnapshotId?: string;
  scopeAttached: boolean;
}

export interface ScheduleTaskContinuationState {
  view?: ScheduleTaskContinuationView;
  removingScope: boolean;
  scopeError: string;
  attach: (occurrence: ScheduleOccurrenceDetail) => void;
  clear: () => void;
  removeScope: (draft: ScheduleTaskContinuationDraft) => void;
}

export interface ScheduleTaskContinuationDraft {
  executor: TaskContextRevision['executor'];
  skillBindings: TaskContextRevision['skillBindings'];
  materials: TaskMaterialSelection[];
  excludedMemoryIds: string[];
  mcpToolBindings: McpToolBinding[];
}

export function useScheduleTaskContinuation({
  taskContext,
  onContextSaved,
}: {
  taskContext: TaskContextRevision | undefined;
  onContextSaved: (context: TaskContextRevision) => void;
}): ScheduleTaskContinuationState {
  const [occurrence, setOccurrence] = useState<ScheduleOccurrenceDetail>();
  const [removingScope, setRemovingScope] = useState(false);
  const [scopeError, setScopeError] = useState('');
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const snapshotId = occurrence?.sourceSnapshot?.id ?? occurrence?.occurrence.sourceSnapshotId;
  const scopeAttached =
    snapshotId !== undefined && taskContext?.scheduleSourceSnapshotId === snapshotId;
  const view = occurrence
    ? {
        occurrence,
        ...(snapshotId ? { sourceSnapshotId: snapshotId } : {}),
        scopeAttached,
      }
    : undefined;

  const attach = useCallback((nextOccurrence: ScheduleOccurrenceDetail): void => {
    generationRef.current += 1;
    setOccurrence(nextOccurrence);
    setRemovingScope(false);
    setScopeError('');
  }, []);

  const clear = useCallback((): void => {
    generationRef.current += 1;
    setOccurrence(undefined);
    setRemovingScope(false);
    setScopeError('');
  }, []);

  const removeScope = useCallback(
    (draft: ScheduleTaskContinuationDraft): void => {
      if (busyRef.current) return;
      if (
        !occurrence ||
        !taskContext ||
        !snapshotId ||
        occurrence.task?.id !== taskContext.taskId ||
        taskContext.scheduleSourceSnapshotId !== snapshotId
      ) {
        setScopeError('本期范围状态已变化，刷新任务上下文后再试。');
        return;
      }

      busyRef.current = true;
      setRemovingScope(true);
      setScopeError('');
      const requestGeneration = generationRef.current;
      const save = async (): Promise<void> => {
        try {
          const result = await window.betterwork.taskContexts.save({
            taskId: taskContext.taskId,
            expectedRevision: taskContext.revision,
            executor: draft.executor,
            skillBindings: draft.skillBindings,
            materials: draft.materials,
            scheduleSourceSnapshotId: null,
            excludedMemoryIds: draft.excludedMemoryIds,
            mcpToolBindings: draft.mcpToolBindings,
            ...(taskContext.modelReference !== undefined
              ? { modelReference: taskContext.modelReference }
              : {}),
            ...(taskContext.builtinToolPolicy !== undefined
              ? { builtinToolPolicy: taskContext.builtinToolPolicy }
              : {}),
          });
          if (result.context.scheduleSourceSnapshotId !== undefined) {
            throw new Error('主进程未确认移除本期来源范围。');
          }
          onContextSaved(result.context);
          if (generationRef.current === requestGeneration) setScopeError('');
        } catch (error: unknown) {
          if (generationRef.current === requestGeneration) {
            setScopeError(describeActionError(error, '移除本期范围失败，原范围仍保留。'));
          }
        } finally {
          busyRef.current = false;
          if (generationRef.current === requestGeneration) setRemovingScope(false);
        }
      };
      trackAction(save(), '移除定时任务本期范围');
    },
    [occurrence, onContextSaved, snapshotId, taskContext],
  );

  return {
    ...(view ? { view } : {}),
    removingScope,
    scopeError,
    attach,
    clear,
    removeScope,
  };
}
