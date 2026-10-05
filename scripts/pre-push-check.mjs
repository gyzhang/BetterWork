import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';

const zeroOid = '0000000000000000000000000000000000000000';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function runNpm(script) {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

const initialStatus = git(['status', '--porcelain']);
if (initialStatus !== '') {
  fail('工作树不干净：先提交本轮改动，再推送；未提交的修复不能替 HEAD 取得绿灯。');
} else {
  const checkedHead = git(['rev-parse', 'HEAD']);
  let hasNewCommit = false;
  let codeChanges = false;
  let updates = '';
  for await (const chunk of process.stdin) updates += chunk.toString('utf8');

  for (const line of updates.split(/\r?\n/u).filter((value) => value.trim() !== '')) {
    const [localRef, localOid, remoteRef, remoteOid] = line.trim().split(/\s+/u);
    if (!localRef || !localOid || !remoteRef || !remoteOid) {
      fail('Git 推送引用格式无效：无法确认本次待推送提交。');
      break;
    }
    if (localOid === zeroOid) continue;

    hasNewCommit = true;
    const pushedCommit = resolveCommit(localOid);
    if (pushedCommit !== checkedHead) {
      fail('推送对象不是当前 HEAD：先切换到要推送的提交，再进行验证。');
      break;
    }

    if (remoteOid === zeroOid) {
      codeChanges = true;
      continue;
    }

    const changedFiles = execFileSync(
      'git',
      ['diff', '--name-only', '-z', remoteOid, pushedCommit],
      {
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter((file) => file !== '');
    if (changedFiles.length === 0 || changedFiles.some((file) => !file.endsWith('.md'))) {
      codeChanges = true;
    }
    try {
      execFileSync('git', ['diff', '--check', remoteOid, pushedCommit], { stdio: 'ignore' });
    } catch {
      fail('待推送差异包含空白错误：修正后再推送。');
      break;
    }
  }

  if (process.exitCode === undefined && hasNewCommit) {
    runNpm(codeChanges ? 'verify' : 'docs:check');
  }

  if (process.exitCode === undefined) {
    const finalHead = git(['rev-parse', 'HEAD']);
    const finalStatus = git(['status', '--porcelain']);
    if (finalHead !== checkedHead || finalStatus !== '') {
      fail('验证期间提交或工作树发生变化：本次推送停止，请在稳定状态重新验证。');
    }
  }
}

function resolveCommit(oid) {
  try {
    return git(['rev-parse', `${oid}^{commit}`]);
  } catch {
    return '';
  }
}
