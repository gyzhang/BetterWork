import { describe, expect, it } from 'vitest';

import { guideHeadings, guideTarget } from './user-guide';

describe('user guide navigation', () => {
  it('ignores fenced examples and gives duplicate Chinese headings separate anchors', () => {
    const headings = guideHeadings('# Guide\n## 2. 配置\n```md\n## Hidden\n```\n## 2. 配置');
    expect(headings.map(({ id, line }) => ({ id, line }))).toEqual([
      { id: 'guide', line: 1 },
      { id: '2-配置', line: 2 },
      { id: '2-配置-1', line: 6 },
    ]);
  });

  it('limits links to bundled images, the example, and document anchors', () => {
    expect(guideTarget('#2-%E9%85%8D%E7%BD%AE')).toEqual({ kind: 'heading', id: '2-配置' });
    expect(guideTarget('examples/collaboration-notes.md')).toEqual({ kind: 'example' });
    expect(guideTarget('images/01-work-overview.png')).toEqual({
      kind: 'image',
      url: './images/01-work-overview.png',
    });
    for (const source of [
      '#%',
      '../private.png',
      'images/../private.png',
      'https://example.com',
      'file:///tmp/example.md',
    ]) {
      expect(guideTarget(source)).toEqual({ kind: 'unavailable' });
    }
  });
});
