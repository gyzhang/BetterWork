import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarkdownPreview } from './markdown-preview';

describe('MarkdownPreview', () => {
  it('正文与消息中的宽表均有独立、可聚焦的滚动区并保留全部列', () => {
    for (const variant of ['document', 'message'] as const) {
      const html = renderToStaticMarkup(
        createElement(MarkdownPreview, {
          variant,
          content:
            '| 销售额（万元） | 回款额（万元） | 同比增长 |\n| --- | --- | --- |\n| 120 | 100 | 10% |',
        }),
      );
      expect(html).toContain('role="region" aria-label="表格，可横向滚动" tabindex="0"');
      expect(html).toContain('<th>销售额（万元）</th>');
      expect(html).toContain('<td>10%</td>');
    }
  });
  it('renders document structure without rendering raw HTML', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content:
          '# 季度复盘\n\n- 收入增长\n- 续约稳定\n\n> 保持重点客户跟进\n\n<script>alert(1)</script>',
      }),
    );
    expect(html).toContain('<h1>季度复盘</h1>');
    expect(html).toContain('<li>收入增长</li>');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('<script>');
  });
});
