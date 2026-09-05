/**
 * Agent 层的统一错误词汇。
 *
 * 取消语义此前在 agent-engine、fake-provider 与四个 tool 里各写了一遍
 * `Object.assign(new Error(...), { name: 'AbortError' })`。任何一处写错名字，
 * 取消就会被当成失败上报，因此收口到这里，全仓只有一份定义。
 */

export const ABORT_ERROR_NAME = 'AbortError';
export const ABORT_ERROR_MESSAGE = 'Run cancelled';

export const abortError = (): Error =>
  Object.assign(new Error(ABORT_ERROR_MESSAGE), { name: ABORT_ERROR_NAME });

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === ABORT_ERROR_NAME;

/** 把未知异常转成可展示、可落库的文本；不吞掉非 Error 抛出物。 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
