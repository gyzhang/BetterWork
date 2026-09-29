/**
 * Renderer 到主进程的每一次调用都必须**收口**：失败必须到达一个真实存在的呈现出口。
 *
 * 此前普遍写作 `void someIpcCall()`：TypeScript 满意了，但失败被静默吞掉，
 * 用户只看到界面毫无反应。ESLint 的 no-floating-promises 已设为
 * `ignoreVoid: false`，就是为了逼出这里的显式选择。
 *
 * 两类处置，按「失败后用户能不能采取行动」二选一；下面两个函数是它们的**缺省实现**，
 * 不是唯一写法（docs/12 §5 的 Renderer 小节列了全部合法形状）：
 *
 * - `reportAction`：调用方还没有错误出口时使用，必须把失败呈现给用户
 *   （内联提示、表单错误条或页面级错误条）。出口不必是全局的——接在局部
 *   `TransientToast` 上同样合规，判据是「这句话有没有出口」，不是「出口有多大」。
 * - `trackAction`：调用自身已经负责呈现结果，或者属于用户无法据以行动的
 *   后台同步（刷新列表、同步窗口装饰）时使用，失败只记录到控制台。
 *
 * **手写 `try/catch` 属于第一类处置，不是第三种**：`reportAction` 只有 `onError` 一个
 * 出口，表达不了「成功也要播报一句」，需要时就手写，把失败交给同一个呈现出口即可。
 * hook 直接 `return` promise 交回调用方也不算违规——收口发生在调用链上最先能承载
 * 这条消息的那一层。
 *
 * 真正不存在的第三种**处置**是「不处理」：`void someIpcCall()`、空 `catch {}`、
 * 以及不写降级理由的 `.catch(() => undefined)`。降级本身合法，但理由必须写在
 * catch 体里，护栏按此断言。
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
