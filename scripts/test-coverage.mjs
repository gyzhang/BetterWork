import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

try {
  let output = 'coverage/full';
  const forwarded = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--output-dir' && args[index + 1]) output = args[++index];
    else if (
      /^--(?:project|config|maxWorkers|coverage\.reportsDirectory)(?:=|$)|^--outputFile(?:[.=]|$)/u.test(
        value,
      )
    )
      throw new Error(
        'Coverage projects, config, worker limit and output files are managed by the serial runner',
      );
    else forwarded.push(value);
  }
  if (output === '' || path.resolve(output) === process.cwd())
    throw new Error('Unsafe coverage output directory');
  if (path.resolve(output) !== path.resolve('coverage/full') && existsSync(output))
    throw new Error('Custom coverage output must be a new directory');
  if (path.resolve(output) === path.resolve('coverage/full'))
    rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const reports = [];
  for (const project of ['functional', 'heavy']) {
    const directory = path.join(output, project);
    process.stdout.write(`Coverage project: ${project}\n`);
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'vitest.coverage.config.ts',
        '--project',
        project,
        '--coverage',
        '--maxWorkers=4',
        `--coverage.reportsDirectory=${directory}`,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${directory}/tests.json`,
        ...forwarded,
      ],
      { stdio: 'inherit' },
    );
    writeFileSync(
      path.join(output, `${project}-status.json`),
      JSON.stringify(
        { project, status: result.status, signal: result.signal, error: result.error?.message },
        null,
        2,
      ) + '\n',
    );
    const report = path.join(directory, 'coverage-final.json');
    if (existsSync(report)) reports.push(report);
    if (result.error || result.status !== 0 || !existsSync(report)) {
      process.exitCode = result.status || 1;
      break;
    }
  }
  if (process.exitCode === undefined) {
    const merged = spawnSync(
      process.execPath,
      ['scripts/merge-coverage.mjs', path.join(output, 'merged'), ...reports],
      { stdio: 'inherit' },
    );
    if (merged.error || merged.status !== 0) process.exitCode = merged.status || 1;
  }
} catch (error) {
  process.stderr.write(
    `Coverage runner failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
