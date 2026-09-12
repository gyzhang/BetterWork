import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertPptxToSvg } from 'pptx-glimpse';
import { afterAll, describe, expect, it } from 'vitest';

import { createPptxRenderer, PREVIEW_WIDTH } from './pptx-renderer';

/**
 * 真实渲染器的管道测试：走 `pptx-glimpse` + 本地补丁 + 随包字体这条完整链路。
 *
 * 服务层测试用假渲染器覆盖缓存与错误语义，覆盖不到的是「补丁没装上、选项没传到、
 * 字体没随包」这一类只在真实依赖上才会暴露的问题，所以这里必须用真实现。
 * fixture 是用 python-pptx 生成的合成稿（两页、16:9、中文），不含任何用户材料。
 * 需要重建时：`Presentation()` + 13.333x7.5 英寸 + 空白布局，第一页标题与三行正文用
 * `Microsoft YaHei`，第二页标题 `SimHei`、正文 `SimSun`；字体名必须走 `run.font.name`
 * 才会写进 XML 的 `typeface` 属性，否则测不到映射。第二页还要用
 * `shapes.build_freeform()` 补一个 EMU 坐标空间的自定义几何，它是下面那条
 * 回归护栏的靶子，删掉会让那条测试变成空断言。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../../..');
const fontResourceDir = path.join(repositoryRoot, 'resources', 'fonts');
const fixturePath = path.join(here, 'fixtures', 'slide-preview-fixture.pptx');

const scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'betterwork-pptx-renderer-'));
afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

/** 从 `<path .../>` 这类的标签文本里取一个属性，取不到就返回空串。 */
const attribute = (tag: string, name: string): string =>
  new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 从 IHDR 读宽高：8 字节签名 + 4 字节长度 + 4 字节块类型之后是大端 uint32。 */
const pngDimensions = (png: Buffer): { width: number; height: number } => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

describe('pptx renderer (real dependency)', () => {
  it('renders every slide of the fixture in page order', async () => {
    const slides = await createPptxRenderer(fontResourceDir).render(fixturePath);

    expect(slides.map((slide) => slide.slideIndex)).toEqual([0, 1]);
    for (const slide of slides) {
      expect(slide.png.subarray(0, PNG_SIGNATURE.byteLength)).toEqual(PNG_SIGNATURE);
      const { width, height } = pngDimensions(slide.png);
      expect(width).toBe(PREVIEW_WIDTH);
      expect(Math.abs(height / width - 9 / 16)).toBeLessThan(0.01);
      // 只挡「画了张近乎空白的图」：带版面内容的 800px 页远大于这个量级。
      // 中文字形是否命中不在字节数能分辨的范围里，由目视核对与 ADR-0013 验收项保证。
      expect(slide.png.byteLength).toBeGreaterThan(4000);
    }
  }, 20000);

  it('refuses to render when the bundled font directory holds no font file', async () => {
    const fontlessDir = path.join(scratchRoot, 'fontless');
    mkdirSync(fontlessDir, { recursive: true });
    writeFileSync(path.join(fontlessDir, 'notes.txt'), 'not a font');

    await expect(createPptxRenderer(fontlessDir).render(fixturePath)).rejects.toThrow(
      /缺少中文字体资源/,
    );
  });

  it('propagates the dependency failure for a file that is not a PPTX package', async () => {
    const notAPptx = path.join(scratchRoot, 'not-a-pptx.pptx');
    writeFileSync(notAPptx, 'this is definitely not a pptx package');

    await expect(createPptxRenderer(fontResourceDir).render(notAPptx)).rejects.toThrow(
      /invalid zip|zip/i,
    );
  });

  it('keeps the fixture a readable OOXML package', () => {
    expect(readFileSync(fixturePath).subarray(0, 2).toString()).toBe('PK');
  });

  // resvg 会整条丢弃有效缩放 <= 1/4096 的 path（实测边界：1/4095 画得出，1/4096 画不出）。
  // 上游把 custGeom 的 EMU 坐标空间原样留在 d 里，再用 transform="scale(1e-4)" 缩到像素，
  // 于是公司模板里的自定义图形——卡片标题条、平行四边形、三角形、菱形——在预览里全部消失，
  // 而 PNG 仍然是合法图片、渲染也不报错，单靠上面几条用例看不出来。本地补丁改成把缩放
  // 烘进坐标（见 patches/pptx-glimpse+0.10.4.patch），这里同时钉住结果和机制。
  it('draws custom geometry without relying on a scale resvg would drop', async () => {
    const slides = await convertPptxToSvg(readFileSync(fixturePath), {
      width: PREVIEW_WIDTH,
      fontDirs: [fontResourceDir],
      onlyFontDirs: true,
    });
    expect(slides, 'fixture 必须有两页，否则下面的断言会空转').toHaveLength(2);

    // 正向控制：第二页那个填充 #1B4593 的自定义几何必须真的出现在 SVG 里。
    const geometry = (slides[1]?.svg ?? '')
      .match(/<path[^>]*\/>/g)
      ?.filter((tag) => tag.includes('#1B4593'));
    expect(geometry, 'fixture 第二页的自定义几何没被输出').toHaveLength(1);
    const shape = geometry?.[0] ?? '';

    // 机制：坐标已经是像素量级，并且不再挂 scale 变换。
    const coordinates = attribute(shape, 'd').match(/-?\d+(?:\.\d+)?/g) ?? [];
    expect(coordinates, '自定义几何的 d 里必须有坐标').not.toHaveLength(0);
    expect(
      Math.max(...coordinates.map(Number)),
      '坐标必须落在像素量级，而不是留在 EMU 空间里等一个极小缩放',
    ).toBeLessThan(PREVIEW_WIDTH);
    expect(shape, '把缩放烘进坐标后不应再给 path 挂 transform').not.toContain('transform');

    for (const [index, slide] of slides.entries()) {
      const tiny: number[] = [];
      for (const match of (slide?.svg ?? '').matchAll(/scale\(([^)]*)\)/g)) {
        for (const part of (match[1] ?? '').split(',')) {
          const value = Math.abs(Number(part.trim()));
          if (Number.isFinite(value) && value > 0 && value <= 1 / 4096) tiny.push(value);
        }
      }
      expect(tiny, `第 ${index + 1} 页存在 resvg 会整条丢弃的极小缩放`).toEqual([]);
    }
  }, 20000);
});
