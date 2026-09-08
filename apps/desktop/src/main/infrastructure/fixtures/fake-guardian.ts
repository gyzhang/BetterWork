import { spawn } from 'node:child_process';

/**
 * 合成 fixture：一个「不守规矩」的 guardian 替身，用来验证宿主的兜底路径。
 * 真实 guardian 不可能这样表现，但宿主必须在它这样表现时仍然给出可解释的结论。
 *
 * 模式由 argv[2] 决定：
 * - `idle`：收下指令后永不回应，验证握手看门狗；
 * - `stubborn`：报告目标已启动，但忽略 cancel，验证宿主按进程组兜底终止并核验；
 * - `crash`：报告启动后立刻退出，验证 guardian 丢失时宿主接管清理。
 */
const requestedMode = process.argv[2] ?? 'idle';
const mode = requestedMode === 'stubborn' || requestedMode === 'crash' ? requestedMode : 'idle';

interface LaunchSpec {
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isTextRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((entry) => typeof entry === 'string');

const readSpec = (value: unknown): LaunchSpec | null => {
  if (typeof value !== 'object' || value === null) return null;
  const fields = value as Record<string, unknown>;
  const executable = fields['executable'];
  const argv = fields['argv'];
  const cwd = fields['cwd'];
  const env = fields['env'];
  if (typeof executable !== 'string' || !isStringArray(argv)) return null;
  if (typeof cwd !== 'string' || !isTextRecord(env)) return null;
  return { executable, argv, cwd, env };
};

const startTarget = (nonce: string, spec: LaunchSpec): void => {
  const child = spawn(spec.executable, spec.argv, {
    cwd: spec.cwd,
    env: spec.env,
    // 目标不能继承替身的 stdout：那会把脚本输出混进控制通道，也会让宿主在替身退出后
    // 迟迟等不到管道 EOF。配合 silent-work fixture 使用。
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
  });
  const pid = child.pid;
  child.unref();
  if (pid === undefined) {
    process.stdout.write(
      `${JSON.stringify({ type: 'failure', nonce: '', phase: 'spawn', code: 'no-pid', summary: 'fixture could not start target', retryable: false })}\n`,
    );
    return;
  }
  const event = { type: 'started', nonce, pid, pgid: pid, startedAt: Date.now() };
  process.stdout.write(`${JSON.stringify(event)}\n`, () => {
    if (mode === 'crash') process.exit(0);
  });
};

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  // idle 模式对任何指令都不回应：专门用来验证宿主的握手看门狗。
  if (mode === 'idle') return;
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const fields = parsed as Record<string, unknown>;
    if (fields['type'] !== 'launch') continue;
    const nonce = fields['nonce'];
    const spec = readSpec(fields['spec']);
    if (typeof nonce !== 'string' || !spec) continue;
    startTarget(nonce, spec);
  }
});
process.stdin.on('end', () => {
  // idle 模式在宿主关闭通道后退出；stubborn / crash 由宿主负责收拾。
  if (mode === 'idle') process.exit(0);
});
