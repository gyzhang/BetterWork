import type { PptxRenderer, RenderedSlide } from '../pptx-renderer';

/** 1x1 合法 PNG：够验证落盘与 base64 编码，又不把真实渲染拉进测试。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface RecordingPptxRenderer extends PptxRenderer {
  /** 每次 render 收到的入参路径，用于断言缓存命中时不再渲染。 */
  readonly calls: string[];
}

export function fakePptxRenderer(pageCount = 2): RecordingPptxRenderer {
  const calls: string[] = [];
  return {
    calls,
    async render(pptxPath: string): Promise<RenderedSlide[]> {
      calls.push(pptxPath);
      return Array.from({ length: pageCount }, (_, index) => ({
        slideIndex: index,
        png: TINY_PNG,
      }));
    },
  };
}

export const failingPptxRenderer = (message: string): RecordingPptxRenderer => {
  const calls: string[] = [];
  return {
    calls,
    async render(pptxPath: string): Promise<RenderedSlide[]> {
      calls.push(pptxPath);
      throw new Error(message);
    },
  };
};

export const emptyPptxRenderer = (): RecordingPptxRenderer => {
  const calls: string[] = [];
  return {
    calls,
    async render(pptxPath: string): Promise<RenderedSlide[]> {
      calls.push(pptxPath);
      return [];
    },
  };
};
