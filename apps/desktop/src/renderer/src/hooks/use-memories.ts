import type {
  CreateMemoryRequest,
  GetMemoryRequest,
  ListMemoriesRequest,
  MemoryConflictResolutionData,
  MemoryProjectionStateData,
  MemoryViewItem,
  MemoryWarning,
  MemoryWriteReceipt,
  ResolveMemoryConflictRequest,
  SetMemoryStatusRequest,
  UpdateMemoryRequest,
} from '@betterwork/agent-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { trackAction } from '../lib/async-action';
import {
  type MemoryFailure,
  type MemoryOutcome,
  type MemorySuccess,
  settleMemoryCall,
} from '../lib/memory-result';

/**
 * 记忆治理的界面状态（契约 §9）。
 *
 * 三条不变量：
 * 1. **领域失败不是异常**：`Result<T>` 的 `{ ok: false }` 由 `lib/memory-result` 归一，
 *    错误文案写进 `error`。调用方一律用 `trackAction` 收口，不得对同一个失败再
 *    `reportAction`，否则一次失败会呈现两遍。
 * 2. **迟到响应不得覆盖新状态**：每次载入带序列号并绑定筛选键；改筛选或换空间后
 *    旧响应直接丢弃（产品设计 §3.5、WM07）。
 * 3. **修订冲突保留草稿**：`REVISION_CONFLICT` 既不重载列表，也不清掉编辑器里
 *    用户正在写的内容；`currentRevision` 回带给界面说明「另有更新」。
 */

export type MemoryMutationOutcome = MemorySuccess<MemoryWriteReceipt> | MemoryFailure;
export type MemoryConflictOutcome = MemoryOutcome<MemoryConflictResolutionData>;
export type MemoryProjectionOutcome = MemoryOutcome<MemoryProjectionStateData>;

export interface MemoryFilters {
  workspaceId: string | undefined;
  expertId: string | undefined;
  /** 全库检索词；空串表示不检索。检索在 Main 的 SQL 层完成，界面不二次过滤。 */
  query: string;
}

export interface RevisionConflict {
  memoryId: string;
  /** 用户草稿基于哪一版；与 currentRevision 一起说明「另有更新」。 */
  expectedRevision: number;
  currentRevision: number | undefined;
}

export interface MemoriesState {
  memories: MemoryViewItem[];
  loading: boolean;
  error: string;
  /** 当前生效的检索词（已去除首尾空白）。 */
  query: string;
  /**
   * 后端还有未返回的记录（契约 §9.1 的 nextCursor）。治理页不做翻页，
   * 所以界面必须据此说明「只看到最近一页」，并引导用检索缩小范围。
   */
  truncated: boolean;
  revisionConflict: RevisionConflict | undefined;
  /**
   * 投影状态来自最近一次写回执：「已提交但投影待重建」是成功＋警告，
   * 不是保存失败（契约 §5.6），所以它独立于 `error` 呈现。
   */
  projectionState: MemoryWriteReceipt['projectionState'] | undefined;
  warnings: MemoryWarning[];
  setFilters: (filters: MemoryFilters) => void;
  setQuery: (query: string) => void;
  setError: (message: string) => void;
  clearRevisionConflict: () => void;
  refresh: () => void;
  create: (input: CreateMemoryRequest) => Promise<MemoryMutationOutcome>;
  update: (input: UpdateMemoryRequest) => Promise<MemoryMutationOutcome>;
  act: (input: SetMemoryStatusRequest) => Promise<MemoryMutationOutcome>;
  resolveConflict: (input: ResolveMemoryConflictRequest) => Promise<MemoryConflictOutcome>;
  rebuildProjection: (operationId: string) => Promise<MemoryProjectionOutcome>;
  /**
   * MI07：按需读取某个精确修订的来源摘要（契约 §11.5）。
   * 只读、不写足迹；越范围的记录由 Main 的读取边界处理，界面不自行补正文。
   */
  loadRevision: (input: GetMemoryRequest) => Promise<MemoryOutcome<MemoryViewItem>>;
}

/** 幂等键（契约 §5.6）：一次提交意图一个 UUID，重试沿用；换草稿才重新生成。 */
export const newMemoryOperationId = (): string => crypto.randomUUID();

const toListRequest = (filters: MemoryFilters): ListMemoriesRequest => ({
  ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
  ...(filters.expertId ? { expertId: filters.expertId } : {}),
  ...(filters.query.trim() === '' ? {} : { query: filters.query.trim() }),
});

const filtersKey = (filters: MemoryFilters): string =>
  `${filters.workspaceId ?? '-'}|${filters.expertId ?? '-'}|${filters.query.trim()}`;

export function useMemories(): MemoriesState {
  const [filters, setFiltersState] = useState<MemoryFilters>({
    workspaceId: undefined,
    expertId: undefined,
    query: '',
  });
  const [memories, setMemories] = useState<MemoryViewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQueryState] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState<RevisionConflict>();
  const [projectionState, setProjectionState] = useState<MemoryWriteReceipt['projectionState']>();
  const [warnings, setWarnings] = useState<MemoryWarning[]>([]);
  const guard = useRef({ request: 0, key: '' });
  const filtersRef = useRef(filters);

  /** `silent` 用于写成功后的补载：不得让列表闪回「正在加载」。 */
  const load = useCallback((silent: boolean): void => {
    guard.current.request += 1;
    const requestId = guard.current.request;
    const snapshot = filtersRef.current;
    const key = filtersKey(snapshot);
    guard.current.key = key;
    if (!silent) setLoading(true);
    trackAction(
      settleMemoryCall(
        window.betterwork.memories.list(toListRequest(snapshot)),
        '读取记忆列表失败，请重试。',
      ).then((outcome) => {
        // 迟到响应：筛选已变或已有更新的载入在途，本次结果一律作废（WM07）。
        if (guard.current.request !== requestId || guard.current.key !== key) return;
        if (outcome.ok) {
          setMemories(outcome.data.items);
          setWarnings(outcome.warnings);
          // 检索词与列表一起落地：界面回显的条件必须对应这批行，不能超前一步。
          setQueryState(snapshot.query.trim());
          setTruncated(outcome.data.nextCursor !== undefined);
          setError('');
        } else {
          // 读取失败不清列表：留着上一次可见内容并说明原因，比刷成空白更可解释。
          setError(outcome.message);
        }
        if (!silent) setLoading(false);
      }),
      '刷新记忆列表',
    );
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback((): void => {
    load(false);
  }, [load]);

  const setFilters = useCallback(
    (next: MemoryFilters): void => {
      if (filtersKey(next) === filtersKey(filtersRef.current)) return;
      filtersRef.current = next;
      setFiltersState(next);
      load(true);
    },
    [load],
  );

  /** 只改检索词，保留当前范围筛选；筛选键未变时由 setFilters 拦住重复请求。 */
  const setQuery = useCallback(
    (next: string): void => {
      setFilters({ ...filtersRef.current, query: next });
    },
    [setFilters],
  );

  const afterWrite = useCallback(
    (receipt: MemoryWriteReceipt, incoming: MemoryWarning[]): void => {
      setProjectionState(receipt.projectionState);
      setWarnings(incoming);
      setRevisionConflict(undefined);
      setError('');
      // 列表以 Main 为准：写成功后静默补载，不在界面侧推断第二套状态真相。
      load(true);
    },
    [load],
  );

  /**
   * 写路径的统一收口：领域冲突只报告不重载，其余失败同样保留列表与草稿。
   * `memoryId` 只用于把冲突定位回正在编辑的那一行。
   */
  const submitWrite = useCallback(
    async (
      call: () => Promise<MemoryMutationOutcome>,
      memoryId: string,
      expectedRevision: number,
    ): Promise<MemoryMutationOutcome> => {
      const outcome = await call();
      if (outcome.ok) {
        afterWrite(outcome.data, outcome.warnings);
        return outcome;
      }
      setError(outcome.message);
      if (outcome.code === 'REVISION_CONFLICT') {
        setRevisionConflict({
          memoryId,
          expectedRevision,
          currentRevision: outcome.currentRevision,
        });
      }
      return outcome;
    },
    [afterWrite],
  );

  const create = useCallback(
    async (input: CreateMemoryRequest): Promise<MemoryMutationOutcome> =>
      // 新建没有既有身份：冲突键回带本次幂等标识，仅用于定位是哪一次提交。
      submitWrite(
        () => settleMemoryCall(window.betterwork.memories.create(input), '保存记忆失败，请重试。'),
        input.operationId,
        0,
      ),
    [submitWrite],
  );

  const loadRevision = useCallback(
    async (input: GetMemoryRequest): Promise<MemoryOutcome<MemoryViewItem>> =>
      settleMemoryCall(window.betterwork.memories.get(input), '读取记忆来源失败，请重试。'),
    [],
  );

  const update = useCallback(
    async (input: UpdateMemoryRequest): Promise<MemoryMutationOutcome> =>
      submitWrite(
        () =>
          settleMemoryCall(window.betterwork.memories.update(input), '保存记忆修改失败，请重试。'),
        input.id,
        input.expectedRevision,
      ),
    [submitWrite],
  );

  const act = useCallback(
    async (input: SetMemoryStatusRequest): Promise<MemoryMutationOutcome> =>
      submitWrite(
        () =>
          settleMemoryCall(
            window.betterwork.memories.setStatus(input),
            '更新记忆状态失败，请重试。',
          ),
        input.id,
        input.expectedRevision,
      ),
    [submitWrite],
  );

  const resolveConflict = useCallback(
    async (input: ResolveMemoryConflictRequest): Promise<MemoryConflictOutcome> => {
      const outcome = await settleMemoryCall(
        window.betterwork.memories.resolveConflict(input),
        '提交口径裁决失败，请重试。',
      );
      if (outcome.ok) {
        setProjectionState(outcome.data.receipt.projectionState);
        setWarnings(outcome.warnings);
        setRevisionConflict(undefined);
        setError('');
        load(true);
        return outcome;
      }
      setError(outcome.message);
      if (outcome.code === 'REVISION_CONFLICT') {
        setRevisionConflict({
          memoryId: input.left.id,
          expectedRevision: input.left.expectedRevision,
          currentRevision: outcome.currentRevision,
        });
      }
      return outcome;
    },
    [load],
  );

  const rebuildProjection = useCallback(
    async (operationId: string): Promise<MemoryProjectionOutcome> => {
      const outcome = await settleMemoryCall(
        window.betterwork.memories.rebuildProjection({ operationId }),
        '重建记忆投影失败，请重试。',
      );
      if (outcome.ok) {
        setProjectionState(outcome.data.projectionState);
        setError('');
      } else {
        setError(outcome.message);
      }
      return outcome;
    },
    [],
  );

  const clearRevisionConflict = useCallback((): void => {
    setRevisionConflict(undefined);
  }, []);

  return {
    memories,
    loading,
    error,
    query,
    truncated,
    revisionConflict,
    projectionState,
    warnings,
    setFilters,
    setQuery,
    setError,
    clearRevisionConflict,
    refresh,
    create,
    update,
    act,
    resolveConflict,
    loadRevision,
    rebuildProjection,
  };
}
