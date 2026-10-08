import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { guideHeadings, guideTarget } from '../apps/desktop/src/renderer/src/lib/user-guide';

describe('shipping user guide resources', () => {
  it('resolves every manual anchor and image against the shipping guide', () => {
    const root = new URL('../docs/guide/', import.meta.url);
    const content = readFileSync(new URL('README.md', root), 'utf8');
    const ids = new Set(guideHeadings(content).map((heading) => heading.id));
    const links = [...content.matchAll(/\]\(([^)]+)\)/gu)];
    expect(links.length).toBeGreaterThan(0);
    for (const match of links) {
      const source = match[1];
      const target = guideTarget(source);
      expect(target.kind).not.toBe('unavailable');
      if (target.kind === 'heading') expect(ids.has(target.id)).toBe(true);
      else if (source) expect(statSync(fileURLToPath(new URL(source, root))).isFile()).toBe(true);
    }
  });
});
