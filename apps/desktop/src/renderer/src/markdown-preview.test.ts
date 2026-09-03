import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './markdown-preview';

describe('MarkdownPreview', () => {
  it('renders document structure without rendering raw HTML', () => {
    const html = renderToStaticMarkup(createElement(MarkdownPreview, { content: '# 季度复盘\n\n- 收入增长\n- 续约稳定\n\n> 保持重点客户跟进\n\n<script>alert(1)</script>' }));
    expect(html).toContain('<h1>季度复盘</h1>');
    expect(html).toContain('<li>收入增长</li>');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('<script>');
  });
});
