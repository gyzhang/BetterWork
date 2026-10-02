/**
 * 截图证据的采样判据（docs/12 §9：像素级结论必须由像素证明）。
 *
 * 抽成独立模块的原因不是「复用代码」，而是这条判据今天漂过一次：GitHub 的 macOS runner 容量吃紧时，
 * `capturePage` 拿到的第一帧是「遮罩已画、面板主题还没换上」的中间态（实测完全中性的 166/166/166，
 * 而 DOM 声明的期望 160/161/159 带冷暖差），单帧即判就成了假红。同族形状在焦点环那一份里已经付出过
 * 一次代价（逐帧读到稳定再判）。所以「什么时候可以判」是这段逻辑的本职，它必须能被单测钉住，
 * 而不是等下一次 CI 红。
 *
 * 本模块刻意不导入 Electron：位图按 `Uint8Array` 传进来就能验算取点、容差与稳定语义。
 */

/** DOM 侧算出的期望读数；`width`/`height` 是它所属的 CSS 视口尺寸，位图按同比例换算取点。 */
export interface FrameSample {
  x: number;
  y: number;
  width: number;
  height: number;
  color: number[];
}

/** 一帧原始位图。Chromium 的 N32 在本项目跑的所有 macOS 环境是 BGRA 序。 */
export interface BitmapFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * 通道容差只有 2：软件合成与真显示之间允许一轮舍入，不允许把「面板没画出来」读成噪声。
 * 放宽它等于把真实缺陷登记成环境差异——CI 那一发正是靠这个差值认出中间态的。
 */
export const CHANNEL_TOLERANCE = 2;

/** 采样预算：慢机器上等到位的最大次数，配 `settleDelayMs` 决定实际墙钟上限。 */
export const MAX_SAMPLE_ATTEMPTS = 20;

export const settleDelayMs = (attempt: number): number => (attempt < 6 ? 50 : 150);

/** 取一个采样点的 RGB（BGRA 反序）。 */
export function readPixel(frame: BitmapFrame, sample: FrameSample): number[] {
  const x = Math.floor((sample.x * frame.width) / sample.width);
  const y = Math.floor((sample.y * frame.height) / sample.height);
  const offset = (y * frame.width + x) * 4;
  return [frame.data[offset + 2] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset] ?? 0];
}

/** 单个采样点是否上屏：空串表示一致，非空是可直接进红字的读数对照。 */
export function sampleMismatch(sample: FrameSample, frame: BitmapFrame): string {
  const actual = readPixel(frame, sample);
  const withinTolerance = sample.color.every(
    (expected, index) => Math.abs((actual[index] ?? 0) - expected) <= CHANNEL_TOLERANCE,
  );
  return withinTolerance ? '' : `期望 ${sample.color.join('/')}，实测 ${actual.join('/')}`;
}

/** 整帧的判据：第一个没上屏的采样点即违规，红字带上它自己的读数对照。 */
export function frameMismatch(samples: readonly FrameSample[], frame: BitmapFrame): string {
  for (const sample of samples) {
    const mismatch = sampleMismatch(sample, frame);
    if (mismatch !== '') return mismatch;
  }
  return '';
}

/**
 * 连续两帧读数相同才算稳定：两帧都无违规 ⇒ 放行并落图；两帧报同一条违规 ⇒ 判红；
 * 不同或还没有上一帧 ⇒ 继续等。中间态只会出现在单帧里，所以它永远凑不齐「相同」这一条。
 */
export function isSettled(previous: string | undefined, current: string): boolean {
  return previous !== undefined && previous === current;
}
