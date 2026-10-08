import { execFileSync } from 'node:child_process';
import process from 'node:process';

function readStandardInput() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function outputsFor(files) {
  const docsOnly = files.length > 0 && files.every((file) => file.endsWith('.md'));
  return `has_code=${!docsOnly}\ndocs_only=${docsOnly}\n`;
}

try {
  const [mode, base, head] = process.argv.slice(2);
  if (mode === '--files') {
    const input = await readStandardInput();
    process.stdout.write(outputsFor(input.split('\0').filter((file) => file !== '')));
  } else if (mode === '--pull-request' && base && head) {
    if (!/^[a-f\d]{40,64}$/iu.test(base) || !/^[a-f\d]{40,64}$/iu.test(head)) {
      throw new Error('Pull Request base/head SHA 格式无效。');
    }
    const output = execFileSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], {
      encoding: 'utf8',
    });
    process.stdout.write(outputsFor(output.split('\0').filter((file) => file !== '')));
  } else {
    throw new Error('用法：classify-pr-changes.mjs --pull-request <base-sha> <head-sha> | --files');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
