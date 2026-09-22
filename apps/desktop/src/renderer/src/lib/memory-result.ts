import type {
  MemoryError,
  MemoryErrorCode,
  MemoryWarning,
  Result,
} from '@betterwork/agent-protocol';

/**
 * `Result<T>` 的界面侧收口（docs/development/memory-contracts.md §9.1、§9.3）。
 *
 * 两类失败必须分开：
 * - 领域失败由 `Result.error` 带着错误码回来，界面按码决定怎么处理
 *   （`REVISION_CONFLICT` 要保住草稿，`TERMINAL_MEMORY` 要禁止再次提交）。
 * - 传输失败（IPC 被拒、主进程抛错）没有错误码，只能统一呈现为可重试的失败，
 *   绝不去解析 Electron 的异常字符串猜业务码。
 */

export const TRANSPORT_FAILURE_CODE = 'TRANSPORT_FAILURE';
export type MemoryFailureCode = MemoryErrorCode | typeof TRANSPORT_FAILURE_CODE;

export interface MemorySuccess<TData> {
  ok: true;
  data: TData;
  warnings: MemoryWarning[];
}

export interface MemoryFailure {
  ok: false;
  code: MemoryFailureCode;
  message: string;
  retryable: boolean;
  /** CAS 冲突时主进程回带的当前修订；其余失败为 undefined。 */
  currentRevision: number | undefined;
}

export type MemoryOutcome<TData> = MemorySuccess<TData> | MemoryFailure;

const transportFailure = (error: unknown, fallback: string): MemoryFailure => ({
  ok: false,
  code: TRANSPORT_FAILURE_CODE,
  message: error instanceof Error && error.message ? error.message : fallback,
  retryable: true,
  currentRevision: undefined,
});

const domainFailure = (error: MemoryError): MemoryFailure => ({
  ok: false,
  code: error.code,
  message: error.message,
  retryable: error.retryable,
  currentRevision: error.currentRevision,
});

/** 把一次 IPC 调用与它的 `Result` 收成判别联合；永不 reject，调用方只看 `ok`。 */
export async function settleMemoryCall<TData>(
  call: Promise<Result<TData>>,
  fallback: string,
): Promise<MemoryOutcome<TData>> {
  try {
    const result = await call;
    if (result.ok) return { ok: true, data: result.data, warnings: result.warnings };
    return domainFailure(result.error);
  } catch (error: unknown) {
    return transportFailure(error, fallback);
  }
}

/** 已经拿到 `Result`（例如直接 await 的场景）时的同等收口。 */
export function settleMemoryResult<TData>(result: Result<TData>): MemoryOutcome<TData> {
  if (result.ok) return { ok: true, data: result.data, warnings: result.warnings };
  return domainFailure(result.error);
}
