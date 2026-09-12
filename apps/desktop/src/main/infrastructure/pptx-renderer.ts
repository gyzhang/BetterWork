import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { convertPptxToPng } from 'pptx-glimpse';

/** 一页幻灯片的渲染结果；`slideIndex` 与协议一致，从 0 开始。 */
export interface RenderedSlide {
  slideIndex: number;
  png: Buffer;
}

/**
 * 渲染语义版本。凡是会改变输出像素的改动——本地补丁、字体映射表、输出宽度、
 * 几何与配色处理——都必须递增它。派生缓存按它整体作废。
 *
 * 不这么做就会留下「渲染器已修好，用户仍看到旧图」：缓存只按 versionId 键控，
 * 成果文件本身没变，没有任何信号能判定那批 PNG 是旧渲染器留下的。
 */
export const PREVIEW_REVISION = 1;

export interface PptxRenderer {
  /** 归属渲染器而不是调用方：谁产出这些字节，谁就决定缓存何时作废。 */
  readonly previewRevision: number;
  render(pptxPath: string): Promise<RenderedSlide[]>;
}

/**
 * 中文 PPT 里高频出现的字体名 → 思源黑体简体中文。
 *
 * 这些字体在 PowerPoint 主题里既可能以中文名也可能以英文名出现，且主题样式会带
 * 「（标题）/（正文）」后缀。当前只随包一份字体，缺条目不会立刻变空框（未命中的名字
 * 会兜底到已加载的第一份字体，实测输出字节一致）；但一旦随包第二种字族，兜底就变成
 * 取决于字体加载顺序。映射表的作用是把「请求的字体名」钉到「确定的字体」，
 * 不得删减——详见 resources/fonts/README.md 与 ADR-0013 决策 4。
 */
export const CHINESE_FONT_MAPPING: Readonly<Record<string, string>> = {
  微软雅黑: 'Source Han Sans SC',
  'Microsoft YaHei': 'Source Han Sans SC',
  'Microsoft YaHei UI': 'Source Han Sans SC',
  '微软雅黑（标题）': 'Source Han Sans SC',
  '微软雅黑（正文）': 'Source Han Sans SC',
  'Microsoft YaHei (Title)': 'Source Han Sans SC',
  'Microsoft YaHei (Body)': 'Source Han Sans SC',
  宋体: 'Source Han Sans SC',
  SimSun: 'Source Han Sans SC',
  黑体: 'Source Han Sans SC',
  SimHei: 'Source Han Sans SC',
  等线: 'Source Han Sans SC',
  DengXian: 'Source Han Sans SC',
  仿宋: 'Source Han Sans SC',
  FangSong: 'Source Han Sans SC',
  楷体: 'Source Han Sans SC',
  KaiTi: 'Source Han Sans SC',
  思源黑体: 'Source Han Sans SC',
  'Hiragino Sans GB': 'Source Han Sans SC',
  // 自身名称也登记，避免二次映射时丢失。
  'Source Han Sans SC': 'Source Han Sans SC',
};

/** 缩略图输出宽度。像素高度由幻灯片比例推导，不指定。 */
export const PREVIEW_WIDTH = 800;

const hasFontFile = (dir: string): boolean => {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((entry) => entry.endsWith('.otf') || entry.endsWith('.ttf'));
};

/**
 * 基于 pptx-glimpse 的纯 JS 渲染器：不启动任何外部进程。
 *
 * 中文字体必须由随包的 `fontResourceDir` 提供：macOS 自带的苹方/黑体是 TTC + AAT，
 * opentype.js 解析不了，缺字体时中文会整片变成空方框，所以宁可报错也不静默降级。
 *
 * `onlyFontDirs: true` 不是性能优化而是必需项（本地补丁提供，见 patches/）：
 * 不限制时渲染器会递归扫描系统字体目录并逐个解析——本机实测 263 个文件 / 300MB，
 * 冷启动 3746ms、常驻堆 2485MB（RSS 3.1GB），足以把 Electron 主进程压到 OOM。
 * 只看随包字体后同一渲染降到 303ms / 236MB，并且不再取决于用户装了什么字体。
 */
export function createPptxRenderer(fontResourceDir: string): PptxRenderer {
  return {
    previewRevision: PREVIEW_REVISION,
    async render(pptxPath: string): Promise<RenderedSlide[]> {
      if (!hasFontFile(fontResourceDir)) {
        throw new Error(
          `缺少中文字体资源：${fontResourceDir} 下没有 OTF/TTF，无法正确渲染中文幻灯片。`,
        );
      }
      const data = readFileSync(pptxPath);
      const slides = await convertPptxToPng(data, {
        width: PREVIEW_WIDTH,
        fontDirs: [fontResourceDir],
        onlyFontDirs: true,
        fontMapping: CHINESE_FONT_MAPPING,
      });
      return slides
        .map((slide) => ({ slideIndex: slide.slideNumber - 1, png: slide.png }))
        .filter((slide) => Number.isInteger(slide.slideIndex) && slide.slideIndex >= 0)
        .sort((left, right) => left.slideIndex - right.slideIndex);
    },
  };
}
