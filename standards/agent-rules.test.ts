import { matchesGlob } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readQoderRuleMetadata } from './agent-rules';

describe('Qoder 规则元数据', () => {
  it.each([
    'trigger: glob: **/*.ts,tsx,css,mjs,json',
    'trigger: glob',
    "trigger: glob\nglob:\n  - '**/*.ts,tsx,css'",
    "trigger: glob\nglob:\n  - '**/*.ts'\n  - '**/*.tsx'",
    'trigger: glob\nglob: **/*.ts,tsx,css',
    'trigger: glob\nglob: **/*.ts,,**/*.tsx',
    'trigger: model_decision',
  ])('拒绝不会按约定加载的元数据：%s', (header) => {
    expect(readQoderRuleMetadata(`---\n${header}\n---\n规则正文`).issues.length).toBeGreaterThan(0);
  });

  it('IDE 保存的完整 glob 模式能覆盖嵌套 TS、TSX 与 CSS 文件，并排除其他目录', () => {
    const metadata = readQoderRuleMetadata(
      '---\ntrigger: glob\nglob: apps/desktop/src/renderer/**/*.ts,apps/desktop/src/renderer/**/*.tsx,apps/desktop/src/renderer/**/*.css\n---\n规则正文',
    );
    expect(metadata.issues).toEqual([]);
    for (const file of [
      'apps/desktop/src/renderer/src/hooks/use-example.ts',
      'apps/desktop/src/renderer/src/views/Example.tsx',
      'apps/desktop/src/renderer/src/styles.css',
    ])
      expect(
        metadata.globs.some((glob) => matchesGlob(file, glob)),
        file,
      ).toBe(true);
    expect(metadata.globs.some((glob) => matchesGlob('packages/example.ts', glob))).toBe(false);
  });
});
