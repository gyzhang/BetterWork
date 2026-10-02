import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

const alias = {
  '@betterwork/agent-protocol': `${root}packages/agent-protocol/src/index.ts`,
  // 子路径别名必须排在其包名前缀之前：字符串别名按声明顺序取首个前缀匹配。
  '@betterwork/agent-core/errors': `${root}packages/agent-core/src/errors.ts`,
  '@betterwork/agent-core': `${root}packages/agent-core/src/index.ts`,
  '@betterwork/tool-runtime': `${root}packages/tool-runtime/src/index.ts`,
};

/**
 * 三条门禁共用一份配置，只分车道：
 * - `functional`＝`npm test` 的前半，是 `npm run verify` 的一部分；
 * - `heavy`＝`npm test` 的后半，**串行**跑重文件，同样进 verify；
 * - `bench`＝`npm run bench`，只跑 `*.bench.test.ts` 且**串行**，不进 verify。
 *
 * 为什么分开：墙钟与内存预算断言在 137 个文件并发跑时会漂到 1.5–5 倍（同一份代码
 * 连跑四轮红项组合每次都变），把它留在提交门禁里等于给每次提交加一次随机红。
 * 解法不是放宽阈值，而是给它一条不与他人抢核的串行车道；样本值每次仍打印在输出里。
 * 口径与门禁见 docs/12 §9，护栏锁「功能档里不得出现 performance.now() 计时断言」。
 *
 * `heavy` 的收录判据是**单文件墙钟 ≥ 20s**（2026-09-29 负载 29.90 下实测：office-parser
 * 46.5s、App 44.4s、knowledge-foundation.perf 28.8s、run-service 25.7s、
 * mac-process-supervisor 24.0s、skill-dependency-service 23.1s；第 7 名 15.9s 起断档）。
 * 这些文件要么渲染整棵应用树，要么在真实子进程／解压／数据库上跑，撞 5s 默认超时的
 * 从来是它们而不是快文件——2026-09-29 22:2x 负载 36 时 functional 档唯一的红就是
 * `App.test.tsx` 的一条 `Test timed out`，AssertionError 0 条。
 *
 * **串行档只隔离「我们自己这 170 个文件互相抢核」，隔离不了本机其它进程**：同晚把
 * `App.test.tsx` 单独跑（负载 31、CPU 只吃到 23%）仍红 5 条超时，且红项与并发跑那次
 * 完全不同（红项轮换＝争抢特征）。所以它是必要而不充分的一半：分档之后 functional 档
 * 墙钟由 199.7s 降到 17.4s（heavy 档 72.8s，两档合计仍比原来快），但外部负载高时
 * heavy 档自己还是会撞 5s 默认超时。
 */
const HEAVY_TEST_FILES = [
  'apps/desktop/src/main/infrastructure/office-parser.test.ts',
  'apps/desktop/src/main/infrastructure/mac-process-supervisor.test.ts',
  'apps/desktop/src/main/services/knowledge-foundation.perf.test.ts',
  'apps/desktop/src/main/services/run-service.test.ts',
  'apps/desktop/src/main/services/skill-dependency-service.test.ts',
  'apps/desktop/src/renderer/src/App.test.tsx',
  // 独立 Git/CLI 夹具多次启动 TypeScript 解析器：2026-10-02 定向实测 24.83s。
  'scripts/drift-check.test.ts',
];

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    projects: [
      {
        test: {
          name: 'functional',
          include: [
            'standards/**/*.test.ts',
            'scripts/**/*.test.ts',
            'packages/**/*.test.ts',
            'apps/**/*.test.ts',
            'apps/**/*.test.tsx',
          ],
          exclude: ['**/*.bench.test.ts', '**/*.bench.test.tsx', ...HEAVY_TEST_FILES],
        },
      },
      {
        test: {
          name: 'heavy',
          include: HEAVY_TEST_FILES,
          // 串行：重文件不与 170 个快文件同窗抢核，否则红哪几条随机器负载而变。
          fileParallelism: false,
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'bench',
          include: ['standards/**/*.bench.test.ts', 'apps/**/*.bench.test.ts'],
          // 串行：基准不与其它文件同窗抢核，否则测的是调度而不是算法。
          fileParallelism: false,
          pool: 'forks',
        },
      },
    ],
  },
});
