import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import {
  adaptPptCommand,
  materializeSvgVerificationScripts,
  patchPptScript,
} from './ppt-script-adaptation';

it('uses the declared language and inherits title size instead of imposing 28pt', () => {
  expect(patchPptScript('svg-export', "{'primary_language': 'zh-CN'}")).toContain('zh-Hans');
  expect(patchPptScript('template-merge', '        r1.font.size = Pt(title_size)')).toContain(
    'r1.font.size = None',
  );
});

it('pins the current exporter output to a fresh BetterWork attempt path', () => {
  const adapted = patchPptScript(
    'svg-export',
    'r = subprocess.run([sys.executable, exporter, project], capture_output=True,',
  );
  expect(adapted).toContain("'-o', os.path.join(project, 'exports', 'betterwork-output.pptx')");
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

it('copies the SVG exporter quality gates beside its adapted script without changing the Skill source', () => {
  const skillRoot = mkdtempSync(path.join(os.tmpdir(), 'betterwork-svg-skill-'));
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'betterwork-svg-work-'));
  const names = ['verify_palette.py', 'verify_layout.py', 'verify_geometry.py'];
  try {
    mkdirSync(path.join(skillRoot, 'scripts'));
    for (const name of names) writeFileSync(path.join(skillRoot, 'scripts', name), `# ${name}\n`);

    const targetDirectory = materializeSvgVerificationScripts(
      skillRoot,
      workDir,
      path.join('.adaptations', 'attempt-1'),
    );

    for (const name of names) {
      expect(readFileSync(path.join(targetDirectory, name), 'utf8')).toBe(`# ${name}\n`);
      expect(readFileSync(path.join(skillRoot, 'scripts', name), 'utf8')).toBe(`# ${name}\n`);
    }
  } finally {
    rmSync(skillRoot, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});
