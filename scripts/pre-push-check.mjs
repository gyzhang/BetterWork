import { execFileSync } from 'node:child_process';
import process from 'node:process';

const zeroOid = '0000000000000000000000000000000000000000';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const initialStatus = git(['status', '--porcelain']);
if (initialStatus !== '') {
  fail('工作树不干净：先提交本轮改动，再推送；待推送对象必须与当前 HEAD 对应。');
} else {
  const checkedHead = git(['rev-parse', 'HEAD']);
  let hasCommitUpdate = false;
  let updates = '';
  for await (const chunk of process.stdin) updates += chunk.toString('utf8');

  for (const line of updates.split(/\r?\n/u).filter((value) => value.trim() !== '')) {
    const [localRef, localOid, remoteRef, remoteOid] = line.trim().split(/\s+/u);
    if (!localRef || !localOid || !remoteRef || !remoteOid) {
      fail('Git 推送引用格式无效：无法确认本次待推送提交。');
      break;
    }
    if (remoteRef === 'refs/heads/main') {
      fail('禁止直接推送 main：请将任务分支推送后创建 Pull Request，并通过 PR Gate 合并。');
      break;
    }
    if (localOid === zeroOid) continue;

    hasCommitUpdate = true;
    const pushedCommit = resolveCommit(localOid);
    if (pushedCommit !== checkedHead) {
      fail('推送对象不是当前 HEAD：先切换到要推送的提交，再进行验证。');
      break;
    }

    let base = remoteOid;
    if (remoteOid === zeroOid) {
      try {
        base = git(['merge-base', 'origin/main', pushedCommit]);
      } catch {
        fail('无法核对新分支差异：请先获取 origin/main，再推送任务分支。');
        break;
      }
    }
    try {
      execFileSync('git', ['diff', '--check', base, pushedCommit], { stdio: 'ignore' });
    } catch {
      fail('待推送差异包含空白错误：修正后再推送。');
      break;
    }
  }

  if (process.exitCode === undefined) {
    const finalHead = git(['rev-parse', 'HEAD']);
    const finalStatus = git(['status', '--porcelain']);
    if (hasCommitUpdate && (finalHead !== checkedHead || finalStatus !== '')) {
      fail('核对期间提交或工作树发生变化：本次推送停止，请在稳定状态重试。');
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
