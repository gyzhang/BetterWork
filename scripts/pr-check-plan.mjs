import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { isProductionSource } from './coverage-policy.mjs';

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
  if (
    files.length > 0 &&
    files.every((file) => file.endsWith('.md') && !/^resources\/(skills|experts)\//u.test(file))
  )
    return 'docs';
  if (
    files.some((file) => releaseManifests.has(file)) &&
    files.every((file) => file.endsWith('.md') || releaseManifests.has(file))
  )
    return 'resources';
  return 'code';
}

export function planChecks(files, base, part, root) {
  const scope = classifyChanges(files);
  const coverageSources = files.filter(
    (file) => isProductionSource(file) && existsSync(path.join(root, file)),
  );
  const uiRequired = files.some(
    (file) =>
      !/\.test\.[cm]?[jt]sx?$/u.test(file) &&
      (/^scripts\/(?:ui-render-check|fixtures\/(?:ui-|.*-steps|artifact-steps|process-recovery|acceptance-))/u.test(
        file,
      ) ||
        /^apps\/desktop\/src\/renderer\/.*\.(?:tsx|css)$/u.test(file) ||
        file === 'apps/desktop/src/main/window.ts' ||
        file === 'apps/desktop/electron.vite.config.ts'),
  );
  const dynamicTests = { functional: new Set(), heavy: new Set() };
  const add = (project, ...tests) => tests.forEach((file) => dynamicTests[project].add(file));
  for (const file of files) {
    if (
      file === 'packages/agent-protocol/src/index.ts' ||
      file.startsWith('apps/desktop/src/main/ipc/')
    )
      add('functional', 'apps/desktop/src/main/ipc/register-ipc.test.ts');
    if (file === 'scripts/fixtures/ipc-type-contract.mjs')
      add('functional', 'apps/desktop/src/main/ipc/register-ipc.test.ts');
    if (/^resources\/(?:dependency-locks|wheelhouse)\//u.test(file)) {
      add('functional', 'apps/desktop/src/main/infrastructure/dependency-lock-catalog.test.ts');
      add('heavy', 'apps/desktop/src/main/services/skill-dependency-service.test.ts');
    }
    if (file.startsWith('apps/desktop/src/main/db/'))
      add('functional', 'apps/desktop/src/main/db/migrate.test.ts');
    if (file === 'apps/desktop/src/main/infrastructure/knowledge-worker.ts')
      add(
        'functional',
        'apps/desktop/src/main/infrastructure/knowledge-worker.test.ts',
        'apps/desktop/src/main/services/knowledge-worker-runner.test.ts',
      );
    if (file === 'apps/desktop/src/main/infrastructure/skill-guardian.ts')
      add(
        'functional',
        'apps/desktop/src/main/infrastructure/skill-guardian.test.ts',
        'apps/desktop/src/main/services/skill-command-runtime.test.ts',
      );
    if (file === 'scripts/pr-check-plan.mjs' || file === 'scripts/pr-check.mjs')
      add('functional', 'scripts/pr-check.test.ts');
    if (/^scripts\/(?:coverage-policy\.(?:mjs|json)|diff-coverage\.mjs)$/u.test(file))
      add('functional', 'scripts/diff-coverage.test.ts');
    if (file === 'scripts/merge-coverage.mjs') add('functional', 'scripts/test-coverage.test.ts');
    if (/^scripts\/[^/]+\.mjs$/u.test(file)) {
      const candidate = file.replace(/\.mjs$/u, '.test.ts');
      if (candidate !== 'scripts/ui-render-check.test.ts' && existsSync(path.join(root, candidate)))
        add(candidate === 'scripts/drift-check.test.ts' ? 'heavy' : 'functional', candidate);
    }
    if (/^scripts\/fixtures\/process-recovery/u.test(file))
      add('functional', 'scripts/fixtures/process-recovery.test.ts');
  }
  const commands = [];
  const npm = (label, script) => commands.push({ label, command: 'npm', args: ['run', script] });
  if (scope === 'code' && part !== 'checks') npm('Lint', 'lint');
  if (part === 'lint') return { scope, commands, uiRequired };

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
    if (files.some((file) => /^resources\/(skills|experts)\//u.test(file))) {
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
    for (const project of ['functional', 'heavy']) {
      const forced = [...dynamicTests[project]].sort();
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
          ...forced.flatMap((file) => ['--exclude', file]),
          '--passWithNoTests',
        ],
      });
      if (forced.length > 0)
        commands.push({
          label: `${project} dynamic consumers`,
          command: 'npx',
          args: ['--no-install', 'vitest', 'run', '--project', project, ...forced],
        });
    }
  }
  const reportDirectories = [];
  for (const item of commands.filter(
    (command) => command.command === 'npx' && command.args.includes('vitest'),
  )) {
    const directory = `coverage/quick/${item.label.replaceAll(' ', '-')}`;
    item.args.push(
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${directory}/tests.json`,
    );
  }
  if (coverageSources.length > 0 && part !== 'lint') {
    for (const item of commands.filter(
      (command) => command.command === 'npx' && command.args.includes('vitest'),
    )) {
      const directory = `coverage/quick/${item.label.replaceAll(' ', '-')}`;
      reportDirectories.push(directory);
      item.args.push(
        '--config',
        'vitest.coverage.config.ts',
        '--coverage',
        '--maxWorkers=4',
        `--coverage.reportsDirectory=${directory}`,
        '--coverage.reporter=json',
        '--coverage.reporter=json-summary',
        ...coverageSources.flatMap((file) => ['--coverage.include', file]),
      );
    }
    commands.push({
      label: 'Changed line coverage',
      command: process.execPath,
      args: [
        'scripts/diff-coverage.mjs',
        '--base',
        base,
        '--reports',
        'coverage/quick',
        '--output',
        'coverage/quick/diff-coverage.json',
      ],
    });
  }
  const requiredTests = commands
    .filter(
      (command) =>
        command.label.includes('dynamic consumers') || command.label === 'Release consumers',
    )
    .flatMap((command) => command.args.filter((argument) => /\.test\.tsx?$/u.test(argument)));
  return { scope, commands, uiRequired, coverageSources, reportDirectories, requiredTests };
}
