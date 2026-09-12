import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { preparePptAttempt } from './ppt-execution-attempt';

const roots: string[] = [];
const temporary = (): string => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'betterwork-ppt-attempt-')));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('copies authoring files to a fresh project and excludes old exports and reports', () => {
  const root = temporary();
  for (const folder of ['svg_output', 'exports', 'validation'])
    mkdirSync(path.join(root, 'project', folder), { recursive: true });
  writeFileSync(path.join(root, 'project/svg_output/slide.svg'), '<svg/>');
  writeFileSync(path.join(root, 'project/exports/old.pptx'), 'old');
  writeFileSync(path.join(root, 'project/validation/old.json'), '{}');
  const first = preparePptAttempt('svg-export', { project_dir: 'project' }, root, root);
  const second = preparePptAttempt('svg-export', { project_dir: 'project' }, root, root);
  expect(first.project_dir).not.toBe(second.project_dir);
  const project = first.project_dir as string;
  expect(readFileSync(path.join(project, 'svg_output/slide.svg'), 'utf8')).toBe('<svg/>');
  expect(existsSync(path.join(project, 'exports'))).toBe(false);
  expect(existsSync(path.join(project, 'validation'))).toBe(false);
  expect(existsSync(path.join(root, 'project/exports/old.pptx'))).toBe(true);
});

it('rejects symlink input projects before execution', () => {
  const root = temporary();
  const outside = temporary();
  symlinkSync(outside, path.join(root, 'linked'));
  expect(() => preparePptAttempt('svg-export', { project_dir: 'linked' }, root, root)).toThrow(
    'symbolic link',
  );
});

it('preserves the project name used by the native scaffold to derive its canvas', () => {
  const root = temporary();
  const name = '验收_ppt169_20260912';
  mkdirSync(path.join(root, name, 'svg_output'), { recursive: true });
  const prepared = preparePptAttempt('svg-export', { project_dir: name }, root, root);
  expect(path.basename(prepared.project_dir as string)).toBe(name);
  expect(path.relative(root, prepared.project_dir as string)).toMatch(/^\.attempts\//u);
});
