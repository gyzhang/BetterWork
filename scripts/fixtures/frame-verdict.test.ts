import { describe, expect, it } from 'vitest';

import {
  type BitmapFrame,
  CHANNEL_TOLERANCE,
  frameAttemptVerdict,
  frameMismatch,
  type FrameSample,
  isSettled,
  MAX_SAMPLE_ATTEMPTS,
  readPixel,
  sampleMismatch,
  settleDelayMs,
} from './frame-verdict';

/**
 * 采样判据的单测不启动 Electron：位图手工构造就够。
 * 这组用例存在的原因是 2026-10-02 那条 CI 假红——macOS runner 容量吃紧时第一帧是中间态，
 * 单帧即判把环境差异读成了缺陷。「什么时候可以判」这件事必须能在没有真渲染的情况下被钉住。
 */

const sample = (overrides: Partial<FrameSample> = {}): FrameSample => ({
  x: 8,
  y: 4,
  width: 16,
  height: 8,
  color: [10, 20, 30],
  ...overrides,
});

/** 造一帧满色位图：入参按 RGB 给，字节按 (blue, green, red, 255) 写入，模拟 Chromium 的 BGRA 序。 */
function frameFilledWith(
  rgb: readonly [number, number, number],
  width = 16,
  height = 8,
): BitmapFrame {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = rgb[2];
    data[index * 4 + 1] = rgb[1];
    data[index * 4 + 2] = rgb[0];
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe('截图采样判据', () => {
  it('取点按 CSS 视口比例换算，并按 BGRA 反序读回 RGB', () => {
    // 视口 16×8、位图 32×16（2 倍缩放）：采样点 (8,4) 应落到像素 (16,8)。
    const data = new Uint8Array(32 * 16 * 4);
    const offset = (8 * 32 + 16) * 4;
    data[offset] = 200; // B
    data[offset + 1] = 100; // G
    data[offset + 2] = 50; // R
    data[offset + 3] = 255;

    expect(readPixel({ data, width: 32, height: 16 }, sample())).toEqual([50, 100, 200]);
  });

  it('通道差到 3 就判违规——容差放宽一次就要用这条用例拦', () => {
    const exact = frameFilledWith([10, 20, 30]);
    expect(sampleMismatch(sample(), exact)).toBe('');

    const offByTolerance = frameFilledWith([10 + CHANNEL_TOLERANCE, 20, 30]);
    expect(sampleMismatch(sample(), offByTolerance)).toBe('');

    const offByOneMore = frameFilledWith([10 + CHANNEL_TOLERANCE + 1, 20, 30]);
    expect(sampleMismatch(sample(), offByOneMore)).toBe('期望 10/20/30，实测 13/20/30');
  });

  it('整帧只报第一个没上屏的采样点，红字带上期望与实测', () => {
    const painted = frameFilledWith([255, 255, 255]);
    const first = sample({ x: 8, y: 4, color: [246, 247, 245] });
    const second = sample({ x: 0, y: 0, color: [160, 161, 159] });

    expect(frameMismatch([first, second], painted)).toBe('期望 246/247/245，实测 255/255/255');
    // 第一个点画对了才轮到第二个点；这一支没走到就等于漏判。
    expect(frameMismatch([sample({ color: [255, 255, 255] }), second], painted)).toBe(
      '期望 160/161/159，实测 255/255/255',
    );
  });

  it('连续两帧读数一致才作结论：中间态既不判红也不放行', () => {
    const intermediate = '期望 160/161/159，实测 166/166/166';
    // 首帧没有历史可比 ⇒ 什么都不能判（CI 那次就是拿首帧判了红）。
    expect(isSettled(undefined, intermediate)).toBe(false);
    expect(isSettled(undefined, '')).toBe(false);
    // 第一帧中间态、第二帧画对 ⇒ 两帧不同，继续等，不许把中间态读成缺陷。
    expect(isSettled(intermediate, '')).toBe(false);
    expect(isSettled('', intermediate)).toBe(false);
    // 两帧都画对 ⇒ 稳定；两帧报同一条违规 ⇒ 只能说明读数稳定，不能证明捕获到了当前窗口状态。
    expect(isSettled('', '')).toBe(true);
    expect(isSettled(intermediate, intermediate)).toBe(true);
  });

  it('稳定错误帧仍继续采样，耗尽预算后才判失败', () => {
    const mismatch = '期望 160/161/159，实测 246/247/245';

    expect(frameAttemptVerdict(undefined, mismatch, 0)).toBe('retry');
    expect(frameAttemptVerdict(mismatch, mismatch, 1)).toBe('retry');
    expect(frameAttemptVerdict('', '', 1)).toBe('pass');
    expect(frameAttemptVerdict(mismatch, mismatch, MAX_SAMPLE_ATTEMPTS - 1)).toBe('fail');
    expect(frameAttemptVerdict(mismatch, '', MAX_SAMPLE_ATTEMPTS - 1)).toBe('retry');
  });

  it('预算够长且退避，慢机器上等得到稳定帧', () => {
    // 前 6 次 50ms、之后 150ms：累计等待上限约 2.5s，够 macOS runner 的容量抖动窗口。
    const waits = Array.from({ length: 20 }, (_, attempt) => settleDelayMs(attempt));
    expect(waits.slice(0, 6)).toEqual([50, 50, 50, 50, 50, 50]);
    expect(waits.slice(6)).toEqual(Array(14).fill(150));
    expect(waits.reduce((total, delay) => total + delay, 0)).toBeGreaterThan(2_000);
  });
});
