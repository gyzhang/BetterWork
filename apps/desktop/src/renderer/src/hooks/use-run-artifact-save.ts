import type { ArtifactSummary, RunSummary } from '@betterwork/agent-protocol';
import { useCallback, useRef, useState } from 'react';

import { describeActionError } from '../lib/async-action';
import type { SelectedTask, TaskSelectionRequest } from './use-task-selection';

export interface RunArtifactTarget {
  run: RunSummary;
  content: string;
}

export interface RunArtifactFeedback {
  runId: string;
  tone: 'success' | 'error';
  message: string;
}

interface ScopedFeedback extends RunArtifactFeedback {
  selection: TaskSelectionRequest;
}

interface RunArtifactSaveOptions {
  task: SelectedTask | undefined;
  artifacts: ArtifactSummary[];
  captureSelection: () => TaskSelectionRequest;
  isCurrentSelection: (selection: TaskSelectionRequest) => boolean;
  onCommitted: () => void;
  onSaved: () => void;
}

export interface RunArtifactSaveState {
  savingRunId: string | undefined;
  feedback: RunArtifactFeedback | undefined;
  dismissFeedback: () => void;
  save: (target: RunArtifactTarget) => Promise<void>;
}

export function useRunArtifactSave({
  task,
  artifacts,
  captureSelection,
  isCurrentSelection,
  onCommitted,
  onSaved,
}: RunArtifactSaveOptions): RunArtifactSaveState {
  const [savingRunId, setSavingRunId] = useState<string>();
  const pending = useRef(false);
  const [feedback, setFeedback] = useState<ScopedFeedback>();
  const dismissFeedback = useCallback(() => setFeedback(undefined), []);
  const save = useCallback(
    async ({ run, content }: RunArtifactTarget): Promise<void> => {
      if (!task || task.id !== run.taskId || !content.trim() || pending.current) return;
      const selection = captureSelection();
      const existing = artifacts.find(
        (artifact) => artifact.taskId === task.id && artifact.type === 'markdown',
      );
      pending.current = true;
      setSavingRunId(run.id);
      setFeedback(undefined);
      try {
        const artifact = await window.betterwork.artifacts.saveMarkdown({
          ...(existing ? { artifactId: existing.id } : {}),
          taskId: run.taskId,
          origin: 'assistant-run',
          runId: run.id,
          title: task.title,
          content,
        });
        onCommitted();
        if (!isCurrentSelection(selection)) return;
        setFeedback({
          selection,
          runId: run.id,
          tone: 'success',
          message: `已保存为 Markdown 成果（v${artifact.versionNumber}）。`,
        });
        onSaved();
      } catch (error: unknown) {
        const message = describeActionError(error, '保存成果失败。');
        if (isCurrentSelection(selection)) {
          setFeedback({ selection, runId: run.id, tone: 'error', message });
        } else {
          console.error('保存原任务成果失败', message);
        }
      } finally {
        pending.current = false;
        setSavingRunId(undefined);
      }
    },
    [task, artifacts, captureSelection, isCurrentSelection, onCommitted, onSaved],
  );
  return {
    savingRunId,
    feedback: feedback && isCurrentSelection(feedback.selection) ? feedback : undefined,
    dismissFeedback,
    save,
  };
}
