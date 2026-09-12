import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createPptxRenderer } from './pptx-renderer';

/**
 * 真实渲染器的管道测试：走 `pptx-glimpse` + 本地补丁 + 随包字体这条完整链路。
 *
 * 服务层测试用假渲染器覆盖缓存与错误语义，覆盖不到的是「补丁没装上、选项没传到、
 * 字体没随包」这一类只在真实依赖上才会暴露的问题，所以这里必须用真实现。
 * fixture 是用 python-pptx 生成的合成稿（两页、16:9、中文），不含任何用户材料。
 * 需要重建时：`Presentation()` + 13.333x7.5 英寸 + 空白布局，第一页标题与三行正文用
 * `Microsoft YaHei`，第二页标题 `SimHei`、正文 `SimSun`；字体名必须走 `run.font.name`
 * 才会写进 XML 的 `typeface` 属性，否则测不到映射。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../../..');
const fontResourceDir = path.join(repositoryRoot, 'resources', 'fonts');
const fixturePath = path.join(here, 'fixtures', 'slide-preview-fixture.pptx');

const scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'betterwork-pptx-renderer-'));
afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

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
      expect(width).toBe(800);
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
});
