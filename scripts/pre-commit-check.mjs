import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const lintExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const formatExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.mdx',
]);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function stopOnFailure(status) {
  if (status === 0) return false;
  process.exitCode = status;
  return true;
}

let stagedFiles = [];
try {
  stagedFiles = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRD', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => file !== '');
} catch (error) {
  process.stderr.write(
    `读取暂存文件失败：${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

if (process.exitCode === undefined) {
  if (stopOnFailure(run('git', ['diff', '--cached', '--check']))) {
    // Every commit at least checks staged whitespace.
  } else {
    const existingFiles = stagedFiles.filter((file) => existsSync(path.resolve(root, file)));
    const lintFiles = existingFiles.filter((file) => lintExtensions.has(path.extname(file)));
    const formatFiles = existingFiles.filter((file) => formatExtensions.has(path.extname(file)));
    const hasTypeScript = stagedFiles.some((file) => ['.ts', '.tsx'].includes(path.extname(file)));
    const hasMarkdown = stagedFiles.some((file) => file.endsWith('.md'));

    if (lintFiles.length > 0) {
      stopOnFailure(run(path.join(root, 'node_modules/.bin/eslint'), lintFiles));
    }
    if (process.exitCode === undefined && formatFiles.length > 0) {
      stopOnFailure(
        run(path.join(root, 'node_modules/.bin/prettier'), ['--check', ...formatFiles]),
      );
    }
    if (process.exitCode === undefined && hasTypeScript) {
      stopOnFailure(run('npm', ['run', 'typecheck']));
    }
    if (process.exitCode === undefined && hasMarkdown) {
      stopOnFailure(run('npm', ['run', 'docs:check']));
    }
  }
}
