import type {
  GetRunMemoryContextRequest,
  MemoryPreviewData,
  MemoryRunContextData,
  PreviewMemoryRequest,
  SaveTaskContextRequest,
  TaskContextRevision,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeActionError, trackAction } from '../lib/async-action';
import { settleMemoryCall } from '../lib/memory-result';

/**
 * 运行侧的记忆可见性（产品设计 §3.5）。
 *
 * 两个读取口各自独立，因为它们回答的是两个不同问题：
 * - `preview`：「下次运行**可能**带哪些」——范围预览，允许草稿 prompt，不写读取足迹；
 * - `runContext`：「**这次**运行实际登记了哪些」——精确修订、顺序、理由与请求阶段，
 *   被截断的历史轮次也来自同一条审计行，只给可解释原因。
 *
 * 两条保护：
 * 1. **迟到响应**——预览按「任务上下文修订＋输入」打键，运行审计按 `runId` 打键；
 *    切 Run、切空间、改草稿之后旧响应一律丢弃，不会覆盖新数据。
 * 2. **不夸大**——本 Hook 只交付协议字段；阶段措辞统一取自 `lib/memory-labels.ts`，
 *   「模型已收到 / 已阅读」这类说法不在这里产生。
 */

export interface RunMemoryPreviewQuery {
  /** 任务上下文尚未建立（新草稿）时为 undefined，此时不做预览并说明原因。 */
  taskId: string | undefined;
  taskContextRevisionId: string | undefined;
  expectedTaskContextRevision: number | undefined;
  prompt: string;
}

export interface RunMemoriesState {
  preview: MemoryPreviewData | undefined;
  previewLoading: boolean;
  previewError: string;
  /** 预览的前置条件是否齐备；不齐备时界面显示「任务上下文尚未建立」。 */
  previewAvailable: boolean;
  requestPreview: () => void;
  runContext: MemoryRunContextData | undefined;
  contextLoading: boolean;
  contextError: string;
  refreshRunContext: () => void;
}

export function useRunMemories(
  query: RunMemoryPreviewQuery,
  runId: string | undefined,
): RunMemoriesState {
  const { taskId, taskContextRevisionId, expectedTaskContextRevision, prompt } = query;
  const trimmedPrompt = prompt.trim();
  const [preview, setPreview] = useState<MemoryPreviewData>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [runContext, setRunContext] = useState<MemoryRunContextData>();
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const previewGuard = useRef({ key: '', request: 0 });
  const contextGuard = useRef({ runId: '', request: 0 });

  const previewKey = `${taskId ?? '-'}|${taskContextRevisionId ?? '-'}|${expectedTaskContextRevision ?? '-'}|${trimmedPrompt.slice(0, 200)}`;
  const previewAvailable =
    taskId !== undefined &&
    taskContextRevisionId !== undefined &&
    expectedTaskContextRevision !== undefined &&
    trimmedPrompt.length > 0;

  const requestPreview = useCallback((): void => {
    if (
      taskId === undefined ||
      taskContextRevisionId === undefined ||
      expectedTaskContextRevision === undefined ||
      !trimmedPrompt
    ) {
      return;
    }
    const input: PreviewMemoryRequest = {
      taskId,
      taskContextRevisionId,
      expectedTaskContextRevision,
      prompt: trimmedPrompt,
    };
    previewGuard.current.request += 1;
    const requestId = previewGuard.current.request;
    previewGuard.current.key = previewKey;
    setPreviewLoading(true);
    setPreviewError('');
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.preview(input),
        '记忆范围预览失败，请重试。',
      ).then((outcome) => {
        // 迟到响应：换任务、换修订或换输入之后，这次结果不再有意义。
        if (previewGuard.current.request !== requestId || previewGuard.current.key !== previewKey) {
          return;
        }
        setPreviewLoading(false);
        if (outcome.ok) {
          setPreview(outcome.data);
          setPreviewError('');
        } else {
          setPreview(undefined);
          setPreviewError(outcome.message);
        }
      }),
      '预览下次运行可用的记忆',
    );
  }, [taskId, taskContextRevisionId, expectedTaskContextRevision, trimmedPrompt, previewKey]);

  useEffect(() => {
    // 上下文一变就丢掉旧预览：留着上一次的清单会被误读成「这次也会用这些」。
    setPreview(undefined);
    setPreviewError('');
    if (previewKey !== previewGuard.current.key) {
      previewGuard.current.request += 1;
      previewGuard.current.key = '';
    }
    if (previewAvailable) requestPreview();
  }, [previewKey, previewAvailable, requestPreview]);

  const loadRunContext = useCallback((target: string | undefined): void => {
    contextGuard.current.request += 1;
    const requestId = contextGuard.current.request;
    contextGuard.current.runId = target ?? '';
    setRunContext(undefined);
    setContextError('');
    if (target === undefined) {
      setContextLoading(false);
      return;
    }
    const input: GetRunMemoryContextRequest = { runId: target };
    setContextLoading(true);
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.runContext(input),
        '读取本次运行记忆失败，请重试。',
      ).then((outcome) => {
        if (contextGuard.current.runId !== target || contextGuard.current.request !== requestId) {
          return;
        }
        setContextLoading(false);
        if (outcome.ok) {
          setRunContext(outcome.data);
          setContextError('');
        } else {
          setContextError(outcome.message);
        }
      }),
      '读取本次运行记忆',
    );
  }, []);

  useEffect(() => {
    loadRunContext(runId);
  }, [runId, loadRunContext]);

  return {
    preview,
    previewLoading,
    previewError,
    previewAvailable,
    requestPreview,
    runContext,
    contextLoading,
    contextError,
    refreshRunContext: () => loadRunContext(runId),
  };
}

/**
 * 本任务排除（产品设计 §3.5）。
 *
 * 不走「只更新 excludedMemoryIds」的捷径：一次保存必须提交**完整** TaskContext，
 * 原样带上 executor、Skill 绑定、材料、modelReference、内置工具策略与 MCP 绑定，
 * 否则一次排除会把用户其他上下文选择一起冲掉。`expectedRevision` 用当前修订，
 * 冲突时失败可见且不覆盖别人刚保存的更新；重试要重新读取上下文再做一次。
 */
export interface TaskMemoryExclusionState {
  /** 正在保存的排除动作对应的记忆，用于把该行的按钮置为「正在调整…」。 */
  savingMemoryId: string | undefined;
  error: string;
  /** 永不 reject：失败只写进 `error`，由面板内联呈现（§11.5.1）。 */
  toggle: (
    context: TaskContextRevision,
    memoryId: string,
  ) => Promise<TaskContextRevision | undefined>;
  clearError: () => void;
}

export function useTaskMemoryExclusion(): TaskMemoryExclusionState {
  const [savingMemoryId, setSavingMemoryId] = useState<string>();
  const [error, setError] = useState('');
  // 一次「代」＝一次点击。换任务或连点两次都会作废上一代的返回，
  // 迟到的保存结果不允许把当前面板的上下文改回旧值。
  const guard = useRef({ token: '', request: 0 });

  const toggle = useCallback(
    async (
      context: TaskContextRevision,
      memoryId: string,
    ): Promise<TaskContextRevision | undefined> => {
      guard.current.request += 1;
      const requestId = guard.current.request;
      const token = `${context.taskId}|${context.revision}|${memoryId}`;
      guard.current.token = token;
      setSavingMemoryId(memoryId);
      setError('');
      const excluded = context.excludedMemoryIds ?? [];
      const next = excluded.includes(memoryId)
        ? excluded.filter((id) => id !== memoryId)
        : [...excluded, memoryId];
      const request: SaveTaskContextRequest = {
        taskId: context.taskId,
        expectedRevision: context.revision,
        executor: context.executor,
        skillBindings: context.skillBindings,
        ...(context.materials ? { materials: context.materials } : {}),
        excludedMemoryIds: next,
        ...(context.mcpToolBindings ? { mcpToolBindings: context.mcpToolBindings } : {}),
        ...(context.modelReference ? { modelReference: context.modelReference } : {}),
        ...(context.builtinToolPolicy ? { builtinToolPolicy: context.builtinToolPolicy } : {}),
      };
      try {
        const result = await window.betterwork.taskContexts.save(request);
        if (guard.current.request !== requestId || guard.current.token !== token) {
          return undefined;
        }
        setSavingMemoryId(undefined);
        return result.context;
      } catch (caught: unknown) {
        if (guard.current.request === requestId) {
          setError(
            describeActionError(caught, '本任务的记忆调整没有保存，可能上下文已被更新，请重试。'),
          );
        }
        setSavingMemoryId(undefined);
        return undefined;
      }
    },
    [],
  );

  const clearError = useCallback((): void => {
    setError('');
  }, []);

  return { savingMemoryId, error, toggle, clearError };
}
