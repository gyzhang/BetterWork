import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import istanbulCoverage from 'istanbul-lib-coverage';

try {
  const [output, ...reports] = process.argv.slice(2);
  if (!output || reports.length === 0)
    throw new Error('Usage: merge-coverage.mjs <output-directory> <coverage-final.json>...');
  const coverage = istanbulCoverage.createCoverageMap();
  for (const file of reports) coverage.merge(JSON.parse(readFileSync(file, 'utf8')));
  if (coverage.files().length === 0) throw new Error('Coverage reports contain no files');
  const summary = { total: coverage.getCoverageSummary().toJSON() };
  for (const file of coverage.files())
    summary[file] = coverage.fileCoverageFor(file).toSummary().toJSON();
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'coverage-final.json'), JSON.stringify(coverage.toJSON()) + '\n');
  writeFileSync(
    path.join(output, 'coverage-summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(summary.total) + '\n');
} catch (error) {
  process.stderr.write(
    `Coverage merge failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
