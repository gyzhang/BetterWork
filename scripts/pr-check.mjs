import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';

import { planChecks } from './pr-check-plan.mjs';

try {
  let base = 'origin/main';
  let part = 'all';
  let planOnly = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') planOnly = true;
    else if ((argument === '--base' || argument === '--part') && args[index + 1]) {
      const value = args[index + 1];
      if (argument === '--base') base = value;
      else part = value;
      index += 1;
    } else throw new Error('Usage: pr-check.mjs [--base <ref>] [--part all|lint|checks] [--plan]');
  }
  if (!['all', 'lint', 'checks'].includes(part)) throw new Error('Invalid quick check part');
  const git = (arguments_) => execFileSync('git', arguments_, { encoding: 'utf8' });
  const baseSha = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  git(['diff', '--check', baseSha]);
  const files = [
    ...new Set(
      [
        ...git(['diff', '--name-only', '-z', baseSha]).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter((file) => file !== ''),
    ),
  ];
  const plan = planChecks(files, baseSha, part, process.cwd());
  if (planOnly) process.stdout.write(`${JSON.stringify({ base: baseSha, files, ...plan })}\n`);
  else {
    process.stdout.write(`Quick check: ${plan.scope}; part: ${part}; base: ${baseSha}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary)
      appendFileSync(
        summary,
        `## Quick check (${part})\n\nScope: ${plan.scope}; base: \`${baseSha}\`\n\n| Check | Seconds | Result |\n| --- | ---: | --- |\n`,
      );
    for (const item of plan.commands) {
      const started = Date.now();
      process.stdout.write(`Starting ${item.label}\n`);
      const result = spawnSync(item.command, item.args, { stdio: 'inherit' });
      const status = result.status ?? 1;
      const seconds = ((Date.now() - started) / 1000).toFixed(2);
      process.stdout.write(`${item.label}: ${seconds}s; exit ${status}\n`);
      if (summary)
        appendFileSync(
          summary,
          `| ${item.label} | ${seconds} | ${status === 0 ? 'passed' : 'failed'} |\n`,
        );
      if (result.error) process.stderr.write(`${result.error.message}\n`);
      if (status !== 0) {
        process.exitCode = status;
        break;
      }
    }
  }
} catch (error) {
  process.stderr.write(
    `Quick check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
