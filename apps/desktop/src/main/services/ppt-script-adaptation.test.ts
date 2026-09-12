import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { adaptPptCommand, patchPptScript } from './ppt-script-adaptation';

it('uses the declared language and inherits title size instead of imposing 28pt', () => {
  expect(patchPptScript('svg-export', "{'primary_language': 'zh-CN'}")).toContain('zh-Hans');
  expect(patchPptScript('template-merge', '        r1.font.size = Pt(title_size)')).toContain(
    'r1.font.size = None',
  );
});

it('rejects missing or ambiguous patch targets', () => {
  expect(() => patchPptScript('template-merge', 'new contract')).toThrow('contract changed');
  expect(() =>
    patchPptScript('svg-export', "'primary_language': 'zh-CN'\n'primary_language': 'zh-CN'"),
  ).toThrow('contract changed');
});

it('refuses an unknown source hash and leaves source bytes unchanged', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-script-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    const file = path.join(root, 'scripts', 'merge_into_template.py');
    const content = 'r1.font.size = Pt(title_size)';
    writeFileSync(file, content);
    expect(() =>
      adaptPptCommand(
        'template-merge',
        { executable: '/python', argv: [file], cwd: root, env: {} },
        root,
      ),
    ).toThrow('source hash changed');
    expect(readFileSync(file, 'utf8')).toBe(content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
