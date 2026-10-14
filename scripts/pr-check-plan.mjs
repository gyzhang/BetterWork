import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const releaseManifests = new Set([
  'resources/skills/release-manifest.json',
  'resources/experts/release-manifest.json',
]);
const formatConfiguration = new Set([
  '.prettierrc.json',
  '.prettierignore',
  '.editorconfig',
  'package-lock.json',
]);
const formatExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.css',
  '.html',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.mdx',
]);

export function classifyChanges(files) {
  if (files.length > 0 && files.every((file) => file.endsWith('.md'))) return 'docs';
  if (
    files.some((file) => releaseManifests.has(file)) &&
    files.every((file) => file.endsWith('.md') || releaseManifests.has(file))
  )
    return 'resources';
  return 'code';
}

export function planChecks(files, base, part, root) {
  const scope = classifyChanges(files);
  const commands = [];
  const npm = (label, script) => commands.push({ label, command: 'npm', args: ['run', script] });
  if (scope === 'code' && part !== 'checks') npm('Lint', 'lint');
  if (part === 'lint') return { scope, commands };

  if (scope !== 'docs') {
    const fullFormat = files.some(
      (file) => formatConfiguration.has(file) || path.basename(file) === 'package.json',
    );
    const formatFiles = fullFormat
      ? ['.']
      : files.filter(
          (file) => existsSync(path.join(root, file)) && formatExtensions.has(path.extname(file)),
        );
    if (formatFiles.length > 0)
      commands.push({
        label: 'Format',
        command: process.execPath,
        args: [
          path.join(root, 'node_modules/prettier/bin/prettier.cjs'),
          '--check',
          ...formatFiles,
        ],
      });
    if (scope === 'code') npm('Types', 'typecheck');
    if (files.some((file) => releaseManifests.has(file))) {
      npm('Release preflight', 'expert:preflight');
      commands.push({
        label: 'Release consumers',
        command: 'npx',
        args: [
          '--no-install',
          'vitest',
          'run',
          '--project',
          'functional',
          'scripts/builtin-release.test.ts',
          'scripts/expert-release-preflight.test.ts',
        ],
      });
    }
  }
  npm('Documentation', 'docs:check');
  if (scope === 'code') {
    for (const project of ['functional', 'heavy'])
      commands.push({
        label: `${project} tests`,
        command: 'npx',
        args: [
          '--no-install',
          'vitest',
          'run',
          '--project',
          project,
          `--changed=${base}`,
          '--exclude',
          'scripts/ui-render-check.test.ts',
          '--passWithNoTests',
        ],
      });
  }
  return { scope, commands };
}
