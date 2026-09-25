import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@betterwork/agent-protocol': `${root}packages/agent-protocol/src/index.ts`,
      // 子路径别名必须排在其包名前缀之前：字符串别名按声明顺序取首个前缀匹配。
      '@betterwork/agent-core/errors': `${root}packages/agent-core/src/errors.ts`,
      '@betterwork/agent-core': `${root}packages/agent-core/src/index.ts`,
      '@betterwork/tool-runtime': `${root}packages/tool-runtime/src/index.ts`,
    },
  },
  test: {
    include: [
      'standards/**/*.test.ts',
      'scripts/**/*.test.ts',
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
    ],
    environment: 'node',
  },
});
