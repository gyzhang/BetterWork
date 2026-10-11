import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

const alias = {
  '@betterwork/agent-protocol': `${root}packages/agent-protocol/src/index.ts`,
  '@betterwork/agent-core/errors': `${root}packages/agent-core/src/errors.ts`,
  '@betterwork/agent-core': `${root}packages/agent-core/src/index.ts`,
  '@betterwork/tool-runtime': `${root}packages/tool-runtime/src/index.ts`,
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: [
      'standards/**/*.test.ts',
      'scripts/**/*.test.ts',
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
    ],
    exclude: ['**/*.bench.test.ts', '**/*.bench.test.tsx'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportOnFailure: true,
      include: [
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop/src/preload/**/*.ts',
        'apps/desktop/src/renderer/src/**/*.{ts,tsx}',
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.bench.test.ts',
        '**/*.d.ts',
        '**/fixtures/**',
        '**/index.ts',
        'apps/desktop/src/main/index.ts',
        'apps/desktop/src/main/window.ts',
        'apps/desktop/src/preload/index.ts',
        'apps/desktop/src/renderer/src/main.tsx',
        'apps/desktop/src/renderer/src/icons.tsx',
        'apps/desktop/src/renderer/src/brand-logo.tsx',
        'apps/desktop/src/renderer/src/echarts-block.tsx',
        'apps/desktop/src/renderer/src/markdown-preview.tsx',
        'apps/desktop/src/renderer/src/notifications.tsx',
        'apps/desktop/src/renderer/src/components/context/**',
        'apps/desktop/src/renderer/src/components/layout/**',
        'packages/agent-core/src/fake-provider.ts',
      ],
    },
  },
});
