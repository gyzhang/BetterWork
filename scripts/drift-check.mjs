// 治理巡检：把「一次性审计」变成一条可以随时再跑的命令（docs/12 §1 的第四层）。
//
// 结构护栏（`standards/coding-standard.test.ts`）钉的是**代码与文档的形状**，它跑在 `npm test` 里，
// 因此看不到三样东西：① 仓库外部的状态（钩子有没有真的装进这个克隆、有没有攒下没推的提交）；
// ② 跨时间的变化（例外登记这个月长了多少、判据被引用得起来吗）；③ 制度有没有真的被执行
// （每个有提交的日子都有工作日志吗）。这三样正是「一段时间后漂移」的实际形状，归本脚本管。
//
// 什么时候跑：开始一次治理审计之前先跑一次拿底；每两周或每完成一个批次之后 `--save` 留一次读数；
// 同类问题第二次出现时（AGENTS.md 的沉淀纪律）用它确认不是又一处无人核对的例外在扩大。
// 它**不进** `npm run verify`：判据里有 `git log`，同一份代码在不同克隆上结论不同，
// 把这种检查塞进提交门禁只会让人下次直接跳过门禁（docs/12 §1）。
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultBaseline = 'docs/development/drift-readings.json';

/** 巡检窗口：多长时间内有提交就必须有日志。 */
const logWindowDays = 14;
/** 本地攒了多少天还没推出去，就要被问一句（未推送的改动既没进 CI 也对别人不可见）。 */
const defaultUnpushedAgeLimitDays = 3;

const PRUNED = new Set([
  '.git',
  '.betterwork',
  '.codeartsdoer',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
]);

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(`git ${args.join(' ')} 执行失败：${String(error)}`, { cause: error });
  }
}

function walk(directory, collected) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!PRUNED.has(entry.name)) walk(absolute, collected);
    } else if (entry.isFile()) collected.push(path.relative(repositoryRoot, absolute));
  }
  return collected;
}

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

const exists = (relativePath) => existsSync(path.join(repositoryRoot, relativePath));

const localDay = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

const isoNow = () => {
  const now = new Date();
  return `${localDay(now)} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;
};

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDay(date);
};

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value);

/** ① 制度有没有被执行：每个有提交的日子都要有一篇工作日志（AGENTS.md「结束一次任务」）。 */
function checkLogs(sinceDay, requiredDays) {
  const commits = git([
    'log',
    `--since=${sinceDay} 00:00:00`,
    '--date=short',
    '--format=%ad',
  ]).split('\n');
  const commitDays = [...new Set(commits.filter((day) => day !== ''))].sort();
  const days = [...new Set([...commitDays, ...requiredDays])].sort();
  const missing = days.filter((day) => !exists(path.join('docs', 'logs', `${day}.md`)));
  return {
    id: 'logs',
    label: '工作日志与提交对齐',
    readings: {
      窗口起始: sinceDay,
      有提交的天数: commitDays.length,
      要求补齐的日期: requiredDays.length,
    },
    findings: missing.map(
      (day) =>
        `${day} 有提交却没有 docs/logs/${day}.md${requiredDays.includes(day) ? '（本次点名要求的日期）' : ''}`,
    ),
  };
}

/** ② 仓库外部的状态：钩子有没有装进这个克隆、本地是不是攒了没推的提交。 */
function checkHookInstallation() {
  const hooksPath = git(['config', 'core.hooksPath']);
  return {
    id: 'hooks',
    label: '本地钩子已接入这个克隆',
    readings: { coreHooksPath: hooksPath === '' ? '(未设置)' : hooksPath },
    findings:
      hooksPath === '.husky/_'
        ? []
        : [
            '这个克隆没有把钩子指到 `.husky/_`：重新跑 `npm ci`（prepare 会执行 husky），' +
              '否则护栏与 `verify` 一次都不会自己跑',
          ],
  };
}

function checkUnpushed(ageLimitDays) {
  const lines = git(['log', 'origin/main..HEAD', '--date=short', '--format=%ad %s'])
    .split('\n')
    .filter((line) => line !== '');
  const oldest = lines.length === 0 ? null : (lines.at(-1) ?? '').slice(0, 10);
  const stale =
    oldest === null || !isDay(oldest)
      ? []
      : (() => {
          const [year, month, day] = oldest.split('-').map((part) => Number(part));
          const pushed = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1);
          return (Date.now() - pushed.getTime()) / 86_400_000 > ageLimitDays ? [oldest] : [];
        })();
  return {
    id: 'unpushed',
    label: '本地领先 origin/main 的提交',
    readings: {
      未推送提交: lines.length,
      最老一笔: oldest ?? '(无)',
      容忍天数: ageLimitDays,
      工作树改动: git(['status', '--porcelain'])
        .split('\n')
        .filter((line) => line !== '').length,
    },
    findings: stale.map(
      (day) => `${day} 的提交仍未推送：没进过 CI 的改动不算经过门禁（容忍 ${ageLimitDays} 天）`,
    ),
  };
}

/** ③ 规模与例外的读数：跨快照比较，例外增长必须被重新确认。 */
function collectReadings() {
  const files = walk(repositoryRoot, []);
  const tsFiles = files.filter((file) => /\.tsx?$/.test(file));
  const testFiles = tsFiles.filter((file) => /\.test\.tsx?$/.test(file));
  const sourceFiles = tsFiles.filter(
    (file) => !/\.test\.tsx?$/.test(file) && !file.startsWith('standards/'),
  );
  const cases = testFiles.reduce(
    (total, file) => total + (read(file).match(/\bit\(/gu) ?? []).length,
    0,
  );
  const guardrails = (read('standards/coding-standard.test.ts').match(/^ {2}it\(/gmu) ?? []).length;
  const exceptions = ['standards/coding-standard.test.ts', 'eslint.config.mjs'].reduce(
    (total, file) => total + (read(file).match(/reason:/gu) ?? []).length,
    0,
  );
  const eslintBlocks = (read('eslint.config.mjs').match(/^\s*files:/gmu) ?? []).length;
  const ruleFiles = files.filter(
    (file) => file.startsWith('.qoder/rules/') && file.endsWith('.md'),
  ).length;
  const sourceLines = sourceFiles.reduce((total, file) => total + read(file).split('\n').length, 0);
  return {
    测试文件: testFiles.length,
    用例: cases,
    结构护栏: guardrails,
    例外登记: exceptions,
    eslint配置块: eslintBlocks,
    规则文件: ruleFiles,
    产品源码行: sourceLines,
  };
}

/** 判据被引用的覆盖率：一条谁都没点过名的护栏，等于没人知道它存在。 */
function collectReferenceReadings() {
  const titles = new Set();
  let describe = '';
  for (const line of read('standards/coding-standard.test.ts').split('\n')) {
    const describeMatch = /^describe\(\s*'([^']+)'/u.exec(line);
    if (describeMatch?.[1]) describe = describeMatch[1];
    const itMatch = /^ {2}it\(\s*'([^']+)'/u.exec(line);
    if (!itMatch?.[1]) continue;
    titles.add(itMatch[1]);
    if (describe !== '') titles.add(`${describe} › ${itMatch[1]}`);
  }
  const livingDocs = walk(repositoryRoot, []).filter(
    (file) =>
      file === 'AGENTS.md' ||
      file === 'README.md' ||
      /^docs\/[^/]+\.md$/u.test(file) ||
      /^docs\/(?:development|designs)\/[^/]+\.md$/u.test(file) ||
      file.startsWith('.qoder/rules/'),
  );
  const referenced = new Set();
  let mentions = 0;
  for (const file of livingDocs) {
    for (const match of read(file).matchAll(/(?:护栏|判据|守卫)[：:]?[「]([^」]{4,90})[」]/gu)) {
      mentions += 1;
      const name = (match[1] ?? '').trim();
      if (titles.has(name)) referenced.add(name);
    }
  }
  return {
    判据总数: titles.size,
    现行文档点名次数: mentions,
    被点过名的判据: referenced.size,
  };
}

function loadBaseline(baselinePath) {
  if (!exists(baselinePath)) return null;
  try {
    return JSON.parse(read(baselinePath));
  } catch (error) {
    throw new Error(`基线读数 ${baselinePath} 解析失败：${String(error)}`, { cause: error });
  }
}

function checkExceptions(baseline, creatingBaseline) {
  const readings = collectReadings();
  const previous = baseline?.readings ?? null;
  const deltas = previous
    ? Object.entries(readings)
        .filter(([key]) => typeof previous[key] === 'number')
        .map(([key, value]) => [key, value - (previous[key] ?? 0)])
        .filter(([, delta]) => delta !== 0)
    : [];
  const findings =
    baseline === null && !creatingBaseline
      ? [
          `没有基线读数 ${defaultBaseline}：跑 \`npm run drift:check -- --save\` 留一次底` +
            '（本轮就在 --save 创建它，所以只提醒不判红）',
        ]
      : previous && (previous['例外登记'] ?? 0) < readings['例外登记']
        ? [
            `例外登记从 ${previous['例外登记']} 增到 ${readings['例外登记']}：` +
              '要么把代码改回收紧的那侧，要么 `--save` 重新留档并在当天日志写明为什么',
          ]
        : [];
  return {
    id: 'scale',
    label: '规模与例外读数',
    readings,
    deltas: Object.fromEntries(deltas),
    findings,
  };
}

function run(options) {
  const baseline = loadBaseline(options.baselinePath);
  const checks = [
    checkLogs(options.sinceDay, options.requiredDays),
    checkHookInstallation(),
    checkUnpushed(options.unpushedAgeLimitDays),
    checkExceptions(baseline, options.save),
  ];
  const findings = checks.flatMap((check) =>
    check.findings.map((finding) => `[${check.id}] ${finding}`),
  );
  const scale = checks.find((check) => check.id === 'scale');
  return {
    at: isoNow(),
    baselineSavedAt: baseline?.savedAt ?? '(无基线)',
    // 顶层 readings 是给别的脚本消费的汇总表；逐条明细仍留在 checks 里。
    readings: {
      ...collectReferenceReadings(),
      ...(scale?.readings ?? {}),
      巡检窗口天数: options.windowDays,
    },
    checks,
    findings,
  };
}

function render(report) {
  const lines = [`治理巡检 ${report.at}（基线：${report.baselineSavedAt}）`, ''];
  lines.push(
    `引用覆盖：判据 ${report.readings['判据总数']} 条，现行文档点名 ${report.readings['现行文档点名次数']} 次，覆盖 ${report.readings['被点过名的判据']} 条`,
  );
  for (const check of report.checks) {
    lines.push(`\n${check.findings.length === 0 ? '✓' : '⚠'} ${check.label}`);
    for (const [key, value] of Object.entries(check.readings)) {
      const delta = check.deltas?.[key];
      lines.push(
        `    ${key}：${value}${typeof delta === 'number' && delta !== 0 ? `（${delta > 0 ? '+' : ''}${delta}）` : ''}`,
      );
    }
  }
  if (report.findings.length > 0) {
    lines.push('', '需要处理：');
    for (const finding of report.findings) lines.push(`  ✗ ${finding}`);
  } else {
    lines.push('', '没有发现漂移。');
  }
  return lines.join('\n');
}

function parseArguments(argv) {
  const options = {
    sinceDay: dayOffset(logWindowDays - 1),
    requiredDays: [],
    unpushedAgeLimitDays: defaultUnpushedAgeLimitDays,
    windowDays: logWindowDays,
    baselinePath: defaultBaseline,
    json: false,
    save: false,
  };
  const unknown = [];
  for (const argument of argv) {
    const [flag, value] = argument.includes('=')
      ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)]
      : [argument, undefined];
    if (flag === '--since' && isDay(String(value))) {
      options.sinceDay = String(value);
      options.windowDays = Math.max(
        1,
        Math.round((new Date().getTime() - new Date(`${value}T00:00:00`).getTime()) / 86_400_000) +
          1,
      );
    } else if (flag === '--require-log' && isDay(String(value))) {
      options.requiredDays.push(String(value));
    } else if (flag === '--max-unpushed-age-days' && /^\d+$/u.test(String(value))) {
      options.unpushedAgeLimitDays = Number(value);
    } else if (flag === '--baseline' && typeof value === 'string' && value !== '') {
      options.baselinePath = value;
    } else if (flag === '--json') options.json = true;
    else if (flag === '--save') options.save = true;
    else unknown.push(argument);
  }
  if (unknown.length > 0)
    throw new Error(
      `不支持的参数：${unknown.join(' ')}。可用：--since=YYYY-MM-DD --require-log=YYYY-MM-DD ` +
        '--max-unpushed-age-days=N --baseline=PATH --json --save',
    );
  return options;
}

function saveBaseline(baselinePath, readings) {
  const absolute = path.join(repositoryRoot, baselinePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    `${JSON.stringify({ savedAt: isoNow(), readings: { ...readings } }, null, 2)}\n`,
    'utf8',
  );
}

try {
  const options = parseArguments(process.argv.slice(2));
  const report = run(options);
  if (options.save)
    saveBaseline(options.baselinePath, { ...report.readings, ...collectReadings() });
  console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
  if (options.save) console.log(`已留存读数：${options.baselinePath}`);
  process.exitCode = report.findings.length > 0 ? 1 : 0;
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
}
