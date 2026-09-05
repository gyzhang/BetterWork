/**
 * Renderer 到主进程的每一次调用都必须收口。
 *
 * 此前普遍写作 `void someIpcCall()`：TypeScript 满意了，但失败被静默吞掉，
 * 用户只看到界面毫无反应。ESLint 的 no-floating-promises 已设为
 * `ignoreVoid: false`，就是为了逼出这里的显式选择。
 *
 * 两档处理方式，按「失败后用户能不能采取行动」二选一：
 *
 * - `reportAction`：调用方还没有错误出口时使用，必须把失败呈现给用户
 *   （内联提示、表单错误条或页面级错误条）。
 * - `trackAction`：调用自身已经负责呈现结果，或者属于用户无法据以行动的
 *   后台同步（刷新列表、同步窗口装饰）时使用，失败只记录到控制台。
 *
 * 不存在第三种「不处理」的选项。
 */

export const describeActionError = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/** 把失败交给调用方指定的呈现出口。 */
export function reportAction(
  action: Promise<unknown>,
  onError: (message: string) => void,
  fallback = '操作失败，请重试。',
): void {
  action.catch((error: unknown) => {
    onError(describeActionError(error, fallback));
  });
}

/** 记录失败但不打扰用户；label 用于在控制台里定位是哪一次调用。 */
export function trackAction(action: Promise<unknown>, label: string): void {
  action.catch((error: unknown) => {
    console.error(`${label} failed`, error);
  });
}
