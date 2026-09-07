import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@betterwork/agent-protocol': `${root}packages/agent-protocol/src/index.ts`,
      '@betterwork/agent-core': `${root}packages/agent-core/src/index.ts`,
      '@betterwork/tool-runtime': `${root}packages/tool-runtime/src/index.ts`,
    },
  },
  test: {
    include: [
      'standards/**/*.test.ts',
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
    ],
    environment: 'node',
  },
});
