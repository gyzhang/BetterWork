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
 * 两条门禁共用一份配置，只分车道：
 * - `functional`＝`npm test`，是 `npm run verify` 的一部分；
 * - `bench`＝`npm run bench`，只跑 `*.bench.test.ts` 且**串行**，不进 verify。
 *
 * 为什么分开：墙钟与内存预算断言在 137 个文件并发跑时会漂到 1.5–5 倍（同一份代码
 * 连跑四轮红项组合每次都变），把它留在提交门禁里等于给每次提交加一次随机红。
 * 解法不是放宽阈值，而是给它一条不与他人抢核的串行车道；样本值每次仍打印在输出里。
 * 口径与门禁见 docs/12 §9，护栏锁「功能档里不得出现 performance.now() 计时断言」。
 */
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
          exclude: ['**/*.bench.test.ts', '**/*.bench.test.tsx'],
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
